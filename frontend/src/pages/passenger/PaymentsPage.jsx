import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import {
  getRidePayment,
  initiateRidePayment,
  submitTransferReference,
  initiateInterswitchPayment,
  verifyInterswitchPayment,
} from '../../services/paymentService.js'

export default function PaymentsPage() {
  const [searchParams] = useSearchParams()
  const [rideId, setRideId] = useState(() => {
    const value = searchParams.get('rideId')
    return value && /^\d+$/.test(value) ? value : ''
  })
  const [reference, setReference] = useState('')
  const [email, setEmail] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function validRideId() {
    const id = Number(rideId)
    if (!Number.isInteger(id) || id < 1) {
      setError('Enter a valid assigned Ride ID.')
      return null
    }
    return id
  }

  async function runAction(action) {
    const id = validRideId()
    if (!id) return

    setError('')
    setMessage('')
    setBusy(true)
    try {
      const result = await action(id)
      setPayment(result.payment || result)
      setReference((result.payment || result).transfer_reference || '')
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

  async function startInterswitch() {
    const id = validRideId()
    if (!id) return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address for checkout.')
      return
    }

    setError('')
    setMessage('')
    setBusy(true)

    try {
      const result = await initiateInterswitchPayment(id, email)
      setPayment(result.payment)

      if (!result.checkout) {
        setMessage(`Payment status: ${result.payment.status.replaceAll('_', ' ')}.`)
        return
      }

      const checkout = result.checkout
      const redirect = new URL(checkout.redirect_url)

      const allowedHosts = [
        'newwebpay-sandbox.interswitchng.com',
        'newwebpay.interswitchng.com',
      ]

      if (
        redirect.protocol !== 'https:' ||
        !allowedHosts.includes(redirect.hostname) ||
        redirect.pathname !== '/collections/w/pay'
      ) {
        throw new Error('Invalid Interswitch redirect address.')
      }

      const returnUrl = new URL('/payments', window.location.origin)
      returnUrl.searchParams.set('rideId', String(id))

      const fields = {
        merchant_code: checkout.merchant_code,
        pay_item_id: checkout.pay_item_id,
        site_redirect_url: returnUrl.toString(),
        txn_ref: checkout.txn_ref,
        amount: String(checkout.amount),
        currency: checkout.currency || '566',
        cust_email: checkout.customer_email,
        cust_name: result.payment.passenger_name || '',
        cust_id: String(result.payment.ride_id),
        pay_item_name: 'EkiMove ride payment',
        payment_response_type: 'GET',
      }

      const form = document.createElement('form')
      form.method = 'POST'
      form.action = redirect.toString()
      form.style.display = 'none'

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = String(value ?? '')
        form.appendChild(input)
      })

      document.body.appendChild(form)
      setMessage('Redirecting to Interswitch secure checkout...')
      form.submit()
    } catch (err) {
      setError(err.message || 'Unable to start Interswitch checkout.')
      setBusy(false)
    }
  }

  async function checkStatus() {
    const id = validRideId()
    if (!id) return

    if (method === 'interswitch') {
      setError('')
      setMessage('')
      setBusy(true)
      try {
        const result = await verifyInterswitchPayment(id)
        setPayment(result)
        setMessage(
          result.status === 'confirmed'
            ? 'Payment confirmed by Interswitch.'
            : `Payment status: ${result.status.replaceAll('_', ' ')}.`
        )
      } catch (err) {
        // If no Interswitch payment exists yet, allow the user to inspect the
        // current payment record using the existing status endpoint.
        try {
          const result = await getRidePayment(id)
          setPayment(result.payment || result)
          setMessage('Current payment status loaded.')
        } catch {
          setError(err.message || 'Unable to check payment status.')
        }
      } finally {
        setBusy(false)
      }
      return
    }

    await runAction(getRidePayment)
  }

  return (
    <AppPage
      eyebrow="PAYMENTS"
      title="Ride payments"
      description="Manage payment for an assigned EkiMove ride."
      sectionTitle="Your ride payment"
      sectionText="Choose bank transfer or Interswitch checkout. Cash is not accepted. Bank-transfer references remain unconfirmed until an authorized administrator independently verifies receipt. Interswitch payments are confirmed only after server-side provider verification."
    >
      {error && <p className="portal-alert portal-alert-error" role="alert">{error}</p>}
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

        <label htmlFor="payment-method">Payment method</label>
        <select
          id="payment-method"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          disabled={busy}
        >
          <option value="bank_transfer">Bank transfer</option>
          <option value="interswitch">Card, transfer or supported digital wallets</option>
        </select>

        {method === 'bank_transfer' ? (
          <div className="payment-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(initiateRidePayment)}
            >
              {busy ? 'Please wait...' : 'Initiate bank transfer'}
            </button>
            <button type="button" disabled={busy} onClick={checkStatus}>
              Check status
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="checkout-email">Email for checkout</label>
            <input
              id="checkout-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
            <p className="field-hint">
              This email is used for this checkout session and is not saved to your EkiMove profile.
            </p>
            <div className="payment-actions">
              <button type="button" disabled={busy} onClick={startInterswitch}>
                {busy ? 'Please wait...' : 'Continue to secure checkout'}
              </button>
              <button type="button" disabled={busy} onClick={checkStatus}>
                Verify payment status
              </button>
            </div>
          </>
        )}
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
          <p>Method: <strong>{
            payment.method === 'interswitch' ? 'Interswitch checkout' : 'Bank transfer'
          }</strong></p>
          <p>Status: <strong>{String(payment.status).replaceAll('_', ' ')}</strong></p>

          {payment.method !== 'interswitch' &&
            payment.status !== 'confirmed' &&
            payment.status !== 'refunded' && (
              <form onSubmit={handleSubmitReference}>
                <label htmlFor="transfer-reference">Bank transfer reference</label>
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
            {payment.method === 'interswitch'
              ? 'A checkout completion message is not proof of payment. EkiMove confirms payment only after server-side provider verification.'
              : 'Submitting a reference does not confirm payment. An authorized administrator must independently verify the transfer.'}
          </p>
        </div>
      )}
    </AppPage>
  )
}
