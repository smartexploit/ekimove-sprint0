import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getAuthOptions, registerPassenger } from '../../services/authService.js'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'

function safeReturnPath(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.startsWith('/admin') || value.startsWith('/driver')) return null
  return value
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = safeReturnPath(location.state?.from)

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    referral_code: (new URLSearchParams(location.search).get('ref') || '').toUpperCase().slice(0, 40),
    password: '',
    confirmPassword: '',
  })
  const [method, setMethod] = useState('phone')
  const [options, setOptions] = useState(null)
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    getAuthOptions().then((result) => active && setOptions(result))
    return () => {
      active = false
    }
  }, [])

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

    if (!agree) {
      setError('Please read and agree to EkiMove’s policies to continue.')
      return
    }

    setLoading(true)

    try {
      await registerPassenger({
        full_name: form.full_name,
        phone: method === 'phone' ? form.phone : '',
        email: method === 'email' ? form.email : '',
        referral_code: form.referral_code,
        password: form.password,
        accept_policies: true,
      })

      navigate(returnTo || '/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const passwordsMatch = form.password === form.confirmPassword

  return (
    <AuthLayout
      title="Your next journey starts here."
      intro="Create a passenger account to book rides around Ekiti."
      heading="Create your account"
      subheading="A few details are all we need to get you moving."
    >
      <form className="form" onSubmit={submit}>
        <label className="field" htmlFor="full_name">
          <span className="field-label">Full name</span>
          <input
            id="full_name"
            className="input"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="As drivers should know you"
            value={form.full_name}
            onChange={update}
            minLength={2}
            maxLength={160}
            required
          />
        </label>

        <div className="field">
          <span className="field-label" id="signup-with">Sign up with</span>
          <div className="segmented segmented-block" role="tablist" aria-labelledby="signup-with">
            {[['phone', 'Phone number'], ['email', 'Email']].map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={method === value}
                className={method === value ? 'is-active' : ''} onClick={() => setMethod(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {method === 'phone' ? (
          <label className="field" htmlFor="phone">
            <span className="field-label">Phone number</span>
            <input
              id="phone"
              className="input"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 08012345678"
              value={form.phone}
              onChange={update}
              minLength={7}
              maxLength={32}
              aria-describedby="contact-hint"
              required
            />
          </label>
        ) : (
          <label className="field" htmlFor="email">
            <span className="field-label">Email address</span>
            <input
              id="email"
              className="input"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={form.email}
              onChange={update}
              maxLength={254}
              aria-describedby="contact-hint"
              required
            />
          </label>
        )}
        <span className="field-hint" id="contact-hint" style={{ marginTop: -8 }}>
          {(method === 'phone' ? options?.sms : options?.email)
            ? `We'll ${method === 'phone' ? 'text' : 'email'} you a 6-digit code to confirm it's yours.`
            : `You'll sign in with this ${method === 'phone' ? 'number' : 'address'}. You can add the other later in your profile.`}
        </span>

        <div className="field">
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="At least 12 characters"
            value={form.password}
            onChange={update}
            minLength={12}
            maxLength={256}
            aria-describedby="password-hint"
            required
          />
          <span className="field-hint" id="password-hint">
            Use at least 12 characters. A short phrase is easy to remember.
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Type it again"
            value={form.confirmPassword}
            onChange={update}
            maxLength={256}
            aria-describedby="confirm-hint"
            required
          />
          <span
            id="confirm-hint"
            className={`field-hint ${form.confirmPassword ? (passwordsMatch ? 'field-hint-ok' : 'field-hint-error') : ''}`}
            aria-live="polite"
          >
            {form.confirmPassword
              ? passwordsMatch
                ? 'Passwords match.'
                : 'Passwords do not match yet.'
              : ''}
          </span>
        </div>

        <label className="field" htmlFor="referral_code">
          <span className="field-label">Invite code (optional)</span>
          <input id="referral_code" className="input" name="referral_code" autoCapitalize="characters" spellCheck={false}
            maxLength={40} value={form.referral_code} placeholder="From a friend"
            onChange={(event) => setForm((current) => ({ ...current, referral_code: event.target.value.toUpperCase() }))} />
          {form.referral_code && <span className="field-hint">You’ll get money off your first ride.</span>}
        </label>

        <label className="check-row">
          <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
          <span>
            I agree to EkiMove’s{' '}
            <Link className="text-link" to="/policies/terms" target="_blank" rel="noreferrer">Terms</Link>,{' '}
            <Link className="text-link" to="/policies/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>{' '}
            and{' '}
            <Link className="text-link" to="/policies/community" target="_blank" rel="noreferrer">Safety Guidelines</Link>.
          </span>
        </label>

        <Alert tone="error">{error}</Alert>

        <button className="btn btn-accent btn-lg btn-block" type="submit" disabled={loading}>
          {loading ? 'Creating your account…' : 'Create account'}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account?{' '}
        <Link to="/login" state={location.state}>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
