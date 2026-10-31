import { Link, useParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { PublicFooter, PublicHeader } from '../../layouts/PublicChrome.jsx'
import { POLICIES, POLICY_EFFECTIVE, policyBySlug } from '../../utils/policies.js'

export default function PoliciesPage() {
  const { slug } = useParams()
  const policy = slug ? policyBySlug(slug) : null

  return (
    <div className="policies-page">
      <PublicHeader />
      <main className="container stack stack-lg" id="main" style={{ padding: '28px 16px 56px', maxWidth: 820 }}>
        <nav className="chip-row" aria-label="Policies">
          <Link className={`chip ${!policy ? 'is-active' : ''}`} to="/policies">All policies</Link>
          {POLICIES.map((item) => (
            <Link key={item.slug} className={`chip ${policy?.slug === item.slug ? 'is-active' : ''}`}
              to={`/policies/${item.slug}`}>
              {item.title}
            </Link>
          ))}
        </nav>

        {!policy ? (
          <section className="stack">
            <div>
              <p className="eyebrow">EkiMove</p>
              <h1>Policies</h1>
              <p className="muted">Effective {POLICY_EFFECTIVE}. These apply to everyone who uses EkiMove.</p>
            </div>
            <div className="grid grid-auto">
              {POLICIES.map((item) => (
                <Link key={item.slug} className="action-card" to={`/policies/${item.slug}`}>
                  <span className="action-icon"><FileText size={22} aria-hidden="true" /></span>
                  <h2>{item.title}</h2>
                  <p>{item.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <article className="card card-lg stack policy-doc">
            <div>
              <p className="eyebrow">{policy.drivers ? 'For drivers' : 'EkiMove policy'}</p>
              <h1>{policy.title}</h1>
              <p className="muted small">Effective {POLICY_EFFECTIVE}</p>
            </div>
            {policy.sections.map(([heading, paragraphs]) => (
              <section key={heading} className="stack stack-sm">
                <h2 className="section-title">{heading}</h2>
                {paragraphs.map((text) => <p key={text}>{text}</p>)}
              </section>
            ))}
          </article>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
