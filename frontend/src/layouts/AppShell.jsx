import { Link, NavLink, useNavigate, useOutletContext } from 'react-router-dom'
import {
  BadgeCheck,
  House,
  LifeBuoy,
  LogOut,
  Navigation,
  Route,
  Wallet,
} from 'lucide-react'
import useSupportUnread from '../hooks/useSupportUnread.js'
import Logo from '../components/brand/Logo.jsx'
import AtonaFloatingAssistant from '../components/AtonaFloatingAssistant.jsx'
import AtonaHeaderButton from '../components/atona/AtonaHeaderButton.jsx'
import { logoutPassenger } from '../services/authService.js'
import { firstName, initials } from '../utils/format.js'
import { homePathForRole } from '../utils/roles.js'

const NAV = {
  passenger: [
    ['/dashboard', 'Home', House],
    ['/book-ride', 'Book', Navigation],
    ['/my-rides', 'My rides', Route],
    ['/payments', 'Payments', Wallet],
    ['/support', 'Support', LifeBuoy],
  ],
  driver: [
    ['/driver/trips', 'Trips', Route],
    ['/driver/earnings', 'Earnings', Wallet],
    ['/driver/status', 'My status', BadgeCheck],
    ['/support', 'Support', LifeBuoy],
  ],
}

/**
 * Signed-in layout for passengers and drivers: a top bar on larger screens
 * and a bottom tab bar on phones.
 */
export default function AppShell({
  title,
  description,
  actions,
  children,
  hideHead = false,
  className = '',
  onApplyBooking,
}) {
  const outlet = useOutletContext()
  const user = outlet?.user
  const navigate = useNavigate()
  const role = user?.role === 'driver' ? 'driver' : 'passenger'
  const items = NAV[role]
  const unread = useSupportUnread(Boolean(user))

  function signOut() {
    logoutPassenger()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`app ${className}`.trim()}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="app-topbar">
        <div className="container app-topbar-inner">
          <div className="row" style={{ gap: 10 }}>
            <Logo to={homePathForRole(user?.role)} size={34} />
            {role === 'driver' && <span className="app-role">Driver</span>}
          </div>

          <nav className="app-nav" aria-label="Main">
            {items.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end>
                <Icon size={18} aria-hidden="true" />
                {label}
                {to === '/support' && unread > 0 && <span className="nav-dot" aria-label={`${unread} unread`} />}
              </NavLink>
            ))}
          </nav>

          <div className="app-user">
            <AtonaHeaderButton className="tabbar-only" />
            <Link to="/profile" className="avatar avatar-link" aria-label={`Your profile (${user?.full_name || 'signed in'})`}>
              {initials(user?.full_name)}
            </Link>
            <button
              type="button"
              className="btn btn-quiet btn-sm app-signout-desktop"
              onClick={signOut}
            >
              Sign out
            </button>
            <button
              type="button"
              className="icon-btn tabbar-only"
              onClick={signOut}
              aria-label={`Sign out ${firstName(user?.full_name)}`.trim()}
            >
              <LogOut size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="app-main" id="main">
        <div className="container">
          {!hideHead && (title || actions) && (
            <div className="page-head">
              <div>
                {title && <h1>{title}</h1>}
                {description && <p>{description}</p>}
              </div>
              {actions && <div className="row">{actions}</div>}
            </div>
          )}
          {children}
        </div>
      </main>

      <AtonaFloatingAssistant onApplyBooking={onApplyBooking} headerLaunch />

      <nav className="tabbar" aria-label="App">
        {items.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end>
            <span className="tab-icon">
              <Icon size={22} aria-hidden="true" />
              {to === '/support' && unread > 0 && <span className="nav-dot" aria-label={`${unread} unread`} />}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
