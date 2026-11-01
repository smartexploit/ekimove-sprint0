import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import { confirmPasswordReset, getAuthOptions, requestPasswordReset } from '../../services/authService.js'
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '../../utils/inputRules.js'
import ContactMethodField from '../../components/auth/ContactMethodField.jsx'
import useContactMethod from '../../hooks/useContactMethod.js'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [options, setOptions] = useState(null)
  const [step, setStep] = useState('ask')
  const contact = useContactMethod(location.state?.identifier)
  const identifier = contact.identifier
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
    setError('')
    if (contact.problem) {
      setError(contact.problem)
      document.getElementById(`reset-${contact.method}`)?.focus()
      return
    }
    setBusy(true)
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
    if (code.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code we sent you.')
      return
    }
    const weak = passwordProblem(password, { phone: contact.method === 'phone' ? identifier : '',
      email: contact.method === 'email' ? identifier : '' })
    if (weak) {
      setError(weak)
      return
    }
    if (password !== confirm) {
      setError('Your passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await confirmPasswordReset({ identifier, code: code.replace(/\D/g, ''), new_password: password })
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
          <ContactMethodField
            idPrefix="reset"
            label="Send the code to my"
            method={contact.method}
            onMethod={(next) => { contact.setMethod(next); setError('') }}
            phone={contact.phone}
            onPhone={contact.setPhone}
            email={contact.email}
            onEmail={contact.setEmail}
          />
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
              onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, '').slice(0, 7))} />
          </label>
          <div className="field">
            <label className="field-label" htmlFor="reset-password">New password</label>
            <PasswordInput id="reset-password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
              required placeholder={`At least ${PASSWORD_MIN} characters`} value={password}
              aria-describedby="reset-password-hint" onChange={(event) => setPassword(event.target.value)} />
            <span id="reset-password-hint" aria-live="polite"
              className={`field-hint ${password ? (passwordProblem(password) ? '' : 'field-hint-ok') : ''}`}>
              {password ? passwordProblem(password) || 'Strong enough.' : 'A short phrase only you would know is easy to remember.'}
            </span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="reset-confirm">Confirm new password</label>
            <PasswordInput id="reset-confirm" autoComplete="new-password" maxLength={PASSWORD_MAX} required
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
