import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Bus, CheckCircle2 } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { driverCheckIn, driverTripStatus, getMyBusTrips } from '../../services/travelService.js'
import { travelTime } from '../../utils/travel.js'

function BusTrip({ trip, onChanged }) {
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function board(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const row = await driverCheckIn(trip.id, code)
      setNotice(`Boarded: ${row.traveller_names.join(', ')}`)
      setCode('')
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not check this ticket.')
    }
  }
  async function status(next) {
    setBusy(true)
    setError('')
    try {
      await driverTripStatus(trip.id, next)
      onChanged()
    } catch (err) {
      setError(err.message || 'Could not update.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card stack">
      <div><StatusBadge kind="departure" status={trip.status} /></div>
      <h2 className="travel-route">{trip.origin} <ArrowRight size={18} aria-label="to" /> {trip.destination}</h2>
      <p className="muted small">{travelTime(trip.departs_at)} · Pickup: {trip.pickup_spot}{trip.drop_off ? ` · Drop-off: ${trip.drop_off}` : ''}</p>
      <p><strong>{trip.seats_checked_in}</strong> of <strong>{trip.seats_booked}</strong> booked seats have boarded.</p>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {['open', 'closed', 'departed'].includes(trip.status) && (
        <form className="row" onSubmit={board} style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span className="field-label">Student’s ticket code</span>
            <input className="input" required minLength={4} maxLength={20} value={code} autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EKT…" />
          </label>
          <button type="submit" className="btn btn-primary">Board</button>
        </form>
      )}
      <ul className="manifest-list" aria-label="Passengers">
        {trip.passengers.map((p) => (
          <li key={p.booking_id} className={p.checked_in ? 'is-done' : ''}>
            <span>
              {p.checked_in && <CheckCircle2 size={16} aria-label="Boarded" />} {p.traveller_names.join(', ')}
            </span>
            <span className="muted small">
              {p.fully_paid ? (p.checked_in ? 'Boarded' : 'Paid') : 'Balance not paid'}
            </span>
          </li>
        ))}
        {trip.passengers.length === 0 && <li className="muted">No confirmed passengers yet.</li>}
      </ul>
      <div className="row">
        {['open', 'closed'].includes(trip.status) && (
          <button type="button" className="btn" disabled={busy} onClick={() => status('departed')}>We’ve left</button>
        )}
        {trip.status === 'departed' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => status('completed')}>We’ve arrived</button>
        )}
      </div>
    </article>
  )
}

export default function DriverTravelPage() {
  const [trips, setTrips] = useState({ loaded: false, list: [] })
  const [error, setError] = useState('')
  const load = useCallback(() => getMyBusTrips().then((list) => setTrips({ loaded: true, list }))
    .catch((err) => setError(err.message || 'Could not load your bus trips.')), [])
  useEffect(() => {
    let active = true
    getMyBusTrips().then((list) => active && setTrips({ loaded: true, list }))
      .catch((err) => active && setError(err.message || 'Could not load your bus trips.'))
    return () => {
      active = false
    }
  }, [])

  return (
    <AppShell title="Bus trips" description="Your student travel departures. Board each student with their ticket code.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        {trips.loaded && trips.list.length === 0 && (
          <div className="card empty">
            <span className="empty-icon"><Bus size={28} aria-hidden="true" /></span>
            <p className="muted">No bus trips are assigned to you yet. The EkiMove team will add you to a departure.</p>
          </div>
        )}
        {trips.list.map((t) => <BusTrip key={t.id} trip={t} onChanged={load} />)}
      </div>
    </AppShell>
  )
}
