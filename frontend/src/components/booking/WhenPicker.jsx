import { CalendarClock } from 'lucide-react'
import { formatPickupTime, pickupLimits, toApiTime } from '../../utils/schedule.js'

/** "Now" or "Later" with a pickup time (30 minutes to 7 days ahead). */
export default function WhenPicker({ value, onChange, leadMinutes = 20 }) {
  const later = value !== null
  const limits = pickupLimits()
  return (
    <div className="field">
      <span className="field-label" id="when-label">When</span>
      <div className="segmented segmented-block" role="tablist" aria-labelledby="when-label">
        <button type="button" role="tab" aria-selected={!later} className={!later ? 'is-active' : ''}
          onClick={() => onChange(null)}>
          Now
        </button>
        <button type="button" role="tab" aria-selected={later} className={later ? 'is-active' : ''}
          onClick={() => onChange(value ?? limits.suggested)}>
          <CalendarClock size={16} aria-hidden="true" /> Later
        </button>
      </div>
      {later && (
        <>
          <label className="sr-only" htmlFor="pickup-time">Pickup time</label>
          <input id="pickup-time" className="input" type="datetime-local" value={value}
            min={limits.min} max={limits.max} required onChange={(event) => onChange(event.target.value)} />
          <span className="field-hint">
            {value ? `Pickup ${formatPickupTime(toApiTime(value))}. ` : ''}
            We start finding your driver {leadMinutes} minutes before. You can book 30 minutes to 7 days ahead.
          </span>
        </>
      )}
    </div>
  )
}
