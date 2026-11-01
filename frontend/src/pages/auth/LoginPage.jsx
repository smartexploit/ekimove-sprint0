import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  loginPassenger,
  getCurrentUser,
} from '../../services/authService.js'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { IDLE_MINUTES } from '../../utils/session.js'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import { homePathForRole } from '../../utils/roles.js'
import ContactMethodField from '../../components/auth/ContactMethodField.jsx'
import useContactMethod from '../../hooks/useContactMethod.js'

/** Only follow internal passenger paths saved by the route guard. */
function safeReturnPath(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = safeReturnPath(location.state?.from)
  const contact = useContactMethod(location.state?.identifier)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (contact.problem) {
      setError(contact.problem)
      document.getElementById(`login-${contact.method}`)?.focus()
      return
    }
    setLoading(true)

    try {
      await loginPassenger({ identifier: contact.identifier, password })
      const user = await getCurrentUser()
      const home = homePathForRole(user.role)
      const destination =
        returnTo && user.role === 'passenger' && !returnTo.startsWith('/admin') && !returnTo.startsWith('/driver')
          ? returnTo
          : home

      navigate(destination, { replace: true })
    } catch (err) {
      setError(err.message || 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back."
      intro="Your next journey around Ekiti starts here."
      heading="Sign in"
      subheading="Use the phone number or email and the password on your EkiMove account."
    >
      {new URLSearchParams(location.search).get('reason') === 'timeout' && (
        <Alert tone="info">
          You were signed out after {IDLE_MINUTES} minutes without activity, to keep your account safe.
          Please sign in again.
        </Alert>
      )}
      {returnTo && (
        <Alert tone="info">Sign in to continue with your trip.</Alert>
      )}
      {location.state?.passwordReset && (
        <Alert tone="success">Your password has been changed. Sign in with your new password.</Alert>
      )}

      <form className="form" onSubmit={submit}>
        <ContactMethodField
          idPrefix="login"
          label="Sign in with"
          method={contact.method}
          onMethod={(next) => { contact.setMethod(next); setError('') }}
          phone={contact.phone}
          onPhone={contact.setPhone}
          email={contact.email}
          onEmail={contact.setEmail}
        />

        <div className="field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <Link className="text-link small" to="/forgot-password"
              state={{ identifier: contact.method === 'phone' ? contact.phone : contact.email }}>
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={256}
            placeholder="Your password"
            required
          />
        </div>

        <Alert tone="error">{error}</Alert>

        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-switch">
        New to EkiMove?{' '}
        <Link to="/register" state={location.state}>
          Create an account
        </Link>
      </p>
      <p className="auth-switch">
        Want to drive? <Link to="/driver/apply">Apply here</Link>
      </p>
    </AuthLayout>
  )
}
