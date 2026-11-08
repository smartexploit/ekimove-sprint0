import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import PasswordInput from '../ui/PasswordInput.jsx'
import CodeEntry from './CodeEntry.jsx'
import { changePassword, confirmVerifyCode, getProfile, sendVerifyCode } from '../../services/accountService.js'
import { signOutCompletely } from '../../services/authService.js'

function NewPasswordStep({ onDone }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (form.next.length < 12) return setError('Your new password must contain at least 12 characters.')
    if (form.next !== form.confirm) return setError('Your passwords do not match.')
    setBusy(true)
    try {
      await changePassword(form.current, form.next)
      onDone()
    } catch (err) {
      setError(err.message || 'Could not change your password.')
    } finally {
      setBusy(false)
    }
    return undefined
  }

  return (
    <form className="stack stack-sm" onSubmit={submit}>
      <span className="instant-icon" aria-hidden="true"><KeyRound size={20} /></span>
      <h2 id="gate-title" className="section-title">Choose your own password</h2>
      <p className="muted small">EkiMove support gave you a temporary password. Replace it with one only you know.</p>
      <div className="field">
        <label className="field-label" htmlFor="gate-current">Temporary password</label>
        <PasswordInput id="gate-current" autoComplete="current-password" required value={form.current}
          onChange={set('current')} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="gate-new">New password</label>
        <PasswordInput id="gate-new" autoComplete="new-password" minLength={12} required value={form.next}
          placeholder="At least 12 characters" onChange={set('next')} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="gate-confirm">Confirm new password</label>
        <PasswordInput id="gate-confirm" autoComplete="new-password" required value={form.confirm}
          onChange={set('confirm')} />
      </div>
      <Alert tone="error">{error}</Alert>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  )
}

function ConfirmContactStep({ profile, onDone }) {
  const [channel, setChannel] = useState(profile.contact.needs_verification)
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isSms = channel === 'sms'
  const destination = isSms ? profile.phone : profile.email
  const other = isSms ? 'email' : 'sms'
  const canSwitch = (other === 'sms' ? profile.phone && profile.contact.sms_available
    : profile.email && profile.contact.email_available)

  async function send() {
    setBusy(true)
    setError('')
    try {
      const result = await sendVerifyCode(channel)
      setSentTo(result.sent_to)
    } catch (err) {
      setError(err.message || 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack stack-sm">
      <span className="instant-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
      <h2 id="gate-title" className="section-title">Confirm your {isSms ? 'phone number' : 'email'}</h2>
      {!sentTo ? (
        <>
          <p className="muted small">
            We’ll {isSms ? 'text' : 'email'} a 6-digit code to <strong>{destination}</strong>. It keeps your account
            safe and lets you reset your password if you forget it.
          </p>
          <Alert tone="error">{error}</Alert>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : isSms ? 'Text me a code' : 'Email me a code'}
          </button>
        </>
      ) : (
        <CodeEntry id="gate-code" sentTo={sentTo} onSubmit={async (code) => {
          await confirmVerifyCode(channel, code)
          onDone()
        }} onResend={async () => setSentTo((await sendVerifyCode(channel)).sent_to)} />
      )}
      {canSwitch && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => {
          setChannel(other)
          setSentTo('')
          setError('')
        }}>
          Use my {other === 'sms' ? 'phone number' : 'email'} instead
        </button>
      )}
    </div>
  )
}

/** After sign-in: asks for a new password after a staff reset, and for a
 * code to confirm the account's phone number or email once codes are on. */
export default function AccountGate() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let active = true
    getProfile().then((data) => active && setProfile(data)).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!profile) return null
  const step = profile.must_change_password ? 'password' : profile.contact?.needs_verification ? 'contact' : null
  if (!step) return null
  const reload = () => getProfile().then(setProfile).catch(() => setProfile(null))

  return (
    <div className="session-warning" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="session-card">
        {step === 'password' ? <NewPasswordStep onDone={reload} /> : <ConfirmContactStep profile={profile} onDone={reload} />}
        <button type="button" className="btn btn-sm" onClick={() => {
          signOutCompletely()
          navigate('/login', { replace: true })
        }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
