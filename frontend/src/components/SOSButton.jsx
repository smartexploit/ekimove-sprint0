import { useState } from 'react'
import { apiRequest } from '../services/authService.js'

const eligibleStatuses = new Set([
  'assigned',
  'driver_arriving',
  'in_progress',
  'incident_review',
])

export default function SOSButton({ rideId, rideStatus }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!rideId || !eligibleStatuses.has(rideStatus)) return null

  async function submitSOS() {
    const confirmed = window.confirm(
      `Send an SOS alert for ride #${rideId}?\n\n` +
      'This creates a critical incident for EkiMove administrators. ' +
      'It does NOT automatically contact emergency services.'
    )

    if (!confirmed) return

    const description = window.prompt(
      'Briefly describe the emergency (at least 5 characters):',
      'SOS alert submitted by a ride participant.'
    )

    if (description === null) return

    if (description.trim().length < 5) {
      setError('Please provide at least 5 characters describing the incident.')
      setNotice('')
      return
    }

    setSending(true)
    setError('')
    setNotice('')

    try {
      const result = await apiRequest(
        `/api/v1/rides/${rideId}/sos`,
        {
          method: 'POST',
          body: JSON.stringify({ description: description.trim() }),
        }
      )

      setNotice(
        result.message ||
        `SOS recorded. Incident #${result.incident_id ?? 'created'}.`
      )
    } catch (err) {
      setError(err.message || 'Unable to submit SOS. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="app-page-actions" aria-label="Emergency assistance">
      <button
        type="button"
        onClick={submitSOS}
        disabled={sending}
        aria-label={`Send SOS for ride ${rideId}`}
      >
        {sending ? 'Sending SOS…' : 'SOS — Emergency alert'}
      </button>

      <p>
        SOS creates an incident for EkiMove administrators. It does not
        automatically call emergency services. If you are in immediate
        danger, contact local emergency services directly when safe.
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
