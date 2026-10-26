import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'

export default function DriverApplicationPage() {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const formElement = event.currentTarget
    const form = new FormData(formElement)

    try {
      const response = await fetch('/api/v1/driver-applications', {
        method: 'POST',
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof data.detail === 'string'
            ? data.detail
            : 'Unable to submit your application.',
        )
      }
      setMessage(data.message || 'Application submitted for review.')
      formElement.reset()
    } catch (err) {
      setError(err.message || 'Unable to reach EkiMove. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppPage
      eyebrow="DRIVER ONBOARDING"
      title="Apply to drive with EkiMove."
      description="Submit your details for review. You cannot accept rides until your driver profile and vehicle are approved."
      sectionTitle="Driver application"
      sectionText="Use your own accurate details. Your face photo is required for identity review."
    >
      {message ? (
        <div role="status">
          <h3>Application received</h3>
          <p>{message}</p>
          <p>Keep your sign-in details safe. Approval is not automatic.</p>
          <Link to="/login">Continue to sign in</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} encType="multipart/form-data">
          <label htmlFor="driver-name">Full legal name</label>
          <input id="driver-name" name="full_name" autoComplete="name" minLength={2} maxLength={160} required />

          <label htmlFor="driver-phone">Phone number</label>
          <input id="driver-phone" name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={32} required />

          <label htmlFor="driver-password">Password (at least 12 characters)</label>
          <input id="driver-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required />

          <label htmlFor="driver-photo">Face photo (JPEG, PNG, or WebP; max 5 MB)</label>
          <input id="driver-photo" name="face_photo" type="file" accept="image/jpeg,image/png,image/webp" required />

          <label htmlFor="vehicle-type">Vehicle type</label>
          <select id="vehicle-type" name="vehicle_type" defaultValue="motorcycle" required>
            <option value="motorcycle">Motorcycle</option>
            <option value="tricycle">Tricycle</option>
            <option value="car">Car</option>
            <option value="minibus">Minibus</option>
          </select>

          <label htmlFor="vehicle-plate">Vehicle registration number</label>
          <input id="vehicle-plate" name="plate_number" minLength={2} maxLength={32} required />

          <label htmlFor="vehicle-capacity">Passenger capacity (excluding driver)</label>
          <input id="vehicle-capacity" name="capacity" type="number" min="1" max="8" defaultValue="1" required />

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit application'}
          </button>
          <p className="auth-switch">Already applied? <Link to="/login">Sign in</Link></p>
        </form>
      )}
    </AppPage>
  )
}
