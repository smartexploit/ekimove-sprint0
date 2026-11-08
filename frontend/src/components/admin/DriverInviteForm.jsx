import { useState } from 'react'
import Alert from '../ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { INVITE_KINDS } from '../../utils/driverOnboarding.js'

const VENUE_KEY = 'ekimove.inviteVenue'

function defaultTime() {
  // Two days from now at 10:00 AM, Nigerian date.
  const lagos = new Date(Date.now() + 2 * 86400000 + 3600000)
  return `${lagos.toISOString().slice(0, 10)}T10:00`
}

function savedVenue() {
  try {
    return localStorage.getItem(VENUE_KEY) || ''
  } catch {
    return ''
  }
}

/** Invite one or more drivers to an inspection and/or orientation session. */
export default function DriverInviteForm({ driverIds, names, onDone, onCancel }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // EkiMove works in Nigerian time (UTC+1, no daylight saving), whatever the device's clock says.
    const local = String(form.get('scheduled_for') || '')
    const when = new Date(`${local.length === 16 ? `${local}:00` : local}+01:00`)
    if (!local || Number.isNaN(when.getTime())) {
      setError('Pick a date and time.')
      return
    }
    const venue = String(form.get('venue') || '').trim()
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/admin/driver-invitations', {
        method: 'POST',
        body: JSON.stringify({
          driver_ids: driverIds,
          kind: form.get('kind'),
          scheduled_for: when.toISOString(),
          venue,
          notes: String(form.get('notes') || '').trim() || null,
        }),
      })
      try {
        localStorage.setItem(VENUE_KEY, venue)
      } catch {
        /* fine */
      }
      onDone(result)
    } catch (err) {
      setError(err.message || 'Could not send the invitations.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card card-outline stack stack-sm" onSubmit={submit} style={{ padding: 14 }}>
      <p style={{ fontWeight: 800 }}>
        Invite {driverIds.length === 1 ? names?.[0] || 'this driver' : `${driverIds.length} drivers`}
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">What for</span>
          <select className="select" name="kind" defaultValue="both">
            {Object.entries(INVITE_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Date and time (Nigeria)</span>
          <input className="input" type="datetime-local" name="scheduled_for" defaultValue={defaultTime()} required />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Venue</span>
        <input className="input" name="venue" minLength={4} maxLength={240} required defaultValue={savedVenue()}
          placeholder="e.g. EkiMove office, Fajuyi Park, Ado-Ekiti" />
      </label>
      <label className="field">
        <span className="field-label">Note for the driver (optional)</span>
        <textarea className="input" name="notes" rows={2} maxLength={1000}
          placeholder="e.g. Ask for Mr Bola at the gate. The session takes about 45 minutes." />
      </label>
      <p className="muted small">Each driver gets a phone notification, an inbox message and an email (if they gave one).</p>
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
