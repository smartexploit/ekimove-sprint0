import { useCallback, useState } from 'react'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
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
      setPayments(result)
    } catch (err) {
      setError(err.message || 'Could not load pending payments.')
    } finally {
      setLoading(false)
    }
  }, [])



  async function reconcile(payment, decision) {
    const reason = (reasons[payment.id] || '').trim()

    if (reason.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }

    if (decision === 'reject') {
      setConfirmingId(null)
      setVerified((current) => ({ ...current, [payment.id]: false }))
      setConfirmingId(null)
    }

    if (decision === 'confirm' && !verified[payment.id]) {
      setConfirmingId(payment.id)
      setError(
        'Before confirming, independently verify the transfer and check the verification box.'
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
    <AppPage
      title="Payment Reconciliation"
      description="Review bank-transfer references and reconcile payments only after independent verification."
    >
      <div className="app-panel">
        <p>
          <strong>Bank transfer only.</strong> A transfer reference or screenshot
          does not prove that funds have been received. Verify the actual
          transaction independently before confirming.
        </p>

        <div className="app-page-actions">
          <button type="button" onClick={() => { loadPayments() }} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh payments'}
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {loading ? (
          <p>Loading pending payments…</p>
        ) : payments.length === 0 ? (
          <p>No payments are awaiting confirmation.</p>
        ) : (
          <div className="app-list">
            {payments.map((payment) => (
              <section className="app-panel" key={payment.id}>
                <h3>Payment #{payment.id}</h3>
                <p><strong>Ride:</strong> #{payment.ride_id}</p>
                <p><strong>Amount:</strong> ₦{Number(payment.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
                <p><strong>Method:</strong> Bank transfer</p>
                <p><strong>Reference:</strong> {payment.transfer_reference || 'Not supplied'}</p>
                <p><strong>Status:</strong> {payment.status}</p>
                <p><strong>Submitted:</strong> {payment.created_at ? new Date(payment.created_at).toLocaleString() : 'Unavailable'}</p>

                <label htmlFor={`reason-${payment.id}`}>Reconciliation reason</label>
                <textarea
                  id={`reason-${payment.id}`}
                  rows={3}
                  value={reasons[payment.id] || ''}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [payment.id]: event.target.value,
                    }))
                  }
                  placeholder="Record the verification result or rejection reason"
                />

                {confirmingId === payment.id && (
                  <label>
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
                    {' '}I independently verified the actual transfer in the bank account or trusted provider.
                  </label>
                )}

                <div className="app-page-actions">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => reconcile(payment, 'confirm')}
                  >
                    {busyId === payment.id ? 'Processing…' : 'Confirm payment'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => reconcile(payment, 'reject')}
                  >
                    Reject payment
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppPage>
  )
}
