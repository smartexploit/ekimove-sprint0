import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import PublicPage from '../../components/site/PublicPage.jsx'
import useSiteContent from '../../hooks/useSiteContent.js'
import { fareRows, naira } from '../../utils/seo.js'

export default function FaresPage() {
  const { content, loaded } = useSiteContent()
  const page = content.pages.fares
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const rows = fareRows(content.fares).filter((row) => {
      const text = `${row.area} ${row.from} ${row.to}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    const byArea = new Map()
    rows.forEach((row) => byArea.set(row.area, [...(byArea.get(row.area) || []), row]))
    return [...byArea.entries()]
  }, [content.fares, query])

  const hasFares = (content.fares || []).length > 0

  return (
    <PublicPage eyebrow="EkiMove" heading={page.heading} intro={page.intro} wide>
      {hasFares && (
        <label className="field content-search">
          <span className="field-label">Find a route</span>
          <span className="input-icon">
            <Search size={18} aria-hidden="true" />
            <input className="input" type="search" value={query} maxLength={60}
              placeholder="Try EKSU or Fajuyi" onChange={(event) => setQuery(event.target.value)} />
          </span>
        </label>
      )}

      {!hasFares && (
        <p className="card muted">{loaded ? 'Fares for this area are being set up. Sign in to see prices for your trip.' : 'Loading fares…'}</p>
      )}
      {hasFares && groups.length === 0 && <p className="card muted">No route matches “{query}”.</p>}

      {groups.map(([area, rows]) => (
        <section key={area} className="card fares-card" aria-label={`Fares in ${area}`}>
          <h2 className="section-title">{area}</h2>
          <ul className="fares-list">
            {rows.map((row) => (
              <li key={`${row.from}|${row.to}`}>
                <span className="fares-route">{row.from} <span aria-hidden="true">→</span><span className="sr-only"> to </span> {row.to}</span>
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
        </section>
      ))}
      {hasFares && <p className="muted small">Prices are for one passenger. Extra passengers and promo codes are shown when you book.</p>}
    </PublicPage>
  )
}
