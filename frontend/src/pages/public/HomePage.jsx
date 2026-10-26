import { useEffect, useState } from 'react'
import '../../App.css'

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

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="EkiMove home">
          <span className="brand-mark">E</span>
          <span>
            <strong>EkiMove</strong>
            <small>Move around Ekiti</small>
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
            <h1>Your city.<br />Your journey.<br /><span>Your move.</span></h1>
            <p className="hero-description">
              A simpler way to plan your next ride around Ekiti.
              Choose your route and get ready to move.
            </p>
            <a className="primary-button" href="#book">Plan your ride <span>→</span></a>
            <div className="hero-proof">
              <span className="proof-icon">⌖</span>
              <span><strong>Local by design</strong><small>Starting with six pilot zones</small></span>
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
              <h3>Get ready to go</h3>
              <p>Booking and payment confirmation will follow verified service steps.</p>
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
          <span><strong>EkiMove</strong><small>Move around Ekiti</small></span>
        </a>
        <p>Made for the way Ekiti moves.</p>
        <span>© {new Date().getFullYear()} EkiMove</span>
      </footer>
    </div>
  )
}

export default App
