/**
 * Ring and ringback sounds made in the browser (no audio files). Browsers
 * only allow sound after the person has tapped the page, so a ring may be
 * silent until then; phones also vibrate where supported.
 */
let context = null

function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!context) context = new Ctx()
  if (context.state === 'suspended') context.resume().catch(() => {})
  return context
}

function beep(ctx, frequencies, start, length, volume) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.02)
  gain.gain.setValueAtTime(volume, start + length - 0.03)
  gain.gain.linearRampToValueAtTime(0, start + length)
  gain.connect(ctx.destination)
  for (const frequency of frequencies) {
    const osc = ctx.createOscillator()
    osc.frequency.value = frequency
    osc.connect(gain)
    osc.start(start)
    osc.stop(start + length)
  }
}

/** Starts a repeating tone; returns a function that stops it. */
export function playTone(kind) {
  let stopped = false
  let timer = null
  const ring = kind === 'ring'
  const cycle = () => {
    if (stopped) return
    const ctx = audioContext()
    if (ctx) {
      const now = ctx.currentTime + 0.05
      if (ring) {
        beep(ctx, [440, 480], now, 0.4, 0.18)
        beep(ctx, [440, 480], now + 0.6, 0.4, 0.18)
      } else {
        beep(ctx, [425], now, 1, 0.08) // ringback, as on Nigerian networks
      }
    }
    if (ring && navigator.vibrate) navigator.vibrate([400, 200, 400])
    timer = window.setTimeout(cycle, ring ? 2500 : 4000)
  }
  cycle()
  return () => {
    stopped = true
    window.clearTimeout(timer)
    if (navigator.vibrate) navigator.vibrate(0)
  }
}

export function unlockAudio() {
  audioContext()
}
