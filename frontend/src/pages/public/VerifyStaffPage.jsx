import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, CircleAlert, CircleX, Clock, Search } from 'lucide-react'
import PublicPage from '../../components/site/PublicPage.jsx'
import { apiUrl } from '../../services/authService.js'

const CODE_CHARS = /[^A-HJ-NP-Za-hj-np-z2-9]/g

function niceDate(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

function Result({ code, result }) {
  if (result.status === 'valid' || result.status === 'expired') {
    const ok = result.status === 'valid'
    return (
      <section className={`card verify-result ${ok ? 'is-valid' : 'is-expired'}`} aria-live="polite">
        <p className="verify-banner">
          {ok ? <BadgeCheck size={26} aria-hidden="true" /> : <Clock size={26} aria-hidden="true" />}
          {ok ? 'Verified EkiMove staff' : 'This card has expired'}
        </p>
        <div className="verify-person">
          {result.has_photo && <img src={apiUrl(`/api/v1/staff-cards/verify/${code}/photo`)} alt={`Photo of ${result.full_name}`} />}
          <div className="stack stack-sm">
            <h2 className="card-title">{result.full_name}</h2>
            <p>{result.title}</p>
            <p className="small muted">Staff number {result.staff_number}</p>
            <p className="small">{ok ? 'Valid until' : 'Expired on'} <strong>{niceDate(result.expires_on)}</strong></p>
          </div>
        </div>
        <p className="small muted">
          {ok
            ? 'Check that the photo matches the person in front of you.'
            : 'Ask them for a current card, or call EkiMove to confirm before you trust it.'}
        </p>
      </section>
    )
  }
  if (result.status === 'revoked') {
    return (
      <section className="card verify-result is-revoked" aria-live="polite">
        <p className="verify-banner"><CircleX size={26} aria-hidden="true" /> This card has been cancelled</p>
        <p>
          It was issued to <strong>{result.full_name}</strong> ({result.staff_number}) and is no longer valid.
          Don’t accept it as proof that they work for EkiMove.
        </p>
      </section>
    )
  }
  return (
    <section className="card verify-result is-revoked" aria-live="polite">
      <p className="verify-banner"><CircleAlert size={26} aria-hidden="true" /> No EkiMove card has this code</p>
      <p>Check the code and try again. If it still doesn’t match, the card may be fake: please don’t give the person money or information.</p>
    </section>
  )
}

/** Public check for an EkiMove staff ID card (the card's QR code opens this page). */
export default function VerifyStaffPage() {
  const { code: fromLink = '' } = useParams()
  const navigate = useNavigate()
  const code = fromLink.replace(CODE_CHARS, '').toUpperCase()
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState({ code: '', result: null, error: '' })

  useEffect(() => {
    document.title = 'Verify a staff ID · EkiMove'
  }, [])

  useEffect(() => {
    if (code.length !== 8) return undefined
    let active = true
    fetch(apiUrl(`/api/v1/staff-cards/verify/${code}`))
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Couldn’t check the card. Try again.')
        return data
      })
      .then((result) => active && setFound({ code, result, error: '' }))
      .catch((err) => active && setFound({ code, result: null, error: err.message }))
    return () => {
      active = false
    }
  }, [code])

  const current = found.code === code ? found : { result: null, error: '' }
  const loading = code.length === 8 && !current.result && !current.error

  function check(event) {
    event.preventDefault()
    const clean = typed.replace(CODE_CHARS, '').toUpperCase()
    if (clean.length === 8) navigate(`/verify/${clean}`)
  }

  return (
    <PublicPage eyebrow="Staff ID check" heading="Is this person from EkiMove?"
      intro="Scan the QR code on their EkiMove ID card, or type the 8-character code printed under it.">
      <div className="verify stack">
        {code.length === 8 ? (
          loading ? <p className="muted" role="status">Checking the card…</p>
            : current.error ? <p className="alert alert-error" role="alert">{current.error}</p>
              : <Result code={code} result={current.result} />
        ) : code ? (
          <Result code={code} result={{ status: 'not_found' }} />
        ) : null}

        <form className="card stack stack-sm" onSubmit={check}>
          <label className="field" htmlFor="verify-code">
            <span className="field-label">{code ? 'Check another card' : 'Code on the card'}</span>
            <input id="verify-code" className="input verify-input" autoComplete="off" autoCapitalize="characters"
              placeholder="e.g. K7QM-9XDA" maxLength={12} value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={typed.replace(CODE_CHARS, '').length !== 8}>
            <Search size={18} aria-hidden="true" /> Check card
          </button>
        </form>

        <p className="small muted">
          Not sure? Call EkiMove on <a href="tel:+2349137486405">0913 748 6405</a> or email{' '}
          <a href="mailto:hello@ekimove.com.ng">hello@ekimove.com.ng</a>. EkiMove staff will never ask you to pay
          them in cash or send money to a personal account.
        </p>
      </div>
    </PublicPage>
  )
}
