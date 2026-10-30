import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'
import SOSButton from '../../components/SOSButton.jsx'
import './MyRidesPage.css'

function formatFare(value) {
  if (value === null || value === undefined) return 'Not available'
  return `₦${Number(value).toLocaleString('en-NG')}`
}

function formatDate(value) {
  if (!value) return 'Date unavailable'

  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readableStatus(status) {
  if (!status) return 'Unknown'

  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getStatusClass(status) {
  const normalized = (status || '').toLowerCase()

  if (['completed', 'paid'].includes(normalized)) return 'completed'

  if (
    ['accepted', 'assigned', 'in_progress', 'ongoing'].includes(normalized)
  ) {
    return 'active'
  }

  if (['cancelled', 'rejected', 'failed'].includes(normalized)) {
    return 'cancelled'
  }

  return 'pending'
}

function getRideId(ride) {
  return ride.id || ride.ride_request_id || ride.request_id || 'N/A'
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

    const interval = setInterval(fetchRides, 10000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [refreshKey])

  const activeRides = rides.filter((ride) =>
    ['requested', 'accepted', 'assigned', 'in_progress', 'ongoing'].includes(
      (ride.ride_status || ride.status || '').toLowerCase()
    )
  )

  const completedRides = rides.filter(
    (ride) =>
      (ride.ride_status || ride.status || '').toLowerCase() === 'completed'
  )

  const refreshRides = () => {
    setLoading(true)
    setRefreshKey((prev) => prev + 1)
  }

  return (
    <AppPage
      eyebrow="YOUR JOURNEY"
      title="My rides"
      description="All your journeys, in one place. Keep track of your bookings and ride details."
      sectionTitle="Ride history"
      sectionText="View your requested, ongoing and completed rides."
    >
      <div className="my-rides-page">

        <div className="my-rides-toolbar">
          <div>
            <span className="my-rides-overline">YOUR ACTIVITY</span>
            <h2>Your journeys</h2>
            <p>Here's what's happening with your rides.</p>
          </div>

          <button
            type="button"
            className="my-rides-refresh"
            onClick={refreshRides}
            disabled={loading}
          >
            <span className="refresh-icon">↻</span>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="my-rides-summary">
          <div className="my-rides-summary-card">
            <div className="summary-symbol total-symbol">↗</div>
            <div>
              <p>Total rides</p>
              <h3>{rides.length}</h3>
            </div>
          </div>

          <div className="my-rides-summary-card">
            <div className="summary-symbol active-symbol">◷</div>
            <div>
              <p>Active rides</p>
              <h3>{activeRides.length}</h3>
            </div>
          </div>

          <div className="my-rides-summary-card">
            <div className="summary-symbol completed-symbol">✓</div>
            <div>
              <p>Completed rides</p>
              <h3>{completedRides.length}</h3>
            </div>
          </div>
        </div>

        {error && rides.length > 0 && (
          <p className="my-rides-error" role="alert">
            {error}
          </p>
        )}

        <section className="my-rides-history">
          <div className="my-rides-history-heading">
            <div>
              <h2>All rides</h2>
              <p>Your booking history and current ride requests.</p>
            </div>

            <span className="my-rides-count">
              {rides.length} {rides.length === 1 ? 'ride' : 'rides'}
            </span>
          </div>

          {loading && rides.length === 0 ? (
            <div className="my-rides-state">
              <div className="my-rides-spinner" />
              <h3>Getting your rides</h3>
              <p>Please wait while we load your journey history.</p>
            </div>
          ) : error && rides.length === 0 ? (
            <div className="my-rides-state">
              <div className="my-rides-empty-icon">!</div>
              <h3>We couldn't load your rides</h3>
              <p>{error}</p>
              <button
                type="button"
                className="my-rides-primary-button"
                onClick={refreshRides}
              >
                Try again
              </button>
            </div>
          ) : rides.length === 0 ? (
            <div className="my-rides-state">
              <div className="my-rides-empty-icon">↗</div>
              <h3>Your next journey starts here</h3>
              <p>
                You haven't booked a ride yet. When you book your first ride,
                your journey details will appear here.
              </p>
              <Link to="/book-ride" className="my-rides-primary-button">
                Book a ride <span>→</span>
              </Link>
            </div>
          ) : (
            <div className="my-rides-list">
              {rides.map((ride, index) => {
                const status = ride.ride_status || ride.status
                const statusClass = getStatusClass(status)

                return (
                  <article
                    className="my-ride-card"
                    key={
                      getRideId(ride) !== 'N/A'
                        ? getRideId(ride)
                        : index
                    }
                  >
                    <div className="my-ride-card-header">
                      <div className="my-ride-reference">
                        <span className="my-ride-car-icon">🚘</span>
                        <div>
                          <small>RIDE REFERENCE</small>
                          <strong>#{getRideId(ride)}</strong>
                        </div>
                      </div>

                      <span className={`my-ride-status ${statusClass}`}>
                        <span />
                        {readableStatus(status)}
                      </span>
                    </div>

                    <div className="my-ride-route">
                      <div className="my-ride-location">
                        <span className="pickup-marker" />
                        <div>
                          <small>FROM</small>
                          <strong>{ride.origin || 'Not provided'}</strong>
                        </div>
                      </div>

                      <div className="my-ride-route-line" />

                      <div className="my-ride-location">
                        <span className="destination-marker" />
                        <div>
                          <small>TO</small>
                          <strong>
                            {ride.destination || 'Not provided'}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="my-ride-information">
                      <div>
                        <small>VEHICLE</small>
                        <strong>{ride.vehicle_type || 'Not specified'}</strong>
                      </div>

                      <div>
                        <small>PASSENGERS</small>
                        <strong>{ride.passengers ?? 'N/A'}</strong>
                      </div>

                      <div>
                        <small>FARE</small>
                        <strong className="my-ride-fare">
                          {formatFare(ride.quoted_fare)}
                        </strong>
                      </div>

                      <div>
                        <small>DATE REQUESTED</small>
                        <strong>{formatDate(ride.created_at)}</strong>
                      </div>
                    </div>

                    {ride.assigned_ride_id && (
                      <div className="my-ride-actions">
                        <SOSButton
                          rideId={ride.assigned_ride_id}
                          rideStatus={ride.ride_status}
                        />

                        <Link
                          to={`/payments/${ride.assigned_ride_id}`}
                          className="my-ride-payment-link"
                        >
                          View payment details <span>→</span>
                        </Link>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </AppPage>
  )
}