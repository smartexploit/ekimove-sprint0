import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'

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
      const apiBaseUrl = (
        import.meta.env.VITE_API_BASE_URL ||
        'https://ekimove-api.onrender.com'
      ).replace(/\/+$/, '')

      const response = await fetch(
        `${apiBaseUrl}/api/v1/driver-applications`,
        {
          method: 'POST',
          body: form,
        },
      )

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error(
          'Unexpected response from EkiMove API. Please try again later.',
        )
      }

      const data = await response.json()
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

  if (message) {
    return (
      <AuthLayout
        title="Drive with EkiMove."
        intro="Earn on trips across Ekiti with fares agreed before every ride."
        heading="Application received"
      >
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <CheckCircle2 size={28} color="#2E8B63" aria-hidden="true" style={{ flexShrink: 0 }} />
            <div className="stack stack-sm">
              <p role="status" style={{ fontWeight: 700 }}>{message}</p>
              <p className="muted">
                Our team will review your details and vehicle. You can't accept
                rides until both are approved. Keep your sign-in details safe.
              </p>
            </div>
          </div>
          <Link className="btn btn-primary btn-lg btn-block" to="/login">
            Continue to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Drive with EkiMove."
      intro="Earn on trips across Ekiti with fares agreed before every ride. Apply once, get verified, then go online whenever you're ready."
      heading="Apply to drive"
      subheading="Use your own accurate details. Approval isn't automatic: your profile and vehicle are reviewed separately."
      wide
    >
      <form className="form" onSubmit={submit} encType="multipart/form-data">
        <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="section-title" style={{ marginBottom: 14 }}>About you</legend>
          <div className="form-grid">
            <label className="field" htmlFor="driver-name">
              <span className="field-label">Full legal name</span>
              <input id="driver-name" className="input" name="full_name" autoComplete="name" minLength={2} maxLength={160} required />
            </label>

            <label className="field" htmlFor="driver-phone">
              <span className="field-label">Phone number</span>
              <input id="driver-phone" className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel" minLength={7} maxLength={32} required />
            </label>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="driver-password">Password</label>
            <PasswordInput
              id="driver-password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              aria-describedby="driver-password-hint"
              required
            />
            <span className="field-hint" id="driver-password-hint">At least 12 characters.</span>
          </div>

          <label className="field" htmlFor="driver-photo">
            <span className="field-label">Face photo</span>
            <input id="driver-photo" className="input" name="face_photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="driver-photo-hint" required />
            <span className="field-hint" id="driver-photo-hint">
              A clear photo of your face. JPEG, PNG or WebP, up to 5 MB. Only EkiMove reviewers can see it.
            </span>
          </label>
        </fieldset>

        <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="section-title" style={{ marginBottom: 14 }}>Your vehicle</legend>
          <div className="form-grid">
            <label className="field" htmlFor="vehicle-type">
              <span className="field-label">Vehicle type</span>
              <select id="vehicle-type" className="select" name="vehicle_type" defaultValue="motorcycle" required>
                <option value="motorcycle">Motorcycle</option>
                <option value="tricycle">Tricycle</option>
                <option value="car">Car</option>
                <option value="minibus">Minibus</option>
                <option value="big_car">Big car (SUV / Sienna) for loads</option>
                <option value="van">Van or bus for loads</option>
                <option value="dyna">Dyna truck for loads</option>
              </select>
            </label>

            <label className="field" htmlFor="vehicle-plate">
              <span className="field-label">Plate number</span>
              <input id="vehicle-plate" className="input" name="plate_number" autoCapitalize="characters" placeholder="e.g. EKT 123 AB" minLength={2} maxLength={32} required />
            </label>

            <label className="field" htmlFor="vehicle-capacity">
              <span className="field-label">Passenger seats</span>
              <input id="vehicle-capacity" className="input" name="capacity" type="number" min="1" max="8" defaultValue="1" aria-describedby="vehicle-capacity-hint" required />
              <span className="field-hint" id="vehicle-capacity-hint">
                Passengers you can carry, not counting you. Motorcycle: 1 or 2. Car: up to 4.
              </span>
            </label>
          </div>
        </fieldset>

        <Alert tone="error">{error}</Alert>

        <button className="btn btn-accent btn-lg btn-block" type="submit" disabled={loading}>
          {loading ? 'Submitting your application…' : 'Submit application'}
        </button>
      </form>

      <p className="auth-switch">
        Already applied? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
