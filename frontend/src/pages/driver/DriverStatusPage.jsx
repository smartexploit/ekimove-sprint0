import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

const statusCopy = {
  pending: {
    title: 'Application under review',
    detail: 'Your driver profile is awaiting review. You cannot accept rides until approval is complete.',
  },
  approved: {
    title: 'Driver profile approved',
    detail: 'Your driver profile has been approved. Your vehicle must also be approved before it can be used for rides.',
  },
  rejected: {
    title: 'Application not approved',
    detail: 'Your application was not approved. Please contact EkiMove support through its official channel for next steps.',
  },
  suspended: {
    title: 'Driver account suspended',
    detail: 'Your driver account is currently suspended and cannot accept rides.',
  },
}

export default function DriverStatusPage() {
  const [application, setApplication] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatingOnline, setUpdatingOnline] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    apiRequest('/api/v1/driver-applications/me')
      .then((data) => {
        if (!cancelled) setApplication(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load application status.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function changeOnlineStatus() {
    if (!application || updatingOnline) return

    const nextOnline = !application.is_online
    setUpdatingOnline(true)
    setActionError('')
    setActionMessage('')

    try {
      const result = await apiRequest('/api/v1/driver-applications/me/online', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_online: nextOnline }),
      })

      setApplication((current) => ({
        ...current,
        is_online: result.is_online,
      }))
      setActionMessage(result.message || 'Online status updated.')
    } catch (err) {
      setActionError(err.message || 'Unable to update online status.')
    } finally {
      setUpdatingOnline(false)
    }
  }

  const canGoOnline =
    application?.verification_status === 'approved' &&
    application?.vehicles?.some((vehicle) => vehicle.is_approved)

  const status = statusCopy[application?.verification_status] || {
    title: 'Status unavailable',
    detail: 'Your current review status could not be identified. Please try again later.',
  }

  return (
    <AppPage
      eyebrow="DRIVER PORTAL"
      title="Your driver application"
      description="Track the review status of your driver profile and registered vehicle."
      sectionTitle={loading ? 'Loading status…' : status.title}
      sectionText={loading ? 'Retrieving your latest status.' : status.detail}
    >
      {error && <p className="auth-error" role="alert">{error}</p>}

      {application && (
        <div aria-live="polite">
          <p>
            <strong>Driver review:</strong>{' '}
            {application.verification_status}
          </p>
          <p>
            <strong>Online status:</strong>{' '}
            {application.is_online ? 'Online' : 'Offline'}
          </p>

          {application.verification_status === 'approved' &&
            application.vehicles.some((vehicle) => vehicle.is_approved) && (
              <p>
                <a className="button" href="/driver/trips">
                  View my assigned trips
                </a>
              </p>
            )}

          {actionError && <p className="auth-error" role="alert">{actionError}</p>}
          {actionMessage && <p role="status">{actionMessage}</p>}

          {canGoOnline ? (
            <button
              type="button"
              onClick={changeOnlineStatus}
              disabled={updatingOnline}
            >
              {updatingOnline
                ? 'Updating…'
                : application.is_online
                  ? 'Go offline'
                  : 'Go online'}
            </button>
          ) : (
            <p>Going online requires an approved driver profile and at least one approved vehicle.</p>
          )}

          {canGoOnline && (
            <p><Link to="/driver/trips">View my assigned trips</Link></p>
          )}

          <h3>Registered vehicles</h3>
          {application.vehicles.length === 0 ? (
            <p>No vehicle is currently listed on your application.</p>
          ) : (
            <ul>
              {application.vehicles.map((vehicle) => (
                <li key={vehicle.plate_number}>
                  <strong>{vehicle.vehicle_type}</strong>
                  {' — '}{vehicle.plate_number}
                  {' — '}{vehicle.is_approved ? 'Approved' : 'Awaiting approval'}
                  {' — capacity: '}{vehicle.capacity}
                </li>
              ))}
            </ul>
          )}

          {!application.vehicles.some((vehicle) => vehicle.is_approved) && (
            <p>Your vehicle has not been approved. You cannot accept rides yet.</p>
          )}
        </div>
      )}

      {!loading && error && (
        <button type="button" onClick={() => window.location.reload()}>
          Retry
        </button>
      )}
    </AppPage>
  )
}
