import { useCallback, useEffect, useState } from 'react'
import { Camera, RefreshCw, ShieldCheck } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import { apiRequest, getAccessToken } from '../../services/authService.js'
import { initials } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const FILTERS = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
]

export default function AdminDriverVerificationPage() {
  const [applications, setApplications] = useState([])
  const [selectedStatus, setSelectedStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoDriverId, setPhotoDriverId] = useState(null)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = await apiRequest(`/api/v1/admin/driver-applications/pending?status=${selectedStatus}`)
      setApplications(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Unable to load driver applications.')
    } finally {
      setLoading(false)
    }
  }, [selectedStatus])

  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      setLoading(true)
      setError('')
      try {
        const data = await apiRequest(
          `/api/v1/admin/driver-applications/pending?status=${selectedStatus}`,
        )
        if (!cancelled) setApplications(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load driver applications.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialLoad()
    return () => { cancelled = true }
  }, [selectedStatus])

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])

  async function viewPhoto(driverId) {
    setBusy(`photo-${driverId}`)
    setError('')
    setMessage('')

    try {
      const token = getAccessToken()
      if (!token) throw new Error('Your session has expired. Please sign in again.')

      const apiBaseUrl = (
        import.meta.env.VITE_API_BASE_URL ||
        'https://ekimove-api.onrender.com'
      ).replace(/\/+$/, '')

      const response = await fetch(
        `${apiBaseUrl}/api/v1/admin/driver-applications/${driverId}/photo`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Admin access is required to view this photo.'
            : response.status === 404
              ? 'Photo not found on the API server. The uploaded file may be missing.'
              : 'Unable to load this driver photo.',
        )
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) {
        throw new Error('The API did not return an image. Check the photo endpoint.')
      }

      const blob = await response.blob()
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      setPhotoUrl(URL.createObjectURL(blob))
      setPhotoDriverId(driverId)
    } catch (err) {
      setError(err.message || 'Unable to load the photo.')
    } finally {
      setBusy('')
    }
  }

  function closePhoto() {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl('')
    setPhotoDriverId(null)
  }

  async function decideDriver(driverId, decision) {
    setBusy(`driver-${driverId}`)
    setError('')
    setMessage('')

    try {
      await apiRequest(
        `/api/v1/admin/driver-applications/${driverId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        },
      )
      setMessage(`Driver ${decision === 'approve' ? 'approved' : 'rejected'}. Vehicle approval is separate.`)
      if (photoDriverId === driverId) closePhoto()
      await loadApplications()
    } catch (err) {
      setError(err.message || 'Unable to save the driver decision.')
    } finally {
      setBusy('')
    }
  }

  async function decideVehicle(vehicleId, decision) {
    setBusy(`vehicle-${vehicleId}`)
    setError('')
    setMessage('')

    try {
      await apiRequest(
        `/api/v1/admin/driver-vehicles/${vehicleId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({ decision }),
        },
      )
      setMessage(`Vehicle ${decision === 'approve' ? 'approved' : 'approval revoked'}.`)
      await loadApplications()
    } catch (err) {
      setError(err.message || 'Unable to save the vehicle decision.')
    } finally {
      setBusy('')
    }
  }

  return (
    <AdminShell
      eyebrow="Trust"
      title="Driver verification"
      description="Review each driver and each vehicle. Approving a driver doesn't approve their vehicle."
      actions={
        <button type="button" className="btn btn-sm" onClick={loadApplications} disabled={loading || Boolean(busy)}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      <div className="stack">
        <div className="filter-pills" role="group" aria-label="Filter driver applications">
          {FILTERS.map(([status, label]) => (
            <button
              key={status}
              type="button"
              className="pill"
              aria-pressed={selectedStatus === status}
              disabled={loading || Boolean(busy)}
              onClick={() => setSelectedStatus(status)}
            >
              {label}
            </button>
          ))}
        </div>

        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>

        {loading && (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading applications…
          </div>
        )}

        {!loading && !error && applications.length === 0 && (
          <div className="card empty">
            <span className="empty-icon"><ShieldCheck size={28} aria-hidden="true" /></span>
            <h2>No applications</h2>
            <p className="muted">
              No {selectedStatus === 'all' ? '' : `${selectedStatus} `}driver applications found.
            </p>
          </div>
        )}

        {!loading && applications.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {applications.map((application) => (
              <article className="card stack" key={application.driver_id} aria-labelledby={`driver-${application.driver_id}`}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="avatar avatar-lg" aria-hidden="true">{initials(application.full_name)}</span>
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <h2 id={`driver-${application.driver_id}`} className="card-title">{application.full_name}</h2>
                    <p className="muted small">
                      Driver #{application.driver_id} · {application.phone || 'No phone'}
                    </p>
                  </div>
                  <StatusBadge status={application.verification_status} kind="verification" />
                </div>

                {photoDriverId === application.driver_id && photoUrl ? (
                  <div className="stack stack-sm">
                    <img
                      className="photo-preview"
                      src={photoUrl}
                      alt={`Private verification photo of ${application.full_name}`}
                    />
                    <div>
                      <button type="button" className="btn btn-sm" onClick={closePhoto}>
                        Close photo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={Boolean(busy) || !application.photo_available}
                      onClick={() => viewPhoto(application.driver_id)}
                    >
                      <Camera size={16} aria-hidden="true" />
                      {busy === `photo-${application.driver_id}`
                        ? 'Loading photo…'
                        : application.photo_available
                          ? 'View face photo'
                          : 'No photo uploaded'}
                    </button>
                  </div>
                )}

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(busy) || selectedStatus !== 'pending'}
                    onClick={() => decideDriver(application.driver_id, 'approve')}
                  >
                    Approve driver
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    disabled={Boolean(busy) || selectedStatus !== 'pending'}
                    onClick={() => decideDriver(application.driver_id, 'reject')}
                  >
                    Reject driver
                  </button>
                </div>

                <div className="stack stack-sm">
                  <h3 className="section-title" style={{ fontSize: 15 }}>Vehicles</h3>
                  {application.vehicles?.length ? (
                    application.vehicles.map((vehicle) => (
                      <div className="card card-outline stack stack-sm" key={vehicle.id} style={{ padding: 14 }}>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="choice-icon" aria-hidden="true" style={{ width: 40, height: 40 }}>
                            <VehicleIcon type={vehicle.vehicle_type} size={22} />
                          </span>
                          <div style={{ flexGrow: 1, minWidth: 0 }}>
                            <p style={{ fontWeight: 800 }}>{vehicleLabel(vehicle.vehicle_type)}</p>
                            <p className="muted small">
                              <span className="plate">{vehicle.plate_number}</span> · {vehicle.capacity} seats
                            </p>
                          </div>
                          <StatusBadge status={vehicle.is_approved ? 'approved' : 'pending'} kind="verification" />
                        </div>
                        <div className="row">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={Boolean(busy) || vehicle.is_approved}
                            onClick={() => decideVehicle(vehicle.id, 'approve')}
                          >
                            Approve vehicle
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-outline btn-sm"
                            disabled={Boolean(busy) || !vehicle.is_approved}
                            onClick={() => decideVehicle(vehicle.id, 'reject')}
                          >
                            Revoke approval
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="muted small">No vehicle details submitted.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
