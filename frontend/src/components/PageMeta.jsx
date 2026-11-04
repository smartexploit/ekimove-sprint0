import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { loadSiteContent, siteContentNow } from '../services/siteService.js'
import { DEFAULT_SITE_URL, SHARE_IMAGE, isIndexable, publicRoutes } from '../utils/seo.js'
import { POLICIES } from '../utils/policies.js'

const MANAGED = 'data-seo'

function setTag(selector, create, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement(create)
    el.setAttribute(MANAGED, '')
    document.head.appendChild(el)
  }
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value))
}

const meta = (attr, key, content) =>
  setTag(`meta[${attr}="${key}"]`, 'meta', { [attr]: key, content })

function clearPageTags() {
  document.head.querySelectorAll(`script[type="application/ld+json"][${MANAGED}], link[rel="canonical"][${MANAGED}]`)
    .forEach((el) => el.remove())
}

/**
 * Keeps the page title, description, link-preview tags, canonical address
 * and structured data in step with the current address. Public pages use
 * the text edited in the console; everything else is marked noindex.
 */
export default function PageMeta() {
  const { pathname } = useLocation()
  const [content, setContent] = useState(siteContentNow)

  const publicPage = isIndexable(pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/')

  useEffect(() => {
    if (!publicPage) return undefined
    let active = true
    loadSiteContent().then((data) => active && setContent(data))
    return () => {
      active = false
    }
  }, [publicPage])

  useEffect(() => {
    const siteUrl = (content.site_url || DEFAULT_SITE_URL).replace(/\/+$/, '')
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
    const route = isIndexable(path)
      ? publicRoutes(content, siteUrl, POLICIES).find((item) => item.path === path)
      : null

    clearPageTags()
    const title = route?.title || `${content.site.name}: ${content.site.tagline}`
    const description = route?.description || content.site.description
    document.title = title
    meta('name', 'description', description)
    meta('name', 'robots', route ? 'index, follow' : 'noindex, nofollow')
    meta('property', 'og:type', 'website')
    meta('property', 'og:site_name', content.site.name)
    meta('property', 'og:title', title)
    meta('property', 'og:description', description)
    meta('property', 'og:url', route?.url || `${siteUrl}/`)
    meta('property', 'og:image', `${siteUrl}${SHARE_IMAGE}`)
    meta('property', 'og:locale', 'en_NG')
    meta('name', 'twitter:card', 'summary_large_image')
    meta('name', 'twitter:title', title)
    meta('name', 'twitter:description', description)
    meta('name', 'twitter:image', `${siteUrl}${SHARE_IMAGE}`)
    if (!route) return

    const canonical = document.createElement('link')
    canonical.rel = 'canonical'
    canonical.href = route.url
    canonical.setAttribute(MANAGED, '')
    document.head.appendChild(canonical)
    for (const data of route.jsonLd) {
      const script = document.createElement('script')
      script.type = 'application/ld+json'
      script.setAttribute(MANAGED, '')
      script.textContent = JSON.stringify(data).replace(/</g, '\\u003c')
      document.head.appendChild(script)
    }
  }, [pathname, content])

  return null
}
