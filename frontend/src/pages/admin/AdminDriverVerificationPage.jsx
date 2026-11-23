import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Camera, Pencil, RefreshCw, ShieldCheck, UserX } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import DriverInviteForm from '../../components/admin/DriverInviteForm.jsx'
import { INVITE_KINDS } from '../../utils/driverOnboarding.js'
import { apiRequest, getAccessToken } from '../../services/authService.js'
import { initials } from '../../utils/format.js'
import { MOVING_VEHICLES, SEAT_LIMITS, vehicleGroup, vehicleLabel } from '../../utils/vehicles.js'

const INVITE_STATUS = {
  invited: 'Invited, no answer yet',
  confirmed: 'Confirmed',
  reschedule: 'Asked for another time',
  attended: 'Attended',
  missed: 'Missed',
  cancelled: 'Cancelled',
}
const OPEN_INVITES = ['invited', 'confirmed', 'reschedule']

function formatDob(value) {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function DetailsList({ application }) {
  const d = application.details || {}
  const rows = [
    ['Gender', d.gender ? d.gender[0].toUpperCase() + d.gender.slice(1) : ''],
    ['Age', d.age != null ? `${d.age} (born ${formatDob(d.date_of_birth)})` : ''],
    ['Town', d.town],
    ['Address', d.home_address],
    ['Licence no.', d.licence_number],
    ['Emergency contact', d.emergency_contact_name ? `${d.emergency_contact_name} · ${d.emergency_contact_phone}` : ''],
    ['Email', application.email],
    ['Safety promises', d.safety_pledged_at ? 'All ticked' : ''],
  ]
  return (
    <dl className="detail-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || <span className="muted">Not given</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

const GROUP_LABELS = { motorcycle: 'Motorcycle', car: 'Car', moving: 'Moving vehicle', bus: 'Travel bus', other: 'Other (old type)' }
const VEHICLE_FILTERS = [
  ['all', 'All vehicles'],
  ['motorcycle', 'Motorcycles'],
  ['car', 'Cars'],
  ['moving', 'Moving vehicles'],
  ['bus', 'Travel buses'],
]
const TYPE_OPTIONS = [
  ['motorcycle', 'Motorcycle'],
  ['car', 'Car'],
  ...MOVING_VEHICLES.map(([value, label]) => [value, `Moving: ${label}`]),
  ['bus', 'Travel bus'],
]

/** Correct a vehicle's type, plate or seats (e.g. a car saved as a motorcycle). */
function VehicleEditor({ vehicle, onSaved, onCancel }) {
  const known = TYPE_OPTIONS.some(([value]) => value === vehicle.vehicle_type)
  const [type, setType] = useState(known ? vehicle.vehicle_type : '')
  const [plate, setPlate] = useState(vehicle.plate_number)
  const [seats, setSeats] = useState(String(vehicle.capacity))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/v1/admin/driver-vehicles/${vehicle.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ vehicle_type: type, plate_number: plate, capacity: Number(seats) }),
      })
      onSaved(`${vehicleLabel(type)} ${plate.toUpperCase()} saved.`)
    } catch (err) {
      setError(err.message || 'Could not save the vehicle.')
      setSaving(false)
    }
  }

  return (
    <form className="stack stack-sm" onSubmit={save}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Vehicle type</span>
          <select className="select" value={type} required
            onChange={(event) => {
              setType(event.target.value)
              setSeats((s) => String(Math.min(Number(s) || 1, SEAT_LIMITS[event.target.value] || 8)))
            }}>
            <option value="" disabled>Choose one</option>
            {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Plate number</span>
          <input className="input" value={plate} maxLength={15} required
            onChange={(event) => setPlate(event.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span className="field-label">Passenger seats</span>
          <input className="input" type="number" min="1" max={SEAT_LIMITS[type] || 8} value={seats} required
            onChange={(event) => setSeats(event.target.value)} />
        </label>
      </div>
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !type}>
          {saving ? 'Saving…' : 'Save vehicle'}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  )
}

/** Remove a driver for good, with a reason kept in the audit log. */
function RemoveDriver({ application, onRemoved, onCancel }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function remove(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/v1/admin/drivers/${application.driver_id}/remove`, {
        method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
      })
      onRemoved(`${application.full_name} has been removed. Their past trips and payments stay on record.`)
    } catch (err) {
      setError(err.message || 'Could not remove the driver.')
      setSaving(false)
    }
  }

  return (
    <form className="remove-driver stack stack-sm" onSubmit={remove}>
      <p style={{ fontWeight: 700 }}>Remove {application.full_name}?</p>
      <p className="small muted">
        They’re signed out, can’t sign in or go online again, and their personal details are cleared.
        Their phone number and plate become free to register again. This can’t be undone.
      </p>
      <label className="field">
        <span className="field-label">Reason (kept in the audit log)</span>
        <input className="input" value={reason} minLength={3} maxLength={500} required autoFocus
          onChange={(event) => setReason(event.target.value)} placeholder="e.g. Failed vehicle inspection" />
      </label>
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="submit" className="btn btn-danger btn-sm" disabled={saving || reason.trim().length < 3}>
          {saving ? 'Removing…' : 'Remove driver'}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel} disabled={saving}>Keep driver</button>
      </div>
    </form>
  )
}

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
  const [inviting, setInviting] = useState(null) // array of driver ids
  const [selected, setSelected] = useState([])
  const [reasons, setReasons] = useState({})
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [removing, setRemoving] = useState(null)

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
          body: JSON.stringify({ decision, reason: decision === 'reject' ? (reasons[driverId] || '').trim() || null : null }),
        },
      )
      setMessage(`Driver ${decision === 'approve' ? 'approved' : 'rejected'} and told by notification, inbox and email. Vehicle approval is separate.`)
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

  async function setOutcome(inviteId, status) {
    setBusy(`invite-${inviteId}`)
    setError('')
    setMessage('')
    try {
      await apiRequest(`/api/v1/admin/driver-invitations/${inviteId}/outcome`, {
        method: 'POST', body: JSON.stringify({ status }),
      })
      setMessage(status === 'cancelled' ? 'Invitation cancelled and the driver told.' : `Marked as ${status}.`)
      await loadApplications()
    } catch (err) {
      setError(err.message || 'Could not update the invitation.')
    } finally {
      setBusy('')
    }
  }

  function invitationsDone(result) {
    setInviting(null)
    setSelected([])
    setMessage(`Invitation sent to ${result.invited} driver${result.invited === 1 ? '' : 's'}.`)
    loadApplications()
  }

  function changed(text) {
    setEditingVehicle(null)
    setRemoving(null)
    setError('')
    setMessage(text)
    loadApplications()
  }

  const shown = vehicleFilter === 'all'
    ? applications
    : applications.filter((a) => (a.vehicles || []).some((v) => vehicleGroup(v.vehicle_type) === vehicleFilter))

  const toggle = (id) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const bulkInvite = inviting && inviting.length > 1

  return (
    <AdminShell
      eyebrow="Trust"
      title="Driver verification"
      description="Review every application within 72 hours. Invite drivers for inspection and orientation, then approve the driver and the vehicle separately."
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

        <div className="filter-pills" role="group" aria-label="Filter by vehicle">
          {VEHICLE_FILTERS.map(([group, label]) => (
            <button key={group} type="button" className="pill" aria-pressed={vehicleFilter === group}
              onClick={() => setVehicleFilter(group)}>
              {label}
              {!loading && group !== 'all' && (
                <> ({applications.filter((a) => (a.vehicles || []).some((v) => vehicleGroup(v.vehicle_type) === group)).length})</>
              )}
            </button>
          ))}
        </div>

        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>

        {selectedStatus === 'pending' && applications.length > 0 && !bulkInvite && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="muted small">
              {selected.length ? `${selected.length} selected` : 'Tick drivers to invite them to the same session.'}
            </p>
            <div className="row">
              {selected.length > 0 && (
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected([])}>Clear</button>
              )}
              <button type="button" className="btn btn-sm btn-primary" disabled={!selected.length || Boolean(busy)}
                onClick={() => setInviting(selected)}>
                <CalendarPlus size={16} aria-hidden="true" /> Invite selected
              </button>
            </div>
          </div>
        )}
        {bulkInvite && (
          <DriverInviteForm driverIds={inviting} onDone={invitationsDone} onCancel={() => setInviting(null)} />
        )}

        {loading && (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading applications…
          </div>
        )}

        {!loading && !error && applications.length > 0 && shown.length === 0 && (
          <p className="muted">No {selectedStatus === 'all' ? '' : `${selectedStatus} `}drivers with this kind of vehicle.</p>
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
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))' }}>
            {shown.map((application) => (
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

                {application.verification_status === 'pending' && (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className={`due-chip ${application.review_overdue ? 'is-late' : ''}`}>
                      {application.review_overdue
                        ? `Overdue: was due ${application.review_due_label}`
                        : application.review_due_label ? `Review by ${application.review_due_label}` : 'No deadline set'}
                    </span>
                    <label className="check-row" style={{ margin: 0 }}>
                      <input type="checkbox" checked={selected.includes(application.driver_id)}
                        onChange={() => toggle(application.driver_id)}
                        aria-label={`Select ${application.full_name} for a group invitation`} />
                      <span className="small">Select</span>
                    </label>
                  </div>
                )}

                <DetailsList application={application} />
                {application.details_missing?.length > 0 && (
                  <p className="small" style={{ color: 'var(--laterite-700)' }}>
                    Missing: {application.details_missing.join(', ')}. The driver is asked to add them in the app.
                  </p>
                )}

                <div className="stack stack-sm">
                  <h3 className="section-title" style={{ fontSize: 15 }}>Inspection and orientation</h3>
                  {application.invitations?.length ? application.invitations.slice(0, 3).map((invite) => (
                    <div className="invite-row" key={invite.id}>
                      <p style={{ fontWeight: 700 }}>{INVITE_KINDS[invite.kind]} · {invite.scheduled_label}</p>
                      <p className="muted small">{invite.venue} · <strong>{INVITE_STATUS[invite.status]}</strong></p>
                      {invite.driver_note && <p className="small">Driver: “{invite.driver_note}”</p>}
                      {(OPEN_INVITES.includes(invite.status) || ['attended', 'missed'].includes(invite.status)) && (
                        <div className="row" style={{ marginTop: 6 }}>
                          {invite.status !== 'attended' && (
                            <button type="button" className="btn btn-sm" disabled={Boolean(busy)}
                              onClick={() => setOutcome(invite.id, 'attended')}>Attended</button>
                          )}
                          {invite.status !== 'missed' && (
                            <button type="button" className="btn btn-sm" disabled={Boolean(busy)}
                              onClick={() => setOutcome(invite.id, 'missed')}>Missed</button>
                          )}
                          {OPEN_INVITES.includes(invite.status) && (
                            <button type="button" className="btn btn-sm btn-quiet" disabled={Boolean(busy)}
                              onClick={() => setOutcome(invite.id, 'cancelled')}>Cancel</button>
                          )}
                        </div>
                      )}
                    </div>
                  )) : <p className="muted small">Not invited yet.</p>}
                  {inviting?.length === 1 && inviting[0] === application.driver_id ? (
                    <DriverInviteForm driverIds={inviting} names={[application.full_name]} onDone={invitationsDone}
                      onCancel={() => setInviting(null)} />
                  ) : (
                    <div>
                      <button type="button" className="btn btn-sm" disabled={Boolean(busy)}
                        onClick={() => setInviting([application.driver_id])}>
                        <CalendarPlus size={16} aria-hidden="true" />
                        {application.invitations?.some((i) => OPEN_INVITES.includes(i.status)) ? 'Send a new time' : 'Invite'}
                      </button>
                    </div>
                  )}
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

                {application.verification_status === 'pending' && (
                  <label className="field">
                    <span className="field-label">Reason if you reject (sent to the driver)</span>
                    <input className="input" maxLength={300} value={reasons[application.driver_id] || ''}
                      onChange={(event) => setReasons((r) => ({ ...r, [application.driver_id]: event.target.value }))}
                      placeholder="e.g. The face photo is blurred. Please apply again." />
                  </label>
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
                            <p style={{ fontWeight: 800 }}>
                              {vehicleGroup(vehicle.vehicle_type) === 'moving'
                                ? `Moving vehicle · ${vehicleLabel(vehicle.vehicle_type)}`
                                : vehicleGroup(vehicle.vehicle_type) === 'other'
                                  ? `${vehicleLabel(vehicle.vehicle_type)} (old type: correct it)`
                                  : GROUP_LABELS[vehicleGroup(vehicle.vehicle_type)]}
                            </p>
                            <p className="muted small">
                              <span className="plate">{vehicle.plate_number}</span> · {vehicle.capacity} {vehicle.capacity === 1 ? 'seat' : 'seats'}
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
                          {editingVehicle !== vehicle.id && (
                            <button type="button" className="btn btn-sm" disabled={Boolean(busy)}
                              onClick={() => setEditingVehicle(vehicle.id)}>
                              <Pencil size={16} aria-hidden="true" /> Correct details
                            </button>
                          )}
                        </div>
                        {editingVehicle === vehicle.id && (
                          <VehicleEditor vehicle={vehicle} onSaved={changed} onCancel={() => setEditingVehicle(null)} />
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted small">No vehicle details submitted.</p>
                  )}
                </div>

                {removing === application.driver_id ? (
                  <RemoveDriver application={application} onRemoved={changed} onCancel={() => setRemoving(null)} />
                ) : (
                  <div className="remove-driver-row">
                    <button type="button" className="btn btn-danger-outline btn-sm" disabled={Boolean(busy)}
                      onClick={() => setRemoving(application.driver_id)}>
                      <UserX size={16} aria-hidden="true" /> Remove driver
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
