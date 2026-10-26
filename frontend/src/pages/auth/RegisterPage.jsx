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
      eyebrow="JOIN EKIMOVE"
      title="Create your account."
      description="Set up your passenger account and get ready to move around Ekiti."
      sectionTitle="Passenger registration"
      sectionText="Your account starts with your name, phone number and a secure password."
    >
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="full_name">Full name</label>
        <input
          id="full_name"
          name="full_name"
          autoComplete="name"
          value={form.full_name}
          onChange={update}
          minLength={2}
          maxLength={160}
          required
        />

        <label htmlFor="phone">Phone number</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={update}
          minLength={7}
          maxLength={32}
          placeholder="Enter your phone number"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update}
          minLength={12}
          maxLength={256}
          required
        />
        <small className="auth-hint">Use at least 12 characters.</small>

        <label htmlFor="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={update}
          required
        />

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create passenger account'}
        </button>

        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AppPage>
  )
}
