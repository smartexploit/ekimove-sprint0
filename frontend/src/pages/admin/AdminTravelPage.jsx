import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Plus, Send } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { apiRequest, downloadFile } from '../../services/authService.js'
import {
  adminCheckIn, adminDepartures, createDeparture, getManifest, getTravelReport, markTravelRefundPaid,
  messageTravellers, recordTravelPayment, setDepartureStatus, updateDeparture,
} from '../../services/travelService.js'
import { formatNaira } from '../../utils/format.js'
import { travelTime } from '../../utils/travel.js'

const naira = (value) => formatNaira(value, { decimals: 0 })
const SCHOOLS = ['EKSU', 'FUOYE', 'FUTIA']
const CITIES = ['Lagos', 'Ibadan', 'Abeokuta', 'Akure', 'Abuja']
const EMPTY = {
  origin: 'EKSU', pickup_spot: 'EKSU main gate', destination: '', drop_off: '', departs_at: '', seats_total: 18,
  price_per_seat: '', allow_deposit: true, deposit_percent: 50, balance_due_hours: 24, refund_cutoff_hours: 48,
  operator_name: '', driver_id: '', vehicle_id: '', notes: '',
}

/** ISO (UTC) to the value a datetime-local input wants, in Nigerian time. */
function localInput(iso) {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function DepartureForm({ initial, drivers, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (initial ? {
    ...EMPTY, ...initial, departs_at: localInput(initial.departs_at), drop_off: initial.drop_off || '',
    operator_name: initial.operator_name || '', notes: initial.notes || '', driver_id: initial.driver_id || '',
    vehicle_id: initial.vehicle_id || '', price_per_seat: Number(initial.price_per_seat),
  } : EMPTY))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((f) => ({ ...f, [key]: value, ...(key === 'driver_id' ? { vehicle_id: '' } : {}) }))
  }
  const driver = drivers.find((d) => String(d.driver_id) === String(form.driver_id))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const body = {
      ...form, seats_total: Number(form.seats_total), price_per_seat: String(form.price_per_seat),
      deposit_percent: Number(form.deposit_percent), balance_due_hours: Number(form.balance_due_hours),
      refund_cutoff_hours: Number(form.refund_cutoff_hours), drop_off: form.drop_off || null,
      operator_name: form.operator_name || null, notes: form.notes || null,
      driver_id: form.driver_id ? Number(form.driver_id) : null, vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null,
    }
    for (const key of ['id', 'seats_left', 'status']) delete body[key]
    const allowed = Object.keys(EMPTY)
    try {
      const clean = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))
      const saved = initial ? await updateDeparture(initial.id, clean) : await createDeparture(clean)
      onSaved(saved)
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label={initial ? 'Edit departure' : 'New departure'}>
      <h2 className="section-title">{initial ? 'Edit departure' : 'New departure'}</h2>
      <Alert tone="error">{error}</Alert>
      <datalist id="travel-schools">{SCHOOLS.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="travel-cities">{CITIES.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="form-grid">
        <label className="field"><span className="field-label">From (school)</span>
          <input className="input" list="travel-schools" required minLength={2} maxLength={80} value={form.origin} onChange={set('origin')} /></label>
        <label className="field"><span className="field-label">Pickup spot</span>
          <input className="input" required minLength={3} maxLength={160} value={form.pickup_spot} onChange={set('pickup_spot')} /></label>
        <label className="field"><span className="field-label">To (city)</span>
          <input className="input" list="travel-cities" required minLength={2} maxLength={80} value={form.destination} onChange={set('destination')} /></label>
        <label className="field"><span className="field-label">Drop-off (optional)</span>
          <input className="input" maxLength={160} value={form.drop_off} onChange={set('drop_off')} placeholder="e.g. Ojota park" /></label>
        <label className="field"><span className="field-label">Leaves at (Nigerian time)</span>
          <input className="input" type="datetime-local" required value={form.departs_at} onChange={set('departs_at')} /></label>
        <label className="field"><span className="field-label">Price per seat (₦)</span>
          <input className="input" type="number" min="0" step="50" required value={form.price_per_seat} onChange={set('price_per_seat')} /></label>
        <label className="field"><span className="field-label">Bus driver (optional for now)</span>
          <select className="select" value={form.driver_id} onChange={set('driver_id')}>
            <option value="">Not chosen yet</option>
            {drivers.map((d) => <option key={d.driver_id} value={d.driver_id}>{d.name}</option>)}
          </select></label>
        <label className="field"><span className="field-label">Bus</span>
          <select className="select" value={form.vehicle_id} onChange={set('vehicle_id')} disabled={!driver}>
            <option value="">{driver ? 'Choose the bus' : 'Choose a driver first'}</option>
            {(driver?.buses || []).map((b) => <option key={b.vehicle_id} value={b.vehicle_id}>{b.plate_number} ({b.seats} seats)</option>)}
          </select></label>
        <label className="field"><span className="field-label">Seats for sale</span>
          <input className="input" type="number" min="1" max="80" required value={form.seats_total} onChange={set('seats_total')} /></label>
        <label className="field"><span className="field-label">Operator or company (optional)</span>
          <input className="input" maxLength={160} value={form.operator_name} onChange={set('operator_name')} /></label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={form.allow_deposit} onChange={set('allow_deposit')} />
        <span>Let students pay a deposit first</span>
      </label>
      <div className="form-grid">
        {form.allow_deposit && (
          <label className="field"><span className="field-label">Deposit (%)</span>
            <input className="input" type="number" min="10" max="100" value={form.deposit_percent} onChange={set('deposit_percent')} /></label>
        )}
        {form.allow_deposit && (
          <label className="field"><span className="field-label">Balance due (hours before leaving)</span>
            <input className="input" type="number" min="0" max="168" value={form.balance_due_hours} onChange={set('balance_due_hours')} /></label>
        )}
        <label className="field"><span className="field-label">Full refund if cancelled (hours before leaving)</span>
          <input className="input" type="number" min="0" max="336" value={form.refund_cutoff_hours} onChange={set('refund_cutoff_hours')} /></label>
      </div>
      <label className="field"><span className="field-label">Note for students (optional)</span>
        <textarea className="textarea" rows={2} maxLength={1000} value={form.notes} onChange={set('notes')}
          placeholder="e.g. One bag each. Arrive 30 minutes early." /></label>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Open for booking'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function Stat({ label, value }) {
  return <div className="stat"><p className="stat-label">{label}</p><p className="stat-value">{value}</p></div>
}

function DepartureCard({ dep, onOpen, onEdit, onChanged }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  async function change(status) {
    setBusy(status)
    setError('')
    try {
      onChanged(await setDepartureStatus(dep.id, status))
    } catch (err) {
      setError(err.message || 'Could not update.')
    } finally {
      setBusy('')
      setConfirm(false)
    }
  }
  return (
    <article className="card stack">
      <div className="row row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="stack stack-sm">
          <div><StatusBadge kind="departure" status={dep.status} /></div>
          <h3 className="travel-route">{dep.origin} <ArrowRight size={18} aria-label="to" /> {dep.destination}</h3>
          <p className="muted small">{travelTime(dep.departs_at, true)} · {dep.pickup_spot}</p>
          <p className="muted small">
            {dep.driver_name ? `${dep.driver_name}${dep.plate_number ? ` · ${dep.plate_number}` : ''}` : 'No driver yet'}
            {dep.operator_name ? ` · ${dep.operator_name}` : ''} · {naira(dep.price_per_seat)} a seat
          </p>
        </div>
      </div>
      <div className="stat-grid travel-stats">
        <Stat label="Seats booked" value={`${dep.seats_confirmed} / ${dep.seats_total}`} />
        <Stat label="Fully paid" value={dep.seats_fully_paid} />
        <Stat label="Waiting to pay" value={dep.seats_held} />
        <Stat label="Boarded" value={dep.seats_checked_in} />
        <Stat label="Collected" value={naira(dep.money_collected)} />
        <Stat label="Balances owed" value={naira(dep.balance_outstanding)} />
      </div>
      {Number(dep.refunds_due) > 0 && <Alert tone="warning">Refunds to send: {naira(dep.refunds_due)}</Alert>}
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen(dep.id)}>Passenger list</button>
        {['open', 'closed'].includes(dep.status) && <button type="button" className="btn btn-sm" onClick={() => onEdit(dep)}>Edit</button>}
        {dep.status === 'open' && <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => change('closed')}>Stop bookings</button>}
        {dep.status === 'closed' && <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => change('open')}>Reopen bookings</button>}
        {['open', 'closed'].includes(dep.status) && <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => change('departed')}>Bus has left</button>}
        {dep.status === 'departed' && <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => change('completed')}>Bus has arrived</button>}
        {['open', 'closed'].includes(dep.status) && (confirm ? (
          <button type="button" className="btn btn-danger btn-sm" disabled={Boolean(busy)} onClick={() => change('cancelled')}>
            Yes, cancel and refund everyone
          </button>
        ) : (
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirm(true)}>Cancel trip</button>
        ))}
      </div>
    </article>
  )
}

function BookingRow({ row, onChanged }) {
  const [mode, setMode] = useState('')
  const [amount, setAmount] = useState(row.balance)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      setMode('')
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  const owes = ['awaiting_payment', 'reserved', 'expired'].includes(row.status) && Number(row.balance) > 0
  return (
    <article className="card stack stack-sm manifest-row">
      <div className="row row-between" style={{ gap: 8 }}>
        <strong className="ticket-mini">{row.ticket_code}</strong>
        <div className="row" style={{ gap: 6 }}>
          {row.checked_in && <span className="badge badge-green">Boarded</span>}
          <StatusBadge kind="ticket" status={row.status} />
        </div>
      </div>
      <p><strong>{row.traveller_names.join(', ')}</strong> · {row.seats} seat{row.seats > 1 ? 's' : ''}</p>
      <p className="muted small">
        Booked by {row.booked_by} · {row.phone || 'no phone'}{row.matric_number ? ` · ${row.matric_number}` : ''}
        {row.kin_phone ? ` · Guardian ${row.kin_phone}` : ''}{row.share_with_school ? ' · Agreed to share with school' : ''}
      </p>
      <p className="small">
        Paid {naira(row.amount_paid)} of {naira(row.amount_total)}
        {Number(row.balance) > 0 && ['reserved', 'awaiting_payment'].includes(row.status) ? ` · Balance ${naira(row.balance)}` : ''}
        {row.refund_status ? ` · Refund ${naira(row.refund_amount)} ${row.refund_status === 'paid' ? 'sent' : 'to send'}` : ''}
      </p>
      <Alert tone="error">{error}</Alert>
      {mode === 'pay' && (
        <div className="form-grid">
          <label className="field"><span className="field-label">Amount (₦)</span>
            <input className="input" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span className="field-label">How</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option>
            </select></label>
          <label className="field"><span className="field-label">Reference (optional)</span>
            <input className="input" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
      )}
      {mode === 'refund' && (
        <label className="field"><span className="field-label">Transfer reference</span>
          <input className="input" minLength={3} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
      )}
      <div className="row">
        {owes && mode !== 'pay' && <button type="button" className="btn btn-sm" onClick={() => setMode('pay')}>Record payment</button>}
        {mode === 'pay' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => run(() => recordTravelPayment(row.booking_id, { amount: String(amount), method, reference: reference || null }))}>
            Save payment
          </button>
        )}
        {row.refund_status === 'due' && mode !== 'refund' && <button type="button" className="btn btn-sm" onClick={() => setMode('refund')}>Refund sent</button>}
        {mode === 'refund' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || reference.trim().length < 3}
            onClick={() => run(() => markTravelRefundPaid(row.booking_id, reference.trim()))}>Save refund</button>
        )}
        {mode && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('')}>Close</button>}
      </div>
    </article>
  )
}

function Manifest({ id, onBack }) {
  const [data, setData] = useState(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => getManifest(id).then(setData).catch((err) => setError(err.message || 'Could not load.')), [id])
  useEffect(() => {
    let active = true
    getManifest(id).then((d) => active && setData(d)).catch((err) => active && setError(err.message || 'Could not load.'))
    return () => {
      active = false
    }
  }, [id])

  async function checkIn(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const row = await adminCheckIn(id, code)
      setNotice(`Boarded: ${row.traveller_names.join(', ')}`)
      setCode('')
      load()
    } catch (err) {
      setError(err.message || 'Could not check in.')
    }
  }
  async function send(event) {
    event.preventDefault()
    setError('')
    try {
      const result = await messageTravellers(id, message)
      setNotice(`Message sent to ${result.sent_to} traveller${result.sent_to === 1 ? '' : 's'}.`)
      setMessage('')
    } catch (err) {
      setError(err.message || 'Could not send.')
    }
  }

  const dep = data?.departure
  const shown = (data?.bookings || []).filter((b) => b.status !== 'expired')
  return (
    <div className="stack">
      <div><button type="button" className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> All departures</button></div>
      {dep && (
        <div className="card stack stack-sm">
          <h2 className="travel-route">{dep.origin} <ArrowRight size={18} aria-label="to" /> {dep.destination}</h2>
          <p className="muted small">{travelTime(dep.departs_at, true)} · {dep.seats_confirmed} of {dep.seats_total} seats booked · {dep.seats_checked_in} boarded</p>
        </div>
      )}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <form className="card row" onSubmit={checkIn} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 200px' }}><span className="field-label">Board a student: ticket code</span>
          <input className="input" required minLength={4} maxLength={20} value={code} autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EKT…" /></label>
        <button type="submit" className="btn btn-primary">Check in</button>
      </form>
      <form className="card row" onSubmit={send} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 260px' }}><span className="field-label">Message everyone on this bus</span>
          <input className="input" required minLength={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. The bus is at the main gate now." /></label>
        <button type="submit" className="btn"><Send size={16} aria-hidden="true" /> Send</button>
      </form>
      {data && shown.length === 0 && <div className="card empty"><p className="muted">No bookings yet.</p></div>}
      {shown.map((row) => <BookingRow key={row.booking_id} row={row} onChanged={load} />)}
    </div>
  )
}

function Report() {
  const [origin, setOrigin] = useState('EKSU')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const query = () => new URLSearchParams({ origin, ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) }).toString()

  async function run(event) {
    event?.preventDefault()
    setError('')
    try {
      setReport(await getTravelReport(query()))
    } catch (err) {
      setError(err.message || 'Could not load the report.')
    }
  }
  return (
    <div className="stack">
      <form className="card stack" onSubmit={run}>
        <div className="form-grid">
          <label className="field"><span className="field-label">School</span>
            <input className="input" list="travel-schools-r" value={origin} onChange={(e) => setOrigin(e.target.value)} /></label>
          <label className="field"><span className="field-label">From date</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span className="field-label">To date</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <datalist id="travel-schools-r">{SCHOOLS.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="row">
          <button type="submit" className="btn btn-primary">Show report</button>
          <button type="button" className="btn" onClick={() => downloadFile(`/api/v1/admin/travel/report.csv?${query()}`, 'ekimove-travel.csv').catch((err) => setError(err.message))}>
            <Download size={16} aria-hidden="true" /> Names list for the school (CSV)
          </button>
        </div>
        <p className="muted small">The names list only includes students who agreed to share their details with their school. Everyone else is counted, not named.</p>
      </form>
      <Alert tone="error">{error}</Alert>
      {report && (
        <>
          <div className="stat-grid">
            <Stat label="Students travelling" value={report.travellers} />
            <Stat label="Boarded" value={report.boarded} />
            <Stat label="Buses" value={report.departures} />
            <Stat label="Agreed to be named" value={report.named_travellers} />
          </div>
          <div className="card stack">
            <h3 className="section-title">By destination</h3>
            {report.by_destination.length === 0 ? <p className="muted">No travellers in this period.</p> : (
              <dl className="rows">
                {report.by_destination.map((r) => <div key={r.destination}><dt>{r.destination}</dt><dd>{r.travellers} students · {r.departures} bus{r.departures === 1 ? '' : 'es'}</dd></div>)}
              </dl>
            )}
          </div>
          {report.by_day.length > 0 && (
            <div className="card stack">
              <h3 className="section-title">By day</h3>
              <dl className="rows">
                {report.by_day.map((r) => <div key={r.date}><dt>{new Date(`${r.date}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}</dt><dd>{r.travellers} students</dd></div>)}
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function AdminTravelPage() {
  const [tab, setTab] = useState('departures')
  const [list, setList] = useState({ loaded: false, rows: [] })
  const [drivers, setDrivers] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | departure
  const [openId, setOpenId] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => adminDepartures(showPast)
    .then((rows) => setList({ loaded: true, rows }))
    .catch((err) => setError(err.message || 'Could not load departures.')), [showPast])

  useEffect(() => {
    let active = true
    adminDepartures(showPast)
      .then((rows) => active && setList({ loaded: true, rows }))
      .catch((err) => active && setError(err.message || 'Could not load departures.'))
    return () => {
      active = false
    }
  }, [showPast])

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/admin/travel/drivers').then((rows) => active && setDrivers(rows)).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return (
    <AdminShell title="Student travel"
      description="Buses for students going home: departures, seat bookings, payments, boarding and reports for schools.">
      <div className="stack">
        <div className="filter-pills" role="group" aria-label="Travel desk">
          <button type="button" className="pill" aria-pressed={tab === 'departures'} onClick={() => { setTab('departures'); setOpenId(null) }}>Departures</button>
          <button type="button" className="pill" aria-pressed={tab === 'report'} onClick={() => setTab('report')}>School report</button>
        </div>
        <Alert tone="error">{error}</Alert>
        {tab === 'report' && <Report />}
        {tab === 'departures' && openId && <Manifest id={openId} onBack={() => { setOpenId(null); load() }} />}
        {tab === 'departures' && !openId && (
          <>
            {editing ? (
              <DepartureForm initial={editing === 'new' ? null : editing} drivers={drivers}
                onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
            ) : (
              <div className="row row-between">
                <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} aria-hidden="true" /> New departure</button>
                <label className="check-row small"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past trips</label>
              </div>
            )}
            {list.loaded && list.rows.length === 0 && !editing && (
              <div className="card empty"><p className="muted">No departures yet. Add the first bus when the school confirms the holiday dates.</p></div>
            )}
            {!editing && list.rows.map((dep) => (
              <DepartureCard key={dep.id} dep={dep} onOpen={setOpenId} onEdit={setEditing}
                onChanged={(saved) => setList((l) => ({ ...l, rows: l.rows.map((r) => (r.id === saved.id ? saved : r)) }))} />
            ))}
          </>
        )}
      </div>
    </AdminShell>
  )
}
