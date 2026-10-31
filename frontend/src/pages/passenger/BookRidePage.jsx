import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MapPin, Wallet } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import { vehicleBlurb, vehicleLabel } from '../../utils/vehicles.js'
import useTripOptions from '../../hooks/useTripOptions.js'
import { apiRequest } from '../../services/authService.js'
import { formatNaira, isMotorcycle } from '../../utils/format.js'

const PASSENGER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8]

function idParam(value) {
  return value && /^\d+$/.test(value) ? value : ''
}

/** Prefill from a trip planned on the homepage (?area=&from=&to=&passengers=&vehicle=). */
function initialForm(searchParams) {
  const passengers = Number(searchParams.get('passengers'))
  const vehicle = (searchParams.get('vehicle') || '').slice(0, 32)
  const from = idParam(searchParams.get('from'))
  const to = idParam(searchParams.get('to'))

  return {
    service_area_id: idParam(searchParams.get('area')),
    origin_place_id: from,
    destination_place_id: to,
    origin_text: '',
    destination_text: '',
    vehicle_type: /^[a-z_]+$/i.test(vehicle) ? vehicle : '',
    passenger_count:
      isMotorcycle(vehicle) ? '1'
        : Number.isInteger(passengers) && passengers >= 1 && passengers <= 8
          ? String(passengers)
          : '1',
  }
}

export default function BookRidePage() {
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState(() => initialForm(searchParams))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ride, setRide] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const trip = useTripOptions({
    areaId: form.service_area_id,
    originId: form.origin_place_id,
    destinationId: form.destination_place_id,
    passengerCount: form.passenger_count,
  })
  const {
    areas,
    places,
    fareOptions,
    loadingAreas,
    loadingPlaces,
    loadingFares: loadingFareOptions,
  } = trip
  const areaId = trip.effectiveAreaId
  const areaName = areas.find((area) => String(area.id) === areaId)?.name
  const loadError = trip.areasError || trip.placesError || trip.faresError

  const samePlace =
    form.origin_place_id && form.origin_place_id === form.destination_place_id
  const selectedFare = fareOptions.find(
    (option) => option.vehicle_type === form.vehicle_type,
  )
  const motorcycleSelected = isMotorcycle(form.vehicle_type)

  /** Fill the form with a trip Atọ́nà quoted (real place IDs from the API). */
  function applyAtonaBooking(draft) {
    setForm((current) => ({
      ...current,
      service_area_id: draft.service_area_id ? String(draft.service_area_id) : current.service_area_id,
      origin_place_id: draft.origin_place_id ? String(draft.origin_place_id) : '',
      destination_place_id: draft.destination_place_id ? String(draft.destination_place_id) : '',
      origin_text: draft.origin_name || '',
      destination_text: draft.destination_name || '',
      passenger_count: isMotorcycle(draft.vehicle_type)
        ? '1'
        : String(draft.passenger_count || 1),
      vehicle_type: draft.vehicle_type || '',
    }))
    setError('')
    setMessage('Atọ́nà filled in your trip. Check the details and choose your ride.')
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

      if (name === 'vehicle_type' && isMotorcycle(value)) {
        next.passenger_count = '1'
      }

      return next
    })

    setError('')
    setMessage('')
    setRide(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setRide(null)

    if (!areaId || !form.origin_place_id || !form.destination_place_id) {
      setError('Choose a pickup place and a destination.')
      return
    }

    if (samePlace) {
      setError('Choose different pickup and destination places.')
      return
    }

    if (!selectedFare) {
      setError('Choose a vehicle with a fare for this exact route.')
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
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (ride) {
    const originPlace = places.find(
      (place) => String(place.id) === String(ride.origin_place_id),
    )
    const destinationPlace = places.find(
      (place) => String(place.id) === String(ride.destination_place_id),
    )

    return (
      <AppShell title="Request sent" description="We're finding a verified driver for you.">
        <section className="card card-lg stack" aria-live="polite" style={{ maxWidth: 640 }}>
          <div className="row row-between">
            <div className="row" style={{ gap: 10 }}>
              <CheckCircle2 size={28} color="#2E8B63" aria-hidden="true" />
              <h2 className="card-title">Request #{ride.id}</h2>
            </div>
            <StatusBadge status={ride.status || 'requested'} />
          </div>

          <div className="route">
            <div className="route-rail" aria-hidden="true">
              <span className="route-dot" />
              <span className="route-line" />
              <span className="route-end" />
            </div>
            <div>
              <p className="route-label">Pickup</p>
              <p className="route-value">
                {originPlace?.name || ride.origin_text || form.origin_text || 'Selected pickup'}
              </p>
            </div>
            <div>
              <p className="route-label">Destination</p>
              <p className="route-value">
                {destinationPlace?.name || ride.destination_text || form.destination_text || 'Selected destination'}
              </p>
            </div>
          </div>

          <dl className="kv">
            <div><dt>Vehicle</dt><dd>{vehicleLabel(ride.vehicle_type)}</dd></div>
            <div><dt>Passengers</dt><dd>{ride.passenger_count}</dd></div>
            <div><dt>Quoted fare</dt><dd>{formatNaira(ride.quoted_fare)}</dd></div>
          </dl>

          <Alert tone="warning">
            Your ride isn't confirmed yet, and nothing has been paid. You'll pay
            by bank transfer or Interswitch once a driver is assigned. A payment
            screenshot alone doesn't confirm payment.
          </Alert>

          <div className="row">
            <Link className="btn btn-primary" to="/my-rides">
              Follow this ride
            </Link>
            <Link className="btn" to="/dashboard">
              Back to home
            </Link>
          </div>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell
      className="has-bottom-bar"
      onApplyBooking={applyAtonaBooking}
      title="Book a ride"
      description="Choose your route to see the approved fares for it."
      actions={
        areaName && areas.length === 1 ? (
          <span className="badge badge-green">
            <MapPin size={14} aria-hidden="true" /> {areaName}
          </span>
        ) : null
      }
    >
      {loadingAreas ? (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Loading service areas…
        </div>
      ) : (
        <form className="passenger-booking-form two-col" onSubmit={handleSubmit}>
          <div className="stack">
            <Alert tone="error">{error || loadError}</Alert>
            <Alert tone="success">{message}</Alert>

            {areas.length === 0 && (
              <Alert tone="warning">
                Booking isn't open in any service area yet. Please check back soon.
              </Alert>
            )}

            {areas.length > 1 && (
              <label className="field">
                <span className="field-label">Service area</span>
                <select
                  className="select"
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
            )}

            <div className="card route">
              <div className="route-rail" aria-hidden="true">
                <span className="route-dot" />
                <span className="route-line" />
                <span className="route-end" />
              </div>
              <label className="field">
                <span className="field-label">Pickup</span>
                <select
                  className="select"
                  name="origin_place_id"
                  value={form.origin_place_id}
                  onChange={updateField}
                  disabled={!areaId || loadingPlaces}
                  required
                >
                  <option value="">
                    {loadingPlaces ? 'Loading places…' : 'Choose pickup'}
                  </option>
                  {places.map((place) => (
                    <option key={place.id} value={String(place.id)}>
                      {place.name}
                    </option>
                  ))}
                </select>
                {form.origin_text && !form.origin_place_id && (
                  <span className="field-hint">You said: “{form.origin_text}”</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">Destination</span>
                <select
                  className="select"
                  name="destination_place_id"
                  value={form.destination_place_id}
                  onChange={updateField}
                  disabled={!areaId || loadingPlaces}
                  required
                >
                  <option value="">Choose destination</option>
                  {places.map((place) => (
                    <option key={place.id} value={String(place.id)}>
                      {place.name}
                    </option>
                  ))}
                </select>
                {form.destination_text && !form.destination_place_id && (
                  <span className="field-hint">You said: “{form.destination_text}”</span>
                )}
              </label>
            </div>

            {samePlace && (
              <Alert tone="warning">Pickup and destination need to be different places.</Alert>
            )}

            <label className="field">
              <span className="field-label">Passengers</span>
              <select
                className="select"
                name="passenger_count"
                value={form.passenger_count}
                onChange={updateField}
                aria-describedby={motorcycleSelected ? 'passenger-hint' : undefined}
              >
                {(motorcycleSelected ? [1] : PASSENGER_COUNTS).map((count) => (
                  <option key={count} value={String(count)}>
                    {count} {count === 1 ? 'passenger' : 'passengers'}
                  </option>
                ))}
              </select>
              {motorcycleSelected && (
                <span className="field-hint" id="passenger-hint">
                  Motorcycle rides carry one passenger.
                </span>
              )}
            </label>
          </div>

          <div className="stack">
            <fieldset className="choice-list" disabled={!trip.routeSelected}>
              <legend className="choice-legend">
                {loadingFareOptions ? 'Checking fares…' : 'Choose a ride'}
              </legend>

              {!trip.routeSelected && (
                <p className="card muted small">
                  Pick your pickup and destination to see the vehicles and fares
                  for that route.
                </p>
              )}

              {trip.routeSelected && !loadingFareOptions && fareOptions.length === 0 && (
                <p className="card muted small" role="status">
                  No fare is set for this exact route and passenger count yet.
                </p>
              )}

              {fareOptions.map((option) => (
                <label className="choice" key={option.fare_id}>
                  <input
                    type="radio"
                    name="vehicle_type"
                    value={option.vehicle_type}
                    checked={form.vehicle_type === option.vehicle_type}
                    onChange={updateField}
                  />
                  <span className={`choice-icon ${isMotorcycle(option.vehicle_type) ? '' : 'choice-icon-warm'}`}>
                    <VehicleIcon type={option.vehicle_type} />
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">{vehicleLabel(option.vehicle_type)}</span>
                    <span className="choice-sub">{vehicleBlurb(option.vehicle_type)}</span>
                  </span>
                  <span className="choice-price">{formatNaira(option.quoted_fare, { decimals: 0 })}</span>
                </label>
              ))}
            </fieldset>

            <p className="row muted small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <Wallet size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              You'll pay after a driver is assigned, by bank transfer or
              Interswitch. Cash isn't accepted.
            </p>

            <div className="bottom-bar">
              <div className="fare-total">
                <span className="muted small" style={{ fontWeight: 700 }}>Your fare</span>
                <span className="money">{selectedFare ? formatNaira(selectedFare.quoted_fare) : '—'}</span>
              </div>
              <button
                className="btn btn-accent btn-lg"
                type="submit"
                disabled={
                  submitting ||
                  loadingPlaces ||
                  loadingFareOptions ||
                  !trip.routeSelected ||
                  !selectedFare
                }
              >
                {submitting
                  ? 'Sending request…'
                  : selectedFare
                    ? `Request ${vehicleLabel(selectedFare.vehicle_type).toLowerCase()}`
                    : 'Request ride'}
              </button>
            </div>
          </div>
        </form>
      )}
    </AppShell>
  )
}
