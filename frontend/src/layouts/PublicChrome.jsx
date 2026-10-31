import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from '../components/brand/Logo.jsx'
import SupportContacts from '../components/SupportContacts.jsx'
import AtonaHeaderButton from '../components/atona/AtonaHeaderButton.jsx'
import { getAccessToken, getStoredUser } from '../services/authService.js'
import { homePathForRole } from '../utils/roles.js'

const SECTION_LINKS = [
  ['#rides', 'Rides'],
  ['#how-it-works', 'How it works'],
  ['#safety', 'Safety'],
  ['#drive', 'Drive with us'],
]

export function PublicHeader({ dark = false }) {
  const [open, setOpen] = useState(false)
  const signedIn = Boolean(getAccessToken())
  const user = getStoredUser()
  const close = () => setOpen(false)

  return (
    <header className={`site-header ${dark ? 'site-header-dark' : 'site-header-solid'}`}>
      <div className="container site-nav">
        <Logo reversed={dark} onClick={close} />

        <div className="site-nav-phone">
          <AtonaHeaderButton className="tabbar-only" />
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="site-links"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        <nav
          id="site-links"
          className={`site-links ${open ? 'is-open' : ''}`}
          aria-label="Main"
        >
          {SECTION_LINKS.map(([href, label]) => (
            <a key={href} href={href} onClick={close}>
              {label}
            </a>
          ))}

          {signedIn ? (
            <Link
              className="btn btn-gold btn-sm"
              to={homePathForRole(user?.role)}
              onClick={close}
            >
              Open my account
            </Link>
          ) : (
            <>
              <Link className="site-signin" to="/login" onClick={close}>
                Sign in
              </Link>
              <Link className="btn btn-gold btn-sm" to="/register" onClick={close}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col" style={{ maxWidth: 320 }}>
            <Logo reversed size={36} />
            <p>Local transport for Ekiti, starting in Ado-Ekiti.</p>
          </div>

          <nav className="footer-col" aria-label="Ride">
            <h2 className="footer-heading">Ride</h2>
            <a href="#plan">Book a ride</a>
            <a href="#how-it-works">How it works</a>
            <a href="#safety">Safety</a>
          </nav>

          <nav className="footer-col" aria-label="Company">
            <h2 className="footer-heading">Company</h2>
            <Link to="/driver/apply">Drive with EkiMove</Link>
            <a href="#about">About EkiMove</a>
            <Link to="/login">Sign in</Link>
          </nav>

          <div className="footer-col">
            <h2 className="footer-heading">Support</h2>
            <SupportContacts
              linkClassName="contact-link"
              fallback={<p>Support channels are coming soon.</p>}
            />
          </div>
        </div>

        <div className="footer-base">
          <span>© {new Date().getFullYear()} EkiMove. Ekiti, on the move.</span>
          <span>Cashless rides: bank transfer or Interswitch.</span>
        </div>
      </div>
    </footer>
  )
}
