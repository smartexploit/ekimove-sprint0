import { Link, useOutletContext, useNavigate } from 'react-router-dom'
import AppPage from '../../layouts/AppPage.jsx'
import { logoutPassenger } from '../../services/authService.js'

export default function DashboardPage() {
  const { user } = useOutletContext()
  const navigate = useNavigate()

  function handleSignOut() {
    logoutPassenger()
    navigate('/', { replace: true })
  }

  return (
    <AppPage
      eyebrow="PASSENGER PORTAL"
      title={`Welcome, ${user.full_name.split(' ')[0]}`}
      description="Your EkiMove passenger space for planning and managing journeys around Ekiti."
      sectionTitle="Your account"
      sectionText="Your account has been verified with the EkiMove service."
    >
      <div className="passenger-dashboard">
        <div className="passenger-account">
          <div className="passenger-avatar" aria-hidden="true">
            {user.full_name.trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <h3>{user.full_name}</h3>
            <p>{user.phone}</p>
            <span className="account-status">
              {user.is_active ? 'Active account' : 'Inactive account'}
            </span>
          </div>
        </div>

        <div className="passenger-actions">
          <Link className="passenger-action-card passenger-action-primary" to="/book-ride">
            <span className="passenger-action-icon" aria-hidden="true">↗</span>
            <strong>Book a ride</strong>
            <span>Request a journey with pickup and destination details.</span>
          </Link>

          <Link className="passenger-action-card" to="/my-rides">
            <span className="passenger-action-icon" aria-hidden="true">≡</span>
            <strong>My rides</strong>
            <span>Ride history is not available yet. View the current feature status.</span>
          </Link>

          <Link className="passenger-action-card" to="/payments">
            <span className="passenger-action-icon" aria-hidden="true">₦</span>
            <strong>Payments</strong>
            <span>Review EkiMove's bank-transfer-only payment policy.</span>
          </Link>
        </div>

        <div className="passenger-dashboard-footer">
          <p>Signed in as a <strong>{user.role}</strong>.</p>
          <button className="passenger-signout" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </AppPage>
  )
}
