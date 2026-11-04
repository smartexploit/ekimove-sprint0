/**
 * Search and link-preview details for EkiMove's public pages. Plain
 * JavaScript with no browser or Vite features, so the same code runs in
 * the app (usePageMeta) and in the build step (scripts/prerender.mjs).
 */

export const DEFAULT_SITE_URL = 'https://ekimove.com.ng'
export const SHARE_IMAGE = '/brand/ekimove-share.png'
export const LOGO_IMAGE = '/brand/ekimove-app-icon-512.png'

const VEHICLE_NAMES = {
  motorcycle: 'Okada (motorcycle)', okada: 'Okada (motorcycle)', bike: 'Okada (motorcycle)',
  car: 'Car', standard: 'Car', tricycle: 'Tricycle (keke)', minibus: 'Minibus',
}

export function vehicleName(type) {
  const key = String(type || '').toLowerCase()
  return VEHICLE_NAMES[key] || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Vehicle'
}

export function naira(amount) {
  const value = Math.round(Number(amount || 0))
  return `₦${value.toLocaleString('en-NG')}`
}

/** Paragraphs from text with blank lines between them. */
export function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

function organization(content, siteUrl) {
  const contact = content.contact || {}
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${siteUrl}/#business`,
    name: content.site?.name || 'EkiMove',
    description: content.site?.description,
    url: siteUrl,
    logo: `${siteUrl}${LOGO_IMAGE}`,
    image: `${siteUrl}${SHARE_IMAGE}`,
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phone ? { telephone: contact.phone } : {}),
    address: { '@type': 'PostalAddress', addressLocality: 'Ado-Ekiti', addressRegion: 'Ekiti', addressCountry: 'NG' },
    areaServed: [{ '@type': 'City', name: 'Ado-Ekiti' }, { '@type': 'State', name: 'Ekiti State' }],
    currenciesAccepted: 'NGN',
    paymentAccepted: 'Bank transfer, Card',
  }
}

function faqPage(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (faq || []).map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }
}

function service(area, content, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: area.heading,
    description: area.description,
    serviceType: 'Ride hailing, package delivery and load moving',
    url: `${siteUrl}/areas/${area.slug}`,
    provider: { '@id': `${siteUrl}/#business` },
    areaServed: { '@type': 'City', name: 'Ado-Ekiti' },
    brand: content.site?.name || 'EkiMove',
  }
}

/** Fares grouped by route, for the Fares page and its plain-text copy. */
export function fareRows(fares) {
  const routes = new Map()
  for (const fare of fares || []) {
    const key = `${fare.area}|${fare.from}|${fare.to}`
    if (!routes.has(key)) routes.set(key, { area: fare.area, from: fare.from, to: fare.to, prices: [] })
    routes.get(key).prices.push({ vehicle: vehicleName(fare.vehicle_type), amount: fare.amount })
  }
  return [...routes.values()]
}

/**
 * Every public page: its address, title, description, structured data and
 * the plain text a crawler without JavaScript can read.
 */
export function publicRoutes(content, siteUrl = DEFAULT_SITE_URL, policies = []) {
  const pages = content.pages
  const business = organization(content, siteUrl)
  const routes = [
    {
      path: '/', ...pages.home, jsonLd: [business],
      text: {
        heading: content.site.tagline,
        paragraphs: [content.site.description],
        links: [['/fares', 'See fares'], ['/faq', 'Questions'], ['/driver/apply', 'Drive with EkiMove'],
          ...(content.areas || []).map((a) => [`/areas/${a.slug}`, a.heading])],
      },
    },
    {
      path: '/fares', title: pages.fares.title, description: pages.fares.description, jsonLd: [business],
      text: {
        heading: pages.fares.heading, paragraphs: [pages.fares.intro],
        list: fareRows(content.fares).map((r) =>
          `${r.from} to ${r.to}: ${r.prices.map((p) => `${p.vehicle} ${naira(p.amount)}`).join(', ')}`),
      },
    },
    {
      path: '/faq', title: pages.faq.title, description: pages.faq.description, jsonLd: [business, faqPage(content.faq)],
      text: {
        heading: pages.faq.heading, paragraphs: [pages.faq.intro],
        list: (content.faq || []).map((item) => `${item.question} ${item.answer}`),
      },
    },
    {
      path: '/driver/apply', ...pages.drive, jsonLd: [business],
      text: { heading: 'Drive with EkiMove', paragraphs: [pages.drive.description] },
    },
    {
      path: '/policies', ...pages.policies, jsonLd: [business],
      text: { heading: 'EkiMove policies', paragraphs: [pages.policies.description] },
    },
    ...(content.areas || []).map((area) => ({
      path: `/areas/${area.slug}`, title: area.title, description: area.description,
      jsonLd: [business, service(area, content, siteUrl)],
      text: { heading: area.heading, paragraphs: [area.intro, ...paragraphs(area.body)] },
    })),
    ...policies.map((policy) => ({
      path: `/policies/${policy.slug}`, title: `${policy.title} | EkiMove`,
      description: `EkiMove ${policy.title}: ${policy.summary}`.slice(0, 170), jsonLd: [business],
      text: {
        heading: policy.title,
        paragraphs: policy.sections.flatMap(([heading, texts]) => [heading, ...texts]),
      },
    })),
  ]
  return routes.map((route) => ({ ...route, url: `${siteUrl}${route.path === '/' ? '/' : route.path}` }))
}

/** Addresses search engines should index (used by the sitemap and the app). */
export function isIndexable(path) {
  return path === '/' || ['/fares', '/faq', '/driver/apply', '/policies'].includes(path) ||
    path.startsWith('/areas/') || path.startsWith('/policies/')
}
