import { useEffect, useState } from 'react'
import Alert from '../ui/Alert.jsx'

const RESEND_SECONDS = 60

/**
 * Six-digit code box with a resend button that waits a minute between
 * sends. `onSubmit(code)` and `onResend()` may throw to show an error.
 */
export default function CodeEntry({ sentTo, onSubmit, onResend, submitLabel = 'Confirm', id = 'code' }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(RESEND_SECONDS)

  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(code.replace(/\D/g, ''))
    } catch (err) {
      setError(err.message || 'That code didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setError('')
    try {
      await onResend()
      setCode('')
      setWait(RESEND_SECONDS)
    } catch (err) {
      setError(err.message || 'Could not send a new code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack stack-sm" onSubmit={submit}>
      {sentTo && <p className="small">We sent a 6-digit code to <strong>{sentTo}</strong>. It expires in 10 minutes.</p>}
      <label className="field" htmlFor={id}>
        <span className="field-label">Code</span>
        <input id={id} className="input code-input" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <Alert tone="error">{error}</Alert>
      <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/\D/g, '').length < 6}>
        {busy ? 'Checking…' : submitLabel}
      </button>
      {onResend && (
        <button type="button" className="btn btn-sm" disabled={busy || wait > 0} onClick={resend}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
      )}
    </form>
  )
}
