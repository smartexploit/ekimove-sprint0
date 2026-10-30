
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import {
  loginPassenger,
  getCurrentUser,
} from '../../services/authService.js'
import AppPage from '../../layouts/AppPage.jsx'

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await loginPassenger({ phone, password })
      const user = await getCurrentUser()

      navigate(
        user.role === 'super_admin'
          ? '/admin/dispatch'
          : user.role === 'driver'
            ? '/driver/status'
            : '/dashboard',
        { replace: true },
      )
    } catch (err) {
      setError(err.message || 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppPage
      eyebrow="WELCOME BACK"
      title="Good to have you back."
      description="Your next journey around Ekiti starts here. Sign in to continue."
      sectionTitle="Sign in to your account"
      sectionText="Enter the phone number and password associated with your EkiMove account."
    >
      <form className="auth-form login-form" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="login-phone">Phone number</label>
          <input
            id="login-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            minLength={7}
            maxLength={32}
            placeholder="Enter your phone number"
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Password</label>

          <div className="auth-password-wrapper">
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={256}
              placeholder="Enter your password"
              required
            />

            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="auth-submit"
          type="submit"
          disabled={loading}
        >
          {loading ? 'Signing in…' : 'Sign in to EkiMove'}
        </button>

        <p className="auth-switch">
          New to EkiMove?{' '}
          <Link to="/register">Create an account</Link>
        </p>
      </form>
    </AppPage>
  )
}
