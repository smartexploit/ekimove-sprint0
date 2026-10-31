import { useId, useState } from 'react'
import { Siren } from 'lucide-react'
import { apiRequest } from '../services/authService.js'
import Alert from './ui/Alert.jsx'

const eligibleStatuses = new Set([
  'assigned',
  'driver_arriving',
  'in_progress',
  'incident_review',
])

const DEFAULT_DESCRIPTION = 'SOS alert submitted by a ride participant.'

/**
 * Emergency alert for an active ride. Opens an in-page confirmation so the
 * person can describe what's happening before the alert is sent.
 */
export default function SOSButton({ rideId, rideStatus }) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fieldId = useId()

  if (!rideId || !eligibleStatuses.has(rideStatus)) return null

  async function submitSOS(event) {
    event.preventDefault()

    if (description.trim().length < 5) {
      setError('Please describe what is happening in at least 5 characters.')
      return
    }

    setSending(true)
    setError('')
    setNotice('')

    try {
      const result = await apiRequest(`/api/v1/rides/${rideId}/sos`, {
        method: 'POST',
        body: JSON.stringify({ description: description.trim() }),
      })

      setNotice(
        result.message ||
          `SOS sent. The EkiMove team has been alerted (incident #${result.incident_id ?? 'created'}).`,
      )
      setOpen(false)
      setDescription(DEFAULT_DESCRIPTION)
    } catch (err) {
      setError(err.message || 'Unable to send SOS. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="btn sos-btn"
          onClick={() => {
            setOpen(true)
            setNotice('')
          }}
          aria-label={`Send SOS for ride ${rideId}`}
        >
          <Siren size={18} aria-hidden="true" /> SOS
        </button>
      )}

      {open && (
        <form
          className="sos-panel"
          style={{ flexBasis: '100%' }}
          onSubmit={submitSOS}
          aria-label="Emergency alert"
        >
          <p style={{ fontWeight: 800, fontSize: 17 }}>Send an SOS alert?</p>
          <p className="small" style={{ color: 'var(--ink-700)' }}>
            This alerts the EkiMove safety team about ride #{rideId}. It does
            not call emergency services. If you are in immediate danger, call
            112 when it is safe to do so.
          </p>
          <label className="field" htmlFor={fieldId}>
            <span className="field-label">What is happening?</span>
            <textarea
              id={fieldId}
              className="textarea"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </label>
          <Alert tone="error">{error}</Alert>
          <div className="row">
            <button type="submit" className="btn sos-btn" disabled={sending}>
              {sending ? 'Sending SOS…' : 'Send SOS now'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false)
                setError('')
              }}
              disabled={sending}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div style={{ flexBasis: '100%' }}>
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
    </>
  )
}
