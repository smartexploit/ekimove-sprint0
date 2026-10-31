import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Route } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import SOSButton from '../../components/SOSButton.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatNaira, formatShortDate } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const nextStatus = {
  assigned: 'driver_arriving',
  driver_arriving: 'in_progress',
  in_progress: 'completed',
}

const actionLabels = {
  assigned: 'Confirm arrival',
  driver_arriving: 'Start trip',
  in_progress: 'Complete trip',
}

const statusLabels = {
  assigned: 'Assigned',
  driver_arriving: 'Arrived at pickup',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  incident_review: 'Incident under review',
}

const STEPS = [
  ['assigned', 'Confirm arrival at pickup'],
  ['driver_arriving', 'Start trip'],
  ['in_progress', 'Complete trip'],
]

const ACTIVE = new Set(['assigned', 'driver_arriving', 'in_progress', 'incident_review'])

function CurrentTrip({ ride, busy, onAdvance }) {
  const stepIndex = STEPS.findIndex(([key]) => key === ride.status)

  return (
    <section className="card card-lg stack" aria-labelledby={`trip-${ride.id}`}>
      <div className="row row-between">
        <h2 id={`trip-${ride.id}`} className="card-title">
          Trip #{ride.id}
        </h2>
        <StatusBadge status={ride.status} kind="driverTrip" />
      </div>

      <div className="route">
        <div className="route-rail" aria-hidden="true">
          <span className="route-dot" />
          <span className="route-line" />
          <span className="route-end" />
        </div>
        <div>
          <p className="route-label">Pickup</p>
          <p className="route-value">{ride.origin_text}</p>
        </div>
        <div>
          <p className="route-label">Destination</p>
          <p className="route-value">{ride.destination_text}</p>
        </div>
      </div>

      <dl className="kv">
        <div><dt>Vehicle</dt><dd>{vehicleLabel(ride.vehicle_type)}</dd></div>
        <div><dt>Passengers</dt><dd>{ride.passenger_count}</dd></div>
        <div><dt>Agreed fare</dt><dd style={{ color: 'var(--green-800)' }}>{formatNaira(ride.agreed_fare, { decimals: 0 })}</dd></div>
      </dl>

      {stepIndex !== -1 && (
        <ol className="steps" aria-label="Trip steps">
          {STEPS.map(([key, label], index) => (
            <li
              key={key}
              className={index < stepIndex ? 'is-done' : index === stepIndex ? 'is-current' : ''}
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span className="step-num" aria-hidden="true">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}

      <div className="row">
        {nextStatus[ride.status] && (
          <button
            type="button"
            className="btn btn-accent btn-lg"
            style={{ flexGrow: 1 }}
            onClick={() => onAdvance(ride)}
            disabled={busy !== null}
          >
            {busy === ride.id ? 'Updating…' : actionLabels[ride.status]}
          </button>
        )}
        <SOSButton rideId={ride.id} rideStatus={ride.status} />
      </div>
    </section>
  )
}

export default function DriverTripsPage() {
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyRide, setBusyRide] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Load trips, then keep checking for new assignments every 15 seconds.
  useEffect(() => {
    let cancelled = false

    async function fetchRides() {
      try {
        const data = await apiRequest('/api/v1/driver/rides')
        if (!cancelled) {
          setRides(Array.isArray(data) ? data : [])
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load your assigned trips.')
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    fetchRides()
    const intervalId = window.setInterval(fetchRides, 15000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [refreshKey])

  function refresh() {
    setRefreshing(true)
    setRefreshKey((value) => value + 1)
  }

  async function advanceRide(ride) {
    const status = nextStatus[ride.status]
    if (!status) return

    setBusyRide(ride.id)
    setError('')
    setNotice('')

    try {
      await apiRequest(`/api/v1/driver/rides/${ride.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setNotice(`Trip #${ride.id} updated: ${statusLabels[status]}.`)
      refresh()
    } catch (err) {
      setError(err.message || 'Unable to update trip status.')
    } finally {
      setBusyRide(null)
    }
  }

  const activeTrips = rides.filter((ride) => ACTIVE.has(ride.status))
  const pastTrips = rides.filter((ride) => !ACTIVE.has(ride.status))

  return (
    <AppShell
      title="My trips"
      description="New assignments appear here automatically."
      actions={
        <button type="button" className="btn btn-sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={16} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        {loading ? (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading your trips…
          </div>
        ) : rides.length === 0 ? (
          <div className="card empty">
            <span className="empty-icon"><Route size={28} aria-hidden="true" /></span>
            <h2>No trips yet</h2>
            <p className="muted" style={{ maxWidth: 420 }}>
              Make sure you're online. New assignments will show up here.
            </p>
            <Link className="btn btn-primary" to="/driver/status">
              Check my status
            </Link>
          </div>
        ) : (
          <div className="two-col">
            <div className="stack">
              {activeTrips.length > 0 ? (
                activeTrips.map((ride) => (
                  <CurrentTrip key={ride.id} ride={ride} busy={busyRide} onAdvance={advanceRide} />
                ))
              ) : (
                <div className="card stack stack-sm">
                  <h2 className="section-title">No trip in progress</h2>
                  <p className="muted small">Stay online to receive your next assignment.</p>
                </div>
              )}
            </div>

            <section className="stack stack-sm" aria-labelledby="past-trips">
              <h2 id="past-trips" className="section-title" style={{ padding: '0 4px' }}>
                Earlier trips
              </h2>
              {pastTrips.length === 0 ? (
                <p className="card muted small">Completed trips will show here.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {pastTrips.map((ride) => (
                    <li className="list-item" key={ride.id}>
                      <div className="list-item-main">
                        <p className="list-item-title">
                          {ride.origin_text} → {ride.destination_text}
                        </p>
                        <p className="list-item-meta">
                          Trip #{ride.id} · {formatShortDate(ride.completed_at || ride.created_at)} ·{' '}
                          {formatNaira(ride.agreed_fare, { decimals: 0 })}
                        </p>
                      </div>
                      <StatusBadge status={ride.status} kind="driverTrip" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  )
}
