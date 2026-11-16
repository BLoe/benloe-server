// Kevin's service worker. It exists for two things: web push, and letting the
// installed app open when the network is briefly away.
//
// Caching is deliberately narrow:
//   /api/*      never touched (private data, and the SSE stream).
//   navigation  network first, so a deploy reaches the very next load; the
//               last good shell is the fallback only when the network fails.
//   /assets/*   cache first: Vite hashes the names, so a file never changes.
//               Only a real answer is kept: a 200 from this origin, not redirected,
//               whose type fits the file (a script for .js, a stylesheet for .css,
//               never HTML). After a deploy the old build's chunks are gone and the
//               server answers 404; that must not be stored under the chunk's name.
// v2: v1 could hold an HTML page stored under a script's name; activating drops it.
const SHELL = 'kevin-shell-v2';
const ASSETS = 'kevin-assets-v2';

/** The content type an asset must have, by its extension; null when any type but HTML will do. */
function expectedType(pathname) {
  if (/\.m?js$/.test(pathname)) return /^(text|application)\/javascript\b/;
  if (/\.css$/.test(pathname)) return /^text\/css\b/;
  if (/\.json$|\.webmanifest$/.test(pathname)) return /^application\/(manifest\+)?json\b/;
  return null;
}

/** May this response be kept as the asset at `pathname`, for good? */
function cacheableAsset(pathname, res) {
  if (!res || res.status !== 200 || res.redirected || res.type !== 'basic') return false;
  const type = (res.headers.get('Content-Type') || '').toLowerCase();
  if (!type || type.startsWith('text/html')) return false;
  const want = expectedType(pathname);
  return want ? want.test(type) : true;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Only the app's own page is worth keeping: not a sign-in redirect, not an error.
          if (res.status === 200 && !res.redirected && res.type === 'basic' && (res.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) {
            const cache = await caches.open(SHELL);
            await cache.put('/', res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match('/', { cacheName: SHELL });
          return cached ?? new Response('Kevin is offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit && cacheableAsset(url.pathname, hit)) return hit;
        if (hit) await cache.delete(req);
        const res = await fetch(req);
        if (cacheableAsset(url.pathname, res)) await cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});

// A notification's link is text the model may have written. It is opened only if it is a path on
// this origin: resolved against the app's own address, anything that lands on another origin
// ("//host", "/\\host", a full URL) becomes the home page instead.
function appPath(link) {
  if (typeof link !== 'string' || !link.startsWith('/')) return '/';
  try {
    const url = new URL(link, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

// Payload from the server: { id, title, body, link }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Kevin', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Kevin', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.id != null ? `kevin-${data.id}` : undefined,
      data: { id: data.id ?? null, link: appPath(data.link) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id = null } = event.notification.data || {};
  // Checked again here: this is the point where the link is acted on.
  const link = appPath((event.notification.data || {}).link);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // The app routes in place; a full navigation would drop its state.
        open.postMessage({ type: 'navigate', link, notificationId: id });
        return;
      }
      await self.clients.openWindow(link);
    })(),
  );
});
