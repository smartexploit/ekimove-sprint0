import './PaymentsPage.css'
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
import './PaymentsPage.css'

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
      <div className="payments-page">

        <div className="payments-intro">
          <div>
            <span className="payments-eyebrow">SECURE CHECKOUT</span>
            <h2>Complete your ride payment</h2>
            <p>
              Choose your preferred payment method and follow the instructions
              to complete your payment securely.
            </p>
          </div>
          <div className="payment-shield">✓</div>
        </div>

        {error && (
          <p className="payment-notice payment-error" role="alert">
            <span>!</span> {error}
          </p>
        )}

        {message && (
          <p className="payment-notice payment-success" role="status">
            <span>✓</span> {message}
          </p>
        )}

        <div className="payments-layout">

          <section className="payment-form-card">
            <div className="payment-card-heading">
              <div>
                <span className="payment-step">STEP 01</span>
                <h3>Payment information</h3>
                <p>Enter your ride details to continue.</p>
              </div>
            </div>

            <div className="payment-field">
              <label htmlFor="payment-ride-id">Assigned Ride ID</label>
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
              <small>Find your assigned Ride ID in your My Rides page.</small>
            </div>

            <div className="payment-field">
              <label htmlFor="payment-method">Choose payment method</label>
              <select
                id="payment-method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                disabled={busy}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="interswitch">Interswitch checkout</option>
              </select>
            </div>

            {method === 'bank_transfer' ? (
              <div className="payment-method-panel">
                <div className="method-heading">
                  <span className="method-icon">₦</span>
                  <div>
                    <h4>Bank transfer</h4>
                    <p>Initiate a transfer and submit your reference.</p>
                  </div>
                </div>

                <div className="payment-actions">
                  <button
                    className="payment-primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(initiateRidePayment)}
                  >
                    {busy ? 'Please wait...' : 'Initiate bank transfer'}
                  </button>

                  <button
                    className="payment-secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={checkStatus}
                  >
                    Check status
                  </button>
                </div>
              </div>
            ) : (
              <div className="payment-method-panel">
                <div className="method-heading">
                  <span className="method-icon">↗</span>
                  <div>
                    <h4>Interswitch checkout</h4>
                    <p>Pay securely using the Interswitch checkout window.</p>
                  </div>
                </div>

                <div className="payment-field">
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
                  <small>
                    This email is used for this checkout session and is not
                    saved to your EkiMove profile.
                  </small>
                </div>

                <div className="payment-actions">
                  <button
                    className="payment-primary-button"
                    type="button"
                    disabled={busy}
                    onClick={startInterswitch}
                  >
                    {busy ? 'Please wait...' : 'Pay with Interswitch'}
                  </button>

                  <button
                    className="payment-secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={checkStatus}
                  >
                    Verify payment status
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="payment-info-card">
            <span className="payment-info-eyebrow">PAYMENT GUIDE</span>
            <h3>Simple. Secure. Reliable.</h3>
            <p>
              Complete your payment using one of our supported payment
              methods.
            </p>

            <div className="payment-guide-item">
              <span>01</span>
              <div>
                <strong>Enter your Ride ID</strong>
                <p>Use the ID assigned to your ride.</p>
              </div>
            </div>

            <div className="payment-guide-item">
              <span>02</span>
              <div>
                <strong>Choose a payment method</strong>
                <p>Select bank transfer or Interswitch.</p>
              </div>
            </div>

            <div className="payment-guide-item">
              <span>03</span>
              <div>
                <strong>Confirm your payment</strong>
                <p>Check your payment status after completing checkout.</p>
              </div>
            </div>

            <div className="payment-security-note">
              <span>✓</span>
              <p>
                Your payment is only marked as confirmed after the required
                verification process.
              </p>
            </div>
          </aside>
        </div>

        {payment && (
          <section className="payment-details-card" aria-live="polite">
            <div className="payment-details-heading">
              <div>
                <span className="payment-step">PAYMENT SUMMARY</span>
                <h3>Payment details</h3>
              </div>
              <span className={`payment-status-tag ${payment.status}`}>
                {String(payment.status).replaceAll('_', ' ')}
              </span>
            </div>

            <div className="payment-details-grid">
              <div>
                <small>RIDE ID</small>
                <strong>{payment.ride_id}</strong>
              </div>

              <div>
                <small>AMOUNT</small>
                <strong className="payment-amount">
                  ₦{Number(payment.amount).toLocaleString('en-NG', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>

              <div>
                <small>PAYMENT METHOD</small>
                <strong>
                  {payment.method === 'interswitch'
                    ? 'Interswitch'
                    : 'Bank transfer'}
                </strong>
              </div>

              <div>
                <small>PAYMENT STATUS</small>
                <strong>{String(payment.status).replaceAll('_', ' ')}</strong>
              </div>
            </div>

            {payment.method !== 'interswitch' &&
              payment.status !== 'confirmed' &&
              payment.status !== 'refunded' && (
                <form
                  className="transfer-reference-form"
                  onSubmit={handleSubmitReference}
                >
                  <h4>Submit bank transfer reference</h4>

                  <div className="payment-field">
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
                  </div>

                  <button
                    className="payment-primary-button"
                    type="submit"
                    disabled={busy}
                  >
                    {busy
                      ? 'Submitting...'
                      : 'Submit reference for verification'}
                  </button>
                </form>
              )}

            <div className="payment-verification-note">
              <span>ⓘ</span>
              <p>
                {payment.method === 'interswitch'
                  ? 'A checkout completion message is not proof of payment. EkiMove confirms payment only after server-side provider verification.'
                  : 'Submitting a reference does not confirm payment. An authorized administrator must independently verify the transfer.'}
              </p>
            </div>
          </section>
        )}
      </div>
    </AppPage>
  )
}
