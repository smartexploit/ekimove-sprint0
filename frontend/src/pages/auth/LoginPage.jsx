import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  loginPassenger,
  getCurrentUser,
} from '../../services/authService.js'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import { homePathForRole } from '../../utils/roles.js'

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
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await loginPassenger({ phone, password })
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
      subheading="Use the phone number and password on your EkiMove account."
    >
      {returnTo && (
        <Alert tone="info">Sign in to continue with your trip.</Alert>
      )}

      <form className="form" onSubmit={submit}>
        <label className="field" htmlFor="login-phone">
          <span className="field-label">Phone number</span>
          <input
            id="login-phone"
            className="input"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            minLength={7}
            maxLength={32}
            placeholder="e.g. 0803 000 0000"
            required
          />
        </label>

        <div className="field">
          <label className="field-label" htmlFor="login-password">
            Password
          </label>
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
