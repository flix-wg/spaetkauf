/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL } from 'workbox-precaching'
import { ExpirationPlugin } from 'workbox-expiration'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ADDON_ZIP } from './addon'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
const appShell = createHandlerBoundToURL('/index.html')
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.mode === 'navigate' && url.origin === self.location.origin
      && url.pathname !== '/' && !getCacheKeyForURL(url.origin + url.pathname)
      && !/^\/(?:data|duckdb)\//.test(url.pathname) && url.pathname !== ADDON_ZIP) {
    event.respondWith(appShell({ event, request: event.request, url }))
  }
})

// Odds shards change only with a data rebuild. History Parquet is read with Range requests, which the
// Cache API can't serve correctly, so only whole-file reads (meta.json) go through the cache.
const sameOrigin = (url: URL) => url.origin === self.location.origin
registerRoute(({ url }) => sameOrigin(url) && url.pathname.startsWith('/data/odds/'),
  new CacheFirst({ cacheName: 'kurt-odds', plugins: [new ExpirationPlugin({ maxAgeSeconds: 7 * 24 * 3600, maxEntries: 500 })] }))
registerRoute(({ url, request }) => sameOrigin(url) && url.pathname.startsWith('/data/history/') && !request.headers.has('range'),
  new StaleWhileRevalidate({ cacheName: 'kurt-history' }))

self.skipWaiting()
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// Trip alerts are local notifications shown by watchTrip; a click opens the trip.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url ?? '/trips'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url).catch(() => undefined)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
