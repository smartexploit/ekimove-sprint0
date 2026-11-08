import { useState } from 'react'
import { CalendarCheck2, CalendarClock, ClipboardList, MapPin } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import DriverDetailsFields from './DriverDetailsFields.jsx'
import { apiRequest } from '../../services/authService.js'
import { nigerianMobile } from '../../utils/inputRules.js'
import { INVITE_KINDS, REVIEW_HOURS, detailsProblem, needsLicence } from '../../utils/driverOnboarding.js'

const OPEN = ['invited', 'confirmed', 'reschedule']

function ReviewCard({ application }) {
  if (application.verification_status !== 'pending') return null
  const steps = [
    ['Application received', true],
    ['Details and vehicle review', false],
    ['Inspection and orientation (if invited)', false],
    ['Approval: go online', false],
  ]
  return (
    <section className="card stack stack-sm" aria-labelledby="review-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <CalendarClock size={22} aria-hidden="true" style={{ color: 'var(--gold-700)', flexShrink: 0 }} />
        <h2 id="review-title" className="card-title">
          {application.review_overdue ? 'Your review is taking longer than usual' : `Review within ${REVIEW_HOURS} hours`}
        </h2>
      </div>
      <p className="muted">
        {application.review_overdue
          ? 'Sorry for the wait. Our team has been reminded and will finish your review as soon as possible.'
          : application.review_due_label
            ? <>You’ll hear from us by <strong>{application.review_due_label}</strong>.</>
            : 'You’ll hear from us soon.'}
      </p>
      <ol className="review-steps">
        {steps.map(([label, done]) => (
          <li key={label} className={done ? 'is-done' : ''}>{label}</li>
        ))}
      </ol>
    </section>
  )
}

function InvitationCard({ invite, onChange }) {
  const [rescheduling, setRescheduling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function respond(response, note) {
    setBusy(true)
    setError('')
    try {
      const updated = await apiRequest(`/api/v1/driver-applications/me/invitations/${invite.id}/respond`, {
        method: 'POST', body: JSON.stringify({ response, note: note || null }),
      })
      setRescheduling(false)
      onChange(updated)
    } catch (err) {
      setError(err.message || 'Could not send your answer.')
    } finally {
      setBusy(false)
    }
  }

  const status = {
    invited: 'Please confirm you can come.',
    confirmed: 'You confirmed. See you there!',
    reschedule: 'You asked for another time. We’ll send a new invitation.',
  }[invite.status]

  return (
    <section className="card stack stack-sm invite-card" aria-labelledby={`invite-${invite.id}`}>
      <p className="eyebrow">You’re invited</p>
      <h2 id={`invite-${invite.id}`} className="card-title">{INVITE_KINDS[invite.kind] || invite.kind_label}</h2>
      <p className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <CalendarCheck2 size={18} aria-hidden="true" style={{ flexShrink: 0 }} /> <strong>{invite.scheduled_label}</strong>
      </p>
      <p className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <MapPin size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} /> {invite.venue}
      </p>
      {invite.notes && <p className="muted small">{invite.notes}</p>}
      <p className="small"><strong>Bring:</strong>{' '}
        {invite.kind !== 'orientation' && 'the vehicle you registered with its papers, '}
        your licence or photo ID{invite.kind !== 'inspection' && ', and your phone with EkiMove installed'}.
      </p>
      <p className="small" role="status">{status}</p>
      <Alert tone="error">{error}</Alert>
      {rescheduling ? (
        <form className="stack stack-sm" onSubmit={(event) => {
          event.preventDefault()
          respond('reschedule', new FormData(event.currentTarget).get('note'))
        }}>
          <label className="field" htmlFor={`invite-note-${invite.id}`}>
            <span className="field-label">Which days and times suit you?</span>
            <textarea id={`invite-note-${invite.id}`} className="input" name="note" rows={2} maxLength={300} required
              placeholder="e.g. Saturday morning or weekdays after 4 PM" />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Send</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRescheduling(false)}>Back</button>
          </div>
        </form>
      ) : (
        <div className="row">
          {invite.status !== 'confirmed' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => respond('confirmed')}>
              I’ll be there
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setRescheduling(true)}>
            I need another time
          </button>
        </div>
      )}
    </section>
  )
}

function CompleteDetails({ application, onSaved }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const vehicleType = (application.vehicles || []).map((v) => v.vehicle_type).find(needsLicence) || 'motorcycle'

  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const problem = detailsProblem(form, { vehicleType })
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/driver-applications/me/details', {
        method: 'PATCH',
        body: JSON.stringify({
          gender: form.get('gender'),
          date_of_birth: form.get('date_of_birth'),
          home_address: String(form.get('home_address')).trim(),
          town: String(form.get('town')).trim(),
          licence_number: String(form.get('licence_number') || '').replace(/\s+/g, '').toUpperCase() || null,
          emergency_contact_name: String(form.get('emergency_contact_name')).trim(),
          emergency_contact_phone: nigerianMobile(form.get('emergency_contact_phone')),
          safety_pledges: form.getAll('safety_pledges'),
        }),
      })
      onSaved(result)
    } catch (err) {
      setError(err.message || 'Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="details-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <ClipboardList size={22} aria-hidden="true" style={{ color: 'var(--laterite-700)', flexShrink: 0 }} />
        <h2 id="details-title" className="card-title">Complete your driver details</h2>
      </div>
      <p className="muted small">EkiMove now asks every driver for: {application.details_missing.join(', ')}.</p>
      <form className="form" onSubmit={save}>
        <DriverDetailsFields vehicleType={vehicleType} initial={application.details || {}} idPrefix="complete" />
        <Alert tone="error">{error}</Alert>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save my details'}
        </button>
      </form>
    </section>
  )
}

/** Review promise, inspection invitation and missing details on the driver status page. */
export default function DriverOnboarding({ application, onUpdate }) {
  const invite = (application.invitations || []).find((i) => OPEN.includes(i.status))
  return (
    <>
      {invite && (
        <InvitationCard invite={invite} onChange={(updated) => onUpdate({
          invitations: application.invitations.map((i) => (i.id === updated.id ? updated : i)),
        })} />
      )}
      <ReviewCard application={application} />
      {application.details_missing?.length > 0 && (
        <CompleteDetails application={application} onSaved={(result) => onUpdate(result)} />
      )}
    </>
  )
}
