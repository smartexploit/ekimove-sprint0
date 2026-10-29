
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

  const navigate = useNavigate()

  function handleLogout() {
    logoutPassenger()
    setIsAuthenticated(false)
    setUserRole('')
    navigate('/login')
  }

  return (
    <div className="site-shell app-page">
      <header className="app-page-header">
        <Link
          className="brand"
          to="/"
          aria-label="EkiMove home"
        >
          <span className="brand-mark">E</span>
          <span>
            <strong>EkiMove</strong>
            <small>Move around Ekiti</small>
          </span>
        </Link>

        <nav aria-label="Main navigation">
          <Link to="/">Home</Link>

          {isAuthenticated ? (
            <>
              {userRole === 'driver' ? (
                <Link to="/driver/status">
                  Driver status
                </Link>
              ) : userRole === 'super_admin' ? (
                <>
                  <Link to="/admin/dispatch">
                    Admin dispatch
                  </Link>
                  <Link to="/admin/drivers">
                    Driver verification
                  </Link>
                  <Link to="/admin/payments">
                    Payment reconciliation
                  </Link>
                  <Link to="/admin/incidents">
                    Incident management
                  </Link>
                  <Link to="/admin/locations">Locations &amp; pricing</Link>
                </>
              ) : (
                <>
                  <Link to="/dashboard">Dashboard</Link>
                  <Link to="/book-ride">Book a Ride</Link>
                  <Link to="/my-rides">My Rides</Link>
                  <Link to="/payments">Payments</Link>
                </>
              )}

              <button
                type="button"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create account</Link>
            </>
          )}
        </nav>
      </header>

      <main className="app-page-content">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>

        <section className="app-page-panel">
          <h2>{sectionTitle}</h2>
          <p>{sectionText}</p>

          {children || (
            <div className="app-page-actions">
              <Link to="/register">Create an account</Link>
              <Link to="/login">Sign in</Link>
            </div>
          )}
        </section>

        <p className="app-page-note">
          EkiMove uses bank transfer for ride payments.
          Cash payment is not supported.
        </p>
      </main>

      <footer className="app-page-footer">
        Made for the way Ekiti moves. &copy;{' '}
        {new Date().getFullYear()} EkiMove
      </footer>
    </div>
  )
}

