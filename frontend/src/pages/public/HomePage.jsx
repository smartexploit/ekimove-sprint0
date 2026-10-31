import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Siren,
  Tag,
  UserRoundCheck,
  Wallet,
} from 'lucide-react'
import Hills from '../../components/brand/Hills.jsx'
import Alert from '../../components/ui/Alert.jsx'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import { vehicleBlurb, vehicleLabel } from '../../utils/vehicles.js'
import AtonaFloatingAssistant from '../../components/AtonaFloatingAssistant.jsx'
import InstallAppCard from '../../components/pwa/InstallAppCard.jsx'
import useTripOptions from '../../hooks/useTripOptions.js'
import { PublicFooter, PublicHeader } from '../../layouts/PublicChrome.jsx'
import { formatNaira, isMotorcycle } from '../../utils/format.js'

function TripPlanner() {
  const navigate = useNavigate()
  const [trip, setTrip] = useState({
    area: '',
    from: '',
    to: '',
    passengers: '1',
    vehicle: '',
  })

  const tripOptions = useTripOptions({
    areaId: trip.area,
    originId: trip.from,
    destinationId: trip.to,
    passengerCount: trip.passengers,
  })
  // During the pilot there is one live area, which the hook preselects.
  const areaId = tripOptions.effectiveAreaId

  const sameplace = trip.from && trip.from === trip.to
  const selectedFare = tripOptions.fareOptions.find(
    (option) => option.vehicle_type === trip.vehicle,
  )

  function update(name, value) {
    setTrip((current) => {
      const next = { ...current, [name]: value }
      if (name === 'area') {
        next.from = ''
        next.to = ''
        next.vehicle = ''
      }
      if (['from', 'to', 'passengers'].includes(name)) next.vehicle = ''
      if (name === 'vehicle' && isMotorcycle(value)) next.passengers = '1'
      return next
    })
  }

  function submit(event) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (areaId) params.set('area', areaId)
    if (trip.from) params.set('from', trip.from)
    if (trip.to) params.set('to', trip.to)
    params.set('passengers', trip.passengers)
    if (trip.vehicle) params.set('vehicle', trip.vehicle)
    navigate(`/book-ride?${params.toString()}`)
  }

  if (!tripOptions.loadingAreas && tripOptions.areas.length === 0) {
    return (
      <div className="planner" id="plan">
        <h2 className="planner-title">Booking opens soon</h2>
        <p className="muted">
          We're finishing route and fare setup for our first service area.
          Create an account now and you'll be ready to ride on day one.
        </p>
        <Link className="btn btn-accent btn-lg" to="/register">
          Create your account
        </Link>
      </div>
    )
  }

  return (
    <form className="planner" id="plan" onSubmit={submit} aria-labelledby="planner-title">
      <h2 className="planner-title" id="planner-title">
        Where are you headed?
      </h2>

      {tripOptions.areas.length > 1 && (
        <label className="field">
          <span className="field-label">Service area</span>
          <select
            className="select"
            value={trip.area}
            onChange={(event) => update('area', event.target.value)}
          >
            <option value="">Choose your town</option>
            {tripOptions.areas.map((area) => (
              <option key={area.id} value={String(area.id)}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="route">
        <div className="route-rail" aria-hidden="true">
          <span className="route-dot" />
          <span className="route-line" />
          <span className="route-end" />
        </div>
        <label className="field">
          <span className="field-label">Pickup</span>
          <select
            className="select"
            value={trip.from}
            onChange={(event) => update('from', event.target.value)}
            disabled={!areaId || tripOptions.loadingPlaces}
          >
            <option value="">
              {tripOptions.loadingAreas || tripOptions.loadingPlaces
                ? 'Loading places…'
                : 'Choose pickup'}
            </option>
            {tripOptions.places.map((place) => (
              <option key={place.id} value={String(place.id)}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Destination</span>
          <select
            className="select"
            value={trip.to}
            onChange={(event) => update('to', event.target.value)}
            disabled={!areaId || tripOptions.loadingPlaces}
          >
            <option value="">Choose destination</option>
            {tripOptions.places.map((place) => (
              <option key={place.id} value={String(place.id)}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sameplace && (
        <Alert tone="warning">Pickup and destination need to be different places.</Alert>
      )}

      {tripOptions.routeSelected && (
        <fieldset className="choice-list">
          <legend className="choice-legend">
            {tripOptions.loadingFares ? 'Checking fares…' : 'Fares for this route'}
          </legend>
          {!tripOptions.loadingFares && tripOptions.fareOptions.length === 0 && (
            <p className="muted small">
              No fare is set for this exact route yet. Try a nearby pickup or
              destination.
            </p>
          )}
          {tripOptions.fareOptions.map((option) => (
            <label className="choice" key={option.fare_id}>
              <input
                type="radio"
                name="planner-vehicle"
                value={option.vehicle_type}
                checked={trip.vehicle === option.vehicle_type}
                onChange={(event) => update('vehicle', event.target.value)}
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
      )}

      <button
        type="submit"
        className="btn btn-accent btn-lg"
        disabled={!tripOptions.routeSelected}
      >
        {selectedFare
          ? `Continue · ${formatNaira(selectedFare.quoted_fare, { decimals: 0 })}`
          : 'Continue to book'}
        <ArrowRight size={20} aria-hidden="true" />
      </button>
      <p className="muted small" style={{ textAlign: 'center' }}>
        Fares come from EkiMove's approved route prices. You'll sign in to confirm.
      </p>
    </form>
  )
}

export default function HomePage() {
  return (
    <div>
      <a className="skip-link" href="#plan">
        Skip to trip planner
      </a>

      <section className="hero">
        <PublicHeader dark />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow">Now piloting in Ado-Ekiti</p>
            <h1 className="display hero-title">
              Move around Ekiti, <em>the easy way.</em>
            </h1>
            <p className="hero-lead">
              Book a motorcycle or car for everyday trips. Your fare is set
              before you book, every driver is verified, and payment is always
              cashless.
            </p>
            <div className="row">
              <a className="btn btn-lg" href="#plan">
                Plan a trip <ArrowRight size={20} aria-hidden="true" />
              </a>
              <Link className="btn btn-lg btn-on-dark" to="/driver/apply">
                Drive with EkiMove
              </Link>
            </div>
          </div>
          <TripPlanner />
        </div>
        <Hills base="#F2F5F1" />
      </section>

      <main>
        <section className="container grid grid-auto trust-strip" aria-label="Why EkiMove">
          <div className="trust-item">
            <span className="trust-icon" style={{ background: 'var(--green-100)', color: 'var(--green-800)' }}>
              <BadgeCheck size={24} aria-hidden="true" />
            </span>
            <div>
              <h3>Verified drivers</h3>
              <p>Drivers and vehicles are reviewed and approved by EkiMove before their first ride.</p>
            </div>
          </div>
          <div className="trust-item">
            <span className="trust-icon" style={{ background: 'var(--gold-100)', color: 'var(--gold-700)' }}>
              <Tag size={24} aria-hidden="true" />
            </span>
            <div>
              <h3>Fare before you book</h3>
              <p>You see the price for your exact route first. No haggling at the roadside.</p>
            </div>
          </div>
          <div className="trust-item">
            <span className="trust-icon" style={{ background: 'var(--laterite-100)', color: 'var(--laterite-700)' }}>
              <Wallet size={24} aria-hidden="true" />
            </span>
            <div>
              <h3>Cashless and accountable</h3>
              <p>Pay by bank transfer or Interswitch. Every payment is verified before it counts.</p>
            </div>
          </div>
        </section>

        <div className="container" style={{ paddingTop: 16 }}>
          <InstallAppCard />
        </div>

        <section className="section" id="rides">
          <div className="container">
            <div className="section-head">
              <p className="eyebrow">Ride options</p>
              <h2>A ride for the way you move.</h2>
            </div>
            <div className="grid grid-auto" style={{ gap: 20 }}>
              <article className="ride-type ride-type-dark">
                <span style={{ color: 'var(--gold-500)' }}>
                  <VehicleIcon type="motorcycle" size={64} />
                </span>
                <div>
                  <h3>Motorcycle</h3>
                  <p>Fast, affordable trips through town. One passenger, helmet first.</p>
                </div>
              </article>
              <article className="ride-type">
                <span style={{ color: 'var(--laterite-600)' }}>
                  <VehicleIcon type="car" size={64} />
                </span>
                <div>
                  <h3>Car</h3>
                  <p>More room and comfort for longer journeys, family trips or market runs.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section section-white" id="how-it-works">
          <div className="container">
            <div className="section-head">
              <p className="eyebrow">How it works</p>
              <h2>Your journey in three steps.</h2>
            </div>
            <ol className="steps-big">
              <li>
                <span className="steps-big-num" style={{ color: 'var(--green-600)' }} aria-hidden="true">01</span>
                <h3>Choose your route</h3>
                <p>Pick your pickup and destination from places across your service area.</p>
              </li>
              <li>
                <span className="steps-big-num" style={{ color: 'var(--laterite-600)' }} aria-hidden="true">02</span>
                <h3>See the fare, pick a ride</h3>
                <p>Compare motorcycle and car prices for that exact route, then send your request.</p>
              </li>
              <li>
                <span className="steps-big-num" style={{ color: '#B57B0B' }} aria-hidden="true">03</span>
                <h3>Meet your driver</h3>
                <p>A verified driver is assigned and you follow each step until you arrive.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section" id="about">
          <div className="container split">
            <img
              className="photo"
              src="/images/ekimove-local-rides.jpg"
              alt="An EkiMove rider in a high-visibility vest and a car on a street in Ado-Ekiti, with the town gate and hills behind"
              style={{ aspectRatio: '4 / 3', objectPosition: '78% center' }}
              loading="lazy"
            />
            <div className="stack">
              <p className="eyebrow">Made for Ekiti</p>
              <h2 className="display" style={{ fontSize: 'clamp(32px, 4vw, 46px)', color: 'var(--green-800)' }}>
                Built around how Ekiti moves.
              </h2>
              <p className="muted" style={{ fontSize: 17 }}>
                EkiMove starts in Ado-Ekiti with the places people actually go:
                markets, campuses, junctions and neighbourhoods. Every route has an
                approved fare, so riders and drivers agree on the price before the
                trip begins.
              </p>
              <a className="text-link" href="#plan">
                Plan your first trip →
              </a>
            </div>
          </div>
        </section>

        <section className="section section-white" id="safety">
          <div className="container split">
            <div className="stack">
              <p className="eyebrow">Safety and trust</p>
              <h2 className="display" style={{ fontSize: 'clamp(32px, 4vw, 46px)', color: 'var(--green-800)' }}>
                Ride with confidence.
              </h2>
              <p className="muted" style={{ fontSize: 17 }}>
                Every part of the journey is recorded, from the driver who accepts
                your ride to the payment that settles it.
              </p>
            </div>
            <ul className="safety-list">
              <li style={{ background: 'var(--mist)' }}>
                <span className="safety-icon" style={{ background: 'var(--laterite-600)', color: '#fff' }}>
                  <Siren size={20} aria-hidden="true" />
                </span>
                <p><strong>In-ride SOS</strong> alerts the EkiMove team straight away during any trip.</p>
              </li>
              <li style={{ background: 'var(--mist)' }}>
                <span className="safety-icon" style={{ background: 'var(--green-800)', color: '#fff' }}>
                  <UserRoundCheck size={20} aria-hidden="true" />
                </span>
                <p><strong>Approved drivers and vehicles</strong>, checked before their first ride.</p>
              </li>
              <li style={{ background: 'var(--mist)' }}>
                <span className="safety-icon" style={{ background: 'var(--gold-500)', color: 'var(--ink)' }}>
                  <Wallet size={20} aria-hidden="true" />
                </span>
                <p><strong>Payments confirmed by EkiMove</strong>, never by a screenshot alone.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="section" id="drive">
          <div className="container">
            <div className="cta-band">
              <div style={{ flex: '1 1 420px' }}>
                <h2>Drive with EkiMove.</h2>
                <p>Own a motorcycle or car? Apply, get verified and start earning on trips across Ekiti.</p>
              </div>
              <Link className="btn btn-lg" to="/driver/apply" style={{ color: 'var(--laterite-700)' }}>
                Apply to drive
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
      <AtonaFloatingAssistant />
    </div>
  )
}
