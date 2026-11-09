import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content Security Policy for the built app: only EkiMove's own scripts (and
 * Google Maps) can run, the page talks only to the EkiMove API and Google Maps, and forms can only post to
 * EkiMove or Interswitch checkout. Added at build time (the dev server
 * needs inline scripts for hot reload).
 */
function contentSecurityPolicy(mode) {
  const env = loadEnv(mode, '.', 'VITE_')
  const api = new Set(['https://api.ekimove.com.ng', 'https://ekimove-api.onrender.com'])
  try {
    if (env.VITE_API_BASE_URL) api.add(new URL(env.VITE_API_BASE_URL).origin)
  } catch {
    // An unusable address is ignored; the default API stays allowed.
  }
  // Google Maps (shown once EkiMove's Google key is set) needs its own
  // hosts, per Google's Content Security Policy guide for the Maps JS API.
  const google = 'https://*.googleapis.com https://*.gstatic.com https://*.google.com'
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' blob: ${google} https://*.ggpht.com https://*.googleusercontent.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://maps.geoapify.com "
      + `${google} https://*.googleusercontent.com`,
    `connect-src 'self' ${[...api].join(' ')} ${google} data: blob:`,
    'frame-src https://*.google.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://newwebpay.interswitchng.com https://newwebpay-sandbox.interswitchng.com",
  ].join('; ')
  return {
    name: 'ekimove-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    contentSecurityPolicy(mode),
    VitePWA({
      // New releases install in the background and take over on the next
      // page load, so people never stay stuck on an old version.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'brand/ekimove-app-icon-180.png',
        'brand/ekimove-logo.svg',
      ],
      manifest: {
        id: '/',
        name: 'EkiMove',
        short_name: 'EkiMove',
        description:
          'Book motorcycle and car rides around Ekiti. Fares shown before you book, verified drivers, cashless payment.',
        lang: 'en-NG',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0E4D3B',
        background_color: '#0E4D3B',
        categories: ['travel', 'navigation'],
        icons: [
          { src: '/brand/ekimove-app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/ekimove-app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/brand/ekimove-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Book a ride', short_name: 'Book', url: '/book-ride', icons: [{ src: '/brand/ekimove-app-icon-192.png', sizes: '192x192' }] },
          { name: 'My rides', short_name: 'My rides', url: '/my-rides', icons: [{ src: '/brand/ekimove-app-icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Open any app link offline from the cached app shell, but never
        // answer API requests from a cache: rides, fares and payments are
        // always live.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Phone notifications (push and notification taps).
        importScripts: ['/push-sw.js'],
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              request.destination === 'image' && url.origin === self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}))
