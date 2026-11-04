import { Link, useParams } from 'react-router-dom'
import PublicPage from '../../components/site/PublicPage.jsx'
import useSiteContent from '../../hooks/useSiteContent.js'
import { fareRows, naira, paragraphs } from '../../utils/seo.js'

export default function AreaPage() {
  const { slug } = useParams()
  const { content, loaded } = useSiteContent()
  const area = content.areas.find((item) => item.slug === slug && item.published !== false)

  if (!area) {
    return (
      <PublicPage heading={loaded ? 'Page not found' : 'Loading…'}
        intro={loaded ? 'This area page is not available.' : ''}>
        {loaded && <p><Link to="/">Go to the EkiMove home page</Link></p>}
      </PublicPage>
    )
  }

  const sample = fareRows(content.fares).slice(0, 6)
  const others = content.areas.filter((item) => item.slug !== area.slug && item.published !== false)

  return (
    <PublicPage eyebrow="Service area" heading={area.heading} intro={area.intro}>
      <div className="content-body">
        {paragraphs(area.body).map((text) => <p key={text}>{text}</p>)}
      </div>

      {sample.length > 0 && (
        <section className="card fares-card">
          <h2 className="section-title">Sample fares</h2>
          <ul className="fares-list">
            {sample.map((row) => (
              <li key={`${row.area}|${row.from}|${row.to}`}>
                <span className="fares-route">{row.from} → {row.to}</span>
                <span className="fares-prices">
                  {row.prices.map((price) => (
                    <span key={price.vehicle} className="fares-price">
                      <small>{price.vehicle}</small> <strong>{naira(price.amount)}</strong>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/fares">See all fares</Link>
        </section>
      )}

      <nav className="chip-row" aria-label="More">
        {others.map((item) => <Link key={item.slug} className="chip" to={`/areas/${item.slug}`}>{item.heading}</Link>)}
        <Link className="chip" to="/faq">Questions</Link>
        <Link className="chip" to="/driver/apply">Drive with EkiMove</Link>
      </nav>
    </PublicPage>
  )
}
