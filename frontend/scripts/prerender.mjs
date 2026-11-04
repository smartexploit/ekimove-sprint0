/**
 * Runs after `vite build`. Writes a ready-made HTML file for every public
 * page (dist/fares/index.html and so on) with its own title, description,
 * link-preview tags, canonical address, structured data and a plain-text
 * copy of the page, plus sitemap.xml and robots.txt.
 *
 * The text comes from the API (GET /api/v1/public/site, edited in the
 * console under "SEO & website"). If the API can't be reached, the
 * starting text bundled with the app is used so the build never fails.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SITE_URL, SHARE_IMAGE, publicRoutes } from '../src/utils/seo.js'
import { POLICIES } from '../src/utils/policies.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

// App screens and private links search engines should leave alone.
const PRIVATE_PATHS = [
  '/admin', '/dashboard', '/book-ride', '/my-rides', '/payments', '/move-a-load', '/invite', '/send-package',
  '/profile', '/support', '/receipts', '/driver/status', '/driver/trips', '/driver/earnings', '/t/', '/login',
  '/register', '/forgot-password', '/api/',
]

const escapeHtml = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function fetchContent() {
  const api = (process.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
  const url = process.env.SITE_CONTENT_URL || (api ? `${api}/api/v1/public/site` : '')
  const defaults = JSON.parse(await readFile(join(root, 'src/content/siteDefaults.json'), 'utf8'))
  const fallback = { ...defaults, fares: [], contact: {}, site_url: null }
  if (!url) {
    console.warn('[prerender] No VITE_API_BASE_URL or SITE_CONTENT_URL; using the bundled website text.')
    return fallback
  }
  // The free API server can take up to a minute to wake up.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data?.site || !data?.pages) throw new Error('unexpected response')
      console.log(`[prerender] Website text loaded from the API (${(data.fares || []).length} fares).`)
      return { ...fallback, ...data }
    } catch (error) {
      console.warn(`[prerender] Attempt ${attempt} to load ${url} failed: ${error.message}`)
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
  console.warn('[prerender] Using the bundled website text.')
  return fallback
}

function headTags(route, content, siteUrl) {
  const image = `${siteUrl}${SHARE_IMAGE}`
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" data-seo />`
  return [
    `<title>${escapeHtml(route.title)}</title>`,
    meta('name', 'description', route.description),
    meta('name', 'robots', 'index, follow'),
    `<link rel="canonical" href="${escapeHtml(route.url)}" data-seo />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', content.site.name),
    meta('property', 'og:title', route.title),
    meta('property', 'og:description', route.description),
    meta('property', 'og:url', route.url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', `${content.site.name}: ${content.site.tagline}`),
    meta('property', 'og:locale', 'en_NG'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', route.title),
    meta('name', 'twitter:description', route.description),
    meta('name', 'twitter:image', image),
    ...route.jsonLd.map((data) =>
      `<script type="application/ld+json" data-seo>${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ')
}

function plainText(route) {
  const { heading, paragraphs = [], list = [], links = [] } = route.text
  return [
    '<noscript>',
    '<main class="container" style="padding:24px 16px">',
    `<h1>${escapeHtml(heading)}</h1>`,
    ...paragraphs.filter(Boolean).map((text) => `<p>${escapeHtml(text)}</p>`),
    list.length ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '',
    links.length ? `<p>${links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join(' · ')}</p>` : '',
    '<p><a href="/">EkiMove home</a> · <a href="/fares">Fares</a> · <a href="/faq">FAQ</a> · <a href="/driver/apply">Drive with EkiMove</a></p>',
    '</main>',
    '</noscript>',
  ].filter(Boolean).join('\n')
}

function pageHtml(template, route, content, siteUrl) {
  const html = template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/?>\s*/, '')
    .replace('</head>', `  ${headTags(route, content, siteUrl)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"></div>\n    ${plainText(route)}`)
  if (!html.includes('rel="canonical"') || !html.includes('<noscript>')) {
    throw new Error(`[prerender] Could not place the page details for ${route.path}; check index.html.`)
  }
  return html
}

function sitemap(routes) {
  const today = new Date().toISOString().slice(0, 10)
  const priority = (path) => (path === '/' ? '1.0' : path.startsWith('/policies/') ? '0.3' : '0.8')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...routes.map((route) =>
      `  <url><loc>${escapeHtml(route.url)}</loc><lastmod>${today}</lastmod><priority>${priority(route.path)}</priority></url>`),
    '</urlset>',
    '',
  ].join('\n')
}

function robots(siteUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n')
}

const content = await fetchContent()
const siteUrl = (process.env.VITE_SITE_URL || content.site_url || DEFAULT_SITE_URL).replace(/\/+$/, '')
const template = await readFile(join(dist, 'index.html'), 'utf8')
const routes = publicRoutes(content, siteUrl, POLICIES)

for (const route of routes) {
  const file = route.path === '/' ? join(dist, 'index.html') : join(dist, route.path.slice(1), 'index.html')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, pageHtml(template, route, content, siteUrl))
}
await writeFile(join(dist, 'sitemap.xml'), sitemap(routes))
await writeFile(join(dist, 'robots.txt'), robots(siteUrl))
console.log(`[prerender] Wrote ${routes.length} pages, sitemap.xml and robots.txt for ${siteUrl}.`)
