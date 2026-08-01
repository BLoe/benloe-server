// Cabinet service worker: offline shell only. API and SSE are always network —
// stale agent data is worse than no data.
const SHELL = 'cabinet-shell-v1';
const ASSETS = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return; // network only
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (url.pathname === '/' || url.pathname.startsWith('/assets') || ASSETS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))),
  );
});

// ---- push (2026-08-01) ----
// RHYTHM.md's structure is pings: the morning brief, the 3:30 protein snack,
// the evening block start, the 10:30 wind-down. Before this they went to an
// in-app event bus that only reached Ben if a tab happened to be open, which
// meant the plan's scaffolding could not actually reach the person it was
// scaffolding. These two handlers are the last link in that chain.

self.addEventListener('push', (e) => {
  // A push with no readable payload is still a signal worth showing — better a
  // generic nudge than silence, since the notification IS the appointment.
  let data = { title: 'Cabinet', body: '', tag: 'cabinet', url: '/', silent: false };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    if (e.data) data.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // Replace rather than stack: a missed morning brief and the evening
      // check-in should never become a wall of stale notifications.
      renotify: !data.silent,
      silent: !!data.silent,
      icon: '/icon-180.png',
      badge: '/icon-180.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Reuse an open Cabinet tab if there is one — opening a second copy of a
      // single-principal console is never what was wanted.
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) return w.focus().then((c) => (c.navigate ? c.navigate(target) : c));
      }
      return self.clients.openWindow(target);
    }),
  );
});
