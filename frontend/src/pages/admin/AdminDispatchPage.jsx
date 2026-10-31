import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Route } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatNaira } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

export default function AdminDispatchPage() {
  const [requests, setRequests] = useState([])
  const [driversByRequest, setDriversByRequest] = useState({})
  const [selectedDrivers, setSelectedDrivers] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyRequest, setBusyRequest] = useState(null)
  const [findingFor, setFindingFor] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadRequests = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await apiRequest('/api/v1/admin/ride-requests/pending')
      setRequests(Array.isArray(data) ? data : [])
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
    setFindingFor(requestId)
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
    } finally {
      setFindingFor(null)
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
      setNotice(`Request #${requestId} assigned. Ride #${result.ride_id} created (plate ${result.plate_number}).`)
      await loadRequests()
    } catch (err) {
      setError(err.message || 'Assignment failed. Refresh and try again.')
    } finally {
      setBusyRequest(null)
    }
  }

  return (
    <AdminShell
      title="Ride dispatch"
      description="Only approved, online drivers with a suitable approved vehicle are listed."
      actions={
        <button type="button" className="btn btn-sm" onClick={loadRequests} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh queue'}
        </button>
      }
    >
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        <section className="card" style={{ padding: 0 }} aria-labelledby="pending-title">
          <div className="row" style={{ padding: '18px 20px' }}>
            <h2 id="pending-title" className="section-title">Pending requests</h2>
            {!loading && (
              <span className={`badge ${requests.length ? 'badge-gold' : ''}`}>
                {requests.length} waiting
              </span>
            )}
          </div>

          {loading ? (
            <div className="loading-block" role="status">
              <span className="spinner" aria-hidden="true" /> Loading pending requests…
            </div>
          ) : requests.length === 0 ? (
            <div className="empty">
              <span className="empty-icon"><Route size={28} aria-hidden="true" /></span>
              <h3>All caught up</h3>
              <p className="muted">No ride requests are waiting for a driver.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 940 }}>
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Route</th>
                    <th scope="col">Vehicle</th>
                    <th scope="col">Riders</th>
                    <th scope="col">Fare</th>
                    <th scope="col">Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => {
                    const drivers = driversByRequest[request.id]
                    return (
                      <tr key={request.id}>
                        <td>
                          <p style={{ fontWeight: 800 }}>#{request.id}</p>
                          <p className="muted small">{request.passenger_name}</p>
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {request.origin_text} → {request.destination_text}
                        </td>
                        <td>{vehicleLabel(request.vehicle_type)}</td>
                        <td>{request.passenger_count}</td>
                        <td className="money" style={{ color: 'var(--green-800)' }}>
                          {formatNaira(request.quoted_fare, { decimals: 0 })}
                        </td>
                        <td style={{ minWidth: 300 }}>
                          {!drivers ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => loadEligibleDrivers(request.id)}
                              disabled={findingFor === request.id}
                            >
                              {findingFor === request.id ? 'Finding drivers…' : 'Find eligible drivers'}
                            </button>
                          ) : drivers.length === 0 ? (
                            <p className="small" style={{ fontWeight: 700, color: 'var(--laterite-700)' }}>
                              No eligible drivers online yet
                            </p>
                          ) : (
                            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                              <label className="sr-only" htmlFor={`driver-${request.id}`}>
                                Driver for request #{request.id}
                              </label>
                              <select
                                id={`driver-${request.id}`}
                                className="select"
                                style={{ minHeight: 42 }}
                                value={selectedDrivers[request.id] || ''}
                                onChange={(event) => setSelectedDrivers((current) => ({
                                  ...current,
                                  [request.id]: event.target.value,
                                }))}
                              >
                                {drivers.map((driver) => (
                                  <option key={driver.driver_id} value={String(driver.driver_id)}>
                                    {driver.full_name} · {driver.plate_number} ({driver.capacity} seats)
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => assignDriver(request.id)}
                                disabled={busyRequest === request.id}
                              >
                                {busyRequest === request.id ? 'Assigning…' : 'Assign'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  )
}
