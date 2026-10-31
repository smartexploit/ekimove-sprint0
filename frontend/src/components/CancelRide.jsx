import { useState } from 'react'
import { X } from 'lucide-react'
import Alert from './ui/Alert.jsx'
import { cancelRide, previewCancellation } from '../services/paymentService.js'
import { formatNaira } from '../utils/format.js'

const CANCELLABLE = new Set(['quote_requested', 'quoted', 'requested', 'assigned', 'driver_arriving'])

/**
 * "Cancel ride" button that first shows the passenger exactly what it
 * costs (from the server), and only cancels after they confirm.
 */
export default function CancelRide({ requestId, status, onCancelled, tone = 'dark' }) {
  const [terms, setTerms] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!CANCELLABLE.has(status)) return null

  async function openPreview() {
    setBusy(true)
    setError('')
    try {
      setTerms(await previewCancellation(requestId))
    } catch (err) {
      setError(err.message || 'Could not check the cancellation terms.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const result = await cancelRide(requestId)
      setTerms(null)
      onCancelled?.(result)
    } catch (err) {
      setError(err.message || 'Could not cancel this ride.')
    } finally {
      setBusy(false)
    }
  }

  if (!terms) {
    return (
      <>
        <button
          type="button"
          className={`btn ${tone === 'dark' ? 'btn-on-dark' : 'btn-danger-outline'}`}
          onClick={openPreview}
          disabled={busy}
        >
          <X size={16} aria-hidden="true" /> {busy ? 'Checking…' : 'Cancel ride'}
        </button>
        {error && <Alert tone="error">{error}</Alert>}
      </>
    )
  }

  const fee = Number(terms.fee || 0)
  const refund = Number(terms.refund || 0)

  return (
    <div className="cancel-panel" role="dialog" aria-labelledby={`cancel-${requestId}`}>
      <h3 id={`cancel-${requestId}`} style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
        Cancel this ride?
      </h3>
      <p className="small" style={{ marginTop: 4, color: 'var(--ink-700)' }}>{terms.message}</p>
      {terms.can_cancel && (fee > 0 || refund > 0) && (
        <dl className="rows small">
          <div>
            <dt>Cancellation fee</dt>
            <dd>{formatNaira(fee, { decimals: 0 })}</dd>
          </div>
          {terms.paid && (
            <div>
              <dt>Refund to you</dt>
              <dd>{formatNaira(refund, { decimals: 0 })}</dd>
            </div>
          )}
        </dl>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="row" style={{ marginTop: 10 }}>
        {terms.can_cancel && (
          <button type="button" className="btn btn-accent" onClick={confirm} disabled={busy}>
            {busy ? 'Cancelling…' : fee > 0 ? `Cancel and pay ${formatNaira(fee, { decimals: 0 })}` : 'Yes, cancel ride'}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setTerms(null)} disabled={busy}>
          Keep my ride
        </button>
      </div>
    </div>
  )
}
