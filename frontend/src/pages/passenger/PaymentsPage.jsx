import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import {
  getRidePayment,
  initiateRidePayment,
  submitTransferReference,
} from '../../services/paymentService.js'

export default function PaymentsPage() {
  const [searchParams] = useSearchParams()
  const [rideId, setRideId] = useState(() => {
    const value = searchParams.get('rideId')
    return value && /^\d+$/.test(value) ? value : ''
  })
  const [reference, setReference] = useState('')
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function runAction(action) {
    const id = Number(rideId)

    setError('')
    setMessage('')

    if (!Number.isInteger(id) || id < 1) {
      setError('Enter a valid assigned Ride ID.')
      return
    }

    setBusy(true)

    try {
      const result = await action(id)
      setPayment(result)
      setReference(result.transfer_reference || '')
      setMessage('Payment information updated.')
    } catch (err) {
      setError(err.message || 'Unable to process the payment request.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitReference(event) {
    event.preventDefault()

    if (reference.trim().length < 3) {
      setError('Enter a valid bank transfer reference.')
      return
    }

    await runAction((id) => submitTransferReference(id, reference))
  }

  return (
    <AppPage
      eyebrow="PAYMENTS"
      title="Bank transfer payments"
      description="Manage payment for an assigned EkiMove ride."
      sectionTitle="Your ride payment"
      sectionText="EkiMove accepts bank transfers only. Cash payments are not accepted. Before transferring, obtain the current receiving-account details through an authorized EkiMove operator. Verify the account details before sending money. After making a genuine transfer, enter its transaction reference and submit it for verification. Your payment remains unconfirmed until an authorized administrator independently verifies receipt of the funds."
    >
      {error && (
        <p className="portal-alert portal-alert-error" role="alert">
          {error}
        </p>
      )}

      {message && <p role="status">{message}</p>}

      <div className="payment-policy-card">
        <label htmlFor="payment-ride-id">Ride ID from My Rides</label>
        <input
          id="payment-ride-id"
          type="number"
          min="1"
          step="1"
          value={rideId}
          onChange={(event) => setRideId(event.target.value)}
          placeholder="Enter your assigned ride ID"
          required
        />

        <div className="payment-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => runAction(initiateRidePayment)}
          >
            {busy ? 'Please wait...' : 'Initiate payment'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => runAction(getRidePayment)}
          >
            Check status
          </button>
        </div>
      </div>

      {payment && (
        <div className="payment-policy-card" aria-live="polite">
          <span className="payment-policy-mark" aria-hidden="true">₦</span>
          <h3>Payment details</h3>
          <p>Ride ID: <strong>{payment.ride_id}</strong></p>
          <p>Amount: <strong>₦{Number(payment.amount).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}</strong></p>
          <p>Method: <strong>Bank transfer</strong></p>
          <p>Status: <strong>{payment.status.replaceAll('_', ' ')}</strong></p>

          {payment.status !== 'confirmed' &&
            payment.status !== 'refunded' && (
              <form onSubmit={handleSubmitReference}>
                <label htmlFor="transfer-reference">
                  Bank transfer reference
                </label>
                <input
                  id="transfer-reference"
                  type="text"
                  minLength="3"
                  maxLength="120"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Enter your transfer reference"
                  required
                />
                <button type="submit" disabled={busy}>
                  {busy ? 'Submitting...' : 'Submit reference for verification'}
                </button>
              </form>
            )}

          <p className="field-hint">
            Submitting a reference does not confirm payment. An authorized
            administrator must independently verify the transfer before
            payment can be confirmed.
          </p>
        </div>
      )}
    </AppPage>
  )
}
