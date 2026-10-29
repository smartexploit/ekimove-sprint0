from pathlib import Path
from datetime import datetime
import shutil

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

def backup(path):
    p = Path(path)
    shutil.copy2(p, p.with_name(p.name + f".before-checkout-{stamp}"))

# 1. Backend: require an email for Interswitch checkout.
p = Path("app/interswitch_payments.py")
text = p.read_text(encoding="utf-8")

if "class InterswitchInitiateRequest" not in text:
    text = text.replace(
        "from decimal import Decimal, ROUND_HALF_UP\n",
        "from decimal import Decimal, ROUND_HALF_UP\nimport re\nfrom pydantic import BaseModel, Field, field_validator\n",
        1,
    )
    marker = 'router = APIRouter(prefix="/api/v1/payments", tags=["interswitch"])\n'
    addition = '''

class InterswitchInitiateRequest(BaseModel):
    customer_email: str = Field(min_length=5, max_length=254)

    @field_validator("customer_email")
    @classmethod
    def validate_customer_email(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[^\\s@]+@[^\\s@]+\\.[^\\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value
'''
    if text.count(marker) != 1:
        raise RuntimeError("Could not safely locate Interswitch router declaration.")
    text = text.replace(marker, marker + addition, 1)

old_sig = '''def initiate_interswitch(
    ride_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:'''
new_sig = '''def initiate_interswitch(
    ride_id: int,
    payload: InterswitchInitiateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:'''
if old_sig in text:
    text = text.replace(old_sig, new_sig, 1)
elif new_sig not in text:
    raise RuntimeError("Could not safely locate Interswitch initiation signature.")

text = text.replace(
    '"customer_email": getattr(user, "email", "") or "",',
    '"customer_email": payload.customer_email,',
    1,
)
if '"customer_email": payload.customer_email,' not in text:
    raise RuntimeError("Could not update checkout email safely.")

backup(p)
p.write_text(text, encoding="utf-8")

# 2. Frontend service: add Interswitch endpoints.
p = Path("frontend/src/services/paymentService.js")
text = p.read_text(encoding="utf-8")
if "initiateInterswitchPayment" not in text:
    text += '''

export async function initiateInterswitchPayment(rideId, customerEmail) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/interswitch/initiate`, {
    method: 'POST',
    body: JSON.stringify({ customer_email: customerEmail.trim() }),
  })
}

export async function verifyInterswitchPayment(rideId) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/interswitch/verify`, {
    method: 'POST',
  })
}
'''
    backup(p)
    p.write_text(text, encoding="utf-8")

# 3. Frontend page: retain transfer flow and add Interswitch checkout.
p = Path("frontend/src/pages/passenger/PaymentsPage.jsx")
backup(p)
page = r'''import { useState } from 'react'
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
  const src = mode === 'LIVE'
    ? 'https://newwebpay.interswitchng.com/inline-checkout.js'
    : 'https://newwebpay-sandbox.interswitchng.com/inline-checkout.js'

  return new Promise((resolve, reject) => {
    if (typeof window.webpayCheckout === 'function') {
      resolve()
      return
    }

    const existing = document.querySelector('script[data-ekimove-interswitch]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(
        new Error('Unable to load Interswitch checkout.')
      ), { once: true })
      if (typeof window.webpayCheckout === 'function') resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.ekimoveInterswitch = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(
      new Error('Unable to load Interswitch checkout.')
    )
    document.body.appendChild(script)
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
          <span className="payment-policy-mark" aria-hidden="true">₦</span>
          <h3>Payment details</h3>
          <p>Ride ID: <strong>{payment.ride_id}</strong></p>
          <p>Amount: <strong>₦{Number(payment.amount).toLocaleString('en-NG', {
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
'''
p.write_text(page, encoding="utf-8")
print("Interswitch checkout files updated. Backups use suffix .before-checkout-" + stamp)
