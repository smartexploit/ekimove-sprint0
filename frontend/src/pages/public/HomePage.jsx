import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bike,
  CarFront,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  MapPin,
  Menu,
  Navigation,
  ShieldCheck,
  X,
} from "lucide-react";

import "./HomePage.css";
// import "../../components/AtonaFloatingAssistant";
import AtonaFloatingAssistant from "../../components/AtonaFloatingAssistant";

const API_BASE_URL = "/api/v1";

const FALLBACK_ZONES = [
  { id: "ado-ekiti", name: "Ado-Ekiti" },
  { id: "ilawe-ekiti", name: "Ilawe-Ekiti" },
  { id: "ikere-ekiti", name: "Ikere-Ekiti" },
  { id: "aromoko-ekiti", name: "Aromoko-Ekiti" },
  { id: "igede-ekiti", name: "Igede-Ekiti" },
];

function getZoneName(zone) {
  if (typeof zone === "string") return zone;

  return (
    zone?.name ||
    zone?.zone_name ||
    zone?.title ||
    zone?.label ||
    ""
  );
}

function SectionHeading({ eyebrow, title, description, light = false }) {
  return (
    <div className={`ek-section-heading ${light ? "is-light" : ""}`}>
      {eyebrow && <span className="ek-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [zones, setZones] = useState(FALLBACK_ZONES);
  const [paymentPolicy, setPaymentPolicy] = useState(null);
  const [loadingZones, setLoadingZones] = useState(true);

  const [rideType, setRideType] = useState("bike");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [rideMessage, setRideMessage] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPageData() {
      try {
        const [zonesResponse, paymentResponse] = await Promise.allSettled([
          fetch(`${API_BASE_URL}/zones`),
          fetch(`${API_BASE_URL}/policy/payments`),
        ]);

        if (!active) return;

        if (
          zonesResponse.status === "fulfilled" &&
          zonesResponse.value.ok
        ) {
          const zonesData = await zonesResponse.value.json();

          const receivedZones = Array.isArray(zonesData)
            ? zonesData
            : zonesData?.zones || zonesData?.data || [];

          if (receivedZones.length > 0) {
            setZones(receivedZones);
          }
        }

        if (
          paymentResponse.status === "fulfilled" &&
          paymentResponse.value.ok
        ) {
          const paymentData = await paymentResponse.value.json();
          setPaymentPolicy(paymentData);
        }
      } catch (error) {
        console.error("Unable to load EkiMove page data:", error);
      } finally {
        if (active) setLoadingZones(false);
      }
    }

    loadPageData();

    return () => {
      active = false;
    };
  }, []);

  const scrollToBooking = () => {
    document.getElementById("booking")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    setMobileMenuOpen(false);
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const handleRideSubmit = (event) => {
    event.preventDefault();
    setFormError("");
    setRideMessage("");

    if (!pickup || !destination) {
      setFormError("Please select both your pickup and destination.");
      return;
    }

    if (pickup === destination) {
      setFormError("Your pickup and destination cannot be the same.");
      return;
    }

    setRideMessage(
      `Your ${rideType === "bike" ? "bike" : "car"} ride details are ready. Ride booking will be available once the booking service is connected.`
    );
  };

  const zoneOptions = zones
    .map((zone) => ({
      value: getZoneName(zone),
      label: getZoneName(zone),
    }))
    .filter((zone) => zone.value);

  const paymentDescription =
    paymentPolicy?.description ||
    paymentPolicy?.message ||
    paymentPolicy?.policy ||
    "Payment options and ride pricing will be communicated clearly before your journey.";

  return (
    <div className="ek-page">
      {/* Navigation */}
      <header className="ek-header">
        <div className="ek-container ek-nav">
          <a
            className="ek-brand"
            href="#home"
            onClick={closeMobileMenu}
            aria-label="EkiMove home"
          >
            <span className="ek-brand-mark">E</span>
            <span>EkiMove<span className="ek-brand-period">.</span></span>
          </a>

          <button
            type="button"
            className="ek-mobile-menu-toggle"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={23} /> : <Menu size={23} />}
          </button>

        
<nav className={`ek-nav-links ${mobileMenuOpen ? "is-open" : ""}`}>
  <a href="#home" onClick={closeMobileMenu}>Home</a>
  <a href="#services" onClick={closeMobileMenu}>Services</a>
  <a href="#how-it-works" onClick={closeMobileMenu}>How it works</a>
  <a href="#about" onClick={closeMobileMenu}>About us</a>

  <Link
    to="/login"
    className="ek-nav-auth-link"
    onClick={closeMobileMenu}
  >
    Sign in
  </Link>

  <Link
    to="/register"
    className="ek-button ek-button-lime ek-nav-cta"
    onClick={closeMobileMenu}
  >
    Create account <ArrowRight size={17} />
  </Link>

  <button
    type="button"
    className="ek-button ek-button-dark"
    onClick={scrollToBooking}
  >
    Find a ride <ArrowRight size={17} />
  </button>
</nav>

        </div>
      </header>

      <main>
        {/* Full-width hero */}
        <section className="ek-hero-banner" id="home">
          <img
            className="ek-hero-banner-image"
            src="/images/ekimove-local-rides.jpg"
            alt="Local motorcycle and car transport for everyday journeys in Ekiti"
            fetchPriority="high"
          />

          <div className="ek-hero-banner-overlay" />

          <div className="ek-container ek-hero-banner-content">
            <span className="ek-hero-badge">
              <span className="ek-status-dot" />
              YOUR JOURNEY. YOUR EKITI.
            </span>

            <h1>
              Getting around Ekiti,
              <br />
              <span>made easier.</span>
            </h1>

            <p>
              EkiMove is building a simpler way to move around Ekiti State.
              Find a ride for your everyday journeys, choose between a bike
              or a car, and plan your trip from pickup to destination.
            </p>

            <div className="ek-hero-banner-actions">
              <button
                type="button"
                className="ek-button ek-button-lime"
                onClick={scrollToBooking}
              >
                Find a ride <ArrowRight size={19} />
              </button>

              <a href="#about" className="ek-hero-learn-more">
                Discover EkiMove <ArrowRight size={18} />
              </a>
            </div>

            <div className="ek-hero-banner-details">
              <div>
                <Bike size={21} />
                <span>Bike rides</span>
              </div>

              <span className="ek-hero-detail-divider" />

              <div>
                <CarFront size={21} />
                <span>Car rides</span>
              </div>

              <span className="ek-hero-detail-divider" />

              <div>
                <MapPin size={21} />
                <span>Made for Ekiti</span>
              </div>
            </div>
          </div>

          <div className="ek-hero-banner-bottom">
            <span>LOCAL TRANSPORT, A BETTER EXPERIENCE.</span>
            <span>EKITI STATE, NIGERIA</span>
          </div>
        </section>

        {/* Booking form */}
        <section className="ek-booking-section" id="booking">
          <div className="ek-container">
            <div className="ek-booking-card">
              <div className="ek-booking-intro">
                <span className="ek-eyebrow">PLAN YOUR JOURNEY</span>
                <h2>Where are you headed?</h2>
                <p>
                  Start with your pickup point, destination, and preferred
                  ride type.
                </p>
              </div>

              <form className="ek-booking-form" onSubmit={handleRideSubmit}>
                <div className="ek-ride-type">
                  <button
                    type="button"
                    className={`ek-ride-option ${
                      rideType === "bike" ? "is-selected" : ""
                    }`}
                    onClick={() => setRideType("bike")}
                    aria-pressed={rideType === "bike"}
                  >
                    <Bike size={23} />
                    <span>
                      <strong>Bike</strong>
                      <small>For quick trips</small>
                    </span>
                    {rideType === "bike" && <Check size={18} />}
                  </button>

                  <button
                    type="button"
                    className={`ek-ride-option ${
                      rideType === "car" ? "is-selected" : ""
                    }`}
                    onClick={() => setRideType("car")}
                    aria-pressed={rideType === "car"}
                  >
                    <CarFront size={23} />
                    <span>
                      <strong>Car</strong>
                      <small>For extra comfort</small>
                    </span>
                    {rideType === "car" && <Check size={18} />}
                  </button>
                </div>

                <div className="ek-booking-fields">
                  <label className="ek-field">
                    <span>Pickup location</span>
                    <span className="ek-input-wrap">
                      <MapPin size={19} />
                      <select
                        value={pickup}
                        onChange={(event) => setPickup(event.target.value)}
                        required
                      >
                        <option value="">Choose pickup</option>
                        {zoneOptions.map((zone) => (
                          <option key={zone.value} value={zone.value}>
                            {zone.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="ek-select-chevron" size={17} />
                    </span>
                  </label>

                  <label className="ek-field">
                    <span>Destination</span>
                    <span className="ek-input-wrap">
                      <Navigation size={19} />
                      <select
                        value={destination}
                        onChange={(event) => setDestination(event.target.value)}
                        required
                      >
                        <option value="">Choose destination</option>
                        {zoneOptions.map((zone) => (
                          <option key={zone.value} value={zone.value}>
                            {zone.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="ek-select-chevron" size={17} />
                    </span>
                  </label>

                  <button
                    type="submit"
                    className="ek-button ek-button-lime ek-booking-submit"
                  >
                    Continue <ArrowRight size={18} />
                  </button>
                </div>

                {loadingZones && (
                  <p className="ek-form-note">Loading available locations…</p>
                )}

                {formError && (
                  <p className="ek-form-message is-error" role="alert">
                    {formError}
                  </p>
                )}

                {rideMessage && (
                  <p className="ek-form-message is-success" role="status">
                    {rideMessage}
                  </p>
                )}
              </form>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="ek-benefits-section">
          <div className="ek-container ek-benefits-grid">
            <div className="ek-benefit">
              <span className="ek-benefit-icon"><MapPin size={23} /></span>
              <div>
                <h3>Local by design</h3>
                <p>Built around the everyday movement needs of Ekiti residents.</p>
              </div>
            </div>

            <div className="ek-benefit">
              <span className="ek-benefit-icon"><Clock3 size={23} /></span>
              <div>
                <h3>Less hassle</h3>
                <p>A simpler way to plan where you are going and how to get there.</p>
              </div>
            </div>

            <div className="ek-benefit">
              <span className="ek-benefit-icon"><ShieldCheck size={23} /></span>
              <div>
                <h3>Clarity first</h3>
                <p>Clear journey details help you make informed transport choices.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Services */}
        <section className="ek-section ek-services-section" id="services">
          <div className="ek-container">
            <SectionHeading
              eyebrow="OUR SERVICES"
              title="A ride for the way you move."
              description="Different journeys call for different rides. EkiMove is designed around practical local transport options."
            />

            <div className="ek-services-grid">
              <article className="ek-service-card ek-service-bike">
                <div className="ek-service-copy">
                  <span className="ek-service-number">01 / BIKE</span>
                  <h3>Quick trips.<br />Easy movement.</h3>
                  <p>
                    For everyday errands, short journeys, and getting around
                    town without unnecessary stress.
                  </p>
                  <button
                    type="button"
                    className="ek-text-link"
                    onClick={scrollToBooking}
                  >
                    Explore bike rides <ArrowRight size={18} />
                  </button>
                </div>

                <div className="ek-service-visual ek-service-visual-bike">
                  <Bike size={112} strokeWidth={1.2} />
                  <span className="ek-service-visual-label">BIKE</span>
                </div>
              </article>

              <article className="ek-service-card ek-service-car">
                <div className="ek-service-copy">
                  <span className="ek-service-number">02 / CAR</span>
                  <h3>More room.<br />More comfort.</h3>
                  <p>
                    An alternative for when you need a car for your journey
                    around the city and beyond.
                  </p>
                  <button
                    type="button"
                    className="ek-text-link"
                    onClick={scrollToBooking}
                  >
                    Explore car rides <ArrowRight size={18} />
                  </button>
                </div>

                <div className="ek-service-visual ek-service-visual-car">
                  <CarFront size={112} strokeWidth={1.2} />
                  <span className="ek-service-visual-label">CAR</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          className="ek-section ek-how-section"
          id="how-it-works"
        >
          <div className="ek-container">
            <SectionHeading
              eyebrow="HOW IT WORKS"
              title="Your journey, in three steps."
              description="The goal is to make planning a local trip feel straightforward from the very beginning."
            />

            <div className="ek-steps-grid">
              <article className="ek-step-card">
                <span className="ek-step-number">01</span>
                <span className="ek-step-icon"><MapPin size={25} /></span>
                <h3>Choose your locations</h3>
                <p>
                  Select where your journey starts and where you want to go.
                </p>
              </article>

              <article className="ek-step-card">
                <span className="ek-step-number">02</span>
                <span className="ek-step-icon"><Bike size={25} /></span>
                <h3>Select your ride</h3>
                <p>
                  Choose a bike or car based on your journey and preferences.
                </p>
              </article>

              <article className="ek-step-card">
                <span className="ek-step-number">03</span>
                <span className="ek-step-icon"><Navigation size={25} /></span>
                <h3>Get ready to move</h3>
                <p>
                  Review your journey details and follow the booking process
                  as the service becomes available.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="ek-section ek-about-section" id="about">
          <div className="ek-container ek-about-grid">
            <div className="ek-about-image-wrap">
              <img
                src="/images/ekimove-ekiti-street.jpg"
                alt="A local street scene representing everyday movement in Ekiti"
                className="ek-about-image"
                loading="lazy"
              />

              <div className="ek-about-image-note">
                <span className="ek-about-note-mark">E</span>
                <span>
                  <strong>Made for Ekiti.</strong>
                  <small>Designed around local journeys.</small>
                </span>
              </div>
            </div>

            <div className="ek-about-copy">
              <span className="ek-eyebrow">ABOUT EKIMOVE</span>
              <h2>Moving our communities forward, one ride at a time.</h2>

              <p>
                Getting from one place to another is part of everyday life.
                Whether it is going to work, running an errand, attending
                an appointment, or visiting family, local movement should
                feel simpler.
              </p>

              <p>
                EkiMove is a transport project focused on making it easier
                to plan local journeys across Ekiti State, with practical
                ride options and an experience designed for the people who
                live and move here.
              </p>

              <a href="#booking" className="ek-button ek-button-dark">
                Plan your journey <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </section>

        {/* Payment information */}
        <section className="ek-payment-section">
          <div className="ek-container ek-payment-card">
            <div className="ek-payment-icon">
              <CreditCard size={28} />
            </div>

            <div className="ek-payment-copy">
              <span className="ek-eyebrow">PAYMENT INFORMATION</span>
              <h2>Know what to expect.</h2>
              <p>{paymentDescription}</p>
            </div>

            <div className="ek-payment-note">
              <ShieldCheck size={20} />
              <span>Clear information. Better decisions.</span>
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="ek-final-cta">
          <div className="ek-container ek-final-cta-content">
            <span className="ek-eyebrow">YOUR NEXT JOURNEY STARTS HERE</span>
            <h2>Wherever you're going,<br />let's make moving easier.</h2>
            <p>
              Explore a simpler approach to local transport in Ekiti State.
            </p>
            <button
              type="button"
              className="ek-button ek-button-lime"
              onClick={scrollToBooking}
            >
              Find a ride <ArrowRight size={19} />
            </button>
          </div>
          <div className="ek-cta-decoration" aria-hidden="true">E</div>
        </section>
      </main>

      {/* Footer */}
      <footer className="ek-footer">
        <div className="ek-container">
          <div className="ek-footer-main">
            <div className="ek-footer-brand">
              <a className="ek-brand ek-brand-footer" href="#home">
                <span className="ek-brand-mark">E</span>
                <span>EkiMove<span className="ek-brand-period">.</span></span>
              </a>
              <p>
                A simpler way to think about local transportation in Ekiti
                State, Nigeria.
              </p>
            </div>

            <div className="ek-footer-links">
              <h4>Explore</h4>
              <a href="#services">Our services</a>
              <a href="#how-it-works">How it works</a>
              <a href="#about">About EkiMove</a>
            </div>

            <div className="ek-footer-links">
              <h4>Get started</h4>
              <button type="button" onClick={scrollToBooking}>Find a ride</button>
              <a href="#booking">Plan your journey</a>
            </div>

            <div className="ek-footer-location">
              <span className="ek-footer-location-icon"><MapPin size={19} /></span>
              <div>
                <h4>Rooted in Ekiti</h4>
                <p>Ekiti State, Nigeria</p>
              </div>
            </div>
          </div>

          <div className="ek-footer-bottom">
            <span>© {new Date().getFullYear()} EkiMove. All rights reserved.</span>
            <span>Built with Ekiti in mind.</span>
          </div>
        </div>
      </footer>

      {/* Keep your existing Atona assistant component mounted here if it
          is a default-exported React component. See note below the code. */}

          <AtonaFloatingAssistant />
    </div>
  );
}