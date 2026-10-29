
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerPassenger } from '../../services/authService.js'
import AppPage from '../../layouts/AppPage.jsx'

export default function RegisterPage() {
  const navigate = useNavigate()

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    password: '',
    confirmPassword: '',
  })

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  function update(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')

    if (form.password.length < 12) {
      setError('Your password must contain at least 12 characters.')
      return
    }

    if (form.password !== form.confirmPassword) {
      setError('Your passwords do not match.')
      return
    }

    setLoading(true)

    try {
      await registerPassenger({
        full_name: form.full_name,
        phone: form.phone,
        password: form.password,
      })

      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppPage
      eyebrow="WELCOME TO EKIMOVE"
      title="Your next journey starts here."
      description="Move around Ekiti with greater ease. Create your passenger account and get ready to ride."
      sectionTitle="Create your account"
      sectionText="A few details are all we need to get you moving."
    >
      <form className="auth-form register-form" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="full_name">Full name</label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Enter your full name"
            value={form.full_name}
            onChange={update}
            minLength={2}
            maxLength={160}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="phone">Phone number</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="e.g. 08012345678"
            value={form.phone}
            onChange={update}
            minLength={7}
            maxLength={32}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Password</label>

          <div className="auth-password-wrapper">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Create a password"
              value={form.password}
              onChange={update}
              minLength={12}
              maxLength={256}
              required
            />

            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <small className="auth-hint">
            Use at least 12 characters.
          </small>
        </div>

        <div className="auth-field">
          <label htmlFor="confirmPassword">Confirm password</label>

          <div className="auth-password-wrapper">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Enter your password again"
              value={form.confirmPassword}
              onChange={update}
              required
            />

            <button
              type="button"
              className="auth-password-toggle"
              onClick={() =>
                setShowConfirmPassword((current) => !current)
              }
              aria-label={
                showConfirmPassword ? 'Hide password' : 'Show password'
              }
            >
              {showConfirmPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {form.confirmPassword && (
            <small
              className={
                form.password === form.confirmPassword
                  ? 'auth-hint auth-success'
                  : 'auth-hint auth-error-text'
              }
            >
              {form.password === form.confirmPassword
                ? 'Passwords match.'
                : 'Passwords do not match yet.'}
            </small>
          )}
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
          {loading ? 'Creating account...' : 'Create passenger account'}
          {!loading && <span aria-hidden="true"> →</span>}
        </button>

        <p className="auth-switch">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>

        <p className="register-footer-note">
          By creating an account, you're taking the first step towards
          easier journeys around Ekiti.
        </p>
      </form>
    </AppPage>
  )
}
