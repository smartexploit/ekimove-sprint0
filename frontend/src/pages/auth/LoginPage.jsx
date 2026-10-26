import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginPassenger, getCurrentUser } from '../../services/authService.js'
import AppPage from '../../layouts/AppPage.jsx'

export default function LoginPage() {
  const navigate = useNavigate()
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
      navigate(user.role === 'super_admin' ? '/admin/dispatch' : user.role === 'driver' ? '/driver/status' : '/dashboard', {
        replace: true,
      })
    } catch (err) {
      setError(err.message || 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppPage
      eyebrow="WELCOME BACK"
      title="Sign in to EkiMove."
      description="Access your account and continue planning your journeys around Ekiti."
      sectionTitle="Your EkiMove account"
      sectionText="Sign in with the phone number and password associated with your account."
    >
      <form className="auth-form" onSubmit={submit}>
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
          required
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={256}
          required
        />

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-switch">
          New to EkiMove? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </AppPage>
  )
}
