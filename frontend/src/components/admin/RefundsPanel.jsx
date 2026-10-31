import { useCallback, useEffect, useState } from 'react'
import Alert from '../ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

/** Refunds owed to passengers after a cancelled paid ride. */
export default function RefundsPanel() {
  const [items, setItems] = useState({ loaded: false, list: [] })
  const [refs, setRefs] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiRequest('/api/v1/admin/refunds?status=due')
      setItems({ loaded: true, list: Array.isArray(data) ? data : [] })
    } catch (err) {
      setItems({ loaded: true, list: [] })
      setError(err.message || 'Could not load refunds.')
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) load()
    })
    return () => {
      active = false
    }
  }, [load])

  async function markPaid(refund) {
    const reference = (refs[refund.payment_id] || '').trim()
    if (reference.length < 3) {
      setError('Enter the reference of the refund transfer you sent.')
      return
    }
    setBusyId(refund.payment_id)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/api/v1/admin/payments/${refund.payment_id}/refund-paid`, {
        method: 'POST',
        body: JSON.stringify({ refund_reference: reference }),
      })
      setNotice(`Refund for ride #${refund.ride_id} recorded.`)
      await load()
    } catch (err) {
      setError(err.message || 'Could not record the refund.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="stack" aria-labelledby="refunds-title">
      <div>
        <h2 id="refunds-title" className="section-title">Refunds to send</h2>
        <p className="muted small">
          Paid rides that were cancelled. Send the refund to the passenger, then record the reference.
        </p>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {items.loaded && items.list.length === 0 ? (
        <p className="card muted small">No refunds are waiting.</p>
      ) : (
        <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
          {items.list.map((refund) => (
            <article className="card stack" key={refund.payment_id}>
              <div className="row row-between">
                <p className="money" style={{ fontSize: 24, color: 'var(--laterite-700)' }}>
                  {formatNaira(refund.refund_amount)}
                </p>
                <span className="muted small">Ride #{refund.ride_id}</span>
              </div>
              <dl className="rows small">
                <div><dt>Passenger</dt><dd>{refund.passenger ? `${refund.passenger.name} · ${refund.passenger.phone}` : '—'}</dd></div>
                <div><dt>Route</dt><dd>{refund.route || '—'}</dd></div>
                <div><dt>Paid</dt><dd>{formatNaira(refund.paid_amount)}</dd></div>
                <div><dt>Fee kept</dt><dd>{formatNaira(refund.cancellation_fee)}</dd></div>
                <div><dt>Cancelled</dt><dd>{refund.cancelled_at ? formatDateTime(refund.cancelled_at) : '—'}</dd></div>
              </dl>
              <label className="field">
                <span className="field-label">Refund transfer reference</span>
                <input
                  className="input"
                  value={refs[refund.payment_id] || ''}
                  onChange={(event) => setRefs((current) => ({ ...current, [refund.payment_id]: event.target.value }))}
                  placeholder="From your bank app"
                />
              </label>
              <div>
                <button type="button" className="btn btn-primary btn-sm" disabled={busyId !== null}
                  onClick={() => markPaid(refund)}>
                  {busyId === refund.payment_id ? 'Saving…' : 'Mark refund sent'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
