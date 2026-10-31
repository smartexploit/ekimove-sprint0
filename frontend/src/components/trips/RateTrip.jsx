import { useState } from 'react'
import { Star } from 'lucide-react'
import { rateTrip } from '../../services/tripService.js'

/** 1–5 star rating with an optional comment; shows the score once given. */
export default function RateTrip({ rideId, existing, who = 'driver', onRated }) {
  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')
  const [saved, setSaved] = useState(existing || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (saved) {
    return (
      <p className="rating-done small" aria-label={`You rated this trip ${saved} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={14} aria-hidden="true" fill={n <= saved ? 'currentColor' : 'none'} />
        ))}
        <span>You rated this {who}</span>
      </p>
    )
  }

  async function submit() {
    if (!score) return
    setBusy(true)
    setError('')
    try {
      await rateTrip(rideId, score, comment.trim())
      setSaved(score)
      onRated?.(score)
    } catch (err) {
      setError(err.message || 'Could not save your rating.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rate-trip">
      <fieldset className="stars">
        <legend className="small" style={{ fontWeight: 700 }}>Rate your {who}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`star ${n <= score ? 'is-on' : ''}`}>
            <input type="radio" name={`rate-${rideId}`} value={n} checked={score === n}
              onChange={() => setScore(n)} className="sr-only" />
            <Star size={26} aria-hidden="true" fill={n <= score ? 'currentColor' : 'none'} />
            <span className="sr-only">{n} star{n > 1 ? 's' : ''}</span>
          </label>
        ))}
      </fieldset>
      {score > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <label className="sr-only" htmlFor={`rate-comment-${rideId}`}>Comment</label>
          <input id={`rate-comment-${rideId}`} className="input" maxLength={500} value={comment}
            onChange={(event) => setComment(event.target.value)} placeholder="Add a comment (optional)" />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Send'}
          </button>
        </div>
      )}
      {error && <p className="small" role="alert" style={{ color: 'var(--laterite-700)' }}>{error}</p>}
    </div>
  )
}
