import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, UserRound, X } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { getPerson, listPeople, personAction } from '../../services/accountService.js'
import { formatDateTime, formatNaira, formatShortDate, initials } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const STATUS_FILTERS = {
  passenger: [['all', 'Everyone'], ['active', 'Active'], ['suspended', 'Suspended'], ['removed', 'Removed']],
  driver: [['all', 'Everyone'], ['approved', 'Approved'], ['pending', 'Awaiting review'], ['suspended', 'Suspended'], ['removed', 'Removed']],
}

const ACTIONS = {
  suspend: ['Suspend account', 'They are signed out at once and can’t sign in or take trips until reactivated.', 'btn-danger-outline'],
  reactivate: ['Reactivate account', 'They can sign in and use EkiMove again.', 'btn-primary'],
  remove: ['Remove account', 'Their name, phone and sign-in are erased for good. Trips, payments and earnings stay in the records. This can’t be undone.', 'btn-accent'],
}

function AccountBadge({ status }) {
  const map = { active: ['Active', 'green'], suspended: ['Suspended', 'red'], removed: ['Removed', 'neutral'] }
  const [label, tone] = map[status] || [status, 'neutral']
  return <span className={`badge badge-${tone}`}>{label}</span>
}

function PersonDetail({ id, onClose, onChanged }) {
  const [person, setPerson] = useState(null)
  const [action, setAction] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => getPerson(id).then(setPerson).catch((err) => setError(err.message)), [id])
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    return () => {
      active = false
    }
  }, [load])

  async function confirm() {
    if (reason.trim().length < 3) return setError('Give a short reason. It is kept in the activity log.')
    setBusy(true)
    setError('')
    try {
      await personAction(id, action, reason.trim())
      setNotice(`${ACTIONS[action][0]}: done.`)
      setAction(null)
      setReason('')
      await load()
      onChanged()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const driver = person?.driver
  const canAct = person && person.role !== 'super_admin' && person.status !== 'removed'

  return (
    <section className="card stack person-detail" aria-label="Account details">
      <div className="row row-between" style={{ flexWrap: 'nowrap' }}>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="avatar avatar-lg" aria-hidden="true">{initials(person?.full_name)}</span>
          <div style={{ minWidth: 0 }}>
            <p className="profile-name">{person?.full_name || 'Loading…'}</p>
            {person && <p className="muted small">{person.phone}{person.email ? ` · ${person.email}` : ''}</p>}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {person && (
        <>
          <dl className="rows small">
            <div><dt>Account</dt><dd><AccountBadge status={person.status} /></dd></div>
            <div><dt>Role</dt><dd>{person.role === 'driver' ? 'Driver' : 'Passenger'}</dd></div>
            <div><dt>Joined</dt><dd>{formatShortDate(person.joined_at)}</dd></div>
            <div><dt>Trips</dt><dd>{person.rides.completed} completed · {person.rides.active} active · {person.rides.trips} total</dd></div>
            {person.suspension_reason && <div><dt>Reason</dt><dd>{person.suspension_reason}</dd></div>}
          </dl>

          {driver && (
            <div className="stack stack-sm">
              <h3 className="section-title" style={{ fontSize: 17 }}>Driver</h3>
              <dl className="rows small">
                <div><dt>Verification</dt><dd><StatusBadge status={driver.verification_status} kind="verification" /></dd></div>
                <div><dt>Online now</dt><dd>{driver.is_online ? 'Yes' : 'No'}</dd></div>
                <div><dt>Balance owed</dt><dd>{formatNaira(driver.balance, { decimals: 0 })}</dd></div>
                <div>
                  <dt>Paid into</dt>
                  <dd>{driver.payout_account
                    ? `${driver.payout_account.bank_name} ${driver.payout_account.account_number} (${driver.payout_account.account_name})`
                    : 'No bank account yet'}</dd>
                </div>
                {driver.vehicles.map((vehicle) => (
                  <div key={vehicle.id}>
                    <dt>Vehicle</dt>
                    <dd>{vehicleLabel(vehicle.vehicle_type)} · {vehicle.plate_number} · {vehicle.capacity} seat(s){vehicle.is_approved ? '' : ' · not approved'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {person.recent_rides?.length > 0 && (
            <div className="stack stack-sm">
              <h3 className="section-title" style={{ fontSize: 17 }}>Recent trips</h3>
              <ul className="plain-list small">
                {person.recent_rides.map((ride) => (
                  <li key={ride.ride_id}>
                    #{ride.ride_id} · {ride.route} · {formatNaira(ride.fare, { decimals: 0 })} ·{' '}
                    <StatusBadge status={ride.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {person.recent_activity?.length > 0 && (
            <details>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>Activity log</summary>
              <ul className="plain-list small" style={{ marginTop: 8 }}>
                {person.recent_activity.map((item, index) => (
                  <li key={index}>{formatDateTime(item.created_at)} · {item.action}{item.details ? ` · ${item.details}` : ''}</li>
                ))}
              </ul>
            </details>
          )}

          {canAct && !action && (
            <div className="row">
              {person.status === 'active' && (
                <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setAction('suspend')}>Suspend</button>
              )}
              {person.status === 'suspended' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setAction('reactivate')}>Reactivate</button>
              )}
              <button type="button" className="btn btn-sm" onClick={() => setAction('remove')}>Remove account</button>
            </div>
          )}
          {action && (
            <div className="cancel-panel stack stack-sm" role="group" aria-label={ACTIONS[action][0]}>
              <p style={{ fontWeight: 800 }}>{ACTIONS[action][0]}?</p>
              <p className="small">{ACTIONS[action][1]}</p>
              <label className="field">
                <span className="field-label">Reason</span>
                <input className="input" value={reason} onChange={(event) => setReason(event.target.value)}
                  placeholder="Kept in the activity log" />
              </label>
              <div className="row">
                <button type="button" className={`btn btn-sm ${ACTIONS[action][2]}`} disabled={busy} onClick={confirm}>
                  {busy ? 'Working…' : `Yes, ${ACTIONS[action][0].toLowerCase()}`}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAction(null)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default function AdminPeoplePage() {
  const [params, setParams] = useSearchParams()
  const role = params.get('role') === 'driver' ? 'driver' : 'passenger'
  const status = STATUS_FILTERS[role].some(([value]) => value === params.get('status')) ? params.get('status') : 'all'
  const selected = params.get('id')
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState({ loaded: false, list: [] })
  const [error, setError] = useState('')

  const load = useCallback(() => listPeople({ role, status, q: query.trim() })
    .then((list) => setPeople({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch((err) => setError(err.message || 'Could not load accounts.')), [role, status, query])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => active && load(), 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [load])

  const setParam = (changes) => {
    const next = Object.fromEntries(params)
    Object.entries(changes).forEach(([key, value]) => {
      if (value == null) delete next[key]
      else next[key] = value
    })
    setParams(next)
  }

  return (
    <AdminShell title="People" description="Passengers and drivers: profiles, activity, and account controls.">
      <div className="stack">
        <div className="segmented" role="tablist" aria-label="Account type">
          {[['passenger', 'Passengers'], ['driver', 'Drivers']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={role === value}
              className={role === value ? 'is-active' : ''} onClick={() => setParam({ role: value, status: null, id: null })}>
              {label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search by name or phone</span>
            <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or phone" />
          </label>
          <div className="chip-row" aria-label="Filter">
            {STATUS_FILTERS[role].map(([value, label]) => (
              <button key={value} type="button" className={`chip ${status === value ? 'is-active' : ''}`}
                aria-pressed={status === value} onClick={() => setParam({ status: value === 'all' ? null : value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Alert tone="error">{error}</Alert>

        <div className={selected ? 'two-col' : ''}>
          <section aria-label="Accounts">
            {people.loaded && people.list.length === 0 ? (
              <div className="card empty">
                <span className="empty-icon"><UserRound size={28} aria-hidden="true" /></span>
                <p className="muted">No accounts match.</p>
              </div>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {people.list.map((person) => (
                  <li key={person.id}>
                    <button type="button" className={`list-item list-button ${String(person.id) === selected ? 'is-selected' : ''}`}
                      onClick={() => setParam({ id: String(person.id) })}>
                      <span className="avatar" aria-hidden="true">{initials(person.full_name)}</span>
                      <span className="list-item-main">
                        <span className="list-item-title">{person.full_name}</span>
                        <span className="list-item-meta">
                          {person.phone} · {person.rides.completed} {person.rides.completed === 1 ? 'trip' : 'trips'}
                          {person.driver ? ` · ${person.driver.vehicles.map((v) => v.plate_number).join(', ')}` : ''}
                        </span>
                      </span>
                      <span className="stack" style={{ gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                        <AccountBadge status={person.status} />
                        {person.driver && person.status === 'active' && (
                          <StatusBadge status={person.driver.verification_status} kind="verification" />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {selected && (
            <PersonDetail key={selected} id={selected} onClose={() => setParam({ id: null })} onChanged={load} />
          )}
        </div>
      </div>
    </AdminShell>
  )
}
