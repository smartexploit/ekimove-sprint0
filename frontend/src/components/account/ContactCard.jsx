import { useState } from 'react'
import { Mail, Smartphone } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import PasswordInput from '../ui/PasswordInput.jsx'
import CodeEntry from './CodeEntry.jsx'
import {
  confirmContactChange,
  confirmVerifyCode,
  sendVerifyCode,
  startContactChange,
} from '../../services/accountService.js'

const KINDS = {
  phone: { label: 'Phone number', channel: 'sms', Icon: Smartphone, input: { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: 'e.g. 08012345678' } },
  email: { label: 'Email', channel: 'email', Icon: Mail, input: { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'you@example.com' } },
}

function ChangeForm({ kind, onDone, onCancel }) {
  const meta = KINDS[kind]
  const [value, setValue] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start(event) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await startContactChange(kind, value.trim(), password)
      if (result.code_sent) setSentTo(result.sent_to)
      else onDone(result.profile, `${meta.label} saved.`)
    } catch (err) {
      setError(err.message || 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <CodeEntry id={`${kind}-change-code`} sentTo={sentTo} submitLabel={`Save ${meta.label.toLowerCase()}`}
        onSubmit={async (code) => {
          const result = await confirmContactChange(kind, value.trim(), code)
          onDone(result.profile, `${meta.label} changed and confirmed.`)
        }}
        onResend={async () => setSentTo((await startContactChange(kind, value.trim(), password)).sent_to)} />
    )
  }

  return (
    <form className="stack stack-sm" onSubmit={start}>
      <label className="field">
        <span className="field-label">New {meta.label.toLowerCase()}</span>
        <input className="input" required maxLength={254} autoCapitalize="none" spellCheck={false} {...meta.input}
          value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <div className="field">
        <label className="field-label" htmlFor={`${kind}-password`}>Your password</label>
        <PasswordInput id={`${kind}-password`} autoComplete="current-password" required value={password}
          onChange={(event) => setPassword(event.target.value)} />
      </div>
      <Alert tone="error">{error}</Alert>
      <div className="row" style={{ gap: 10 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function ConfirmExisting({ kind, onDone }) {
  const channel = KINDS[kind].channel
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true)
    setError('')
    try {
      setSentTo((await sendVerifyCode(channel)).sent_to)
    } catch (err) {
      setError(err.message || 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <CodeEntry id={`${kind}-confirm-code`} sentTo={sentTo} onSubmit={async (code) => {
        await confirmVerifyCode(channel, code)
        onDone()
      }} onResend={async () => setSentTo((await sendVerifyCode(channel)).sent_to)} />
    )
  }
  return (
    <div className="stack stack-sm">
      <Alert tone="error">{error}</Alert>
      <div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : 'Confirm with a code'}
        </button>
      </div>
    </div>
  )
}

/** The phone number and email someone signs in with, and changing them. */
export default function ContactCard({ profile, onSaved, onReload }) {
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const contact = profile.contact || {}

  return (
    <section className="card stack" aria-labelledby="contact-title">
      <div>
        <h2 id="contact-title" className="section-title">Sign-in details</h2>
        <p className="muted small">You can sign in with either of these and your password.</p>
      </div>
      <Alert tone="success">{notice}</Alert>
      {Object.entries(KINDS).map(([kind, meta]) => {
        const value = profile[kind]
        const verified = kind === 'phone' ? contact.phone_verified : contact.email_verified
        const canConfirm = value && !verified && (kind === 'phone' ? contact.sms_available : contact.email_available)
        return (
          <div className="stack stack-sm" key={kind}>
            <div className="contact-row">
              <div className="row contact-row-main" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <meta.Icon size={20} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <p className="small muted" style={{ margin: 0 }}>{meta.label}</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>{value || 'Not added'}</p>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {value && (
                  <span className={`badge ${verified ? 'badge-green' : 'badge-gold'}`}>
                    {verified ? 'Confirmed' : 'Not confirmed'}
                  </span>
                )}
                {editing !== kind && (
                  <button type="button" className="btn btn-sm" onClick={() => {
                    setEditing(kind)
                    setNotice('')
                  }}>
                    {value ? 'Change' : 'Add'}
                  </button>
                )}
              </div>
            </div>
            {editing === kind ? (
              <ChangeForm kind={kind} onCancel={() => setEditing(null)} onDone={(updated, message) => {
                setEditing(null)
                setNotice(message)
                onSaved(updated)
              }} />
            ) : canConfirm && (
              <ConfirmExisting kind={kind} onDone={() => {
                setNotice(`${meta.label} confirmed.`)
                onReload()
              }} />
            )}
          </div>
        )
      })}
    </section>
  )
}
