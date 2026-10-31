import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import { confirmPasswordReset, getAuthOptions, requestPasswordReset } from '../../services/authService.js'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [options, setOptions] = useState(null)
  const [step, setStep] = useState('ask')
  const [identifier, setIdentifier] = useState(location.state?.identifier || '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getAuthOptions().then((result) => active && setOptions(result))
    return () => {
      active = false
    }
  }, [])

  async function ask(event) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await requestPasswordReset(identifier)
      setNotice(result.message)
      setStep('code')
    } catch (err) {
      setError(err.message || 'Could not send a code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function reset(event) {
    event.preventDefault()
    setError('')
    if (password.length < 12) {
      setError('Your new password must contain at least 12 characters.')
      return
    }
    if (password !== confirm) {
      setError('Your passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await confirmPasswordReset({ identifier, code, new_password: password })
      navigate('/login', { replace: true, state: { passwordReset: true, identifier } })
    } catch (err) {
      setError(err.message || 'Could not change your password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Locked out? Let’s fix that."
      intro="We’ll send a code to the phone number or email on your account."
      heading="Reset your password"
      subheading={step === 'ask'
        ? 'Enter the phone number or email you sign in with.'
        : 'Enter the 6-digit code we sent, then choose a new password.'}
    >
      {options && !options.password_reset ? (
        <div className="stack stack-sm">
          <Alert tone="info">
            Password reset by code isn’t switched on yet. Message EkiMove support and we’ll reset it for you
            after checking it’s really you.
          </Alert>
          <SupportContacts className="stack stack-sm small" linkClassName="contact-link text-link"
            fallback={<p className="muted small">Support contacts will appear here soon.</p>} />
        </div>
      ) : step === 'ask' ? (
        <form className="form" onSubmit={ask}>
          <label className="field" htmlFor="reset-identifier">
            <span className="field-label">Phone number or email</span>
            <input id="reset-identifier" className="input" type="text" inputMode="email" autoComplete="username"
              autoCapitalize="none" spellCheck={false} value={identifier} minLength={3} maxLength={254} required
              placeholder="0803 000 0000 or you@example.com" onChange={(event) => setIdentifier(event.target.value)} />
          </label>
          <Alert tone="error">{error}</Alert>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !options}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form className="form" onSubmit={reset}>
          <Alert tone="info">{notice}</Alert>
          <label className="field" htmlFor="reset-code">
            <span className="field-label">6-digit code</span>
            <input id="reset-code" className="input code-input" type="text" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code}
              onChange={(event) => setCode(event.target.value)} />
          </label>
          <div className="field">
            <label className="field-label" htmlFor="reset-password">New password</label>
            <PasswordInput id="reset-password" autoComplete="new-password" minLength={12} maxLength={256} required
              placeholder="At least 12 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="reset-confirm">Confirm new password</label>
            <PasswordInput id="reset-confirm" autoComplete="new-password" maxLength={256} required
              placeholder="Type it again" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </div>
          <Alert tone="error">{error}</Alert>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
          <button className="btn btn-block" type="button" disabled={busy} onClick={ask}>
            Send a new code
          </button>
        </form>
      )}

      <p className="auth-switch">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
