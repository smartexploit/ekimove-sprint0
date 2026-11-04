/**
 * One in-app voice call (WebRTC). The two phones exchange connection
 * details through the EkiMove API, then talk directly; audio never passes
 * through EkiMove and is never recorded.
 *
 * States: 'calling' (caller, waiting for an answer), 'connecting',
 * 'connected', 'ended'.
 */
import { endCall, getCallState, sendCallSignal } from '../services/callService.js'

const LIVE = ['ringing', 'active']
const FAST_POLL_MS = 1000
const SLOW_POLL_MS = 3000
const CANDIDATE_BATCH_MS = 400
const DROP_GRACE_MS = 12000

export const MIC_DENIED = 'Allow microphone access for EkiMove in your browser settings, then try again.'

export async function getMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error('This browser can’t make calls. Please update it, or send a message instead.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw new Error(MIC_DENIED, { cause: error })
    throw new Error('Your microphone isn’t available. Close other apps using it and try again.', { cause: error })
  }
}

export default class CallSession {
  constructor({ call, iceServers, stream, onChange }) {
    this.call = call
    this.stream = stream
    this.onChange = onChange
    this.state = call.role === 'caller' ? 'calling' : 'connecting'
    this.muted = false
    this.after = 0
    this.pending = []
    this.queued = []
    this.closed = false
    this.answeredAt = null
    this.pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 2 })
    stream.getTracks().forEach((track) => this.pc.addTrack(track, stream))

    this.audio = document.createElement('audio')
    this.audio.autoplay = true
    this.audio.setAttribute('playsinline', '')
    this.audio.hidden = true
    document.body.appendChild(this.audio)

    this.pc.ontrack = (event) => {
      this.audio.srcObject = event.streams[0] || new MediaStream([event.track])
      this.audio.play().catch(() => {})
    }
    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.pending.push(event.candidate.toJSON())
      if (!this.batchTimer) this.batchTimer = window.setTimeout(() => this.flushCandidates(), CANDIDATE_BATCH_MS)
    }
    this.pc.onconnectionstatechange = () => this.connectionChanged()
  }

  emit(extra = {}) {
    this.onChange?.({ state: this.state, muted: this.muted, call: this.call, answeredAt: this.answeredAt, ...extra })
  }

  async begin() {
    if (this.call.role === 'caller') {
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true })
      await this.pc.setLocalDescription(offer)
      await sendCallSignal(this.call.id, 'offer', { type: offer.type, sdp: offer.sdp })
    }
    this.emit()
    this.poll()
  }

  async flushCandidates() {
    this.batchTimer = null
    if (this.closed || !this.pending.length) return
    // The callee may only send once the call is accepted, which it already is.
    const batch = this.pending.splice(0, this.pending.length)
    try {
      await sendCallSignal(this.call.id, 'candidates', batch)
    } catch {
      /* the call may have ended; polling will notice */
    }
  }

  async poll() {
    if (this.closed) return
    try {
      const data = await getCallState(this.call.id, this.after)
      if (this.closed) return
      this.call = data.call
      for (const signal of data.signals) {
        this.after = Math.max(this.after, signal.id)
        await this.handleSignal(signal)
      }
      if (this.state === 'calling' && data.call.status === 'active') {
        this.state = 'connecting'
        this.emit()
      }
      if (!LIVE.includes(data.call.status)) {
        this.finish(data.call.status)
        return
      }
    } catch {
      /* a missed poll is retried */
    }
    const delay = this.state === 'connected' ? SLOW_POLL_MS : FAST_POLL_MS
    this.pollTimer = window.setTimeout(() => this.poll(), delay)
  }

  async handleSignal(signal) {
    let payload
    try {
      payload = JSON.parse(signal.payload)
    } catch {
      return
    }
    if (signal.kind === 'offer' && this.call.role === 'callee') {
      await this.pc.setRemoteDescription(payload)
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      await sendCallSignal(this.call.id, 'answer', { type: answer.type, sdp: answer.sdp })
      await this.addQueued()
    } else if (signal.kind === 'answer' && this.call.role === 'caller') {
      await this.pc.setRemoteDescription(payload)
      await this.addQueued()
    } else if (signal.kind === 'candidates' && Array.isArray(payload)) {
      this.queued.push(...payload)
      if (this.pc.remoteDescription) await this.addQueued()
    }
  }

  async addQueued() {
    const list = this.queued.splice(0, this.queued.length)
    for (const candidate of list) {
      try {
        await this.pc.addIceCandidate(candidate)
      } catch {
        /* an unusable route is skipped */
      }
    }
  }

  connectionChanged() {
    const status = this.pc.connectionState
    if (status === 'connected') {
      window.clearTimeout(this.dropTimer)
      if (this.state !== 'connected') {
        this.state = 'connected'
        this.answeredAt = this.answeredAt || Date.now()
        this.emit()
      } else {
        this.emit({ reconnecting: false })
      }
    } else if (status === 'disconnected') {
      this.emit({ reconnecting: true })
      window.clearTimeout(this.dropTimer)
      this.dropTimer = window.setTimeout(() => this.hangUp(true), DROP_GRACE_MS)
    } else if (status === 'failed') {
      this.hangUp(true)
    }
  }

  setMuted(muted) {
    this.muted = muted
    this.stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    this.emit()
  }

  async hangUp(failed = false) {
    if (this.closed) return
    const id = this.call.id
    this.finish(failed ? 'failed' : 'ended')
    try {
      await endCall(id, failed)
    } catch {
      /* the server also ends calls on its own */
    }
  }

  finish(status) {
    if (this.closed) return
    this.closed = true
    window.clearTimeout(this.pollTimer)
    window.clearTimeout(this.batchTimer)
    window.clearTimeout(this.dropTimer)
    this.stream.getTracks().forEach((track) => track.stop())
    try {
      this.pc.close()
    } catch {
      /* already closed */
    }
    this.audio.srcObject = null
    this.audio.remove()
    this.state = 'ended'
    this.emit({ endStatus: status })
  }
}
