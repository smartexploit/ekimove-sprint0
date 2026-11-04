import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { PublicFooter, PublicHeader } from '../../layouts/PublicChrome.jsx'

/** Shared frame for the public content pages (fares, FAQ, areas). */
export default function PublicPage({ eyebrow, heading, intro, children, wide = false }) {
  return (
    <div className="content-page">
      <PublicHeader />
      <main id="main" className="container content-main" style={{ maxWidth: wide ? 980 : 820 }}>
        <header className="content-head">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{heading}</h1>
          {intro && <p className="lead">{intro}</p>}
        </header>
        {children}
        <section className="content-cta" aria-label="Get started">
          <div>
            <h2>Ready to move?</h2>
            <p>Sign up with your phone number or email. No app store download needed.</p>
          </div>
          <div className="content-cta-actions">
            <Link className="btn btn-gold" to="/register">
              Get started <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="btn btn-on-dark" to="/login">Sign in</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
