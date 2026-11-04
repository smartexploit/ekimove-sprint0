import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { getAccessToken, getStoredUser } from '../../services/authService.js'
import { acceptCall, declineCall, getIncomingCall, startTripCall } from '../../services/callService.js'
import CallSession, { getMicrophone } from '../../utils/callSession.js'
import { playTone, unlockAudio } from '../../utils/callTones.js'
import { CallContext } from './callContext.js'

const INCOMING_POLL_MS = 4000
const CALL_ROLES = ['passenger', 'driver']
const END_TEXT = {
  ended: 'Call ended', declined: 'Call declined', missed: 'No answer', cancelled: 'Call cancelled',
  failed: 'Call dropped. Check your connection, or send a message instead.',
}

function closeCallNotification(callId) {
  navigator.serviceWorker?.ready
    .then((reg) => reg.getNotifications({ tag: `call-${callId}` }))
    .then((list) => list.forEach((n) => n.close()))
    .catch(() => {})
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Timer({ since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>{clock((now - since) / 1000)}</span>
}

function CallScreen({ view, onAccept, onDecline, onHangUp, onMute }) {
  const { call, state } = view
  const name = call.other.name
  const role = call.other.role === 'driver' ? 'Your driver' : 'Your passenger'
  let status
  if (state === 'incoming') status = 'is calling you…'
  else if (state === 'starting') status = 'Starting call…'
  else if (state === 'calling') status = 'Ringing…'
  else if (state === 'connecting') status = 'Connecting…'
  else if (state === 'connected') status = view.reconnecting ? 'Reconnecting…' : <Timer since={view.answeredAt} />
  else status = END_TEXT[view.endStatus] || 'Call ended'

  return (
    <div className="call-screen" role="dialog" aria-modal="true" aria-label={`Call with ${name}`}>
      <div className="call-who">
        <span className="call-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <p className="call-role">{role}</p>
        <h2>{name}</h2>
        <p className="call-status" aria-live="polite">{status}</p>
        {view.error && <p className="call-error" role="alert">{view.error}</p>}
      </div>
      <div className="call-foot">
      <p className="call-note">In-app call · your number stays private · not recorded</p>
      <div className="call-actions">
        {state === 'incoming' ? (
          <>
            <button type="button" className="call-btn call-btn-end" onClick={onDecline} aria-label="Decline">
              <PhoneOff size={28} aria-hidden="true" /><span>Decline</span>
            </button>
            <button type="button" className="call-btn call-btn-accept" onClick={onAccept} aria-label="Answer">
              <Phone size={28} aria-hidden="true" /><span>Answer</span>
            </button>
          </>
        ) : state !== 'ended' ? (
          <>
            <button type="button" className={`call-btn call-btn-quiet ${view.muted ? 'is-on' : ''}`} onClick={onMute}
              aria-pressed={view.muted} disabled={state === 'starting'}>
              {view.muted ? <MicOff size={26} aria-hidden="true" /> : <Mic size={26} aria-hidden="true" />}
              <span>{view.muted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button type="button" className="call-btn call-btn-end" onClick={onHangUp} aria-label="End call">
              <PhoneOff size={28} aria-hidden="true" /><span>End</span>
            </button>
          </>
        ) : null}
      </div>
      </div>
    </div>
  )
}

/**
 * Handles in-app calls for signed-in passengers and drivers: watches for
 * incoming calls, rings, and runs one call at a time.
 */
export function CallProvider({ children }) {
  const [view, setView] = useState(null)
  const session = useRef(null)
  const seen = useRef(new Set())
  const viewRef = useRef(null)
  viewRef.current = view

  const clearLater = useCallback(() => {
    window.setTimeout(() => {
      if (viewRef.current?.state === 'ended') setView(null)
    }, 2500)
  }, [])

  const attach = useCallback((call, iceServers, stream) => {
    const current = new CallSession({
      call, iceServers, stream,
      onChange: (next) => {
        setView((v) => ({ ...v, ...next, error: v?.error }))
        if (next.state === 'ended') {
          session.current = null
          clearLater()
        }
      },
    })
    session.current = current
    return current.begin()
  }, [clearLater])

  // Ring for incoming calls; ringback while calling.
  const state = view?.state
  useEffect(() => {
    if (state !== 'incoming' && state !== 'calling') return undefined
    return playTone(state === 'incoming' ? 'ring' : 'ringback')
  }, [state])

  // Watch for incoming calls while the app is open.
  useEffect(() => {
    let timer = null
    let stopped = false
    const check = async () => {
      timer = null
      const user = getStoredUser()
      if (stopped) return
      if (getAccessToken() && CALL_ROLES.includes(user?.role) && document.visibilityState === 'visible'
          && !session.current && !viewRef.current) {
        try {
          const { call } = await getIncomingCall()
          if (call && !seen.current.has(call.id) && !session.current && !viewRef.current) {
            seen.current.add(call.id)
            setView({ state: 'incoming', call, muted: false })
          }
        } catch {
          /* checked again shortly */
        }
      }
      if (!stopped) timer = window.setTimeout(check, INCOMING_POLL_MS)
    }
    const wake = () => {
      if (document.visibilityState === 'visible' && timer) {
        window.clearTimeout(timer)
        check()
      }
    }
    check()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  // An incoming call that stops ringing elsewhere (missed or cancelled).
  const incomingId = view?.state === 'incoming' ? view.call.id : null
  useEffect(() => {
    if (!incomingId) return undefined
    const timer = window.setInterval(async () => {
      try {
        const { call } = await getIncomingCall()
        if (!call || call.id !== incomingId) {
          setView((v) => (v?.call.id === incomingId && v.state === 'incoming'
            ? { ...v, state: 'ended', endStatus: 'missed' } : v))
          clearLater()
        }
      } catch {
        /* keep ringing */
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [incomingId, clearLater])

  const startCall = useCallback(async (rideId, other) => {
    if (session.current || viewRef.current) throw new Error('You’re already on a call.')
    unlockAudio()
    const placeholder = { id: 'new', other, role: 'caller' }
    setView({ state: 'starting', call: placeholder, muted: false })
    let stream
    try {
      stream = await getMicrophone()
      const { call, ice_servers: iceServers } = await startTripCall(rideId)
      setView({ state: 'calling', call, muted: false })
      await attach(call, iceServers, stream)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (session.current) session.current.hangUp(true)
      setView({ state: 'ended', call: placeholder, endStatus: 'error', error: error.message || 'Could not start the call.' })
      window.setTimeout(() => setView((v) => (v?.endStatus === 'error' ? null : v)), 4000)
    }
  }, [attach])

  const accept = useCallback(async () => {
    const call = viewRef.current?.call
    if (!call) return
    unlockAudio()
    closeCallNotification(call.id)
    setView((v) => ({ ...v, state: 'connecting' }))
    let stream
    try {
      stream = await getMicrophone()
      const accepted = await acceptCall(call.id)
      await attach(accepted.call, accepted.ice_servers, stream)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (session.current) session.current.hangUp(true)
      else declineCall(call.id).catch(() => {})
      setView((v) => ({ ...v, state: 'ended', endStatus: 'error', error: error.message || 'Could not answer.' }))
      window.setTimeout(() => setView((v) => (v?.endStatus === 'error' ? null : v)), 4000)
    }
  }, [attach])

  const decline = useCallback(() => {
    const call = viewRef.current?.call
    if (!call) return
    closeCallNotification(call.id)
    declineCall(call.id).catch(() => {})
    setView({ ...viewRef.current, state: 'ended', endStatus: 'declined' })
    clearLater()
  }, [clearLater])

  const hangUp = useCallback(() => {
    if (session.current) session.current.hangUp(false)
    else setView(null)
  }, [])

  const mute = useCallback(() => {
    if (session.current) session.current.setMuted(!session.current.muted)
  }, [])

  return (
    <CallContext.Provider value={{ startCall, busy: Boolean(view) }}>
      {children}
      {view && <CallScreen view={view} onAccept={accept} onDecline={decline} onHangUp={hangUp} onMute={mute} />}
    </CallContext.Provider>
  )
}
