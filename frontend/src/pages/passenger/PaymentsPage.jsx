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

function loadInterswitchScript(mode) {
  const normalizedMode = String(mode).toUpperCase()
  if (normalizedMode !== 'TEST' && normalizedMode !== 'LIVE') {
    throw new Error('Invalid Interswitch checkout mode.')
  }

  const src = normalizedMode === 'LIVE'
    ? 'https://newwebpay.interswitchng.com/inline-checkout.js'
    : 'https://newwebpay-sandbox.interswitchng.com/inline-checkout.js'

  let script = document.querySelector('script[data-ekimove-interswitch]')

  if (script && script.src !== src) {
    throw new Error(
      'A different Interswitch mode is already loaded. Reload the page before switching modes.'
    )
  }

  if (typeof window.webpayCheckout === 'function') {
    return Promise.resolve()
  }

  if (script?.dataset.ekimoveLoaded === 'true') {
    return Promise.reject(
      new Error('Interswitch checkout did not initialize. Please reload and retry.')
    )
  }

  return new Promise((resolve, reject) => {
    let timeoutId

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    const onLoad = () => {
      cleanup()
      script.dataset.ekimoveLoaded = 'true'

      if (typeof window.webpayCheckout === 'function') {
        resolve()
      } else {
        reject(new Error('Interswitch checkout did not initialize. Please retry.'))
      }
    }

    const onError = () => {
      cleanup()
      reject(new Error('Unable to load Interswitch checkout.'))
    }

    if (script) {
      reject(new Error(
        'An Interswitch script is already present but not initialized. Reload the page and retry.'
      ))
      return
    }

    script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.ekimoveInterswitch = 'true'


    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(
        'Timed out loading Interswitch checkout. Check your connection and retry.'
      ))
    }, 15000)

    if (!script.isConnected) {
      document.body.appendChild(script)
    }
  })
}
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

      await loadInterswitchScript(result.checkout.mode)

      if (typeof window.webpayCheckout !== 'function') {
        throw new Error('Interswitch checkout did not initialize. Please retry.')
      }

      setMessage('Complete checkout in the Interswitch window. EkiMove will verify the result with the provider.')

      window.webpayCheckout({
        merchant_code: result.checkout.merchant_code,
        pay_item_id: result.checkout.pay_item_id,
        txn_ref: result.checkout.txn_ref,
        amount: result.checkout.amount,
        currency: 566,
        cust_email: result.checkout.customer_email,
        cust_name: result.payment.passenger_name || '',
        cust_id: String(result.payment.ride_id),
        pay_item_name: 'EkiMove ride payment',
        mode: result.checkout.mode,
        onComplete: async () => {
          // Browser callback is not proof of payment; ask our backend to requery.
          setBusy(true)
          try {
            const verified = await verifyInterswitchPayment(id)
            setPayment(verified)
            setMessage(
              verified.status === 'confirmed'
                ? 'Payment confirmed by Interswitch.'
                : 'Payment is not confirmed yet. Check status again shortly.'
            )
          } catch (err) {
            setError(err.message || 'Could not verify payment. Check status and retry.')
          } finally {
            setBusy(false)
          }
        },
      })
    } catch (err) {
      setError(err.message || 'Unable to start Interswitch checkout.')
    } finally {
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
          <option value="interswitch">Interswitch checkout</option>
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
                {busy ? 'Please wait...' : 'Pay with Interswitch'}
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
          <span className="payment-policy-mark" aria-hidden="true">â‚¦</span>
          <h3>Payment details</h3>
          <p>Ride ID: <strong>{payment.ride_id}</strong></p>
          <p>Amount: <strong>â‚¦{Number(payment.amount).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}</strong></p>
          <p>Method: <strong>{
            payment.method === 'interswitch' ? 'Interswitch' : 'Bank transfer'
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


