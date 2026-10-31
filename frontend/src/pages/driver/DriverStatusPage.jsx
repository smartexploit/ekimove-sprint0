import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Ban, Clock3, XCircle } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import ProfileStrip from '../../components/ProfileStrip.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import { apiRequest } from '../../services/authService.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const statusCopy = {
  pending: {
    title: 'Your application is under review',
    detail: "We're checking your details. You can't accept rides until your profile and vehicle are approved.",
    icon: Clock3,
    colors: ['var(--gold-100)', 'var(--gold-700)'],
  },
  approved: {
    title: "You're approved to drive",
    detail: 'Your driver profile is approved. A vehicle must also be approved before you can take rides.',
    icon: BadgeCheck,
    colors: ['var(--green-100)', 'var(--green-800)'],
  },
  rejected: {
    title: 'Application not approved',
    detail: 'Your application was not approved. Please contact EkiMove support through an official channel for next steps.',
    icon: XCircle,
    colors: ['var(--laterite-100)', 'var(--laterite-700)'],
  },
  suspended: {
    title: 'Driver account suspended',
    detail: 'Your driver account is currently suspended and cannot accept rides.',
    icon: Ban,
    colors: ['var(--laterite-100)', 'var(--laterite-700)'],
  },
}

export default function DriverStatusPage() {
  const [application, setApplication] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [updatingOnline, setUpdatingOnline] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    apiRequest('/api/v1/driver-applications/me')
      .then((data) => {
        if (!cancelled) {
          setApplication(data)
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load your driver status.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey])

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
      setActionError(err.message || 'Unable to update your online status.')
    } finally {
      setUpdatingOnline(false)
    }
  }

  const vehicles = application?.vehicles || []
  const hasApprovedVehicle = vehicles.some((vehicle) => vehicle.is_approved)
  const canGoOnline =
    application?.verification_status === 'approved' && hasApprovedVehicle

  const status = statusCopy[application?.verification_status] || {
    title: 'Status unavailable',
    detail: "We couldn't identify your review status. Please try again later.",
    icon: Clock3,
    colors: ['var(--mist)', 'var(--ink-500)'],
  }
  const StatusIcon = status.icon

  return (
    <AppShell title="My driver status" description="Your review, vehicles and availability.">
      <div style={{ marginBottom: 16 }}><ProfileStrip /></div>
      {loading && (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Loading your status…
        </div>
      )}

      {!loading && error && (
        <div className="stack">
          <Alert tone="error">{error}</Alert>
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setLoading(true)
                setReloadKey((value) => value + 1)
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {application && (
        <div className="two-col" aria-live="polite">
          <div className="stack">
            <div className="online-card">
              <span className={`online-dot ${application.is_online ? 'is-on' : ''}`} aria-hidden="true" />
              <div style={{ flexGrow: 1 }}>
                <p style={{ fontWeight: 800, fontSize: 17 }}>
                  {application.is_online ? "You're online" : "You're offline"}
                </p>
                <p className="small" style={{ color: '#a9c9ba' }}>
                  {canGoOnline
                    ? application.is_online
                      ? 'You can receive ride assignments.'
                      : 'Go online to receive ride assignments.'
                    : 'Going online needs an approved profile and an approved vehicle.'}
                </p>
              </div>
              {canGoOnline && (
                <button
                  type="button"
                  className={`btn btn-sm ${application.is_online ? 'btn-on-dark' : 'btn-gold'}`}
                  onClick={changeOnlineStatus}
                  disabled={updatingOnline}
                  aria-pressed={application.is_online}
                >
                  {updatingOnline
                    ? 'Updating…'
                    : application.is_online
                      ? 'Go offline'
                      : 'Go online'}
                </button>
              )}
            </div>

            <Alert tone="error">{actionError}</Alert>
            <Alert tone="success">{actionMessage}</Alert>

            <div className="status-hero">
              <span
                className="status-hero-icon"
                style={{ background: status.colors[0], color: status.colors[1] }}
              >
                <StatusIcon size={26} aria-hidden="true" />
              </span>
              <div className="stack stack-sm">
                <div className="row" style={{ gap: 8 }}>
                  <h2 className="card-title">{status.title}</h2>
                </div>
                <p className="muted">{status.detail}</p>
                {['rejected', 'suspended'].includes(application.verification_status) && (
                  <SupportContacts className="stack stack-sm" linkClassName="contact-link text-link" />
                )}
                {canGoOnline && (
                  <div>
                    <Link className="btn btn-primary btn-sm" to="/driver/trips">
                      View my trips
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          <section className="stack stack-sm" aria-labelledby="vehicles-title">
            <h2 id="vehicles-title" className="section-title" style={{ padding: '0 4px' }}>
              My vehicles
            </h2>
            {vehicles.length === 0 ? (
              <p className="card muted small">No vehicle is listed on your application.</p>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {vehicles.map((vehicle) => (
                  <li className="list-item" key={vehicle.plate_number}>
                    <span className="choice-icon" aria-hidden="true">
                      <VehicleIcon type={vehicle.vehicle_type} />
                    </span>
                    <div className="list-item-main">
                      <p className="list-item-title">{vehicleLabel(vehicle.vehicle_type)}</p>
                      <p className="list-item-meta">
                        <span className="plate">{vehicle.plate_number}</span> · {vehicle.capacity}{' '}
                        {vehicle.capacity === 1 ? 'seat' : 'seats'}
                      </p>
                    </div>
                    <StatusBadge status={vehicle.is_approved ? 'approved' : 'pending'} kind="verification" />
                  </li>
                ))}
              </ul>
            )}
            {vehicles.length > 0 && !hasApprovedVehicle && (
              <p className="muted small" style={{ padding: '0 4px' }}>
                Your vehicle hasn't been approved yet, so you can't accept rides.
              </p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
