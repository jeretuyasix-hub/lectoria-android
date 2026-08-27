const CACHE = 'lector-ia-shell-v4'
const scopeUrl = new URL(self.registration.scope)
const CORE = [scopeUrl.href, new URL('manifest.webmanifest', scopeUrl).href]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.pathname.includes('/api/')) return

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(cache => cache.put(req, copy))
        return res
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match(scopeUrl.href)))
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients[0]
      if (existing) return existing.focus()
      return self.clients.openWindow(scopeUrl.href)
    })
  )
})
