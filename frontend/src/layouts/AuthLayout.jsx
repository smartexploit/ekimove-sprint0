import { ShieldCheck, Tag, Wallet } from 'lucide-react'
import Logo from '../components/brand/Logo.jsx'
import Hills from '../components/brand/Hills.jsx'

/**
 * Split-screen layout for sign-in, registration and driver onboarding:
 * a green brand panel with Ekiti hills beside the form.
 */
export default function AuthLayout({
  title,
  intro,
  heading,
  subheading,
  wide = false,
  children,
}) {
  return (
    <div className="auth">
      <a className="skip-link" href="#auth-content">
        Skip to form
      </a>

      <section className="auth-brand" aria-label="EkiMove">
        <Logo reversed />

        <div className="stack" style={{ position: 'relative', zIndex: 1 }}>
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>

        <ul
          className="auth-brand-extra stack stack-sm"
          style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative', zIndex: 1 }}
        >
          <li className="row" style={{ color: 'var(--green-200)', fontWeight: 600 }}>
            <ShieldCheck size={20} color="#F2B33D" aria-hidden="true" />
            Verified drivers and vehicles
          </li>
          <li className="row" style={{ color: 'var(--green-200)', fontWeight: 600 }}>
            <Tag size={20} color="#F2B33D" aria-hidden="true" />
            Fare shown before you book
          </li>
          <li className="row" style={{ color: 'var(--green-200)', fontWeight: 600 }}>
            <Wallet size={20} color="#F2B33D" aria-hidden="true" />
            Cashless: bank transfer or Interswitch
          </li>
        </ul>

        <Hills base="#FFFFFF" />
      </section>

      <main className="auth-panel" id="auth-content">
        <div className={`auth-form-wrap ${wide ? 'auth-form-wrap-wide' : ''}`}>
          <div className="auth-head">
            <h2>{heading}</h2>
            {subheading && <p>{subheading}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
