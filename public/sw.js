/*
 * Solarity service worker. Push only — no caching, no Workbox.
 * Rationale in architecture.md section 7b.
 *
 * Plain JS: served statically from /public, never compiled by Next.js.
 */

// Take over immediately. Otherwise a freshly installed PWA receives no push
// until the user fully quits and reopens it.
self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  // A push with no payload must not throw.
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || "Solarity"
  const body = data.body || "You have a new notification"

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // One live notification per Circle: a second digest replaces the first
      // rather than stacking seven of them over a week.
      tag: data.data?.group_id ? `circle-${data.data.group_id}` : "solarity",
      renotify: false,
      data: data.data || {},
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const d = event.notification.data || {}

  let target = "/"
  if (d.group_id) target = `/circles/${d.group_id}`
  if (d.type === "digest" && d.group_id) target = `/circles/${d.group_id}?tab=overview`

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open window rather than spawning a tab per tap.
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target)
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})

// A rotated subscription silently stops delivering; nothing surfaces the
// failure. The window has to re-subscribe.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clientList) => {
      clientList.forEach((client) =>
        client.postMessage({ type: "RESUBSCRIBE_PUSH" }),
      )
    }),
  )
})
