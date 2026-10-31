/* EkiMove phone notifications. Loaded into the app's service worker
   (see workbox.importScripts in vite.config.js). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const options = {
    body: data.body || '',
    icon: '/brand/ekimove-app-icon-192.png',
    badge: '/favicon-32.png',
    data: { url: data.url || '/' },
  }
  if (data.tag) {
    options.tag = data.tag
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(data.title || 'EkiMove', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let target = new URL('/', self.location.origin)
  try {
    const wanted = new URL(event.notification.data?.url || '/', self.location.origin)
    if (wanted.origin === self.location.origin) target = wanted
  } catch {
    /* keep the home page */
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) {
          try {
            await client.navigate(target.href)
          } catch {
            /* the page will still be focused */
          }
        }
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href)
  })())
})
