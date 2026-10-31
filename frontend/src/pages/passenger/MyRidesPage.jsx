import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, RefreshCw, Route } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { vehicleLabel } from '../../utils/vehicles.js'
import SOSButton from '../../components/SOSButton.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatNaira, formatShortDate, initials } from '../../utils/format.js'
import {
  PROGRESS_STEPS,
  isActiveRide,
  progressIndex,
  rideStatus,
} from '../../utils/rides.js'

function LiveRide({ ride }) {
  const status = rideStatus(ride)
  const step = progressIndex(status)

  return (
    <section className="live-card" aria-labelledby={`ride-${ride.id}-title`}>
      <div className="row row-between">
        <StatusBadge status={status} />
        <span className="small" style={{ color: 'var(--green-200)' }}>
          Request #{ride.id}
        </span>
      </div>

      <div>
        <h2 id={`ride-${ride.id}-title`} style={{ fontSize: 24, fontWeight: 800 }}>
          {ride.origin_text} → {ride.destination_text}
        </h2>
        <p className="small" style={{ marginTop: 4, color: 'var(--green-200)' }}>
          {vehicleLabel(ride.vehicle_type)} · {ride.passenger_count}{' '}
          {ride.passenger_count === 1 ? 'passenger' : 'passengers'} ·{' '}
          {formatNaira(ride.quoted_fare)}
        </p>
      </div>

      {status !== 'incident_review' && (
        <ol className="progress" aria-label="Ride progress">
          {PROGRESS_STEPS.map(([key, label], index) => (
            <li
              key={key}
              className={`${index <= step ? 'is-done' : ''} ${index === step ? 'is-current' : ''}`.trim()}
              aria-current={index === step ? 'step' : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
      )}

      {ride.assigned_ride_id ? (
        <div className="driver-chip">
          <span className="avatar" aria-hidden="true">{initials(ride.driver_name)}</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 800 }}>
              {ride.driver_name ? `${ride.driver_name} · verified driver` : 'Verified driver'}
            </p>
            <p className="small" style={{ color: 'var(--green-200)', marginTop: 2 }}>
              {vehicleLabel(ride.vehicle_type)}
              {ride.vehicle_plate ? (
                <>
                  {' · Plate '}
                  <span className="plate">{ride.vehicle_plate}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : (
        <p className="small" style={{ color: 'var(--green-200)' }}>
          We're matching you with a verified driver. This page updates on its own.
        </p>
      )}

      {ride.assigned_ride_id && (
        <div className="row">
          <Link className="btn" to={`/payments?rideId=${ride.assigned_ride_id}`}>
            Pay for ride
          </Link>
          <SOSButton rideId={ride.assigned_ride_id} rideStatus={ride.ride_status} />
        </div>
      )}
    </section>
  )
}

export default function MyRidesPage() {
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true

    async function fetchRides() {
      try {
        const data = await apiRequest('/api/v1/ride-requests/my-rides')
        if (active) {
          setRides(Array.isArray(data) ? data : [])
          setError('')
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Unable to load your rides.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchRides()
    const intervalId = window.setInterval(fetchRides, 10000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [refreshKey])

  const activeRides = rides.filter(isActiveRide)
  const pastRides = rides.filter((ride) => !isActiveRide(ride))

  return (
    <AppShell
      title="My rides"
      description="Live rides update every 10 seconds while this page is open."
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
          <Link className="btn btn-primary btn-sm" to="/book-ride">
            <Plus size={16} aria-hidden="true" /> New ride
          </Link>
        </>
      }
    >
      {loading && (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Loading your rides…
        </div>
      )}

      {!loading && error && (
        <Alert tone="error">
          {error}{' '}
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginLeft: 8 }}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Try again
          </button>
        </Alert>
      )}

      {!loading && !error && rides.length === 0 && (
        <div className="card empty">
          <span className="empty-icon"><Route size={28} aria-hidden="true" /></span>
          <h2>No rides yet</h2>
          <p className="muted">Your ride requests will appear here.</p>
          <Link className="btn btn-accent" to="/book-ride">
            Book your first ride
          </Link>
        </div>
      )}

      {!loading && rides.length > 0 && (
        <div className="two-col">
          <div className="stack">
            {activeRides.length > 0 ? (
              activeRides.map((ride) => <LiveRide key={ride.id} ride={ride} />)
            ) : (
              <div className="card stack stack-sm">
                <h2 className="section-title">No ride in progress</h2>
                <p className="muted small">Ready for your next trip?</p>
                <div>
                  <Link className="btn btn-accent btn-sm" to="/book-ride">
                    Book a ride
                  </Link>
                </div>
              </div>
            )}
          </div>

          <section className="stack stack-sm" aria-labelledby="past-rides">
            <h2 id="past-rides" className="section-title" style={{ padding: '0 4px' }}>
              Earlier rides
            </h2>
            {pastRides.length === 0 ? (
              <p className="card muted small">Completed and cancelled rides will show here.</p>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {pastRides.map((ride) => (
                  <li className="list-item" key={ride.id}>
                    <div className="list-item-main">
                      <p className="list-item-title">
                        {ride.origin_text} → {ride.destination_text}
                      </p>
                      <p className="list-item-meta">
                        {vehicleLabel(ride.vehicle_type)} · {formatShortDate(ride.created_at)} ·{' '}
                        {formatNaira(ride.quoted_fare, { decimals: 0 })}
                      </p>
                    </div>
                    <StatusBadge status={rideStatus(ride)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
