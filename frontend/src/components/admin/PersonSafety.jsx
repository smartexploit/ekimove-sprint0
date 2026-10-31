import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, MapPinned } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import LazyMap from '../map/LazyMap.jsx'
import { fetchImageUrl } from '../../services/authService.js'
import { getRideTrail, reviewVerification } from '../../services/tripService.js'
import { formatDateTime } from '../../utils/format.js'

/** ID verification review for a passenger (admin). */
export function VerificationReview({ person, onChanged }) {
  const v = person.verification
  const [photo, setPhoto] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => photo && URL.revokeObjectURL(photo), [photo])

  if (!v || v.status === 'not_submitted') {
    return <p className="muted small">No ID submitted yet.</p>
  }

  async function showPhoto() {
    setError('')
    try {
      setPhoto(await fetchImageUrl(`/api/v1/admin/verifications/${person.id}/photo`))
    } catch (err) {
      setError(err.message)
    }
  }

  async function decide(decision) {
    setBusy(true)
    setError('')
    try {
      await reviewVerification(person.id, decision, note.trim())
      setNote('')
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack stack-sm">
      <dl className="rows small">
        <div><dt>ID</dt><dd>{v.id_type_label} · {v.id_number}</dd></div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`badge ${v.status === 'approved' ? 'badge-green' : v.status === 'rejected' ? 'badge-red' : 'badge-gold'}`}>
              {v.status === 'approved' && <BadgeCheck size={14} aria-hidden="true" />} {v.status}
            </span>
          </dd>
        </div>
        <div><dt>Submitted</dt><dd>{formatDateTime(v.submitted_at)}</dd></div>
        {v.review_note && <div><dt>Note</dt><dd>{v.review_note}</dd></div>}
      </dl>
      <Alert tone="error">{error}</Alert>
      {v.has_photo && !photo && (
        <div><button type="button" className="btn btn-sm" onClick={showPhoto}>View ID photo</button></div>
      )}
      {photo && <img src={photo} alt={`${v.id_type_label} submitted by ${person.full_name}`} className="id-photo" />}
      {v.status === 'pending' && (
        <>
          <label className="field">
            <span className="field-label">Note (needed if rejecting)</span>
            <input className="input" value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Photo is blurry" />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approve')}>
              Approve ID
            </button>
            <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => decide('reject')}>
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** A trip's recorded GPS trail with its timeline (admin). */
export function TrailViewer({ rideId, onClose }) {
  const [trail, setTrail] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getRideTrail(rideId).then((data) => active && setTrail(data)).catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [rideId])

  const markers = useMemo(() => {
    if (!trail) return []
    const list = []
    if (trail.pickup) list.push({ id: 'p', kind: 'pickup', ...trail.pickup, popup: `Pickup: ${trail.pickup.name}` })
    if (trail.destination) list.push({ id: 'd', kind: 'destination', ...trail.destination, popup: `Destination: ${trail.destination.name}` })
    return list
  }, [trail])

  return (
    <div className="trail-viewer stack stack-sm">
      <div className="row row-between">
        <p style={{ fontWeight: 800 }}><MapPinned size={16} aria-hidden="true" /> Trip #{rideId} trail</p>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      <Alert tone="error">{error}</Alert>
      {trail && (
        <>
          <p className="small">
            {trail.route}<br />
            Driver {trail.driver?.name} ({trail.driver?.phone}) · {trail.vehicle?.plate_number || 'vehicle not recorded'}<br />
            Passenger {trail.passenger?.name} ({trail.passenger?.phone})
          </p>
          <dl className="rows small">
            {[['Assigned', trail.assigned_at], ['Arrived', trail.arrived_at], ['Started', trail.started_at],
              ['Completed', trail.completed_at], ['Cancelled', trail.cancelled_at]]
              .filter(([, value]) => value)
              .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatDateTime(value)}</dd></div>)}
          </dl>
          {trail.trail.length < 2 && <p className="muted small">No GPS trail was recorded for this trip.</p>}
          <LazyMap markers={markers} trail={trail.trail} height={280} label={`GPS trail of trip ${rideId}`} />
          {trail.messages?.length > 0 && (
            <details>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>
                Trip chat ({trail.messages.length})
              </summary>
              <ul className="plain-list small" style={{ marginTop: 8 }}>
                {trail.messages.map((message) => (
                  <li key={message.id}>
                    {formatDateTime(message.created_at)} · <strong>{message.from === 'driver' ? 'Driver' : 'Passenger'}:</strong>{' '}
                    {message.body}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
