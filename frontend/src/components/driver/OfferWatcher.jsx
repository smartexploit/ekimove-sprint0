import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, MapPin, Navigation } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import {
  TRIPS_CHANGED_EVENT,
  acceptOffer,
  declineOffer,
  getCurrentOffer,
  shareLocation,
} from '../../services/dispatchService.js'
import { formatNaira } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'
import { playTone, unlockAudio } from '../../utils/callTones.js'

const POLL_MS = 3000
// Often enough for passengers to watch the driver approach on the map.
const LOCATION_EVERY_MS = 10000

function beep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    // Sound is a bonus; browsers may block it until the driver taps the page.
  }
}

function distanceText(metres) {
  if (metres == null) return null
  return metres < 1000 ? `${metres} m away` : `${(metres / 1000).toFixed(1)} km away`
}

/**
 * Shows a trip offered to this driver, with a countdown and Accept/Decline.
 * While the driver is online it also shares their location (if allowed) so
 * EkiMove can offer them the nearest trips.
 */
export default function OfferWatcher() {
  const navigate = useNavigate()
  const [offer, setOffer] = useState(null)
  const [online, setOnline] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [location, setLocation] = useState('unknown')
  const lastOfferId = useRef(null)
  const [fullSeconds, setFullSeconds] = useState(30)

  // Poll for offers while the page is visible.
  useEffect(() => {
    let active = true
    const check = () => {
      if (document.visibilityState !== 'visible') return
      getCurrentOffer()
        .then((data) => {
          if (!active) return
          setOnline(Boolean(data.is_online))
          const next = data.offer
          setOffer(next)
          if (next) {
            setSecondsLeft(next.seconds_left)
            if (next.id !== lastOfferId.current) {
              lastOfferId.current = next.id
              setFullSeconds(Math.max(next.seconds_left, 10))
              setError('')
              beep()
            }
          }
        })
        .catch(() => {})
    }
    check()
    const timer = window.setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  // Ring and vibrate while a new trip is waiting for an answer.
  const ringing = Boolean(offer) && secondsLeft > 0
  useEffect(() => {
    if (!ringing) return undefined
    return playTone('ring')
  }, [ringing])

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => window.removeEventListener('pointerdown', unlockAudio)
  }, [])

  // Local countdown between polls.
  useEffect(() => {
    if (!offer) return undefined
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [offer])

  // Share location while online.
  useEffect(() => {
    if (!online || !navigator.geolocation) return undefined
    let lastSent = 0
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setLocation('on')
        if (Date.now() - lastSent < LOCATION_EVERY_MS) return
        lastSent = Date.now()
        shareLocation(position.coords.latitude, position.coords.longitude).catch(() => {})
      },
      () => setLocation('off'),
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [online])

  async function respond(accept) {
    setBusy(true)
    setError('')
    try {
      if (accept) {
        await acceptOffer(offer.id)
        setOffer(null)
        window.dispatchEvent(new Event(TRIPS_CHANGED_EVENT))
        navigate('/driver/trips')
      } else {
        await declineOffer(offer.id)
        setOffer(null)
      }
    } catch (err) {
      setError(err.message || 'That did not work.')
      setOffer(null)
    } finally {
      setBusy(false)
    }
  }

  if (offer && secondsLeft > 0) {
    const urgent = secondsLeft <= 10
    return (
      <div className="offer-overlay">
      <section className="offer-card" role="alertdialog" aria-modal="true" aria-labelledby="offer-title"
        aria-describedby="offer-route">
        <div className="row row-between">
          <p id="offer-title" className="offer-eyebrow">
            <BellRing size={18} aria-hidden="true" /> New {offer.service_type === 'haulage' ? 'load job' : 'trip'} for you
          </p>
          <span className={`offer-timer ${urgent ? 'is-urgent' : ''}`} aria-live="polite">{secondsLeft}s</span>
        </div>
        <div className="offer-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (secondsLeft / fullSeconds) * 100)}%` }} />
        </div>
        {offer.drivers_notified > 1 && (
          <p className="offer-race">Sent to {offer.drivers_notified} nearby drivers. First to accept gets it.</p>
        )}
        <p id="offer-route" className="offer-route">
          {offer.origin_text} <span aria-hidden="true">→</span><span className="sr-only">to</span> {offer.destination_text}
        </p>
        <p className="offer-meta">
          {vehicleLabel(offer.vehicle_type)} · {offer.passenger_count} {offer.passenger_count === 1 ? 'passenger' : 'passengers'}
          {distanceText(offer.distance_m) ? ` · Pickup ${distanceText(offer.distance_m)}` : ''}
        </p>
        {offer.load_description && <p className="offer-meta">Load: {offer.load_description}</p>}
        <div className="offer-money">
          <div>
            <p className="offer-label">You earn</p>
            <p className="offer-earning">{formatNaira(offer.earning, { decimals: 0 })}</p>
          </div>
          <p className="offer-meta" style={{ textAlign: 'right' }}>
            Fare {formatNaira(offer.fare, { decimals: 0 })}<br />EkiMove {formatNaira(offer.commission, { decimals: 0 })}
          </p>
        </div>
        <div className="offer-actions">
          <button type="button" className="btn btn-gold btn-lg" disabled={busy} onClick={() => respond(true)}>
            {busy ? 'Please wait…' : 'Accept trip'}
          </button>
          <button type="button" className="btn btn-on-dark" disabled={busy} onClick={() => respond(false)}>
            Decline
          </button>
        </div>
      </section>
      </div>
    )
  }

  return (
    <>
      {error && <Alert tone="warning">{error}</Alert>}
      {online && location === 'off' && (
        <p className="location-note">
          <MapPin size={16} aria-hidden="true" /> Turn on location for EkiMove to get trips near you first.
        </p>
      )}
      {online && location === 'on' && (
        <p className="location-note is-on">
          <Navigation size={16} aria-hidden="true" /> You're online and sharing your location. New trips will pop up here.
        </p>
      )}
    </>
  )
}
