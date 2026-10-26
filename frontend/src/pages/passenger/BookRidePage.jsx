
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

export default function BookRidePage() {
  const [zones, setZones] = useState([])
  const [fareOptions, setFareOptions] = useState([])
  const [loadingZones, setLoadingZones] = useState(true)
  const [loadingFareOptions, setLoadingFareOptions] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ride, setRide] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    origin_zone_id: '',
    destination_zone_id: '',
    origin_text: '',
    destination_text: '',
    vehicle_type: '',
    passenger_count: '1',
  })

  useEffect(() => {
    let active = true

    apiRequest('/api/v1/zones')
      .then((data) => {
        if (active) setZones(data)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingZones(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    if (
      !form.origin_zone_id ||
      !form.destination_zone_id ||
      form.origin_zone_id === form.destination_zone_id
    ) {
      return () => {
        active = false
      }
    }

    apiRequest(
      `/api/v1/fare-options?origin_zone_id=${encodeURIComponent(form.origin_zone_id)}&destination_zone_id=${encodeURIComponent(form.destination_zone_id)}`,
    )
      .then((options) => {
        if (!active) return

        setFareOptions(options)
        setForm((current) => ({
          ...current,
          vehicle_type: options.includes(current.vehicle_type)
            ? current.vehicle_type
            : options[0] || '',
        }))
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingFareOptions(false)
      })

    return () => {
      active = false
    }
  }, [form.origin_zone_id, form.destination_zone_id])

  function updateField(event) {
    const { name, value } = event.target
    const zoneChanged =
      name === 'origin_zone_id' || name === 'destination_zone_id'

    setForm((current) => {
      const next = { ...current, [name]: value }

      if (zoneChanged) {
        next.vehicle_type = ''
      }

      if (
        name === 'vehicle_type' &&
        ['motorcycle', 'motorbike'].includes(value.toLowerCase())
      ) {
        next.passenger_count = '1'
      }

      return next
    })

    if (zoneChanged) {
      const originId =
        name === 'origin_zone_id' ? value : form.origin_zone_id
      const destinationId =
        name === 'destination_zone_id' ? value : form.destination_zone_id

      setFareOptions([])
      setLoadingFareOptions(
        Boolean(originId && destinationId && originId !== destinationId),
      )
    }

    setError('')
    setMessage('')
    setRide(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setRide(null)

    if (!form.origin_zone_id || !form.destination_zone_id) {
      setError('Choose both a pickup zone and a destination zone.')
      return
    }

    if (form.origin_zone_id === form.destination_zone_id) {
      setError('Choose different pickup and destination zones.')
      return
    }

    if (!fareOptions.includes(form.vehicle_type)) {
      setError('Choose an available vehicle for this route.')
      return
    }

    setSubmitting(true)

    try {
      const result = await apiRequest('/api/v1/ride-requests', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          origin_zone_id: Number(form.origin_zone_id),
          destination_zone_id: Number(form.destination_zone_id),
          passenger_count: Number(form.passenger_count),
        }),
      })

      setRide(result)
      setMessage(
        'Your ride request has been submitted. It is requested, not yet confirmed.',
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const motorcycleSelected = ['motorcycle', 'motorbike'].includes(
    form.vehicle_type.toLowerCase(),
  )

  if (ride) {
    const originZone = zones.find(
      (zone) => String(zone.id) === String(ride.origin_zone_id),
    )
    const destinationZone = zones.find(
      (zone) => String(zone.id) === String(ride.destination_zone_id),
    )

    return (
      <AppPage
        eyebrow="RIDE REQUEST"
        title="Your request has been submitted"
        description="Your ride request is recorded. You can review its details below."
        sectionTitle="Request confirmation"
        sectionText="Your ride is requested and is waiting for confirmation. Do not make a payment based on this screen alone."
      >
        <section className="ride-result" aria-live="polite">
          <h3>Request received</h3>
          <p>
            Request number: <strong>#{ride.id}</strong>
          </p>
          <p>
            Status: <strong>{ride.status || 'requested'}</strong>
          </p>
          <p>
            Pickup zone: <strong>{originZone?.name || 'Selected zone'}</strong>
          </p>
          <p>
            Pickup landmark: <strong>{ride.origin_text}</strong>
          </p>
          <p>
            Destination zone:{' '}
            <strong>{destinationZone?.name || 'Selected zone'}</strong>
          </p>
          <p>
            Destination landmark: <strong>{ride.destination_text}</strong>
          </p>
          <p>
            Vehicle: <strong>{ride.vehicle_type}</strong>
          </p>
          <p>
            Passengers: <strong>{ride.passenger_count}</strong>
          </p>
          <p>
            Quoted fare:{' '}
            <strong>
              {ride.currency || 'NGN'}{' '}
              {Number(ride.quoted_fare).toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>
          </p>
          <p>
            Payment method: <strong>Bank transfer only</strong>
          </p>
          <p>
            Neither the ride nor the payment is confirmed yet. A payment
            screenshot alone does not confirm payment.
          </p>
          <div className="app-page-actions">
            <Link to="/my-rides">View My Rides</Link>
            <Link to="/dashboard">Return to Dashboard</Link>
          </div>
        </section>
      </AppPage>
    )
  }

  return (
    <AppPage
      eyebrow="RIDE BOOKING"
      title="Plan your journey"
      description="Enter your pickup and destination details to submit a ride request."
      sectionTitle="Ride details"
      sectionText="The fare is calculated by the EkiMove server using an active route fare. A submitted request is not a confirmed ride."
    >
      {loadingZones ? (
        <p role="status">Loading active zones…</p>
      ) : (
        <form className="passenger-booking-form" onSubmit={handleSubmit}>
          {error && (
            <p className="portal-alert portal-alert-error" role="alert">
              {error}
            </p>
          )}

          {message && (
            <p className="portal-alert portal-alert-success" role="status">
              {message}
            </p>
          )}

          <label>
            Pickup zone
            <select
              name="origin_zone_id"
              value={form.origin_zone_id}
              onChange={updateField}
              required
            >
              <option value="">Choose pickup zone</option>
              {zones.map((zone) => (
                <option key={zone.id} value={String(zone.id)}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Destination zone
            <select
              name="destination_zone_id"
              value={form.destination_zone_id}
              onChange={updateField}
              required
            >
              <option value="">Choose destination zone</option>
              {zones.map((zone) => (
                <option key={zone.id} value={String(zone.id)}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Pickup address or landmark
            <input
              name="origin_text"
              value={form.origin_text}
              onChange={updateField}
              minLength={3}
              maxLength={255}
              placeholder="e.g. a nearby landmark in your pickup zone"
              required
            />
          </label>

          <label>
            Destination address or landmark
            <input
              name="destination_text"
              value={form.destination_text}
              onChange={updateField}
              minLength={3}
              maxLength={255}
              placeholder="Enter your destination landmark"
              required
            />
          </label>

          <label>
            Vehicle type
            <select
              name="vehicle_type"
              value={form.vehicle_type}
              onChange={updateField}
              disabled={
                loadingFareOptions ||
                !form.origin_zone_id ||
                !form.destination_zone_id ||
                form.origin_zone_id === form.destination_zone_id ||
                fareOptions.length === 0
              }
              required
            >
              <option value="">
                {loadingFareOptions
                  ? 'Loading available vehicles…'
                  : 'Choose an available vehicle'}
              </option>
              {fareOptions.map((vehicle) => (
                <option key={vehicle} value={vehicle}>
                  {vehicle.charAt(0).toUpperCase() + vehicle.slice(1)}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Vehicle options depend on the selected route.
            </span>
          </label>

          <label>
            Number of passengers
            <select
              name="passenger_count"
              value={form.passenger_count}
              onChange={updateField}
            >
              {(motorcycleSelected ? [1] : [1, 2, 3, 4, 5, 6, 7, 8]).map(
                (count) => (
                  <option key={count} value={String(count)}>
                    {count}
                  </option>
                ),
              )}
            </select>
            {motorcycleSelected && (
              <span className="field-hint">
                Motorcycle bookings are limited to one passenger.
              </span>
            )}
          </label>

          <p className="transfer-policy-inline">
            Payment policy: bank transfer only. Cash is not supported.
          </p>

          {!loadingFareOptions &&
            form.origin_zone_id &&
            form.destination_zone_id &&
            form.origin_zone_id !== form.destination_zone_id &&
            fareOptions.length === 0 && (
              <p className="field-hint" role="status">
                No vehicles are currently configured for this route.
              </p>
            )}

          <button
            className="submit-button"
            type="submit"
            disabled={
              submitting ||
              loadingFareOptions ||
              zones.length < 2 ||
              fareOptions.length === 0
            }
          >
            {submitting ? 'Submitting request…' : 'Submit ride request'}
          </button>

          {zones.length === 0 && (
            <p className="field-hint">
              No active zones are configured yet. Ride booking is unavailable
              until zones are added.
            </p>
          )}
        </form>
      )}

      {ride && (
        <section className="ride-result" aria-live="polite">
          <h3>Ride request submitted</h3>
          <p>
            Request number: <strong>#{ride.id}</strong>
          </p>
          <p>
            Status: <strong>{ride.status || 'requested'}</strong>
          </p>
          <p>
            Quoted fare:{' '}
            <strong>
              {ride.currency || 'NGN'}{' '}
              {Number(ride.quoted_fare).toLocaleString('en-NG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>
          </p>
          <p>Payment is not confirmed by submitting this request.</p>
          <Link to="/dashboard">Return to dashboard</Link>
        </section>
      )}
    </AppPage>
  )
}
