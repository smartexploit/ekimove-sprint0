import { useCallback, useEffect, useState } from 'react'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

function formatNaira(value) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(value)
}

export default function AdminDispatchPage() {
  const [requests, setRequests] = useState([])
  const [driversByRequest, setDriversByRequest] = useState({})
  const [selectedDrivers, setSelectedDrivers] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyRequest, setBusyRequest] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadRequests = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await apiRequest('/api/v1/admin/ride-requests/pending')
      setRequests(data)
      setDriversByRequest({})
      setSelectedDrivers({})
    } catch (err) {
      setError(err.message || 'Could not load pending ride requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    Promise.resolve().then(() => {
      if (!cancelled) {
        loadRequests()
      }
    })

    return () => {
      cancelled = true
    }
  }, [loadRequests])

  async function loadEligibleDrivers(requestId) {
    setError('')
    setNotice('')
    try {
      const drivers = await apiRequest(
        `/api/v1/admin/ride-requests/${requestId}/eligible-drivers`,
      )
      setDriversByRequest((current) => ({ ...current, [requestId]: drivers }))
      if (drivers.length > 0) {
        setSelectedDrivers((current) => ({
          ...current,
          [requestId]: String(drivers[0].driver_id),
        }))
      }
    } catch (err) {
      setError(err.message || 'Could not load eligible drivers.')
    }
  }

  async function assignDriver(requestId) {
    const driverId = selectedDrivers[requestId]
    if (!driverId) {
      setError('Select an eligible driver before assigning this request.')
      return
    }

    setError('')
    setNotice('')
    setBusyRequest(requestId)
    try {
      const result = await apiRequest(
        `/api/v1/admin/ride-requests/${requestId}/assign`,
        {
          method: 'POST',
          body: JSON.stringify({ driver_id: Number(driverId) }),
        },
      )
      setNotice(`Request #${requestId} assigned successfully. Ride #${result.ride_id} created.`)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Assignment failed. Refresh and try again.')
    } finally {
      setBusyRequest(null)
    }
  }

  return (
    <AppPage
      eyebrow="OPERATIONS"
      title="Ride dispatch"
      description="Review pending ride requests and assign an eligible driver."
      sectionTitle="Pending requests"
      sectionText="Only approved, online drivers with a suitable approved vehicle can be assigned."
    >
      <div className="dispatch-toolbar">
        <span>{requests.length} pending request{requests.length === 1 ? '' : 's'}</span>
        <button type="button" className="dispatch-refresh" onClick={loadRequests} disabled={loading}>
          {loading ? 'Refreshing?' : 'Refresh queue'}
        </button>
      </div>

      {error && <p className="dispatch-message dispatch-error" role="alert">{error}</p>}
      {notice && <p className="dispatch-message dispatch-success" role="status">{notice}</p>}

      {loading ? (
        <p className="dispatch-empty">Loading pending requests?</p>
      ) : requests.length === 0 ? (
        <p className="dispatch-empty">No pending ride requests right now.</p>
      ) : (
        <div className="dispatch-list">
          {requests.map((request) => {
            const drivers = driversByRequest[request.id]
            return (
              <article className="dispatch-card" key={request.id}>
                <div className="dispatch-card-heading">
                  <div>
                    <span className="dispatch-request-id">REQUEST #{request.id}</span>
                    <h3>{request.origin_text} <span aria-hidden="true">?</span> {request.destination_text}</h3>
                  </div>
                  <span className="dispatch-status">{request.status}</span>
                </div>

                <dl className="dispatch-details">
                  <div><dt>Passenger</dt><dd>{request.passenger_name}</dd></div>
                  <div><dt>Vehicle</dt><dd>{request.vehicle_type}</dd></div>
                  <div><dt>Passengers</dt><dd>{request.passenger_count}</dd></div>
                  <div><dt>Quoted fare</dt><dd>{formatNaira(request.quoted_fare)}</dd></div>
                </dl>

                {!drivers ? (
                  <button
                    type="button"
                    className="dispatch-secondary"
                    onClick={() => loadEligibleDrivers(request.id)}
                  >
                    Find eligible drivers
                  </button>
                ) : drivers.length === 0 ? (
                  <p className="dispatch-no-drivers">
                    No eligible drivers are available for this request yet.
                  </p>
                ) : (
                  <div className="dispatch-assign-row">
                    <label htmlFor={`driver-${request.id}`}>Eligible driver</label>
                    <select
                      id={`driver-${request.id}`}
                      value={selectedDrivers[request.id] || ''}
                      onChange={(event) => setSelectedDrivers((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))}
                    >
                      {drivers.map((driver) => (
                        <option key={driver.driver_id} value={String(driver.driver_id)}>
                          {driver.full_name} ? {driver.vehicle_type}, {driver.plate_number} (capacity {driver.capacity})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="dispatch-primary"
                      onClick={() => assignDriver(request.id)}
                      disabled={busyRequest === request.id}
                    >
                      {busyRequest === request.id ? 'Assigning?' : 'Assign driver'}
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </AppPage>
  )
}
