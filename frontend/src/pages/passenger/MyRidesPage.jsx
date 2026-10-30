
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppPage from '../../components/layout/AppPage';
import { apiRequest } from '../../services/authService';
import SOSButton from '../../components/SOSButton';
import './MyRidesPage.css';

function formatFare(value) {
  if (value === null || value === undefined) return 'Not available';

  return `₦${Number(value).toLocaleString('en-NG')}`;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';

  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readableStatus(status) {
  if (!status) return 'Unknown';

  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusClass(status) {
  const normalized = (status || '').toLowerCase();

  if (['completed', 'paid'].includes(normalized)) return 'completed';
  if (['accepted', 'assigned', 'in_progress', 'ongoing'].includes(normalized)) {
    return 'active';
  }
  if (['cancelled', 'rejected', 'failed'].includes(normalized)) {
    return 'cancelled';
  }

  return 'pending';
}

function getRideId(ride) {
  return ride.id || ride.ride_request_id || ride.request_id || 'N/A';
}

export default function MyRidesPage() {
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function fetchRides() {
      try {
        const data = await apiRequest('/api/v1/ride-requests/my-rides');

        if (active) {
          setRides(Array.isArray(data) ? data : []);
          setError('');
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Unable to load your rides.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchRides();

    const interval = setInterval(fetchRides, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshKey]);

  const activeRides = rides.filter((ride) =>
    ['requested', 'accepted', 'assigned', 'in_progress', 'ongoing'].includes(
      (ride.ride_status || ride.status || '').toLowerCase()
    )
  );

  const completedRides = rides.filter((ride) =>
    (ride.ride_status || ride.status || '').toLowerCase() === 'completed'
  );

  return (
    <AppPage>
      <div className="rides-dashboard">

        {/* Sidebar */}
        <aside className="rides-sidebar">
          <Link to="/" className="rides-logo">
            <span className="rides-logo-icon">E</span>
            <span>EkiMove</span>
          </Link>

          <div className="sidebar-section">
            <p className="sidebar-label">MENU</p>

            <Link to="/dashboard" className="sidebar-link">
              <span>▦</span> Overview
            </Link>

            <Link to="/my-rides" className="sidebar-link active">
              <span>↗</span> My Rides
            </Link>

            <Link to="/payments" className="sidebar-link">
              <span>₦</span> Payments
            </Link>

            <Link to="/profile" className="sidebar-link">
              <span>◉</span> My Profile
            </Link>
          </div>

          <div className="sidebar-bottom">
            <p className="sidebar-label">SUPPORT</p>
            <Link to="/support" className="sidebar-link">
              <span>?</span> Help & Support
            </Link>

            <div className="sidebar-help">
              <div className="help-icon">✦</div>
              <strong>Need assistance?</strong>
              <p>Our support team is ready to help.</p>
              <Link to="/support">Contact support →</Link>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="rides-main">

          <header className="rides-topbar">
            <div className="breadcrumb">
              Dashboard <span>/</span> <strong>My Rides</strong>
            </div>

            <div className="topbar-user">
              <div className="user-avatar">P</div>
              <span>Passenger</span>
            </div>
          </header>

          <section className="rides-content">

            <div className="rides-heading">
              <div>
                <p className="dashboard-eyebrow">YOUR JOURNEY</p>
                <h1>My Rides</h1>
                <p className="heading-description">
                  View and manage all your ride requests in one place.
                </p>
              </div>

              <button
                className="refresh-button"
                onClick={() => {
                  setLoading(true);
                  setRefreshKey((prev) => prev + 1);
                }}
              >
                ↻ Refresh
              </button>
            </div>

            {/* Summary cards */}
            <div className="ride-summary-grid">
              <div className="ride-summary-card">
                <div className="summary-icon total-icon">↗</div>
                <div>
                  <p>Total Rides</p>
                  <h2>{rides.length}</h2>
                </div>
              </div>

              <div className="ride-summary-card">
                <div className="summary-icon active-icon">◷</div>
                <div>
                  <p>Active Rides</p>
                  <h2>{activeRides.length}</h2>
                </div>
              </div>

              <div className="ride-summary-card">
                <div className="summary-icon completed-icon">✓</div>
                <div>
                  <p>Completed Rides</p>
                  <h2>{completedRides.length}</h2>
                </div>
              </div>
            </div>

            {/* Rides list */}
            <section className="rides-list-section">
              <div className="rides-list-heading">
                <div>
                  <h2>Ride History</h2>
                  <p>All your previous and ongoing trips.</p>
                </div>

                <span className="ride-count">{rides.length} rides</span>
              </div>

              {loading && rides.length === 0 ? (
                <div className="rides-state">
                  <div className="loading-spinner" />
                  <p>Loading your rides...</p>
                </div>
              ) : error && rides.length === 0 ? (
                <div className="rides-state error-state">
                  <h3>Unable to load rides</h3>
                  <p>{error}</p>
                  <button
                    onClick={() => {
                      setLoading(true);
                      setRefreshKey((prev) => prev + 1);
                    }}
                  >
                    Try again
                  </button>
                </div>
              ) : rides.length === 0 ? (
                <div className="rides-state">
                  <div className="empty-ride-icon">↗</div>
                  <h3>No rides yet</h3>
                  <p>Your ride requests will appear here once you book a ride.</p>
                  <Link to="/book-ride" className="book-ride-button">
                    Book a Ride
                  </Link>
                </div>
              ) : (
                <div className="rides-card-list">
                  {rides.map((ride, index) => {
                    const status = ride.ride_status || ride.status;
                    const statusClass = getStatusClass(status);

                    return (
                      <article
                        className="ride-card"
                        key={getRideId(ride) !== 'N/A'
                          ? getRideId(ride)
                          : index}
                      >
                        <div className="ride-card-top">
                          <div className="ride-reference">
                            <span className="ride-car-icon">🚘</span>
                            <div>
                              <span className="ride-reference-label">
                                RIDE REFERENCE
                              </span>
                              <strong>#{getRideId(ride)}</strong>
                            </div>
                          </div>

                          <span className={`ride-status ${statusClass}`}>
                            <span className="status-dot" />
                            {readableStatus(status)}
                          </span>
                        </div>

                        <div className="ride-route">
                          <div className="route-point">
                            <span className="route-dot pickup-dot" />
                            <div>
                              <small>PICKUP LOCATION</small>
                              <strong>{ride.origin || 'Not provided'}</strong>
                            </div>
                          </div>

                          <div className="route-line" />

                          <div className="route-point">
                            <span className="route-dot destination-dot" />
                            <div>
                              <small>DESTINATION</small>
                              <strong>{ride.destination || 'Not provided'}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="ride-details">
                          <div>
                            <small>VEHICLE</small>
                            <strong>{ride.vehicle_type || 'Not specified'}</strong>
                          </div>

                          <div>
                            <small>PASSENGERS</small>
                            <strong>{ride.passengers ?? 'N/A'}</strong>
                          </div>

                          <div>
                            <small>QUOTED FARE</small>
                            <strong className="ride-fare">
                              {formatFare(ride.quoted_fare)}
                            </strong>
                          </div>

                          <div>
                            <small>DATE REQUESTED</small>
                            <strong>{formatDate(ride.created_at)}</strong>
                          </div>
                        </div>

                        <div className="ride-card-actions">
                          {ride.assigned_ride_id && (
                            <div className="ride-sos-action">
                              <SOSButton
                                rideId={ride.assigned_ride_id}
                                rideStatus={ride.ride_status}
                              />
                            </div>
                          )}

                          {ride.assigned_ride_id && (
                            <Link
                              to={`/payments/${ride.assigned_ride_id}`}
                              className="payment-link"
                            >
                              View Payment →
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

          </section>
        </main>
      </div>
    </AppPage>
  );
}
