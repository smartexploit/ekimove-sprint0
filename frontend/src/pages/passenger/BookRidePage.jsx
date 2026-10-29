import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'
import AtonaFloatingAssistant from '../../components/AtonaFloatingAssistant.jsx'

export default function BookRidePage() {
  const [areas, setAreas] = useState([])
  const [places, setPlaces] = useState([])
  const [fareOptions, setFareOptions] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(true)
  const [loadingPlaces, setLoadingPlaces] = useState(false)
  const [loadingFareOptions, setLoadingFareOptions] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ride, setRide] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    service_area_id: '',
    origin_place_id: '',
    destination_place_id: '',
    origin_text: '',
    destination_text: '',
    vehicle_type: '',
    passenger_count: '1',
  })

  useEffect(() => {
    let active = true

    apiRequest('/api/v1/locations/areas')
      .then((data) => {
        if (active) setAreas(data)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingAreas(false)
      })

    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true

    setPlaces([])
    setFareOptions([])
    setForm((current) => ({
      ...current,
      origin_place_id: '',
      destination_place_id: '',
      origin_text: '',
      destination_text: '',
      vehicle_type: '',
    }))

    if (!form.service_area_id) {
      setLoadingPlaces(false)
      return () => { active = false }
    }

    setLoadingPlaces(true)
    apiRequest(
      `/api/v1/locations/places?service_area_id=${encodeURIComponent(form.service_area_id)}`,
    )
      .then((data) => {
        if (active) setPlaces(data)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingPlaces(false)
      })

    return () => { active = false }
  }, [form.service_area_id])

  useEffect(() => {
    let active = true

    setFareOptions([])
    setForm((current) => ({ ...current, vehicle_type: '' }))

    if (
      !form.origin_place_id ||
      !form.destination_place_id ||
      form.origin_place_id === form.destination_place_id
    ) {
      setLoadingFareOptions(false)
      return () => { active = false }
    }

    setLoadingFareOptions(true)
    apiRequest(
      `/api/v1/place-fare-options?origin_place_id=${encodeURIComponent(form.origin_place_id)}&destination_place_id=${encodeURIComponent(form.destination_place_id)}&passenger_count=${encodeURIComponent(form.passenger_count)}`,
    )
      .then((options) => {
        if (active) setFareOptions(options)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoadingFareOptions(false)
      })

    return () => { active = false }
  }, [
    form.origin_place_id,
    form.destination_place_id,
    form.passenger_count,
  ])

  function applyAtonaBooking(booking) {
    setForm((current) => ({
      ...current,
      origin_text: booking.origin_text || '',
      destination_text: booking.destination_text || '',
      passenger_count: String(booking.passenger_count || 1),
      origin_place_id: '',
      destination_place_id: '',
      vehicle_type: '',
    }))
    setFareOptions([])
    setError('')
    setMessage(
      'Atọ́nà added your trip details. Select the service area, pickup place and destination place to continue.',
    )
    setRide(null)
  }

  function updateField(event) {
    const { name, value } = event.target

    setForm((current) => {
      const next = { ...current, [name]: value }

      if (name === 'service_area_id') {
        next.origin_place_id = ''
        next.destination_place_id = ''
        next.origin_text = ''
        next.destination_text = ''
        next.vehicle_type = ''
      }

      if (name === 'origin_place_id') {
        next.origin_text =
          places.find((place) => String(place.id) === value)?.name || ''
        next.vehicle_type = ''
      }

      if (name === 'destination_place_id') {
        next.destination_text =
          places.find((place) => String(place.id) === value)?.name || ''
        next.vehicle_type = ''
      }

      if (name === 'passenger_count') {
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

    setFareOptions([])
    setError('')
    setMessage('')
    setRide(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setRide(null)

    if (
      !form.service_area_id ||
      !form.origin_place_id ||
      !form.destination_place_id
    ) {
      setError('Choose a service area, pickup place and destination place.')
      return
    }

    if (form.origin_place_id === form.destination_place_id) {
      setError('Choose different pickup and destination places.')
      return
    }

    if (!fareOptions.some(
      (option) => option.vehicle_type === form.vehicle_type,
    )) {
      setError('Choose a vehicle with an active fare for this exact route.')
      return
    }

    setSubmitting(true)

    try {
      const result = await apiRequest('/api/v1/ride-requests', {
        method: 'POST',
        body: JSON.stringify({
          origin_place_id: Number(form.origin_place_id),
          destination_place_id: Number(form.destination_place_id),
          vehicle_type: form.vehicle_type,
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
    const originPlace = places.find(
      (place) => String(place.id) === String(ride.origin_place_id),
    )
    const destinationPlace = places.find(
      (place) => String(place.id) === String(ride.destination_place_id),
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
          <p>Request number: <strong>#{ride.id}</strong></p>
          <p>Status: <strong>{ride.status || 'requested'}</strong></p>
          <p>Pickup place: <strong>{originPlace?.name || ride.origin_text || form.origin_text || 'Selected pickup'}</strong></p>
          <p>Destination place: <strong>{destinationPlace?.name || ride.destination_text || form.destination_text || 'Selected destination'}</strong></p>
          <p>Vehicle: <strong>{ride.vehicle_type}</strong></p>
          <p>Passengers: <strong>{ride.passenger_count}</strong></p>
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
          <p>Payment method: <strong>Bank transfer only</strong></p>
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
      description="Choose your pickup and destination to see available vehicles and fares."
      sectionTitle="Ride details"
      sectionText="The server calculates the fare using an active fare for your exact route. Submitting a request does not confirm a ride."
    >
      {loadingAreas ? (
        <p role="status">Loading active service areas…</p>
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
            Service area
            <select
              name="service_area_id"
              value={form.service_area_id}
              onChange={updateField}
              required
            >
              <option value="">Choose service area</option>
              {areas.map((area) => (
                <option key={area.id} value={String(area.id)}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Pickup place
            <select
              name="origin_place_id"
              value={form.origin_place_id}
              onChange={updateField}
              disabled={!form.service_area_id || loadingPlaces}
              required
            >
              <option value="">
                {loadingPlaces ? 'Loading places…' : 'Choose pickup place'}
              </option>
              {places.map((place) => (
                <option key={place.id} value={String(place.id)}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Destination place
            <select
              name="destination_place_id"
              value={form.destination_place_id}
              onChange={updateField}
              disabled={!form.service_area_id || loadingPlaces}
              required
            >
              <option value="">Choose destination place</option>
              {places.map((place) => (
                <option key={place.id} value={String(place.id)}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Vehicle type and quoted fare
            <select
              name="vehicle_type"
              value={form.vehicle_type}
              onChange={updateField}
              disabled={
                loadingFareOptions ||
                !form.origin_place_id ||
                !form.destination_place_id ||
                form.origin_place_id === form.destination_place_id ||
                fareOptions.length === 0
              }
              required
            >
              <option value="">
                {loadingFareOptions
                  ? 'Loading route fares…'
                  : 'Choose an available vehicle'}
              </option>
              {fareOptions.map((option) => (
                <option key={option.fare_id} value={option.vehicle_type}>
                  {option.vehicle_type.charAt(0).toUpperCase() +
                    option.vehicle_type.slice(1)}{' '}
                  — ₦{Number(option.quoted_fare).toLocaleString('en-NG', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Only vehicles with an active fare for this exact route are shown.
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
            form.origin_place_id &&
            form.destination_place_id &&
            form.origin_place_id !== form.destination_place_id &&
            fareOptions.length === 0 && (
              <p className="field-hint" role="status">
                No active fare is configured for this exact route and
                passenger count.
              </p>
            )}

          {areas.length === 0 && (
            <p className="field-hint" role="status">
              No active service areas are available. Booking requires an active
              area, places and configured route fares.
            </p>
          )}

          <button
            className="submit-button"
            type="submit"
            disabled={
              submitting ||
              loadingPlaces ||
              loadingFareOptions ||
              !form.origin_place_id ||
              !form.destination_place_id ||
              form.origin_place_id === form.destination_place_id ||
              !fareOptions.some(
                (option) => option.vehicle_type === form.vehicle_type,
              )
            }
          >
            {submitting ? 'Submitting request…' : 'Submit ride request'}
          </button>
        </form>
      )}
      <AtonaFloatingAssistant onApplyBooking={applyAtonaBooking} />
    </AppPage>
  )
}
