import { useState } from 'react'
import { Database } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import PasswordInput from '../ui/PasswordInput.jsx'
import { downloadFile } from '../../services/authService.js'
import { cancelDeletion, requestDeletion } from '../../services/promoService.js'
import { formatShortDate } from '../../utils/format.js'

/** Download a copy of your data, or ask for your account to be deleted. */
export default function DataRightsCard({ profile, onChanged }) {
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requested = profile.deletion_requested_at

  async function run(action, done) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (done) setNotice(done)
    } catch (err) {
      setError(err.message || 'That didn’t work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack stack-sm" aria-labelledby="data-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true"><Database size={20} /></span>
        <h2 id="data-title" className="section-title">Your data</h2>
      </div>
      <p className="muted small">
        Under the Nigeria Data Protection Act you can get a copy of the data EkiMove holds about you, or ask us to
        delete your account.
      </p>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <div>
        <button type="button" className="btn btn-sm" disabled={busy}
          onClick={() => run(() => downloadFile('/api/v1/me/export', 'ekimove-my-data.json'), 'Your data has been downloaded.')}>
          Download my data
        </button>
      </div>
      {requested ? (
        <div className="cancel-panel stack stack-sm">
          <p className="small" style={{ fontWeight: 800 }}>You asked us to delete your account on {formatShortDate(requested)}.</p>
          <p className="small">
            Our team will settle anything still owed (like refunds or driver earnings) and then delete it. Trip and payment
            records are kept without your name, as the law requires.
          </p>
          <div>
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => run(async () => onChanged(await cancelDeletion()), 'Deletion request cancelled.')}>
              Keep my account
            </button>
          </div>
        </div>
      ) : !asking ? (
        <div>
          <button type="button" className="link-button link-tap small" onClick={() => setAsking(true)}>Delete my account…</button>
        </div>
      ) : (
        <form className="cancel-panel stack stack-sm" onSubmit={(event) => {
          event.preventDefault()
          run(async () => {
            onChanged(await requestDeletion(password, reason.trim()))
            setAsking(false)
            setPassword('')
          }, 'Request sent. We’ll confirm in Support.')
        }}>
          <p className="small" style={{ fontWeight: 800 }}>Delete your EkiMove account?</p>
          <p className="small">
            You won’t be able to sign in or book. Trip and payment records stay, without your name. You can change your
            mind until we’ve done it.
          </p>
          <label className="field">
            <span className="field-label">Reason (optional)</span>
            <input className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="field">
            <label className="field-label" htmlFor="delete-password">Your password</label>
            <PasswordInput id="delete-password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="row">
            <button type="submit" className="btn btn-danger-outline btn-sm" disabled={busy || !password}>
              {busy ? 'Sending…' : 'Ask to delete my account'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}
