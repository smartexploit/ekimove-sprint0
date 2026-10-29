
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Menu,
  X,
} from 'lucide-react'

import {
  getAccessToken,
  getStoredUser,
  logoutPassenger,
} from '../services/authService.js'

import '../App.css'

export default function AppPage({
  eyebrow = 'EKIMOVE',
  title,
  description,
  sectionTitle,
  sectionText,
  children,
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => Boolean(getAccessToken()),
  )

  const [userRole, setUserRole] = useState(
    () => getStoredUser()?.role || '',
  )

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navigate = useNavigate()

  function closeMobileMenu() {
    setMobileMenuOpen(false)
  }

  function handleLogout() {
    logoutPassenger()
    setIsAuthenticated(false)
    setUserRole('')
    closeMobileMenu()
    navigate('/login')
  }

  return (
    <div className="ek-page auth-page">

      {/* Navigation */}
      <header className="ek-header">
        <div className="ek-container ek-nav">

          <Link
            className="ek-brand"
            to="/"
            onClick={closeMobileMenu}
            aria-label="EkiMove home"
          >
            <span className="ek-brand-mark">E</span>
            <span>
              EkiMove<span className="ek-brand-period">.</span>
            </span>
          </Link>

          <button
            type="button"
            className="ek-mobile-menu-toggle"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={23} /> : <Menu size={23} />}
          </button>

          <nav
            className={`ek-nav-links ${mobileMenuOpen ? 'is-open' : ''}`}
            aria-label="Main navigation"
          >
            <Link to="/" onClick={closeMobileMenu}>
              Home
            </Link>

            {isAuthenticated ? (
              <>
                {userRole === 'driver' ? (
                  <Link to="/driver/status" onClick={closeMobileMenu}>
                    Driver status
                  </Link>
                ) : userRole === 'super_admin' ? (
                  <>
                    <Link to="/admin/dispatch" onClick={closeMobileMenu}>
                      Admin dispatch
                    </Link>

                    <Link to="/admin/drivers" onClick={closeMobileMenu}>
                      Driver verification
                    </Link>

                    <Link to="/admin/payments" onClick={closeMobileMenu}>
                      Payment reconciliation
                    </Link>

                    <Link to="/admin/incidents" onClick={closeMobileMenu}>
                      Incident management
                    </Link>

                    <Link to="/admin/locations" onClick={closeMobileMenu}>
                      Locations &amp; pricing
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/dashboard" onClick={closeMobileMenu}>
                      Dashboard
                    </Link>

                    <Link to="/book-ride" onClick={closeMobileMenu}>
                      Book a Ride
                    </Link>

                    <Link to="/my-rides" onClick={closeMobileMenu}>
                      My Rides
                    </Link>

                    <Link to="/payments" onClick={closeMobileMenu}>
                      Payments
                    </Link>
                  </>
                )}

                <button
                  type="button"
                  className="ek-button ek-button-dark ek-nav-cta"
                  onClick={handleLogout}
                >
                  Sign out <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={closeMobileMenu}>
                  Sign in
                </Link>

                <Link
                  to="/register"
                  className="ek-button ek-button-dark ek-nav-cta"
                  onClick={closeMobileMenu}
                >
                  Create account <ArrowRight size={17} />
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Authentication content */}
      <main className="auth-main">
        <div className="ek-container auth-container">

          <section className="auth-intro">
            <span className="ek-eyebrow">{eyebrow}</span>

            <h1>{title}</h1>

            <p>{description}</p>
          </section>

          <section className="auth-card">
            <div className="auth-card-heading">
              <span className="auth-card-accent" />

              <h2>{sectionTitle}</h2>

              <p>{sectionText}</p>
            </div>

            {children || (
              <div className="app-page-actions">
                <Link to="/register">Create an account</Link>
                <Link to="/login">Sign in</Link>
              </div>
            )}
          </section>

          <p className="auth-payment-note">
            EkiMove uses bank transfer for ride payments.
            Cash payment is not supported.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="ek-footer auth-footer">
        <div className="ek-container auth-footer-content">
          <Link className="ek-brand ek-brand-footer" to="/">
            <span className="ek-brand-mark">E</span>
            <span>
              EkiMove<span className="ek-brand-period">.</span>
            </span>
          </Link>

          <span>
            Made for the way Ekiti moves. ©{' '}
            {new Date().getFullYear()} EkiMove
          </span>
        </div>
      </footer>

    </div>
  )
}
