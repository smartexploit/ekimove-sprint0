import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { getOverview } from '../../services/accountService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

const naira = (value) => formatNaira(value, { decimals: 0 })
const REFRESH_MS = 20000

const ACTION_LABELS = {
  'ride.status_changed': 'Trip status changed',
  'ride.cancelled_by_passenger': 'Ride cancelled by passenger',
  'payment.confirmed': 'Payment confirmed',
  'payment.rejected': 'Payment rejected',
  'payment.refund_paid': 'Refund sent',
  'deposit.unmatched': 'Deposit needs checking',
  'deposit.resolved': 'Deposit closed',
  'payout.created': 'Driver payout created',
  'payout.paid': 'Driver payout sent',
  'payout.failed': 'Driver payout failed',
  'account.suspended': 'Account suspended',
  'account.reactivated': 'Account reactivated',
  'account.removed': 'Account removed',
  'haulage.requested': 'Load booking requested',
  'haulage.quoted': 'Load quote sent',
  'haulage.quote_accepted': 'Load quote accepted',
  'haulage.quote_declined': 'Load quote declined',
  'settings.updated': 'Booking rules changed',
  'profile.updated': 'Profile updated',
  'password.changed': 'Password changed',
}

function Stat({ label, value, note, to, tone }) {
  const body = (
    <>
      <p className="stat-label">{label}</p>
      <p className="stat-value" style={tone === 'alert' && Number(value) > 0 ? { color: 'var(--laterite-700)' } : undefined}>
        {value}
      </p>
      {note && <p className="stat-note">{note}</p>}
    </>
  )
  return to ? <Link className="stat stat-link" to={to}>{body}</Link> : <div className="stat">{body}</div>
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => getOverview()
    .then((result) => {
      setData(result)
      setError('')
    })
    .catch((err) => setError(err.message || 'Could not load the overview.')), [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [load])

  return (
    <AdminShell
      title="Overview"
      description="What's happening on EkiMove right now. Updates every 20 seconds."
      actions={
        <button type="button" className="btn btn-sm" onClick={load}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      }
    >
      <div className="stack stack-lg">
        <Alert tone="error">{error}</Alert>
        {!data && !error && (
          <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> Loading…</div>
        )}
        {data && (
          <>
            <section className="stack stack-sm" aria-labelledby="needs-title">
              <h2 id="needs-title" className="section-title">Needs attention</h2>
              <div className="stat-grid">
                <Stat label="Waiting for a driver" value={data.trips.waiting_for_driver} to="/admin/dispatch" tone="alert" />
                <Stat label="Load quotes to send" value={data.trips.quotes_to_send} to="/admin/loads" tone="alert" />
                <Stat label="Support chats to answer" value={data.support.awaiting_reply}
                  note={`${data.support.open_threads} open`} to="/admin/support" tone="alert" />
                <Stat label="Payments to confirm" value={data.money.payments_to_confirm} to="/admin/payments" tone="alert" />
                <Stat label="Deposits to check" value={data.money.deposits_to_check} to="/admin/payments" tone="alert" />
                <Stat label="Refunds to send" value={data.money.refunds_due} to="/admin/payments" tone="alert" />
                <Stat label="Driver payouts open" value={data.money.payouts_open} to="/admin/earnings" tone="alert" />
                <Stat label="Open safety incidents" value={data.safety.open_incidents} to="/admin/incidents" tone="alert" />
                <Stat label="Drivers to verify" value={data.people.drivers_pending} to="/admin/drivers" tone="alert" />
              </div>
            </section>

            <section className="stack stack-sm" aria-labelledby="live-title">
              <h2 id="live-title" className="section-title">Live trips and today</h2>
              <div className="stat-grid">
                <Stat label="Assigned" value={data.trips.assigned} />
                <Stat label="Driver arriving" value={data.trips.driver_arriving} />
                <Stat label="On the way" value={data.trips.in_progress} />
                <Stat label="Requests today" value={data.trips.requests_today} />
                <Stat label="Completed today" value={data.trips.completed_today} />
                <Stat label="Cancelled today" value={data.trips.cancelled_today} />
                <Stat label="Commission today" value={naira(data.money.commission_today)} to="/admin/earnings" />
                <Stat label="Fares, last 7 days" value={naira(data.money.fares_this_week)} />
              </div>
            </section>

            <section className="stack stack-sm" aria-labelledby="people-title">
              <h2 id="people-title" className="section-title">People</h2>
              <div className="stat-grid">
                <Stat label="Passengers" value={data.people.passengers} to="/admin/people?role=passenger" />
                <Stat label="Approved drivers" value={data.people.drivers_approved}
                  note={`${data.people.drivers_online} online now`} to="/admin/people?role=driver&status=approved" />
                <Stat label="Suspended accounts" value={data.people.suspended} to="/admin/people?status=suspended" />
                <Stat label="New this week" value={data.people.new_this_week} />
              </div>
            </section>

            <section className="stack stack-sm" aria-labelledby="activity-title">
              <h2 id="activity-title" className="section-title">Recent activity</h2>
              {data.activity.length === 0 ? (
                <p className="card muted small">Nothing yet.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {data.activity.map((item, index) => (
                    <li className="list-item" key={`${item.created_at}-${index}`}>
                      <div className="list-item-main">
                        <p className="list-item-title">{ACTION_LABELS[item.action] || item.action}</p>
                        <p className="list-item-meta">
                          {item.actor}{item.actor_role && item.actor_role !== 'system' ? ` (${item.actor_role.replace('_', ' ')})` : ''}
                          {item.details ? ` · ${item.details}` : ''}
                        </p>
                      </div>
                      <span className="muted small" style={{ flexShrink: 0 }}>{formatDateTime(item.created_at)}</span>
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
