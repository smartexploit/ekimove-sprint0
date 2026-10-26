
import { useCallback, useEffect, useState } from 'react'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest, getAccessToken } from '../../services/authService.js'

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
      setError(err.message || 'Unable to load pending driver applications.')
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

      const response = await fetch(
        `/api/v1/admin/driver-applications/${driverId}/photo`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Admin access is required to view this photo.'
            : 'Unable to load this driver photo.',
        )
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

  async function decideDriver(driverId, decision) {
    const label = `driver-${driverId}`
    setBusy(label)
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
      setMessage(`Driver application ${decision === 'approve' ? 'approved' : 'rejected'}. Vehicle approval remains separate.`)
      if (photoDriverId === driverId) {
        if (photoUrl) URL.revokeObjectURL(photoUrl)
        setPhotoUrl('')
        setPhotoDriverId(null)
      }
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
      setMessage(`Vehicle ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      await loadApplications()
    } catch (err) {
      setError(err.message || 'Unable to save the vehicle decision.')
    } finally {
      setBusy('')
    }
  }

  return (
    <AppPage
      eyebrow="EKIMOVE ADMIN"
      title="Driver verification"
      description="Review driver applications and assess vehicle eligibility separately."
      sectionTitle="Driver applications"
      sectionText="Approving a driver does not automatically approve their vehicle."
    >
      <div className="form-stack">
        <div role="group" aria-label="Filter driver applications"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            ['pending', 'Pending'],
            ['approved', 'Approved'],
            ['rejected', 'Rejected'],
            ['all', 'All'],
          ].map(([status, label]) => (
            <button
              key={status}
              type="button"
              aria-pressed={selectedStatus === status}
              disabled={loading || Boolean(busy)}
              onClick={() => setSelectedStatus(status)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={loadApplications} disabled={loading || Boolean(busy)}>
          {loading ? 'Loading…' : 'Refresh applications'}
        </button>

        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}

        {loading && <p>Loading pending applications…</p>}
        {!loading && !error && applications.length === 0 && (
          <p>No {selectedStatus === 'all' ? '' : selectedStatus + ' '}driver applications found.</p>
        )}

        {applications.map((application) => (
          <article
            key={application.driver_id}
            style={{
              border: '1px solid #d9e2ec',
              borderRadius: 12,
              padding: 18,
              marginTop: 16,
            }}
          >
            <h3>{application.full_name}</h3>
            <p>Driver ID: {application.driver_id}</p>
            <p>Phone: {application.phone || 'Unavailable'}</p>
            <p>Driver review: {application.verification_status}</p>

            <button
              type="button"
              disabled={Boolean(busy) || !application.photo_available}
              onClick={() => viewPhoto(application.driver_id)}
            >
              {busy === `photo-${application.driver_id}` ? 'Loading photo…' : 'View private face photo'}
            </button>

            {photoDriverId === application.driver_id && photoUrl && (
              <div style={{ marginTop: 12 }}>
                <img
                  src={photoUrl}
                  alt={`Private verification photo for ${application.full_name}`}
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    width: 240,
                    borderRadius: 8,
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(photoUrl)
                    setPhotoUrl('')
                    setPhotoDriverId(null)
                  }}
                >
                  Close photo
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button
                type="button"
                disabled={Boolean(busy) || selectedStatus !== 'pending'}
                onClick={() => decideDriver(application.driver_id, 'approve')}
              >
                Approve driver
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || selectedStatus !== 'pending'}
                onClick={() => decideDriver(application.driver_id, 'reject')}
              >
                Reject driver
              </button>
            </div>

            <h4>Vehicle review</h4>
            {application.vehicles?.length ? (
              application.vehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  style={{
                    borderTop: '1px solid #e5e7eb',
                    paddingTop: 10,
                    marginTop: 10,
                  }}
                >
                  <p>Type: {vehicle.vehicle_type}</p>
                  <p>Plate: {vehicle.plate_number}</p>
                  <p>Capacity: {vehicle.capacity}</p>
                  <p>Vehicle approval: {vehicle.is_approved ? 'Approved' : 'Pending approval'}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={Boolean(busy) || vehicle.is_approved}
                      onClick={() => decideVehicle(vehicle.id, 'approve')}
                    >
                      Approve vehicle
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy) || !vehicle.is_approved}
                      onClick={() => decideVehicle(vehicle.id, 'reject')}
                    >
                      Revoke vehicle approval
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p>No vehicle information submitted.</p>
            )}
          </article>
        ))}
      </div>
    </AppPage>
  )
}
