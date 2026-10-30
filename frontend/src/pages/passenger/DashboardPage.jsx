
import { Link, useOutletContext, useNavigate } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { logoutPassenger } from '../../services/authService.js'
import './DashboardPage.css'

export default function DashboardPage() {
  const { user } = useOutletContext()
  const navigate = useNavigate()

  const firstName = user?.full_name?.trim()?.split(/\s+/)[0] || 'there'
  const initials = user?.full_name?.trim()?.charAt(0).toUpperCase() || 'P'

  function handleSignOut() {
    logoutPassenger()
    navigate('/', { replace: true })
  }

  return (
    <AppPage
      eyebrow="PASSENGER PORTAL"
      title={`Welcome back, ${firstName}!`}
      description="Your journey starts here. Manage your rides and account from one place."
      sectionTitle="Your dashboard"
      sectionText="Everything you need for a smoother journey around Ekiti."
    >
      <div className="passenger-dashboard">

        {/* Account overview */}
        <section className="dashboard-account">
          <div className="dashboard-account-info">
            <div className="dashboard-avatar">
              {initials}
            </div>

            <div className="dashboard-user-details">
              <span className="dashboard-label">YOUR ACCOUNT</span>
              <h3>{user.full_name}</h3>
              <p>{user.phone}</p>
              <span className={`dashboard-status ${user.is_active ? 'is-active' : 'is-inactive'}`}>
                <span className="status-dot" />
                {user.is_active ? 'Active account' : 'Inactive account'}
              </span>
            </div>
          </div>

          <div className="dashboard-account-badge">
            <span>Passenger</span>
            <span className="dashboard-badge-icon">✦</span>
          </div>
        </section>

        {/* Book a ride */}
        <section className="dashboard-booking">
          <div className="dashboard-booking-content">
            <span className="dashboard-label">READY TO MOVE?</span>
            <h2>Where would you like to go today?</h2>
            <p>
              Book your next ride with EkiMove and get moving
              around Ekiti with ease.
            </p>

            <Link to="/book-ride" className="dashboard-book-button">
              Book a ride <span>↗</span>
            </Link>
          </div>

          <div className="dashboard-booking-decoration" aria-hidden="true">
            <span>↗</span>
          </div>
        </section>

        {/* Services */}
        <section className="dashboard-services">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-label">QUICK ACCESS</span>
              <h2>Manage your journeys</h2>
            </div>
          </div>

          <div className="dashboard-actions">

            <Link to="/my-rides" className="dashboard-action-card">
              <div className="dashboard-action-icon rides-icon">≡</div>
              <div className="dashboard-action-text">
                <h3>My rides</h3>
                <p>View your ride history and journey details.</p>
              </div>
              <span className="dashboard-action-arrow">↗</span>
            </Link>

            <Link to="/payments" className="dashboard-action-card">
              <div className="dashboard-action-icon payments-icon">₦</div>
              <div className="dashboard-action-text">
                <h3>Payments</h3>
                <p>Learn about payment options and transfer policies.</p>
              </div>
              <span className="dashboard-action-arrow">↗</span>
            </Link>

          </div>
        </section>

        {/* Footer */}
        <footer className="dashboard-footer">
          <p>
            Signed in as a <strong>{user.role}</strong>.
          </p>

          <button
            className="dashboard-signout"
            type="button"
            onClick={handleSignOut}
          >
            <span>↗</span> Sign out
          </button>
        </footer>

      </div>
    </AppPage>
  )
}
