import { useCallback, useEffect, useState } from 'react'
import { Banknote, RefreshCw, Send } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import CopyButton from '../../components/ui/CopyButton.jsx'
import {
  getEarningsSummary,
  listPayouts,
  markPayoutFailed,
  markPayoutPaid,
  runPayouts,
} from '../../services/earningsService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

const naira = (value) => formatNaira(value, { decimals: 0 })

function runMessage(result) {
  if (!result.created) {
    return result.skipped_no_account
      ? `No payouts created. ${result.skipped_no_account} driver(s) with a balance haven't added a bank account.`
      : 'No driver balance has reached the payout minimum yet.'
  }
  const parts = [`${result.created} payout(s) created, ${naira(result.total)} in total.`]
  if (result.paid) parts.push(`${result.paid} sent.`)
  if (result.processing) parts.push(`${result.processing} on the way.`)
  if (result.queued) parts.push(`${result.queued} waiting for you to send by hand.`)
  if (result.failed) parts.push(`${result.failed} failed and returned to the driver's balance.`)
  if (result.skipped_no_account) parts.push(`${result.skipped_no_account} skipped (no bank account).`)
  return parts.join(' ')
}

function PayoutCard({ payout, busy, onPaid, onFailed }) {
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const account = payout.payout_account

  return (
    <article className="card stack">
      <div className="row row-between">
        <p className="money" style={{ fontSize: 24, color: 'var(--green-800)' }}>{formatNaira(payout.amount)}</p>
        <StatusBadge status={payout.status} kind="payout" />
      </div>
      <dl className="rows small">
        <div><dt>Driver</dt><dd>{payout.driver_name} · {payout.driver_phone}</dd></div>
        {account && (
          <>
            <div><dt>Bank</dt><dd>{account.bank_name}</dd></div>
            <div>
              <dt>Account</dt>
              <dd className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {account.account_number}
                <CopyButton value={account.account_number} label="account number" />
              </dd>
            </div>
            <div><dt>Name</dt><dd>{account.account_name}{account.verified ? ' ✓' : ''}</dd></div>
          </>
        )}
        <div><dt>Created</dt><dd>{payout.created_at ? formatDateTime(payout.created_at) : '—'}</dd></div>
      </dl>
      {payout.status === 'queued' && (
        <>
          <label className="field">
            <span className="field-label">Bank transfer reference</span>
            <input className="input" value={reference} onChange={(event) => setReference(event.target.value)}
              placeholder="After you send it" />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => onPaid(payout, reference)}>
            Mark as sent
          </button>
        </>
      )}
      {payout.status === 'processing' && (
        <p className="muted small">Paystack is sending this. It updates on its own when the bank confirms.</p>
      )}
      <details>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>It didn't go through</summary>
        <div className="stack stack-sm" style={{ marginTop: 8 }}>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="What happened" aria-label="Why the payout failed" />
          <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy}
            onClick={() => onFailed(payout, reason)}>
            Mark failed and return to balance
          </button>
        </div>
      </details>
    </article>
  )
}

export default function AdminEarningsPage() {
  const [summary, setSummary] = useState(null)
  const [payouts, setPayouts] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [report, open] = await Promise.all([getEarningsSummary(), listPayouts('open')])
      setSummary(report)
      setPayouts(Array.isArray(open) ? open : [])
    } catch (err) {
      setError(err.message || 'Could not load earnings.')
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) load()
    })
    return () => {
      active = false
    }
  }, [load])

  async function act(work, success) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await work()
      setNotice(typeof success === 'function' ? success(result) : success)
      await load()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  function paid(payout, reference) {
    if (reference.trim().length < 3) return setError('Enter the reference of the transfer you sent.')
    return act(() => markPayoutPaid(payout.id, reference), `Payout to ${payout.driver_name} recorded as sent.`)
  }

  function failed(payout, reason) {
    if (reason.trim().length < 3) return setError('Say briefly why the payout failed.')
    return act(() => markPayoutFailed(payout.id, reason), `Payout to ${payout.driver_name} returned to their balance.`)
  }

  return (
    <AdminShell
      title="Earnings"
      description="EkiMove's commission, what drivers are owed, and driver payouts."
      actions={
        <button type="button" className="btn btn-sm" onClick={() => load()} disabled={busy}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      }
    >
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        {!summary && !error && (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading earnings…
          </div>
        )}

        {summary && (
          <>
            <div className="stat-grid">
              <div className="stat">
                <p className="stat-label">Fares earned</p>
                <p className="stat-value">{naira(summary.fares)}</p>
                <p className="stat-note">
                  {summary.entries} {summary.entries === 1 ? 'paid trip or fee' : 'paid trips and fees'}
                </p>
              </div>
              <div className="stat">
                <p className="stat-label">EkiMove commission</p>
                <p className="stat-value">{naira(summary.commission)}</p>
                <p className="stat-note">{Number(summary.commission_percent)}% of every fare</p>
              </div>
              <div className="stat">
                <p className="stat-label">Owed to drivers</p>
                <p className="stat-value" style={{ color: 'var(--laterite-700)' }}>{naira(summary.owed_to_drivers)}</p>
                <p className="stat-note">{naira(summary.in_flight)} being paid now</p>
              </div>
              <div className="stat">
                <p className="stat-label">Paid to drivers</p>
                <p className="stat-value">{naira(summary.paid_out)}</p>
                <p className="stat-note">All time</p>
              </div>
            </div>

            <section className="card stack stack-sm" aria-labelledby="run-title">
              <div className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="instant-icon" aria-hidden="true"><Banknote size={20} /></span>
                <div>
                  <h2 id="run-title" className="section-title">Pay drivers</h2>
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Pays every driver whose balance is at least {naira(summary.payout_minimum)}.{' '}
                    {summary.payouts_automatic
                      ? 'Money is sent automatically with Paystack to verified accounts.'
                      : "Automatic transfers are off, so payouts are listed below for you to send from the bank and mark as sent."}{' '}
                    The scheduled daily job does the same.
                  </p>
                </div>
              </div>
              <div>
                <button type="button" className="btn btn-primary" disabled={busy}
                  onClick={() => act(runPayouts, runMessage)}>
                  <Send size={16} aria-hidden="true" /> {busy ? 'Working…' : 'Pay drivers now'}
                </button>
              </div>
            </section>

            <section className="stack" aria-labelledby="open-payouts-title">
              <h2 id="open-payouts-title" className="section-title">Payouts in progress</h2>
              {payouts.length === 0 ? (
                <p className="card muted small">No payouts are waiting.</p>
              ) : (
                <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
                  {payouts.map((payout) => (
                    <PayoutCard key={payout.id} payout={payout} busy={busy} onPaid={paid} onFailed={failed} />
                  ))}
                </div>
              )}
            </section>

            <section className="stack stack-sm" aria-labelledby="balances-title">
              <h2 id="balances-title" className="section-title">Driver balances</h2>
              {summary.drivers.length === 0 ? (
                <p className="card muted small">No driver has earned anything yet.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {summary.drivers.map((driver) => (
                    <li className="list-item" key={driver.driver_id}>
                      <div className="list-item-main">
                        <p className="list-item-title">{driver.name}</p>
                        <p className="list-item-meta">
                          {driver.payout_account
                            ? `${driver.payout_account.bank_name} ${driver.payout_account.account_number}`
                            : 'No bank account yet'}
                          {' · '}earned {naira(driver.lifetime)} in total
                        </p>
                      </div>
                      <span className="ledger-amount is-credit">{naira(driver.balance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminShell>
  )
}
