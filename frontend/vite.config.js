import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
})
