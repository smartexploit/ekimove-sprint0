import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from '../components/brand/Logo.jsx'
import SupportContacts from '../components/SupportContacts.jsx'
import useSiteContent from '../hooks/useSiteContent.js'
import { getAccessToken, getStoredUser } from '../services/authService.js'
import { homePathForRole } from '../utils/roles.js'

// Homepage sections; the leading "/" makes them work from any page.
const SECTION_LINKS = [
  ['/#rides', 'Rides'],
  ['/fares', 'Fares'],
  ['/#safety', 'Safety'],
  ['/faq', 'FAQ'],
  ['/#drive', 'Drive with us'],
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
          {SECTION_LINKS.map(([href, label]) => (href.startsWith('/#') ? (
            <a key={href} href={href} onClick={close}>
              {label}
            </a>
          ) : (
            <Link key={href} to={href} onClick={close}>
              {label}
            </Link>
          )))}

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
  const { content } = useSiteContent()
  const areas = content.areas.filter((area) => area.published !== false).slice(0, 6)

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
            <a href="/#plan">Book a ride</a>
            <a href="/#how-it-works">How it works</a>
            <a href="/#safety">Safety</a>
          </nav>

          <nav className="footer-col" aria-label="Explore">
            <h2 className="footer-heading">Explore</h2>
            <Link to="/fares">Fares</Link>
            {areas.map((area) => (
              <Link key={area.slug} to={`/areas/${area.slug}`}>{area.heading}</Link>
            ))}
            <Link to="/faq">Questions</Link>
          </nav>

          <nav className="footer-col" aria-label="Company">
            <h2 className="footer-heading">Company</h2>
            <Link to="/driver/apply">Drive with EkiMove</Link>
            <a href="/#about">About EkiMove</a>
            <Link to="/login">Sign in</Link>
          </nav>

          <nav className="footer-col" aria-label="Policies">
            <h2 className="footer-heading">Policies</h2>
            <Link to="/policies/terms">Terms of Service</Link>
            <Link to="/policies/privacy">Privacy Policy</Link>
            <Link to="/policies/community">Safety guidelines</Link>
            <Link to="/policies/cancellations">Cancellations & refunds</Link>
            <Link to="/policies/driver">Driver Agreement</Link>
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
          <span>Cashless rides: pay by bank transfer.</span>
        </div>
      </div>
    </footer>
  )
}
