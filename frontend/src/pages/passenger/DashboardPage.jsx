import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { ArrowRight, LifeBuoy, Route, Wallet } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Hills from '../../components/brand/Hills.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import InstallAppCard from '../../components/pwa/InstallAppCard.jsx'
import { apiRequest } from '../../services/authService.js'
import { firstName, formatNaira } from '../../utils/format.js'
import { isActiveRide, rideStatus } from '../../utils/rides.js'

export default function DashboardPage() {
  const { user } = useOutletContext()
  const [activeRide, setActiveRide] = useState(null)

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
          <p>See the fare for your exact route before you request a ride.</p>
          <div>
            <Link className="btn btn-gold btn-lg" to="/book-ride">
              Book a ride <ArrowRight size={20} aria-hidden="true" />
            </Link>
          </div>
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
          <div className="action-card">
            <span className="action-icon" style={{ background: 'var(--laterite-100)', color: 'var(--laterite-700)' }}>
              <LifeBuoy size={22} aria-hidden="true" />
            </span>
            <h2>Need help?</h2>
            <SupportContacts
              className="stack stack-sm small"
              linkClassName="contact-link text-link"
              fallback={<p>Support contacts will appear here once they're set up.</p>}
            />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
