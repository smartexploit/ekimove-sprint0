import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { ArrowRight, LifeBuoy, MessageCircle, Route, Truck, UserRound, Wallet } from 'lucide-react'
import VehicleIcon from '../../components/ui/VehicleIcon.jsx'
import useBookingRules from '../../hooks/useBookingRules.js'
import useSupportUnread from '../../hooks/useSupportUnread.js'
import AppShell from '../../layouts/AppShell.jsx'
import Hills from '../../components/brand/Hills.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import InstallAppCard from '../../components/pwa/InstallAppCard.jsx'
import { apiRequest } from '../../services/authService.js'
import { firstName, formatNaira, initials } from '../../utils/format.js'
import { isActiveRide, rideStatus } from '../../utils/rides.js'

export default function DashboardPage() {
  const { user } = useOutletContext()
  const [activeRide, setActiveRide] = useState(null)
  const rules = useBookingRules()
  const unread = useSupportUnread()
  const motorcycleMax = rules.max_passengers?.motorcycle ?? 1

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/ride-requests/my-rides')
      .then((data) => {
        if (!active || !Array.isArray(data)) return
        setActiveRide(data.find(isActiveRide) || null)
      })
      .catch(() => {
        // The dashboard still works without ride data.
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <AppShell hideHead>
      <div className="stack stack-lg">
        <section className="where-to" aria-labelledby="where-to-title">
          <p className="eyebrow" style={{ color: 'var(--gold-500)' }}>
            Hello, {firstName(user.full_name)}
          </p>
          <h1 id="where-to-title" className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 46px)' }}>
            Where are you going today?
          </h1>
          <p>Choose how you want to travel. You'll see the fare for your exact route before you book.</p>
          <nav className="ride-picker" aria-label="Choose a vehicle">
            <Link className="ride-pick" to="/book-ride?vehicle=car">
              <span className="ride-pick-icon"><VehicleIcon type="car" /></span>
              <span className="ride-pick-title">Car</span>
              <span className="ride-pick-sub">Up to 4 passengers</span>
            </Link>
            <Link className="ride-pick" to="/book-ride?vehicle=motorcycle">
              <span className="ride-pick-icon"><VehicleIcon type="motorcycle" /></span>
              <span className="ride-pick-title">Motorcycle</span>
              <span className="ride-pick-sub">
                {motorcycleMax >= 2 ? '1 passenger, 2nd at extra cost' : '1 passenger'}
              </span>
            </Link>
            <Link className="ride-pick" to="/move-a-load">
              <span className="ride-pick-icon"><Truck size={24} aria-hidden="true" /></span>
              <span className="ride-pick-title">Move a load</span>
              <span className="ride-pick-sub">Van, big car or dyna</span>
            </Link>
          </nav>
          <Hills base="#F2F5F1" />
        </section>

        <InstallAppCard />

        {activeRide && (
          <Link
            to="/my-rides"
            className="card row row-between"
            style={{ textDecoration: 'none', color: 'inherit', flexWrap: 'nowrap' }}
          >
            <div className="stack stack-sm" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <StatusBadge status={rideStatus(activeRide)} />
                <span className="muted small">Request #{activeRide.id}</span>
              </div>
              <p className="list-item-title">
                {activeRide.origin_text} → {activeRide.destination_text}
              </p>
              <p className="muted small">
                {formatNaira(activeRide.quoted_fare)}
                {activeRide.driver_name ? ` · Driver ${activeRide.driver_name}` : ''}
              </p>
            </div>
            <ArrowRight size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
          </Link>
        )}

        <div className="grid grid-auto">
          <Link className="action-card" to="/book-ride">
            <span className="action-icon"><ArrowRight size={22} aria-hidden="true" /></span>
            <h2>Book a ride</h2>
            <p>Pick your pickup and destination and see every vehicle's fare.</p>
          </Link>
          <Link className="action-card" to="/my-rides">
            <span className="action-icon"><Route size={22} aria-hidden="true" /></span>
            <h2>My rides</h2>
            <p>Follow a live ride, see its driver and look back at past trips.</p>
          </Link>
          <Link className="action-card" to="/payments">
            <span className="action-icon" style={{ background: 'var(--gold-100)', color: 'var(--gold-700)' }}>
              <Wallet size={22} aria-hidden="true" />
            </span>
            <h2>Payments</h2>
            <p>Pay for an assigned ride by bank transfer or Interswitch. No cash.</p>
          </Link>
          <Link className="action-card" to="/support">
            <span className="action-icon" style={{ background: 'var(--laterite-100)', color: 'var(--laterite-700)' }}>
              <LifeBuoy size={22} aria-hidden="true" />
            </span>
            <h2>
              Chat with support
              {unread > 0 && <span className="nav-dot" aria-label={`${unread} new replies`} />}
            </h2>
            <p>Questions about a ride, a payment or your account? Message the EkiMove team.</p>
            <span className="row small" style={{ gap: 6, fontWeight: 800, color: 'var(--green-800)' }}>
              <MessageCircle size={16} aria-hidden="true" /> {unread > 0 ? 'You have a reply' : 'Start a chat'}
            </span>
          </Link>
          <Link className="action-card" to="/profile">
            <span className="avatar" aria-hidden="true">{initials(user.full_name)}</span>
            <h2>Your profile</h2>
            <p>{user.full_name} · {user.phone}</p>
            <span className="row small" style={{ gap: 6, fontWeight: 800, color: 'var(--green-800)' }}>
              <UserRound size={16} aria-hidden="true" /> Edit details or password
            </span>
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
