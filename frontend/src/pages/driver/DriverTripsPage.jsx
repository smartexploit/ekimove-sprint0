import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../services/authService'
import AppPage from '../../layouts/AppPage'
import SOSButton from '../../components/SOSButton.jsx'

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
  driver_arriving: 'Driver arriving',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  incident_review: 'Incident under review',
}

export default function DriverTripsPage() {
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyRide, setBusyRide] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadRides = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/v1/driver/rides')
      setRides(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Unable to load your assigned trips.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchRides() {
      try {
        const data = await apiRequest('/api/v1/driver/rides')
        if (!cancelled) setRides(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load your assigned trips.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchRides()
    return () => { cancelled = true }
  }, [])

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
      setNotice(`Trip #${ride.id} updated to ${statusLabels[status]}.`)
      await loadRides()
    } catch (err) {
      setError(err.message || 'Unable to update trip status.')
    } finally {
      setBusyRide(null)
    }
  }

  return (
    <AppPage title="Driver Trips">
      <main className="page-content">
        <section className="page-heading">
          <h1>My assigned trips</h1>
          <p>Manage your assigned EkiMove rides and update each trip as it progresses.</p>
          <button type="button" onClick={loadRides} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh trips'}
          </button>
        </section>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {loading ? (
          <p>Loading assigned trips…</p>
        ) : rides.length === 0 ? (
          <section>
            <h2>No assigned trips yet</h2>
            <p>New assignments will appear here. Refresh to check for updates.</p>
          </section>
        ) : (
          <section className="ride-list">
            {rides.map((ride) => (
              <article key={ride.id} className="ride-card">
                <h2>Trip #{ride.id}</h2>
                <p><strong>Pickup:</strong> {ride.origin_text}</p>
                <p><strong>Destination:</strong> {ride.destination_text}</p>
                <p><strong>Vehicle:</strong> {ride.vehicle_type}</p>
                <p><strong>Passengers:</strong> {ride.passenger_count}</p>
                <p>
                  <strong>Agreed fare:</strong>{' '}
                  ₦{Number(ride.agreed_fare).toLocaleString('en-NG')}
                </p>
                <p>
                  <strong>Status:</strong>{' '}
                  {statusLabels[ride.status] || ride.status}
                </p>

                <SOSButton rideId={ride.id} rideStatus={ride.status} />

                {nextStatus[ride.status] && (
                  <button
                    type="button"
                    onClick={() => advanceRide(ride)}
                    disabled={busyRide !== null}
                  >
                    {busyRide === ride.id
                      ? 'Updating…'
                      : actionLabels[ride.status]}
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
      </main>
    </AppPage>
  )
}
