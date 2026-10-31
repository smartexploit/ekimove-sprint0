import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileCheck2 } from 'lucide-react'
import Alert from './ui/Alert.jsx'
import { acceptPolicies, getPolicyStatus } from '../services/tripService.js'
import { POLICIES, POLICY_VERSION } from '../utils/policies.js'

/** Asks signed-in people to accept the current policies once. */
export default function PolicyGate({ role }) {
  const [needed, setNeeded] = useState(false)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (role === 'super_admin') return undefined
    let active = true
    getPolicyStatus().then((status) => active && setNeeded(Boolean(status.needs_acceptance))).catch(() => {})
    return () => {
      active = false
    }
  }, [role])

  if (!needed) return null
  const list = POLICIES.filter((policy) => !policy.drivers || role === 'driver')

  async function accept() {
    setBusy(true)
    setError('')
    try {
      await acceptPolicies(POLICY_VERSION)
      setNeeded(false)
    } catch (err) {
      setError(err.message || 'Could not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="session-warning" role="dialog" aria-modal="true" aria-labelledby="policy-title">
      <div className="session-card">
        <span className="instant-icon" aria-hidden="true"><FileCheck2 size={20} /></span>
        <h2 id="policy-title" className="section-title">Please review EkiMove’s policies</h2>
        <p className="muted small">
          They explain how EkiMove works, how we keep trips safe and how we use your data. Tap each one to read it.
        </p>
        <ul className="plain-list small">
          {list.map((policy) => (
            <li key={policy.slug}>
              <Link className="text-link" to={`/policies/${policy.slug}`} target="_blank" rel="noreferrer">
                {policy.title}
              </Link>
            </li>
          ))}
        </ul>
        <Alert tone="error">{error}</Alert>
        <label className="check-row">
          <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
          I have read and agree to these policies.
        </label>
        <button type="button" className="btn btn-primary" disabled={!agree || busy} onClick={accept}>
          {busy ? 'Saving…' : 'Agree and continue'}
        </button>
      </div>
    </div>
  )
}
