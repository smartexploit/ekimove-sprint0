import { useEffect, useState } from 'react'
import { CircleCheck, LoaderCircle, ShieldCheck } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import CopyButton from '../ui/CopyButton.jsx'
import {
  createMyVirtualAccount,
  getMyVirtualAccount,
  getRidePayment,
} from '../../services/paymentService.js'
import { formatNaira } from '../../utils/format.js'

const POLL_MS = 5000

/**
 * The passenger's personal EkiMove account number. Money sent to it is
 * matched to the ride automatically, so there is no reference to type and
 * no one to wait for. While the ride is unpaid the status is re-checked
 * every few seconds and `onPaid` fires as soon as it is confirmed.
 */
export default function InstantTransfer({ rideId, amount, paid, onPaid }) {
  const [state, setState] = useState({ loaded: false, account: null })
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMyVirtualAccount()
      .then((data) => active && setState({ loaded: true, account: data.account }))
      .catch(() => active && setState({ loaded: true, account: null }))
    return () => {
      active = false
    }
  }, [])

  const account = state.account
  const watching = Boolean(account && rideId && !paid)

  useEffect(() => {
    if (!watching) return undefined
    let active = true
    const check = () =>
      getRidePayment(rideId)
        .then((payment) => {
          if (active && payment?.status === 'confirmed') onPaid(payment)
        })
        .catch(() => {})
    const timer = window.setInterval(check, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [watching, rideId, onPaid])

  async function createAccount() {
    setBusy(true)
    setError('')
    try {
      const data = await createMyVirtualAccount()
      setState({ loaded: true, account: data.account })
    } catch (err) {
      setError(err.message || 'We could not create your account number. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!state.loaded) return null

  if (!account) {
    return (
      <div className="card card-outline stack">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="instant-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div>
            <h2 className="instant-title">Get your own EkiMove account number</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              Transfer to it from any bank app and your ride is marked paid in
              seconds. It stays yours for every trip.
            </p>
          </div>
        </div>
        <Alert tone="error">{error}</Alert>
        <label className="check-row">
          <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
          <span className="small">
            I agree that EkiMove may create a personal bank account number for me
            with its payment partner, Paystack, using my name and phone number.
          </span>
        </label>
        <button type="button" className="btn btn-primary" disabled={!agree || busy} onClick={createAccount}>
          {busy ? 'Creating your account…' : 'Get my account number'}
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <dl className="card card-outline rows bank-details" aria-label="Your EkiMove account">
        <div>
          <dt>Bank</dt>
          <dd>{account.bank_name}</dd>
        </div>
        <div>
          <dt>Account number</dt>
          <dd className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <span style={{ fontSize: 20, letterSpacing: '0.04em' }}>{account.account_number}</span>
            <CopyButton value={account.account_number} label="account number" />
          </dd>
        </div>
        <div>
          <dt>Account name</dt>
          <dd>{account.account_name}</dd>
        </div>
        {amount != null && (
          <div>
            <dt>Amount to send</dt>
            <dd className="money" style={{ fontSize: 20, color: 'var(--green-800)' }}>{formatNaira(amount)}</dd>
          </div>
        )}
      </dl>

      {paid ? (
        <p className="instant-status is-paid" role="status">
          <CircleCheck size={18} aria-hidden="true" /> Payment received. Your driver can start the trip.
        </p>
      ) : rideId ? (
        <p className="instant-status" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          Waiting for your transfer. Send the exact amount and this updates on its own.
        </p>
      ) : null}
    </div>
  )
}
