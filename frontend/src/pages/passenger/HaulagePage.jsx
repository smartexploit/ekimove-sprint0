import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, Package, Truck } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import {
  acceptLoadQuote,
  declineLoadQuote,
  listMyLoads,
  requestLoad,
} from '../../services/accountService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

const VEHICLES = [
  ['big_car', 'Big car', 'SUV or Sienna: luggage, a few boxes'],
  ['van', 'Van or bus', 'Furniture, a small move, many bags'],
  ['dyna', 'Dyna truck', 'Heavy or bulky loads, building materials'],
]

const EMPTY = { vehicle_type: 'van', origin_text: '', destination_text: '', load_description: '', when: '' }

function LoadCard({ load, busy, onAccept, onDecline }) {
  return (
    <article className="card stack stack-sm">
      <div className="row row-between">
        <p className="list-item-title" style={{ minWidth: 0 }}>
          {load.origin_text} → {load.destination_text}
        </p>
        <StatusBadge status={load.status} />
      </div>
      <p className="muted small">
        {load.vehicle_label} · Booking #{load.id}
        {load.scheduled_for ? ` · ${formatDateTime(load.scheduled_for)}` : ''}
      </p>
      <p className="small">{load.load_description}</p>

      {load.status === 'quoted' && (
        <div className="quote-box">
          <p className="muted small" style={{ fontWeight: 700 }}>EkiMove's quote</p>
          <p className="money" style={{ fontSize: 26, color: 'var(--green-800)' }}>
            {formatNaira(load.quoted_fare, { decimals: 0 })}
          </p>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{load.quote_terms}</p>
          <p className="muted small">
            If you accept, we'll assign a driver and you'll pay this amount through EkiMove before the
            job starts. Never pay a driver directly.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAccept(load)}>
              Accept and book
            </button>
            <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => onDecline(load)}>
              Decline
            </button>
          </div>
        </div>
      )}
      {load.status === 'quote_requested' && (
        <p className="small">We're working out a price. We'll reply in your support chat, usually within working hours.</p>
      )}
      {['requested', 'assigned'].includes(load.status) && (
        <p className="small">Booked at {formatNaira(load.quoted_fare, { decimals: 0 })}. Follow it in <Link className="text-link" to="/my-rides">My rides</Link>.</p>
      )}
      {load.support_thread_id && (
        <div>
          <Link className="btn btn-sm" to={`/support?thread=${load.support_thread_id}`}>
            <MessageCircle size={16} aria-hidden="true" /> Chat about this load
          </Link>
        </div>
      )}
    </article>
  )
}

export default function HaulagePage() {
  const [form, setForm] = useState(EMPTY)
  const [loads, setLoads] = useState({ loaded: false, list: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => listMyLoads()
    .then((list) => setLoads({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch(() => setLoads((current) => ({ ...current, loaded: true }))), [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    const timer = window.setInterval(load, 20000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [load])

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await requestLoad({
        vehicle_type: form.vehicle_type,
        origin_text: form.origin_text.trim(),
        destination_text: form.destination_text.trim(),
        load_description: form.load_description.trim(),
        ...(form.when ? { scheduled_for: new Date(form.when).toISOString() } : {}),
      })
      setForm(EMPTY)
      setNotice("Request sent. We'll agree the price with you in your support chat.")
      await load()
    } catch (err) {
      setError(err.message || 'Could not send your request.')
    } finally {
      setBusy(false)
    }
  }

  async function act(fn, loadItem, message) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn(loadItem.id)
      setNotice(message)
      await load()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell
      title="Move a load"
      description="Big cars, vans and dyna trucks for luggage, furniture and goods within Ekiti."
    >
      <div className="two-col">
        <form className="card stack" onSubmit={submit} aria-labelledby="load-form-title">
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <span className="instant-icon" aria-hidden="true"><Truck size={20} /></span>
            <h2 id="load-form-title" className="section-title">Tell us what you're moving</h2>
          </div>
          <Alert tone="error">{error}</Alert>
          <Alert tone="success">{notice}</Alert>
          <fieldset className="choice-list">
            <legend className="choice-legend">Vehicle</legend>
            {VEHICLES.map(([value, title, sub]) => (
              <label className="choice" key={value}>
                <input type="radio" name="load_vehicle" value={value} checked={form.vehicle_type === value}
                  onChange={update('vehicle_type')} />
                <span className="choice-body">
                  <span className="choice-title">{title}</span>
                  <span className="choice-sub">{sub}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="field-label">Pick up from</span>
            <input className="input" required minLength={3} maxLength={255} value={form.origin_text}
              onChange={update('origin_text')} placeholder="Street, area and a landmark" />
          </label>
          <label className="field">
            <span className="field-label">Deliver to</span>
            <input className="input" required minLength={3} maxLength={255} value={form.destination_text}
              onChange={update('destination_text')} placeholder="Street, area and a landmark" />
          </label>
          <label className="field">
            <span className="field-label">What's the load?</span>
            <textarea className="textarea" required minLength={5} maxLength={1500} rows={3}
              value={form.load_description} onChange={update('load_description')}
              placeholder="e.g. 1 double bed, a fridge and 6 boxes. Need 2 loaders." />
          </label>
          <label className="field">
            <span className="field-label">When (optional)</span>
            <input className="input" type="datetime-local" value={form.when} onChange={update('when')} />
          </label>
          <p className="muted small">
            There's no fixed fare for loads. EkiMove support will agree the price and terms with you in
            chat. You only pay through EkiMove, after you accept and a driver is assigned.
          </p>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Request a quote'}
            </button>
          </div>
        </form>

        <section className="stack" aria-labelledby="my-loads-title">
          <h2 id="my-loads-title" className="section-title" style={{ padding: '0 4px' }}>Your load bookings</h2>
          {loads.loaded && loads.list.length === 0 ? (
            <div className="card empty">
              <span className="empty-icon"><Package size={28} aria-hidden="true" /></span>
              <p className="muted">Your requests and quotes will appear here.</p>
            </div>
          ) : (
            loads.list.map((item) => (
              <LoadCard key={item.id} load={item} busy={busy}
                onAccept={(l) => act(acceptLoadQuote, l, 'Quote accepted. We are finding you a driver.')}
                onDecline={(l) => act(declineLoadQuote, l, 'Quote declined.')} />
            ))
          )}
        </section>
      </div>
    </AppShell>
  )
}
