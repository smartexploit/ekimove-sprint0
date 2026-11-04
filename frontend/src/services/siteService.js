import { apiRequest } from './authService.js'
import defaults from '../content/siteDefaults.json'

const FALLBACK = { ...defaults, fares: [], contact: {}, site_url: null, published_at: null }

let cached = null
let pending = null

/** The public website text (titles, area pages, FAQ) and current fares. */
export function loadSiteContent() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = apiRequest('/api/v1/public/site')
      .then((data) => {
        cached = { ...FALLBACK, ...(data || {}) }
        return cached
      })
      .catch(() => FALLBACK)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export function siteContentNow() {
  return cached || FALLBACK
}

export function forgetSiteContent() {
  cached = null
}

export function getAdminSite() {
  return apiRequest('/api/v1/admin/site')
}

export function saveAdminSite(content) {
  return apiRequest('/api/v1/admin/site', { method: 'PUT', body: JSON.stringify(content) }).then((data) => {
    forgetSiteContent()
    return data
  })
}

export function publishSite() {
  return apiRequest('/api/v1/admin/site/publish', { method: 'POST' })
}
