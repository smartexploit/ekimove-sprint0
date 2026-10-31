import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Share2, Star } from 'lucide-react'
import LazyMap from '../map/LazyMap.jsx'
import { getTracking, shareTrip, stopSharingTrip } from '../../services/tripService.js'
import { etaText, tripMarkers } from '../../utils/tracking.js'

const POLL_MS = 8000

/**
 * Live view of an assigned trip for the passenger: pickup PIN, the driver
 * on a map with distance and ETA, and sharing with a trusted contact.
 */
export default function TripTracker({ rideId, emergencyContact }) {
  const [view, setView] = useState(null)
  const [shareLink, setShareLink] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const load = () => getTracking(rideId).then((data) => active && setView(data)).catch(() => {})
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [rideId])

  const markers = useMemo(() => tripMarkers(view), [view])

  async function share() {
    setMessage('')
    try {
      const { path } = await shareTrip(rideId)
      const url = new URL(path, window.location.origin).toString()
      setShareLink(url)
      const text = `I'm on an EkiMove trip. Follow it live: ${url}`
      if (navigator.share) {
        await navigator.share({ title: 'My EkiMove trip', text, url }).catch(() => {})
      } else {
        await navigator.clipboard?.writeText(url)
        setMessage('Link copied. Paste it to someone you trust.')
      }
    } catch (err) {
      setMessage(err.message || 'Could not create a link.')
    }
  }

  async function stop() {
    await stopSharingTrip(rideId).catch(() => {})
    setShareLink('')
    setMessage('Sharing stopped. The old link no longer works.')
  }

  if (!view) return null
  const smsText = shareLink ? encodeURIComponent(`I'm on an EkiMove trip. Follow it live: ${shareLink}`) : ''

  return (
    <div className="tracker">
      {view.pickup_pin && (
        <div className="pin-box" role="note">
          <KeyRound size={18} aria-hidden="true" />
          <div>
            <p className="pin-label">Your pickup PIN</p>
            <p className="pin-code" aria-label={`Pickup PIN ${view.pickup_pin.split('').join(' ')}`}>{view.pickup_pin}</p>
          </div>
          <p className="pin-hint">Tell the driver only once you’re with them and the plate matches.</p>
        </div>
      )}
      <p className="tracker-eta" aria-live="polite">{etaText(view)}</p>
      {view.driver?.rating?.average && (
        <p className="tracker-meta">
          <Star size={14} aria-hidden="true" /> Driver rated {view.driver.rating.average} ({view.driver.rating.count})
        </p>
      )}
      {(markers.length > 0 || view.trail.length > 1) && (
        <LazyMap markers={markers} trail={view.trail} height={220} label="Your driver and route on a map" />
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-on-dark btn-sm" onClick={share}>
          <Share2 size={16} aria-hidden="true" /> {shareLink || view.share_active ? 'Share link again' : 'Share trip'}
        </button>
        {emergencyContact && shareLink && (
          <a className="btn btn-on-dark btn-sm" href={`sms:${emergencyContact.phone}?&body=${smsText}`}>
            Text {emergencyContact.name}
          </a>
        )}
        {(shareLink || view.share_active) && (
          <button type="button" className="btn btn-on-dark btn-sm" onClick={stop}>Stop sharing</button>
        )}
      </div>
      {message && <p className="tracker-meta" role="status">{message}</p>}
    </div>
  )
}
