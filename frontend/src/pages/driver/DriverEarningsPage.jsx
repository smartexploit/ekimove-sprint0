import { useCallback, useEffect, useState } from 'react'
import { Landmark, PiggyBank, RefreshCw } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import {
  getDriverEarnings,
  getPayoutAccount,
  listBanks,
  savePayoutAccount,
} from '../../services/earningsService.js'
import { formatNaira, formatShortDate } from '../../utils/format.js'

const KIND_LABEL = {
  trip: 'Trip',
  cancellation_fee: 'Cancellation fee',
  payout: 'Paid out to your bank',
  payout_reversal: 'Payout returned',
  adjustment: 'Adjustment',
}

const naira = (value) => formatNaira(value, { decimals: 0 })

function PayoutAccountForm({ onSaved }) {
  const [state, setState] = useState({ loaded: false, account: null, verify: false })
  const [banks, setBanks] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ bankCode: '', accountNumber: '', accountName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getPayoutAccount(), listBanks()])
      .then(([account, bankList]) => {
        if (!active) return
        setState({ loaded: true, account: account.account, verify: account.verification_available })
        setBanks(Array.isArray(bankList) ? bankList : [])
      })
      .catch((err) => active && setError(err.message || 'Could not load your bank details.'))
    return () => {
      active = false
    }
  }, [])

  function startEditing() {
    const account = state.account
    setForm({
      bankCode: account?.bank_code || '',
      accountNumber: account?.account_number || '',
      accountName: account?.account_name || '',
    })
    setError('')
    setEditing(true)
  }

  async function save(event) {
    event.preventDefault()
    if (!form.bankCode) return setError('Choose your bank.')
    if (!/^\d{10}$/.test(form.accountNumber.trim())) return setError('Enter your 10-digit account number.')
    if (!state.verify && form.accountName.trim().length < 3) {
      return setError('Enter the account name exactly as your bank shows it.')
    }
    setBusy(true)
    setError('')
    try {
      const result = await savePayoutAccount({
        bankCode: form.bankCode,
        accountNumber: form.accountNumber,
        accountName: state.verify ? '' : form.accountName,
      })
      setState((current) => ({ ...current, account: result.account }))
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not save your bank details.')
    } finally {
      setBusy(false)
    }
  }

  if (!state.loaded && !error) return null
  const account = state.account

  if (!editing && account) {
    return (
      <section className="card stack stack-sm" aria-labelledby="payout-account-title">
        <div className="row row-between">
          <h2 id="payout-account-title" className="section-title">Where you get paid</h2>
          <button type="button" className="btn btn-sm" onClick={startEditing}>Change</button>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <span className="instant-icon" aria-hidden="true"><Landmark size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 800 }}>{account.account_name}</p>
            <p className="muted small">{account.bank_name} · {account.account_number}</p>
          </div>
        </div>
        {!account.verified && (
          <p className="muted small">
            Please double-check these details. EkiMove will confirm the name with your bank before
            sending money automatically.
          </p>
        )}
      </section>
    )
  }

  return (
    <form className="card stack" onSubmit={save} aria-labelledby="payout-form-title">
      <div>
        <h2 id="payout-form-title" className="section-title">
          {account ? 'Change your bank account' : 'Add your bank account to get paid'}
        </h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Your earnings are sent here. Use an account in your own name.
        </p>
      </div>
      <Alert tone="error">{error}</Alert>
      <div className="field">
        <label className="field-label" htmlFor="payout-bank">Bank</label>
        <select id="payout-bank" className="select" value={form.bankCode}
          onChange={(event) => setForm((f) => ({ ...f, bankCode: event.target.value }))}>
          <option value="">Choose your bank</option>
          {banks.map((bank) => (
            <option key={bank.code} value={bank.code}>{bank.name}</option>
          ))}
        </select>
      </div>
      <label className="field">
        <span className="field-label">Account number</span>
        <input className="input" inputMode="numeric" autoComplete="off" maxLength={10}
          value={form.accountNumber}
          onChange={(event) => setForm((f) => ({ ...f, accountNumber: event.target.value.replace(/\D/g, '') }))}
          placeholder="10 digits" />
      </label>
      {!state.verify && (
        <label className="field">
          <span className="field-label">Account name</span>
          <input className="input" autoComplete="name" value={form.accountName}
            onChange={(event) => setForm((f) => ({ ...f, accountName: event.target.value }))}
            placeholder="As shown by your bank" />
        </label>
      )}
      {state.verify && (
        <p className="muted small">We'll check the account name with your bank when you save.</p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save bank account'}
        </button>
        {account && (
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export default function DriverEarningsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    getDriverEarnings()
      .then((result) => {
        if (!active) return
        setData(result)
        setError('')
      })
      .catch((err) => active && setError(err.message || 'Could not load your earnings.'))
    return () => {
      active = false
    }
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])
  const percent = data ? Number(data.commission_percent) : null
  const keep = percent != null ? 100 - percent : null

  return (
    <AppShell
      title="Earnings"
      description="What you've earned, what EkiMove keeps, and when you get paid."
      actions={
        <button type="button" className="btn btn-sm" onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      }
    >
      <Alert tone="error">{error}</Alert>

      {!data && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Loading your earnings…
        </div>
      )}

      {data && (
        <div className="two-col">
          <div className="stack">
            <section className="earn-hero" aria-labelledby="balance-title">
              <p id="balance-title" className="earn-hero-label">Ready to pay out</p>
              <p className="earn-hero-amount">{naira(data.balance)}</p>
              <p className="earn-hero-note">
                {data.payout_account
                  ? `Paid daily to ${data.payout_account.bank_name} ${data.payout_account.account_number} once it reaches ${naira(data.payout_minimum)}.`
                  : 'Add your bank account below so we can pay you.'}
              </p>
              <div className="earn-tiles">
                <div>
                  <p className="earn-tile-label">Today</p>
                  <p className="earn-tile-value">{naira(data.today)}</p>
                </div>
                <div>
                  <p className="earn-tile-label">This week</p>
                  <p className="earn-tile-value">{naira(data.this_week)}</p>
                </div>
                <div>
                  <p className="earn-tile-label">Trips</p>
                  <p className="earn-tile-value">{data.trips_completed}</p>
                </div>
              </div>
            </section>

            <PayoutAccountForm onSaved={refresh} />

            <section className="card stack stack-sm" aria-labelledby="split-title">
              <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                <span className="instant-icon" aria-hidden="true"><PiggyBank size={20} /></span>
                <div>
                  <h2 id="split-title" className="section-title">You keep {keep}% of every fare</h2>
                  <p className="muted small" style={{ marginTop: 4 }}>
                    EkiMove keeps {percent}% for the app, payments, support and safety. On a{' '}
                    {naira(1000)} trip you earn {naira(1000 * (keep / 100))}. Kept cancellation fees
                    are split the same way.
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="stack stack-sm" aria-labelledby="ledger-title">
              <h2 id="ledger-title" className="section-title" style={{ padding: '0 4px' }}>Recent earnings</h2>
              {data.entries.length === 0 ? (
                <p className="card muted small">Completed, paid trips will show here with your share.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {data.entries.map((entry) => {
                    const amount = Number(entry.amount)
                    const isCredit = amount >= 0
                    return (
                      <li className="list-item" key={entry.id}>
                        <div className="list-item-main">
                          <p className="list-item-title">{entry.route || KIND_LABEL[entry.kind]}</p>
                          <p className="list-item-meta">
                            {entry.route ? `${KIND_LABEL[entry.kind]} · ` : ''}
                            {formatShortDate(entry.created_at)}
                            {Number(entry.fare) > 0 &&
                              ` · ${naira(entry.fare)} − ${naira(entry.commission)} EkiMove`}
                          </p>
                        </div>
                        <span className={`ledger-amount ${isCredit ? 'is-credit' : ''}`}>
                          {isCredit ? '+' : '−'}{naira(Math.abs(amount))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {data.payouts.length > 0 && (
              <section className="stack stack-sm" aria-labelledby="payouts-title">
                <h2 id="payouts-title" className="section-title" style={{ padding: '0 4px' }}>Payouts</h2>
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {data.payouts.map((payout) => (
                    <li className="list-item" key={payout.id}>
                      <div className="list-item-main">
                        <p className="list-item-title">{naira(payout.amount)}</p>
                        <p className="list-item-meta">
                          {formatShortDate(payout.completed_at || payout.created_at)}
                          {payout.status === 'failed' && payout.failure_reason
                            ? ` · ${payout.failure_reason} (returned to your balance)`
                            : ''}
                        </p>
                      </div>
                      <StatusBadge status={payout.status} kind="payout" />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}
