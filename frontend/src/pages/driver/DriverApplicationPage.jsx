import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CheckCircle2 } from 'lucide-react'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import { apiUrl } from '../../services/authService.js'
import DriverDetailsFields from '../../components/driver/DriverDetailsFields.jsx'
import { REVIEW_HOURS, detailsProblem } from '../../utils/driverOnboarding.js'
import {
  NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, emailProblem, nameProblem, nameTyping, nigerianMobile, passwordProblem,
  phoneProblem, phoneTyping,
} from '../../utils/inputRules.js'

/** Keep stray characters out of an (uncontrolled) field as it's typed. */
const filterWith = (rule) => (event) => {
  const cleaned = rule(event.target.value)
  if (cleaned !== event.target.value) event.target.value = cleaned
}
const plateTyping = (value) => value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 15)

export default function DriverApplicationPage() {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [vehicleType, setVehicleType] = useState('motorcycle')
  const [dueLabel, setDueLabel] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const email = String(form.get('email') || '').trim().toLowerCase()
    const plate = String(form.get('plate_number') || '').trim().replace(/\s+/g, ' ')
    const problem =
      nameProblem(form.get('full_name'), 'full legal name') ||
      phoneProblem(form.get('phone')) ||
      (email ? emailProblem(email) : '') ||
      passwordProblem(form.get('password'), { name: form.get('full_name'), phone: form.get('phone'), email }) ||
      (/^[A-Z0-9][A-Z0-9 -]{3,13}[A-Z0-9]$/.test(plate) ? '' : 'Enter the plate number as it appears on the vehicle, like EKT 123 AB.') ||
      detailsProblem(form, { vehicleType, ownPhone: form.get('phone') })
    if (problem) {
      setError(problem)
      return
    }
    form.set('full_name', String(form.get('full_name')).trim().replace(/\s+/g, ' '))
    form.set('phone', nigerianMobile(form.get('phone')))
    form.set('email', email)
    form.set('plate_number', plate)
    form.set('emergency_contact_phone', nigerianMobile(form.get('emergency_contact_phone')))
    form.set('licence_number', String(form.get('licence_number') || '').replace(/\s+/g, '').toUpperCase())
    setLoading(true)

    try {
      const response = await fetch(apiUrl('/api/v1/driver-applications'), { method: 'POST', body: form })

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
      setDueLabel(data.review_due_label || '')
      formElement.reset()
      window.scrollTo?.({ top: 0 })
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
              <p role="status" style={{ fontWeight: 700 }}>Thank you, your application is in.</p>
              <p className="muted">
                We review every driver within {REVIEW_HOURS} hours{dueLabel ? <>, so you’ll hear from us by <strong>{dueLabel}</strong></> : ''}.
                A welcome message is waiting in your EkiMove inbox{' '}
                (and your email, if you gave one).
              </p>
            </div>
          </div>
          <ol className="next-steps">
            <li><strong>Review.</strong> We check your details, face photo and vehicle.</li>
            <li>
              <strong>Inspection and orientation.</strong> We may invite you to bring your vehicle, licence and
              papers, and show you how to take trips in the app.
            </li>
            <li><strong>Approval.</strong> Once your profile and vehicle are approved, go online to start earning.</li>
          </ol>
          <p className="muted small row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <CalendarClock size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            Sign in now and turn on notifications, so you see your invitation and approval the moment they’re sent.
          </p>
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
      subheading={`Use your own accurate details. We review every application within ${REVIEW_HOURS} hours and may invite you for a vehicle inspection and app orientation.`}
      wide
    >
      <form className="form" onSubmit={submit} encType="multipart/form-data">
        <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="section-title" style={{ marginBottom: 14 }}>About you</legend>
          <div className="form-grid">
            <label className="field" htmlFor="driver-name">
              <span className="field-label">Full legal name</span>
              <input id="driver-name" className="input" name="full_name" autoComplete="name" minLength={2} maxLength={NAME_MAX} required
                onInput={filterWith(nameTyping)} />
            </label>

            <label className="field" htmlFor="driver-phone">
              <span className="field-label">Phone number</span>
              <input id="driver-phone" className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel" minLength={10} maxLength={18} required
                placeholder="e.g. 0803 123 4567" onInput={filterWith(phoneTyping)} />
            </label>
          </div>

          <label className="field" htmlFor="driver-email">
            <span className="field-label">Email (optional)</span>
            <input id="driver-email" className="input" name="email" type="email" inputMode="email" autoComplete="email"
              autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="you@example.com" />
            <span className="field-hint">You can sign in with your phone number or this email.</span>
          </label>

          <div className="field">
            <label className="field-label" htmlFor="driver-password">Password</label>
            <PasswordInput
              id="driver-password"
              name="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              aria-describedby="driver-password-hint"
              required
            />
            <span className="field-hint" id="driver-password-hint">
              At least {PASSWORD_MIN} characters. Don't use your name or phone number; a short phrase is easy to remember.
            </span>
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
              <select id="vehicle-type" className="select" name="vehicle_type" value={vehicleType}
                onChange={(event) => setVehicleType(event.target.value)} required>
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
              <input id="vehicle-plate" className="input" name="plate_number" autoCapitalize="characters" placeholder="e.g. EKT 123 AB" minLength={5} maxLength={15} required
                onInput={filterWith(plateTyping)} />
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

        <DriverDetailsFields vehicleType={vehicleType} idPrefix="apply" />

        <Alert tone="error">{error}</Alert>

        <label className="check-row">
          <input type="checkbox" name="accept_policies" value="true" required />
          <span>
            I agree to EkiMove’s{' '}
            <Link className="text-link" to="/policies/driver" target="_blank" rel="noreferrer">Driver Agreement</Link>,{' '}
            <Link className="text-link" to="/policies/terms" target="_blank" rel="noreferrer">Terms</Link>,{' '}
            <Link className="text-link" to="/policies/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>{' '}
            and{' '}
            <Link className="text-link" to="/policies/community" target="_blank" rel="noreferrer">Safety Guidelines</Link>,
            including sharing my location while I’m online.
          </span>
        </label>

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
