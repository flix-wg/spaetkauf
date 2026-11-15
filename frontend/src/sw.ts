/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL } from 'workbox-precaching'
import { getLang, notificationText, type Lang } from './i18n-core'
import { ADDON_ZIP } from './addon'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
const appShell = createHandlerBoundToURL('/index.html')
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.mode === 'navigate' && url.origin === self.location.origin
      && url.pathname !== '/' && !getCacheKeyForURL(url.origin + url.pathname)
      && !/^\/api(?:\/|$)/.test(url.pathname) && url.pathname !== ADDON_ZIP) {
    event.respondWith(appShell({ event, request: event.request, url }))
  }
})
self.skipWaiting()
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const LANGUAGE_CACHE = 'kurt-preferences'
const LANGUAGE_KEY = '/__kurt_language'
self.addEventListener('message', (event) => {
  const lang = event.data?.lang
  if (event.data?.type === 'language' && (lang === 'de' || lang === 'en')) {
    event.waitUntil(caches.open(LANGUAGE_CACHE).then(cache => cache.put(LANGUAGE_KEY, new Response(lang))))
  }
})

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; trip_id?: string; lang?: Lang } = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  const url = data.url ?? (data.trip_id ? `/trip/${data.trip_id}` : '/trips')
  event.waitUntil(
    (async () => {
      let lang = data.lang
      if (lang !== 'de' && lang !== 'en') {
        const cached = await caches.open(LANGUAGE_CACHE).then(cache => cache.match(LANGUAGE_KEY)).catch(() => undefined)
        const saved = await cached?.text()
        if (saved === 'de' || saved === 'en') lang = saved
      }
      const fallback = notificationText(lang === 'de' || lang === 'en' ? lang : getLang())
      await self.registration.showNotification(data.title ?? fallback.title, {
        body: data.body ?? fallback.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url },
      })
    })(),
  )
})

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
