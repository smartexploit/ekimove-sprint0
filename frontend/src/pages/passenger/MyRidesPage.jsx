import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'
import SOSButton from '../../components/SOSButton.jsx'

function formatFare(amount, currency = 'NGN') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${currency} ?`

  return `${currency} ${value.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value) {
  if (!value) return 'Date unavailable'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  return date.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function readableStatus(status) {
  if (!status) return 'Status unavailable'
  return status.replaceAll('_', ' ')
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
          setError(err.message || 'Unable to load your ride history.')
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

  return (
    <AppPage
      eyebrow="RIDE ACTIVITY"
      title="My rides"
      description="Review your submitted ride requests and their latest recorded status."
      sectionTitle="Your ride history"
      sectionText="Ride information is loaded from your authenticated EkiMove account."
    >
      <div className="app-page-actions">
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          Refresh rides
        </button>
        <p>Ride statuses refresh automatically every 10 seconds while this page is open.</p>
      </div>

      {loading && <p role="status">Loading your rides...</p>}

      {!loading && error && (
        <div role="alert" className="form-error">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && rides.length === 0 && (
        <div className="empty-state">
          <h3>No rides yet</h3>
          <p>Your submitted ride requests will appear here.</p>
          <Link to="/book-ride">Book your first ride</Link>
        </div>
      )}

      {!loading && !error && rides.length > 0 && (
        <div className="ride-history-list">
          {rides.map((ride) => (
            <article className="ride-result" key={ride.id}>
              <h3>Ride request #{ride.id}</h3>
              <p>
                Status:{' '}
                <strong>{readableStatus(ride.ride_status || ride.status)}</strong>
              </p>
              <p>
                Pickup: <strong>{ride.origin_text}</strong>
              </p>
              <p>
                Destination: <strong>{ride.destination_text}</strong>
              </p>
              <p>
                Vehicle: <strong>{ride.vehicle_type}</strong>
              </p>
              <p>
                Passengers: <strong>{ride.passenger_count}</strong>
              </p>
              <p>
                Quoted fare:{' '}
                <strong>{formatFare(ride.quoted_fare, ride.currency)}</strong>
              </p>
              <p>Submitted: {formatDate(ride.created_at)}</p>
              {ride.status === 'requested' && !ride.assigned_ride_id && (
                <p>
                  This request is awaiting confirmation. The quoted fare is
                  not proof of payment or ride confirmation.
                </p>
              )}

              {ride.assigned_ride_id && (
                <>
                  <SOSButton
                    rideId={ride.assigned_ride_id}
                    rideStatus={ride.ride_status}
                  />
                  <div className="app-page-actions">
                  <Link to={`/payments?rideId=${ride.assigned_ride_id}`}>
                    Manage payment
                  </Link>
                  <p>
                    Payment is available by bank transfer only. A submitted
                    transfer reference does not confirm payment.
                  </p>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="app-page-actions">
        <Link to="/book-ride">Book another ride</Link>
        <Link to="/dashboard">Return to dashboard</Link>
      </div>
    </AppPage>
  )
}
