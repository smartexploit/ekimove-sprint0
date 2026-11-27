import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bus, Clock, MapPin, Share2, Ticket, Users } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import CopyButton from '../../components/ui/CopyButton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import InstantTransfer from '../../components/payments/InstantTransfer.jsx'
import SOSButton from '../../components/SOSButton.jsx'
import LazyMap from '../../components/map/LazyMap.jsx'
import { whenVisible } from '../../utils/whenVisible.js'
import { getStoredUser } from '../../services/authService.js'
import {
  bookSeats, cancelTicket, getDepartures, getMyTickets, shareBusTrip, stopSharingBusTrip,
} from '../../services/travelService.js'
import { formatNaira } from '../../utils/format.js'
import { travelTime } from '../../utils/travel.js'

const MAX_SEATS = 4

const naira = (value) => formatNaira(value, { decimals: 0 })

function BookingForm({ departure, user, onBooked, onClose }) {
  const [seats, setSeats] = useState(1)
  const [names, setNames] = useState([user?.full_name || ''])
  const [option, setOption] = useState(departure.deposit_available ? 'deposit' : 'full')
  const [matric, setMatric] = useState('')
  const [kin, setKin] = useState('')
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const total = Number(departure.price_per_seat) * seats
  const deposit = Number(departure.deposit_per_seat) * seats
  const maxSeats = Math.min(MAX_SEATS, departure.seats_left)

  function changeSeats(value) {
    const next = Math.max(1, Math.min(maxSeats, Number(value) || 1))
    setSeats(next)
    setNames((current) => Array.from({ length: next }, (_, i) => current[i] || ''))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await bookSeats({
        departure_id: departure.id, seats, traveller_names: names.map((n) => n.trim()),
        payment_option: option, matric_number: matric.trim() || null, kin_phone: kin.trim() || null,
        share_with_school: share,
      })
      onBooked(data.booking)
    } catch (err) {
      setError(err.message || 'Could not book. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack travel-book" onSubmit={submit} aria-label={`Book seats to ${departure.destination}`}>
      <Alert tone="error">{error}</Alert>
      <label className="field">
        <span className="field-label">Seats</span>
        <select className="select" value={seats} onChange={(event) => changeSeats(event.target.value)}>
          {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n} seat{n > 1 ? 's' : ''}</option>
          ))}
        </select>
      </label>
      {names.map((name, i) => (
        <label className="field" key={i}>
          <span className="field-label">{i === 0 ? 'Traveller’s full name' : `Traveller ${i + 1}’s full name`}</span>
          <input className="input" required minLength={2} maxLength={80} value={name}
            onChange={(event) => setNames((all) => all.map((n, j) => (j === i ? event.target.value : n)))} />
        </label>
      ))}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Matric number (optional)</span>
          <input className="input" maxLength={40} value={matric} onChange={(event) => setMatric(event.target.value)}
            placeholder="e.g. EKSU/2021/1234" autoCapitalize="characters" />
        </label>
        <label className="field">
          <span className="field-label">Parent or guardian’s phone (optional)</span>
          <input className="input" type="tel" maxLength={32} value={kin} onChange={(event) => setKin(event.target.value)}
            placeholder="In case we can’t reach you" />
        </label>
      </div>
      <fieldset className="choice-list">
        <legend className="choice-legend">How do you want to pay?</legend>
        <label className="choice">
          <input type="radio" name={`pay-${departure.id}`} checked={option === 'full'} onChange={() => setOption('full')} />
          <span className="choice-body">
            <span className="choice-title">Pay in full: {naira(total)}</span>
            <span className="choice-sub">Your ticket is ready as soon as it’s paid.</span>
          </span>
        </label>
        {departure.deposit_available && (
          <label className="choice">
            <input type="radio" name={`pay-${departure.id}`} checked={option === 'deposit'} onChange={() => setOption('deposit')} />
            <span className="choice-body">
              <span className="choice-title">Pay {departure.deposit_percent}% now: {naira(deposit)}</span>
              <span className="choice-sub">
                Pay the other {naira(total - deposit)} in the app by {travelTime(departure.balance_due_at)}.
              </span>
            </span>
          </label>
        )}
      </fieldset>
      <label className="check-row">
        <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
        <span className="small">
          I agree that EkiMove may share my name, matric number and travel details with {departure.origin} for
          students’ safety records.
        </span>
      </label>
      <p className="muted small">
        We hold your seat for 1 hour while you pay. Cancel before {travelTime(departure.refund_cutoff_at)} for a full
        refund; after that, payments can’t be refunded.
      </p>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Booking…' : `Book ${seats} seat${seats > 1 ? 's' : ''}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </form>
  )
}

function DepartureCard({ departure, user, open, onOpen, onBooked }) {
  return (
    <article className="card stack travel-card">
      <div className="row row-between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
        <div className="stack stack-sm" style={{ minWidth: 0 }}>
          <h3 className="travel-route">
            {departure.origin} <ArrowRight size={18} aria-label="to" /> {departure.destination}
          </h3>
          <p className="travel-when"><Clock size={16} aria-hidden="true" /> {travelTime(departure.departs_at)}</p>
        </div>
        <div className="travel-price">
          <span className="money">{naira(departure.price_per_seat)}</span>
          <span className="muted small">per seat</span>
        </div>
      </div>
      <dl className="travel-facts">
        <div><dt><MapPin size={15} aria-hidden="true" /> Pickup</dt><dd>{departure.pickup_spot}</dd></div>
        {departure.drop_off && <div><dt><MapPin size={15} aria-hidden="true" /> Drop-off</dt><dd>{departure.drop_off}</dd></div>}
        <div><dt><Users size={15} aria-hidden="true" /> Seats left</dt><dd>{departure.seats_left} of {departure.seats_total}</dd></div>
      </dl>
      {departure.notes && <p className="muted small">{departure.notes}</p>}
      {open ? (
        <BookingForm departure={departure} user={user} onBooked={onBooked} onClose={() => onOpen(null)} />
      ) : (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => onOpen(departure.id)}
            disabled={!departure.bookable}>
            {departure.bookable ? 'Book a seat' : 'Full'}
          </button>
        </div>
      )}
    </article>
  )
}

function PayPanel({ ticket, payment, onPaid }) {
  const [useBank, setUseBank] = useState(!payment.instant)
  const checkPaid = useCallback(
    () => getMyTickets().then((data) => {
      const now = data.bookings.find((b) => b.id === ticket.id)
      return Boolean(now && now.amount_paid !== ticket.amount_paid)
    }),
    [ticket.id, ticket.amount_paid],
  )
  if (!useBank) {
    return (
      <InstantTransfer amount={ticket.due_now} checkPaid={checkPaid} onPaid={onPaid}
        paidText="Payment received. Your ticket is updated." onUnavailable={() => setUseBank(true)} />
    )
  }
  if (!payment.bank) {
    return <Alert tone="warning">Online payment isn’t available right now. Please contact EkiMove support to pay.</Alert>
  }
  return (
    <dl className="card card-outline rows bank-details" aria-label="Pay by bank transfer">
      <div><dt>Bank</dt><dd>{payment.bank.bank_name}</dd></div>
      <div>
        <dt>Account number</dt>
        <dd className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{payment.bank.account_number}</span>
          <CopyButton value={payment.bank.account_number} label="account number" />
        </dd>
      </div>
      <div><dt>Account name</dt><dd>{payment.bank.account_name}</dd></div>
      <div><dt>Amount</dt><dd className="money">{naira(ticket.due_now)}</dd></div>
      <div><dt>Narration</dt><dd>{ticket.ticket_code}</dd></div>
      <p className="muted small" style={{ gridColumn: '1 / -1' }}>
        Write your ticket code as the narration. The EkiMove team confirms it, and your ticket updates.
      </p>
    </dl>
  )
}

function minutesAgo(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

/** On the travel day: where the bus is, a link for family, and SOS. */
function LiveTrip({ ticket, onChanged }) {
  const dep = ticket.departure
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const link = ticket.share_path ? `${window.location.origin}${ticket.share_path}` : ''
  const markers = useMemo(() => (ticket.bus_location ? [{
    id: 'bus', kind: 'driver', latitude: ticket.bus_location.latitude, longitude: ticket.bus_location.longitude,
    label: 'BUS', popup: `Your bus${ticket.bus?.plate_number ? ` · ${ticket.bus.plate_number}` : ''}`,
  }] : []), [ticket.bus_location, ticket.bus])

  async function share() {
    setBusy(true)
    setError('')
    try {
      const { path } = await shareBusTrip(ticket.id)
      const url = `${window.location.origin}${path}`
      const text = `Follow my EkiMove bus from ${dep.origin} to ${dep.destination}:`
      if (navigator.share) {
        await navigator.share({ title: 'My EkiMove bus trip', text, url }).catch(() => {})
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setCopied('Link copied. Paste it in WhatsApp or a text to your family.')
      }
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not create the link.')
    } finally {
      setBusy(false)
    }
  }
  async function stop() {
    setBusy(true)
    try {
      await stopSharingBusTrip(ticket.id)
      setCopied('')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const ended = ['completed', 'cancelled'].includes(dep.status)
  return (
    <div className="stack stack-sm live-trip">
      {ticket.bus?.plate_number && (
        <p className="small row" style={{ gap: 6 }}>
          <Bus size={15} aria-hidden="true" /> {ticket.bus.vehicle_name || 'Bus'} <span className="plate plate-light">{ticket.bus.plate_number}</span>
          {ticket.bus.driver_name ? ` · Driver ${ticket.bus.driver_name}` : ''}
        </p>
      )}
      {dep.status === 'departed' && (
        <>
          <p className="instant-status">
            On the road since {ticket.departed_at ? travelTime(ticket.departed_at) : 'departure'}.
            {ticket.bus_location ? ` Bus location updated ${minutesAgo(ticket.bus_location.updated_at)}.` : ' Waiting for the bus’s location.'}
          </p>
          {markers.length > 0 && <LazyMap markers={markers} height={240} label="Where your bus is" />}
        </>
      )}
      {dep.status === 'completed' && <p className="instant-status is-paid">Your bus has arrived. Welcome home!</p>}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{copied}</Alert>
      {!ended && (
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={share} disabled={busy}>
            <Share2 size={16} aria-hidden="true" /> {link ? 'Share again' : 'Share trip with family'}
          </button>
          {link && <button type="button" className="btn btn-ghost btn-sm" onClick={stop} disabled={busy}>Stop sharing</button>}
          {ticket.sos_available && (
            <SOSButton sosPath={`/api/v1/travel/bookings/${ticket.id}/sos`} withLocation
              subject={`your bus to ${dep.destination}`} />
          )}
        </div>
      )}
      {link && !ended && <p className="muted small">Trip sharing is on: anyone with your link can follow the bus until you arrive.</p>}
    </div>
  )
}

function TicketCard({ ticket, payment, onChanged }) {
  const dep = ticket.departure
  const [paying, setPaying] = useState(ticket.status === 'awaiting_payment')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owes = Number(ticket.due_now) > 0 && ['awaiting_payment', 'reserved'].includes(ticket.status)
  const live = ['awaiting_payment', 'reserved', 'paid'].includes(ticket.status)

  async function cancel() {
    setBusy(true)
    setError('')
    try {
      await cancelTicket(ticket.id)
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not cancel.')
    } finally {
      setBusy(false)
      setConfirmCancel(false)
    }
  }

  return (
    <article className={`card stack ticket ${live ? '' : 'is-dim'}`}>
      <div className="ticket-head">
        <div className="stack stack-sm" style={{ minWidth: 0 }}>
          <div><StatusBadge kind="ticket" status={ticket.status} /></div>
          <h3 className="travel-route">
            {dep.origin} <ArrowRight size={18} aria-label="to" /> {dep.destination}
          </h3>
          <p className="travel-when"><Clock size={16} aria-hidden="true" /> {travelTime(dep.departs_at)}</p>
        </div>
        <div className="ticket-code" aria-label="Ticket code">
          <span className="muted small">Ticket</span>
          <strong>{ticket.ticket_code}</strong>
        </div>
      </div>
      <dl className="travel-facts">
        <div><dt><MapPin size={15} aria-hidden="true" /> Pickup</dt><dd>{dep.pickup_spot}</dd></div>
        <div><dt><Users size={15} aria-hidden="true" /> {ticket.seats > 1 ? 'Travellers' : 'Traveller'}</dt><dd>{ticket.traveller_names.join(', ')}</dd></div>
        <div><dt>Paid</dt><dd>{naira(ticket.amount_paid)} of {naira(ticket.amount_total)}</dd></div>
        {ticket.status === 'reserved' && (
          <div><dt>Balance</dt><dd>{naira(ticket.balance)} by {travelTime(dep.balance_due_at)}</dd></div>
        )}
        {ticket.refund_status && (
          <div><dt>Refund</dt><dd>{naira(ticket.refund_amount)} {ticket.refund_status === 'paid' ? 'sent' : 'on its way'}</dd></div>
        )}
      </dl>
      {ticket.status === 'paid' && (
        <p className="instant-status is-paid">
          {ticket.checked_in ? 'You’ve boarded. Safe journey!' : 'Show this ticket code at the bus on the day.'}
        </p>
      )}
      {['reserved', 'paid'].includes(ticket.status) && <LiveTrip ticket={ticket} onChanged={onChanged} />}
      {ticket.status === 'awaiting_payment' && ticket.hold_expires_at && (
        <Alert tone="warning">Pay {naira(ticket.due_now)} by {travelTime(ticket.hold_expires_at)} to keep your seat.</Alert>
      )}
      <Alert tone="error">{error}</Alert>
      {owes && (paying ? (
        <PayPanel ticket={ticket} payment={payment} onPaid={onChanged} />
      ) : (
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setPaying(true)}>
            Pay {naira(ticket.due_now)}
          </button>
        </div>
      ))}
      {ticket.can_cancel && (
        confirmCancel ? (
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
              {Number(ticket.refund_if_cancelled) > 0
                ? `Yes, cancel (refund ${naira(ticket.refund_if_cancelled)})`
                : Number(ticket.amount_paid) > 0 ? 'Yes, cancel (no refund)' : 'Yes, cancel'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>Keep my seat</button>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(true)}>Cancel booking</button>
          </div>
        )
      )}
    </article>
  )
}

export default function TravelPage() {
  const [departures, setDepartures] = useState({ loaded: false, list: [], destinations: [] })
  const [tickets, setTickets] = useState({ list: [], payment: { instant: false, bank: null } })
  const [destination, setDestination] = useState('')
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const [user] = useState(() => getStoredUser())

  const load = useCallback(() => Promise.all([getDepartures(), getMyTickets()])
    .then(([deps, mine]) => {
      setDepartures({ loaded: true, list: deps.departures, destinations: deps.destinations })
      setTickets({ list: mine.bookings, payment: mine.payment })
    })
    .catch((err) => setError(err.message || 'Could not load the buses.')), [])

  useEffect(() => {
    let active = true
    Promise.all([getDepartures(), getMyTickets()])
      .then(([deps, mine]) => {
        if (!active) return
        setDepartures({ loaded: true, list: deps.departures, destinations: deps.destinations })
        setTickets({ list: mine.bookings, payment: mine.payment })
      })
      .catch((err) => active && setError(err.message || 'Could not load the buses.'))
    return () => {
      active = false
    }
  }, [])

  // While a bus is on the road (or about to leave), keep the ticket fresh.
  const live = tickets.list.some((t) => t.sos_available || t.departure.status === 'departed')
  useEffect(() => {
    if (!live) return undefined
    const timer = window.setInterval(whenVisible(load), 20000)
    return () => window.clearInterval(timer)
  }, [live, load])

  const shown = departures.list.filter((d) => !destination || d.destination === destination)
  const current = tickets.list.filter((t) => ['awaiting_payment', 'reserved', 'paid'].includes(t.status))
  const past = tickets.list.filter((t) => !['awaiting_payment', 'reserved', 'paid'].includes(t.status)).slice(0, 5)

  return (
    <AppShell title="Travel home"
      description="Book your seat on an EkiMove bus for the holidays. Pay in full or a deposit, then show your ticket at the bus.">
      <div className="stack stack-lg">
        <Alert tone="error">{error}</Alert>

        {current.length > 0 && (
          <section className="stack" aria-labelledby="tickets-title">
            <h2 id="tickets-title" className="section-title title-with-icon"><Ticket size={20} aria-hidden="true" /> Your tickets</h2>
            {current.map((t) => <TicketCard key={t.id} ticket={t} payment={tickets.payment} onChanged={load} />)}
          </section>
        )}

        <section className="stack" aria-labelledby="buses-title">
          <h2 id="buses-title" className="section-title title-with-icon"><Bus size={20} aria-hidden="true" /> Upcoming buses</h2>
          {departures.destinations.length > 1 && (
            <div className="filter-pills" role="group" aria-label="Choose where you’re going">
              <button type="button" className="pill" aria-pressed={!destination} onClick={() => setDestination('')}>All</button>
              {departures.destinations.map((d) => (
                <button key={d} type="button" className="pill" aria-pressed={destination === d} onClick={() => setDestination(d)}>{d}</button>
              ))}
            </div>
          )}
          {departures.loaded && shown.length === 0 && (
            <div className="card empty">
              <span className="empty-icon"><Bus size={28} aria-hidden="true" /></span>
              <p className="muted">No buses are open for booking yet. Check back soon: new dates are added for the holidays.</p>
            </div>
          )}
          {shown.map((d) => (
            <DepartureCard key={d.id} departure={d} user={user} open={openId === d.id} onOpen={setOpenId}
              onBooked={() => {
                setOpenId(null)
                load()
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }} />
          ))}
        </section>

        {past.length > 0 && (
          <section className="stack" aria-labelledby="past-title">
            <h2 id="past-title" className="section-title">Earlier bookings</h2>
            {past.map((t) => <TicketCard key={t.id} ticket={t} payment={tickets.payment} onChanged={load} />)}
          </section>
        )}
      </div>
    </AppShell>
  )
}
