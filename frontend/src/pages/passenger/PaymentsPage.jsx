import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CreditCard, Landmark, Wallet } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import CopyButton from '../../components/ui/CopyButton.jsx'
import InstantTransfer from '../../components/payments/InstantTransfer.jsx'
import useBusinessInfo from '../../hooks/useBusinessInfo.js'
import { apiRequest } from '../../services/authService.js'
import {
  getRidePayment,
  initiateRidePayment,
  submitTransferReference,
  initiateInterswitchPayment,
  verifyInterswitchPayment,
} from '../../services/paymentService.js'
import { formatNaira } from '../../utils/format.js'

function BankDetails({ amount }) {
  const { bank_transfer: bank, loaded } = useBusinessInfo()

  if (!loaded) return null

  if (!bank.configured) {
    return (
      <Alert tone="warning">
        <p style={{ fontWeight: 700 }}>Account details aren't available here yet.</p>
        <p style={{ marginTop: 4 }}>
          Please contact EkiMove support for the account to pay into, and use
          only official EkiMove channels.
        </p>
        <SupportContacts className="stack stack-sm" linkClassName="contact-link text-link" />
      </Alert>
    )
  }

  return (
    <dl className="card card-outline rows bank-details">
      <div>
        <dt>Bank</dt>
        <dd>{bank.bank_name}</dd>
      </div>
      <div>
        <dt>Account number</dt>
        <dd className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <span style={{ fontSize: 20, letterSpacing: '0.04em' }}>{bank.account_number}</span>
          <CopyButton value={bank.account_number} label="account number" />
        </dd>
      </div>
      <div>
        <dt>Account name</dt>
        <dd>{bank.account_name}</dd>
      </div>
      {amount != null && (
        <div>
          <dt>Amount to send</dt>
          <dd className="money" style={{ fontSize: 20, color: 'var(--green-800)' }}>{formatNaira(amount)}</dd>
        </div>
      )}
    </dl>
  )
}

export default function PaymentsPage() {
  const [searchParams] = useSearchParams()
  const [rideId, setRideId] = useState(() => {
    const value = searchParams.get('rideId')
    return value && /^\d+$/.test(value) ? value : ''
  })
  const [rides, setRides] = useState({ loaded: false, items: [] })
  const [reference, setReference] = useState('')
  const [email, setEmail] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/ride-requests/my-rides')
      .then((data) => {
        if (!active) return
        const assigned = Array.isArray(data)
          ? data.filter((ride) => ride.assigned_ride_id && ride.ride_status !== 'cancelled')
          : []
        setRides({ loaded: true, items: assigned })
      })
      .catch(() => {
        if (active) setRides({ loaded: true, items: [] })
      })
    return () => {
      active = false
    }
  }, [])

  // With exactly one payable ride, select it without asking.
  const effectiveRideId =
    rideId || (rides.items.length === 1 ? String(rides.items[0].assigned_ride_id) : '')
  const selectedRide = rides.items.find(
    (ride) => String(ride.assigned_ride_id) === effectiveRideId,
  )
  const currentPayment =
    payment && String(payment.ride_id) === effectiveRideId ? payment : null
  const { instant_transfers: instant } = useBusinessInfo()
  const instantOn = Boolean(instant?.enabled)
  const isPaid =
    currentPayment?.status === 'confirmed' ||
    (!currentPayment && selectedRide?.payment_status === 'confirmed')

  const handleInstantPaid = useCallback((result) => {
    setPayment(result)
    setError('')
    setMessage('Payment received. Your ride is paid.')
  }, [])

  function validRideId() {
    const id = Number(effectiveRideId)
    if (!Number.isInteger(id) || id < 1) {
      setError('Choose the ride you want to pay for.')
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
        setBusy(false)
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
      setMessage('Taking you to Interswitch secure checkout…')
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
            : `Payment status: ${result.status.replaceAll('_', ' ')}.`,
        )
      } catch (err) {
        // If no Interswitch payment exists yet, show the current payment
        // record from the standard status endpoint instead.
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

  const amountDue = currentPayment?.amount ?? selectedRide?.quoted_fare ?? null
  const needsReference =
    !instantOn &&
    currentPayment &&
    currentPayment.method !== 'interswitch' &&
    currentPayment.status !== 'confirmed' &&
    currentPayment.status !== 'refunded'

  return (
    <AppShell
      title="Payments"
      description="Pay for a ride once a driver has been assigned. Cash isn't accepted."
    >
      {rides.loaded && rides.items.length === 0 && !rideId ? (
        <div className="card empty">
          <span className="empty-icon"><Wallet size={28} aria-hidden="true" /></span>
          <h2>Nothing to pay yet</h2>
          <p className="muted" style={{ maxWidth: 420 }}>
            You can pay once a driver has been assigned to one of your rides.
          </p>
          <Link className="btn btn-primary" to="/my-rides">
            Go to my rides
          </Link>
        </div>
      ) : (
        <div className="two-col">
          <div className="stack">
            <Alert tone="error">{error}</Alert>
            <Alert tone="success">{message}</Alert>

            <label className="field">
              <span className="field-label">Ride</span>
              <select
                id="payment-ride-id"
                className="select"
                value={effectiveRideId}
                onChange={(event) => {
                  setRideId(event.target.value)
                  setError('')
                  setMessage('')
                }}
                disabled={busy}
              >
                <option value="">Choose a ride</option>
                {rides.items.map((ride) => (
                  <option key={ride.assigned_ride_id} value={String(ride.assigned_ride_id)}>
                    Ride #{ride.assigned_ride_id} · {ride.origin_text} → {ride.destination_text}
                  </option>
                ))}
                {rideId && !selectedRide && (
                  <option value={rideId}>Ride #{rideId}</option>
                )}
              </select>
            </label>

            <fieldset className="choice-list">
              <legend className="choice-legend">Payment method</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="payment-method"
                  value="bank_transfer"
                  checked={method === 'bank_transfer'}
                  onChange={() => setMethod('bank_transfer')}
                  disabled={busy}
                />
                <span className="choice-body">
                  <span className="choice-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Landmark size={18} aria-hidden="true" /> Bank transfer
                  </span>
                  <span className="choice-sub">
                    {instantOn ? 'Confirmed automatically in seconds' : 'Checked by the EkiMove team'}
                  </span>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="payment-method"
                  value="interswitch"
                  checked={method === 'interswitch'}
                  onChange={() => setMethod('interswitch')}
                  disabled={busy}
                />
                <span className="choice-body">
                  <span className="choice-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CreditCard size={18} aria-hidden="true" /> Card or wallet
                  </span>
                  <span className="choice-sub">Interswitch secure checkout</span>
                </span>
              </label>
            </fieldset>

            {method === 'bank_transfer' && instantOn ? (
              <>
                <InstantTransfer
                  rideId={effectiveRideId ? Number(effectiveRideId) : null}
                  amount={amountDue}
                  paid={isPaid}
                  onPaid={handleInstantPaid}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !effectiveRideId}
                    onClick={checkStatus}
                  >
                    Check status now
                  </button>
                </div>
              </>
            ) : method === 'bank_transfer' ? (
              <>
                <BankDetails amount={amountDue} />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !effectiveRideId}
                    onClick={() => runAction(initiateRidePayment)}
                  >
                    {busy ? 'Please wait…' : "I'm paying by transfer"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !effectiveRideId}
                    onClick={checkStatus}
                  >
                    Check status
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="field" htmlFor="checkout-email">
                  <span className="field-label">Email for your receipt</span>
                  <input
                    id="checkout-email"
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    aria-describedby="checkout-email-hint"
                    required
                  />
                  <span className="field-hint" id="checkout-email-hint">
                    Used for this checkout only. It isn't saved to your EkiMove profile.
                  </span>
                </label>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !effectiveRideId}
                    onClick={startInterswitch}
                  >
                    {busy ? 'Please wait…' : 'Continue to secure checkout'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !effectiveRideId}
                    onClick={checkStatus}
                  >
                    Verify payment
                  </button>
                </div>
              </>
            )}
          </div>

          <aside className="stack" aria-live="polite">
            <div className="card stack">
              <div className="row row-between">
                <div>
                  <p className="muted small" style={{ fontWeight: 700 }}>Amount due</p>
                  <p className="money" style={{ fontSize: 32, color: 'var(--green-800)' }}>
                    {amountDue != null ? formatNaira(amountDue) : '—'}
                  </p>
                </div>
                <StatusBadge
                  status={currentPayment?.status || selectedRide?.payment_status || 'pending'}
                  kind="payment"
                />
              </div>
              {currentPayment && (
                <dl className="rows">
                  <div>
                    <dt>Ride</dt>
                    <dd>#{currentPayment.ride_id}</dd>
                  </div>
                  <div>
                    <dt>Method</dt>
                    <dd>{currentPayment.method === 'interswitch' ? 'Interswitch checkout' : 'Bank transfer'}</dd>
                  </div>
                  {currentPayment.transfer_reference && (
                    <div>
                      <dt>Reference</dt>
                      <dd>{currentPayment.transfer_reference}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {needsReference && (
              <form className="card stack" onSubmit={handleSubmitReference}>
                <label className="field" htmlFor="transfer-reference">
                  <span className="field-label">Transfer reference</span>
                  <input
                    id="transfer-reference"
                    className="input"
                    type="text"
                    minLength="3"
                    maxLength="120"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="From your bank app or receipt"
                    required
                  />
                </label>
                <button type="submit" className="btn btn-accent" disabled={busy}>
                  {busy ? 'Submitting…' : 'Submit for verification'}
                </button>
              </form>
            )}

            <Alert tone="warning">
              {currentPayment?.method === 'interswitch' || method === 'interswitch'
                ? "A checkout success message isn't proof of payment. EkiMove confirms it only after checking with Interswitch."
                : instantOn
                  ? "Only pay into your own EkiMove account number shown here. Your ride is marked paid when the money arrives, not from a screenshot."
                  : "Your payment is confirmed only after the EkiMove team checks the transfer. A screenshot alone doesn't confirm it."}
            </Alert>
          </aside>
        </div>
      )}
    </AppShell>
  )
}
