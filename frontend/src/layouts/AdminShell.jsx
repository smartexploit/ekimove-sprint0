import { NavLink, useNavigate, useOutletContext } from 'react-router-dom'
import {
  AlertTriangle,
  Banknote,
  Calculator,
  FileBarChart,
  Gift,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Map as MapIcon,
  Truck,
  MapPinned,
  UserCog,
  Users,
  MapPin,
  Rocket,
  Route,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import Logo from '../components/brand/Logo.jsx'
import useSupportUnread from '../hooks/useSupportUnread.js'
import { signOutCompletely } from '../services/authService.js'
import { canOpen } from '../utils/roles.js'

const NAV = [
  ['/admin/overview', 'Overview', LayoutDashboard],
  ['/admin/launch', 'Launch checklist', Rocket],
  ['/admin/map', 'Live map', MapIcon],
  ['/admin/dispatch', 'Dispatch', Route],
  ['/admin/loads', 'Loads', Truck],
  ['/admin/support', 'Support', LifeBuoy],
  ['/admin/people', 'People', Users],
  ['/admin/payments', 'Payments', Wallet],
  ['/admin/earnings', 'Earnings', Banknote],
  ['/admin/reports', 'Reports', FileBarChart],
  ['/admin/promos', 'Promos & invites', Gift],
  ['/admin/incidents', 'Incidents', AlertTriangle],
  ['/admin/drivers', 'Driver verification', ShieldCheck],
  ['/admin/locations', 'Places & fares', MapPin],
  ['/admin/fares', 'Fare calculator', Calculator],
  ['/admin/pins', 'Pin check', MapPinned],
  ['/admin/website', 'SEO & website', Globe],
  ['/admin/team', 'Team & access', UserCog],
]

/** Operations console layout: dark sidebar (a scrolling top bar on phones). */
export default function AdminShell({ eyebrow = 'Operations', title, description, actions, children }) {
  const outlet = useOutletContext()
  const user = outlet?.user
  const navigate = useNavigate()
  const unread = useSupportUnread(Boolean(user) && canOpen(user, '/admin/support'))
  const nav = NAV.filter(([to]) => canOpen(user, to))

  function signOut() {
    signOutCompletely()
    navigate('/login', { replace: true })
  }

  return (
    <div className="admin">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className="admin-sidebar">
        <div className="row" style={{ gap: 6 }}>
          <Logo to="/admin/overview" reversed size={32} />
        </div>

        <nav className="admin-nav" aria-label="Admin">
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end>
              <Icon size={19} aria-hidden="true" />
              {label}
              {to === '/admin/support' && unread > 0 && (
                <span className="nav-count" aria-label={`${unread} waiting for a reply`}>{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-foot">
          <span>
            {user?.full_name || 'Administrator'}
            <small style={{ display: 'block', opacity: 0.7 }}>{user?.role === 'staff' ? 'Staff' : 'Super-admin'}</small>
          </span>
          <button type="button" className="admin-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main" id="main">
        <div className="page-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1 style={{ marginTop: 6 }}>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  )
}
