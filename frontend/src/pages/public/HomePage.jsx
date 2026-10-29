import { useEffect, useState } from 'react'
import '../../App.css'
import '../../prototype-home-scoped.css'
import AtonaFloatingAssistant from '../../components/AtonaFloatingAssistant.jsx'

const API_BASE = '/api/v1'

const fallbackZones = [
  'Ado-Ekiti Central',
  'Fajuyi / Secretariat Axis',
  'Oke-Ila',
  'Basiri',
  'Adebayo',
  'Ajilosun',
]

function App() {
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(true)
  const [apiMessage, setApiMessage] = useState('')
  const [paymentPolicy, setPaymentPolicy] = useState(null)
  const [originZone, setOriginZone] = useState('')
  const [destinationZone, setDestinationZone] = useState('')
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [vehicle, setVehicle] = useState('standard')
  const [passengers, setPassengers] = useState(1)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        const [zonesResponse, policyResponse] = await Promise.all([
          fetch(`${API_BASE}/zones`),
          fetch(`${API_BASE}/policy/payments`),
        ])

        if (!zonesResponse.ok) {
          throw new Error(`Zones API returned HTTP ${zonesResponse.status}`)
        }

        const zonesData = await zonesResponse.json()
        const list = Array.isArray(zonesData)
          ? zonesData
          : zonesData.zones ?? zonesData.items ?? []

        if (!cancelled) {
          const activeZones = list.filter((zone) => zone.is_active !== false)
          setZones(activeZones)
          setApiMessage(
            activeZones.length
              ? 'Live service zones loaded'
              : 'The API returned no active zones.',
          )
        }

        if (policyResponse.ok && !cancelled) {
          setPaymentPolicy(await policyResponse.json())
        }
      } catch {
        if (!cancelled) {
          setZones([])
          setApiMessage(
            'We could not load live zones. Check that the API is reachable and try again.',
          )
        }
      } finally {
        if (!cancelled) setZonesLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [])

  const sameZone =
    originZone !== '' && originZone === destinationZone

  function handleBooking(event) {
    event.preventDefault()
    setNotice('')

    if (!originZone || !destinationZone || !pickup.trim() || !destination.trim()) {
      setNotice('Choose both zones and enter your pickup and destination details.')
      return
    }

    if (sameZone) {
      setNotice('Choose two different zones for this trip.')
      return
    }

    if (vehicle === 'motorcycle' && passengers > 1) {
      setNotice('Motorcycle bookings allow one passenger, excluding the rider.')
      return
    }

    setNotice(
      'Your trip details are ready. Booking is not submitted: passenger authentication and an active fare for this route are required first.',
    )
  }

  const zoneOptions = zones.length
    ? zones
    : fallbackZones.map((name, index) => ({
        id: `fallback-${index + 1}`,
        name,
        is_active: true,
      }))

  function applyAtonaBooking(booking) {
    const validOrigin = zones.find(
      (zone) => zone.is_active !== false &&
        String(zone.id) === String(booking.origin_zone_id),
    )
    const validDestination = zones.find(
      (zone) => zone.is_active !== false &&
        String(zone.id) === String(booking.destination_zone_id),
    )

    if (!validOrigin || !validDestination) {
      setNotice('At??n? could not match this trip to active service zones. Please try again when live zones are available.')
      return
    }

    if (String(validOrigin.id) === String(validDestination.id)) {
      setNotice('Choose two different zones for this trip.')
      return
    }

    const count = Number(booking.passenger_count || 1)
    if (!Number.isInteger(count) || count < 1 || count > 6) {
      setNotice('Please review the passenger count in the booking form.')
      return
    }

    setOriginZone(String(validOrigin.id))
    setDestinationZone(String(validDestination.id))
    setPickup(booking.origin_text || '')
    setDestination(booking.destination_text || '')
    setPassengers(count)
    if (booking.vehicle_type === 'motorcycle' || booking.vehicle_type === 'standard') {
      setVehicle(booking.vehicle_type)
    }
    setNotice('At??n? prepared your trip details. Review them before continuing. No ride has been submitted.')
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="prototype-home site-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="EkiMove home">
          <span className="brand-mark">E</span>
          <span>
            <strong>EkiMove</strong>
            <small>Anywhere in Ekiti</small>
          </span>
        </a>

        <nav className="nav-links" aria-label="Main navigation">
          <a className="active" href="#home">Home</a>
          <a href="#book">Book a ride</a>
          <a href="#how-it-works">How it works</a>
        </nav>

        <a className="nav-action" href="/driver/apply">
  Become a Driver <span>↗</span>
</a>
      </header>

      <main id="home">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> BUILT FOR EKITI</div>
            <h1>Move smarter.<br />Move freely.<br /><span>Anywhere in Ekiti.</span></h1>
            <p className="hero-description">
              A simpler way to plan your next journey, wherever you need to go across Ekiti State.
              Choose your route and get ready to move.
            </p>
            <a className="primary-button" href="#book">Plan your ride <span>→</span></a>
            <div className="hero-proof">
              <span className="proof-icon">⌖</span>
              <span><strong>Local by design</strong><small>Service coverage depends on active zones</small></span>
            </div>
          </div>

          <div className="hero-art" aria-label="Illustration of a car travelling on a road">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="sun-disc" />
            <div className="art-label label-top"><span>✳</span> YOUR NEXT STOP</div>
            <div className="route-line"><i /><i /><i /></div>
            <div className="city-hill hill-back" />
            <div className="city-hill hill-front" />
            <div className="road"><div className="road-dashes" /></div>
            <div className="car">
              <div className="car-window" />
              <div className="car-light" />
              <div className="wheel wheel-left" />
              <div className="wheel wheel-right" />
            </div>
            <div className="art-label label-bottom"><span>↗</span> EKITI, LET'S MOVE</div>
            <span className="spark spark-one">✦</span>
            <span className="spark spark-two">✳</span>
          </div>
        </section>

        <section className="booking-section" id="book">
          <div className="section-heading">
            <div>
              <div className="eyebrow">YOUR RIDE STARTS HERE</div>
              <h2>Where are we going?</h2>
              <p>Enter your trip details to prepare your journey.</p>
            </div>
            <span className="step-badge"><span /> TRIP PLANNER</span>
          </div>

          <form className="booking-card" onSubmit={handleBooking}>
            <div className="form-grid">
              <div className="field-group">
                <label htmlFor="origin-zone">Pickup zone</label>
                <div className="select-wrap">
                  <span className="field-symbol pickup-symbol">●</span>
                  <select id="origin-zone" value={originZone}
                    onChange={(e) => { setOriginZone(e.target.value); setNotice('') }}>
                    <option value="">Choose pickup zone</option>
                    {zoneOptions.map((zone) => (
                      <option key={zone.id} value={String(zone.id)}>{zone.name}</option>
                    ))}
                  </select>
                </div>
                <label className="sub-label" htmlFor="pickup-detail">Pickup address or landmark</label>
                <input id="pickup-detail" value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder="e.g. Near Fajuyi Park" maxLength={255} />
              </div>

              <div className="field-group">
                <label htmlFor="destination-zone">Destination zone</label>
                <div className="select-wrap">
                  <span className="field-symbol destination-symbol">◎</span>
                  <select id="destination-zone" value={destinationZone}
                    onChange={(e) => { setDestinationZone(e.target.value); setNotice('') }}>
                    <option value="">Choose destination zone</option>
                    {zoneOptions.map((zone) => (
                      <option key={zone.id} value={String(zone.id)}>{zone.name}</option>
                    ))}
                  </select>
                </div>
                <label className="sub-label" htmlFor="destination-detail">Destination address or landmark</label>
                <input id="destination-detail" value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Adebayo junction" maxLength={255} />
              </div>
            </div>

            <div className="form-divider" />

            <div className="ride-options">
              <fieldset className="vehicle-field">
                <legend>Choose your ride</legend>
                <div className="vehicle-options">
                  <button type="button"
                    className={`vehicle-option ${vehicle === 'standard' ? 'selected' : ''}`}
                    aria-pressed={vehicle === 'standard'}
                    onClick={() => { setVehicle('standard'); setPassengers(1); setNotice('') }}>
                    <span className="vehicle-icon car-icon">▰</span>
                    <span><strong>Standard car</strong><small>Everyday journeys</small></span>
                    <span className="radio-dot" />
                  </button>
                  <button type="button"
                    className={`vehicle-option ${vehicle === 'motorcycle' ? 'selected' : ''}`}
                    aria-pressed={vehicle === 'motorcycle'}
                    onClick={() => { setVehicle('motorcycle'); setPassengers(1); setNotice('') }}>
                    <span className="vehicle-icon bike-icon">◉</span>
                    <span><strong>Motorcycle</strong><small>One passenger max</small></span>
                    <span className="radio-dot" />
                  </button>
                </div>
              </fieldset>

              <div className="passenger-field">
                <label htmlFor="passenger-count">Passengers</label>
                <div className="passenger-control">
                  <button type="button" aria-label="Remove passenger"
                    disabled={passengers <= 1}
                    onClick={() => setPassengers((count) => Math.max(1, count - 1))}>−</button>
                  <output id="passenger-count">{passengers}</output>
                  <button type="button" aria-label="Add passenger"
                    disabled={passengers >= (vehicle === 'motorcycle' ? 1 : 8)}
                    onClick={() => setPassengers((count) => Math.min(vehicle === 'motorcycle' ? 1 : 8, count + 1))}>+</button>
                </div>
                <small className="muted">Excludes the driver</small>
              </div>
            </div>

            <div className="booking-footer">
              <div className="fare-placeholder">
                <span className="fare-icon">₦</span>
                <span><strong>Fare shown before booking</strong><small>No estimated price is displayed until a valid fare is available.</small></span>
              </div>
              <button className="submit-button" type="submit">Review trip <span>→</span></button>
            </div>

            {notice && <p className="notice" role="status">{notice}</p>}
          </form>
          <p className="api-status" role="status">
            <span className={zones.length ? 'status-dot success' : 'status-dot'} />
            {zonesLoading ? 'Connecting to EkiMove services…' : apiMessage}
            {!zonesLoading && !zones.length && (
              <button type="button" className="text-button" onClick={() => window.location.reload()}>Retry</button>
            )}
          </p>
        </section>

        <section className="services-section" id="services">
          <div className="services-heading">
            <div>
              <span className="eyebrow">OUR SERVICES</span>
              <h2>Ride options for every need</h2>
            </div>
            <p>Find the ride that fits your journey. Availability depends on configured services and locations.</p>
          </div>
          <div className="service-card-grid">
            <article className="service-card">
              <div className="service-icon">🚘</div>
              <h3>Standard Ride</h3>
              <p>Comfortable, practical journeys for everyday travel.</p>
              <span className="service-link">Explore ride options →</span>
              <img src="https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=600&q=80" alt="Modern passenger car" loading="lazy" />
            </article>
            <article className="service-card">
              <div className="service-icon">🚙</div>
              <h3>SUV Ride</h3>
              <p>More space for passengers and luggage.</p>
              <span className="service-link">Availability to be confirmed</span>
              <img src="https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=600&q=80" alt="SUV vehicle" loading="lazy" />
            </article>
            <article className="service-card">
              <div className="service-icon">🏍️</div>
              <h3>Bike Ride</h3>
              <p>A motorcycle option for short journeys where supported.</p>
              <span className="service-link">Motorcycle option</span>
              <img src="https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80" alt="Motorcycle" loading="lazy" />
            </article>
            <article className="service-card">
              <div className="service-icon">🚐</div>
              <h3>Van Ride</h3>
              <p>Space for group journeys and larger loads.</p>
              <span className="service-link">Availability to be confirmed</span>
              <img src="https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=600&q=80" alt="Passenger van" loading="lazy" />
            </article>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="eyebrow">STRAIGHTFORWARD BY DESIGN</div>
          <h2>A smoother way to move.</h2>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <div className="feature-icon">⌖</div>
              <h3>Choose your route</h3>
              <p>Tell us where you're starting and where you need to go.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <div className="feature-icon">₦</div>
              <h3>Review your fare</h3>
              <p>See the configured fare before you confirm a booking.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <div className="feature-icon">↗</div>
              <h3>Take your ride</h3>
              <p>Follow the trip status available in your account.</p>
            </article>
            <article className="feature-card">
              <span className="feature-number">04</span>
              <div className="feature-icon">✓</div>
              <h3>Arrive safely</h3>
              <p>Complete your journey and review the trip details.</p>
            </article>
          </div>
        </section>

        <section className="payment-strip">
          <div className="payment-symbol">↗</div>
          <div>
            <strong>Cashless by policy</strong>
            <p>
              {paymentPolicy?.cash_enabled === false
                ? 'EkiMove supports bank transfer only. A screenshot alone does not confirm payment.'
                : 'Bank transfer is the intended payment method. Payment must be verified before it is marked confirmed.'}
            </p>
          </div>
          <span className="payment-tag">BANK TRANSFER</span>
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#home">
          <span className="brand-mark">E</span>
          <span><strong>EkiMove</strong><small>Anywhere in Ekiti</small></span>
        </a>
        <p>Move smarter. Anywhere in Ekiti.</p>
        <span>© {new Date().getFullYear()} EkiMove</span>
      </footer>
      <AtonaFloatingAssistant onApplyBooking={applyAtonaBooking} />
    </div>
  )
}

export default App
