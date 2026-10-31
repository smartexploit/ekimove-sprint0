import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Wallet } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reasons, setReasons] = useState({})
  const [verified, setVerified] = useState({})
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const loadPayments = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/admin/payments/pending')
      setPayments(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err.message || 'Could not load pending payments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) loadPayments()
    })
    return () => {
      cancelled = true
    }
  }, [loadPayments])

  async function reconcile(payment, decision) {
    const reason = (reasons[payment.id] || '').trim()

    if (reason.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }

    if (decision === 'reject') {
      setVerified((current) => ({ ...current, [payment.id]: false }))
      setConfirmingId(null)
    }

    if (decision === 'confirm' && !verified[payment.id]) {
      setConfirmingId(payment.id)
      setError(
        'Before confirming, independently verify the transfer and tick the verification box.',
      )
      return
    }

    const action = decision === 'confirm' ? 'confirm this payment' : 'reject this payment'
    if (!window.confirm(`Are you sure you want to ${action}?`)) return

    setBusyId(payment.id)
    setError('')
    setNotice('')

    try {
      await apiRequest(`/api/v1/admin/payments/${payment.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      })
      setNotice(`Payment #${payment.id} ${decision === 'confirm' ? 'confirmed' : 'rejected'}.`)
      setReasons((current) => ({ ...current, [payment.id]: '' }))
      setVerified((current) => ({ ...current, [payment.id]: false }))
      setConfirmingId(null)
      await loadPayments()
    } catch (err) {
      setError(err.message || 'Reconciliation failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AdminShell
      title="Payment reconciliation"
      description="Confirm bank-transfer payments only after checking the money has actually arrived."
      actions={
        <button type="button" className="btn btn-sm" onClick={() => loadPayments()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      <div className="stack">
        <Alert tone="warning">
          A transfer reference or screenshot doesn't prove funds were received.
          Check the actual transaction in the bank account before confirming.
        </Alert>
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        {loading ? (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading pending payments…
          </div>
        ) : payments.length === 0 ? (
          <div className="card empty">
            <span className="empty-icon"><Wallet size={28} aria-hidden="true" /></span>
            <h2>Nothing to reconcile</h2>
            <p className="muted">No payments are waiting for confirmation.</p>
          </div>
        ) : (
          <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {payments.map((payment) => (
              <section className="card stack" key={payment.id} aria-labelledby={`payment-${payment.id}`}>
                <div className="row row-between">
                  <h2 id={`payment-${payment.id}`} className="card-title">
                    Payment #{payment.id}
                  </h2>
                  <StatusBadge status={payment.status} kind="payment" />
                </div>
                <p className="money" style={{ fontSize: 28, color: 'var(--green-800)' }}>
                  {formatNaira(payment.amount)}
                </p>
                <dl className="rows">
                  <div><dt>Ride</dt><dd>#{payment.ride_id}</dd></div>
                  <div><dt>Method</dt><dd>Bank transfer</dd></div>
                  <div><dt>Reference</dt><dd>{payment.transfer_reference || 'Not supplied'}</dd></div>
                  <div><dt>Submitted</dt><dd>{payment.created_at ? formatDateTime(payment.created_at) : 'Unavailable'}</dd></div>
                </dl>

                <label className="field" htmlFor={`reason-${payment.id}`}>
                  <span className="field-label">Reconciliation note</span>
                  <textarea
                    id={`reason-${payment.id}`}
                    className="textarea"
                    rows={3}
                    value={reasons[payment.id] || ''}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [payment.id]: event.target.value,
                      }))
                    }
                    placeholder="What you checked, or why you're rejecting it"
                  />
                </label>

                {confirmingId === payment.id && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={Boolean(verified[payment.id])}
                      onChange={(event) =>
                        setVerified((current) => ({
                          ...current,
                          [payment.id]: event.target.checked,
                        }))
                      }
                    />
                    I independently verified this transfer in the bank account or with a trusted provider.
                  </label>
                )}

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId !== null}
                    onClick={() => reconcile(payment, 'confirm')}
                  >
                    {busyId === payment.id ? 'Processing…' : 'Confirm payment'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    disabled={busyId !== null}
                    onClick={() => reconcile(payment, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
