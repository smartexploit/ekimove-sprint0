import { useCallback, useEffect, useRef, useState } from 'react'

const GOOD_ENOUGH_M = 12
const MAX_WAIT_MS = 20000

/**
 * Takes the phone's position for a few seconds and keeps the most precise
 * reading (GPS gets sharper as it settles). Stops early once it's good.
 */
export default function useGpsReading() {
  const [reading, setReading] = useState(null) // { latitude, longitude, accuracy_m }
  const [status, setStatus] = useState('idle') // idle | locating | done | error
  const [error, setError] = useState('')
  const watch = useRef(null)
  const timer = useRef(null)

  const stop = useCallback(() => {
    if (watch.current != null) navigator.geolocation?.clearWatch(watch.current)
    watch.current = null
    window.clearTimeout(timer.current)
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(() => {
    stop()
    setReading(null)
    setError('')
    if (!navigator.geolocation) {
      setStatus('error')
      setError('This phone can’t share its location.')
      return
    }
    setStatus('locating')
    let best = null
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy),
        }
        if (!best || next.accuracy_m < best.accuracy_m) {
          best = next
          setReading(next)
        }
        if (next.accuracy_m <= GOOD_ENOUGH_M) {
          stop()
          setStatus('done')
        }
      },
      (err) => {
        stop()
        setStatus('error')
        setError(err.code === 1
          ? 'Location is blocked. Allow location for EkiMove in your browser or phone settings.'
          : 'Couldn’t get your location. Step outside and try again.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_WAIT_MS },
    )
    timer.current = window.setTimeout(() => {
      stop()
      setStatus(best ? 'done' : 'error')
      if (!best) setError('Couldn’t get your location. Step outside and try again.')
    }, MAX_WAIT_MS)
  }, [stop])

  const reset = useCallback(() => {
    stop()
    setReading(null)
    setStatus('idle')
    setError('')
  }, [stop])

  return { reading, status, error, start, stop: () => { stop(); setStatus(reading ? 'done' : 'idle') }, reset }
}
