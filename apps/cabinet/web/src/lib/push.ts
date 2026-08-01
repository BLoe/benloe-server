/**
 * Push subscription handshake (2026-08-01).
 *
 * Three parties have to agree before a 3:30pm ping can reach Ben's phone: the
 * browser (permission + a service worker), the push service (a subscription
 * endpoint), and Cabinet (the VAPID key that identifies it, and the endpoint
 * to send to). This module is the client half of that handshake.
 *
 * Everything here degrades to a clear reason rather than a thrown error,
 * because "notifications are off and here's why" is a far more useful state
 * for a settings toggle than a red banner.
 */

export type PushState =
  /** No service worker or no Push API — an old browser, or plain http. */
  | { status: 'unsupported'; reason: string }
  /** Supported, but the server has no VAPID keys configured. */
  | { status: 'unconfigured' }
  /** Ben said no. Only he can undo this, in browser settings. */
  | { status: 'denied' }
  /** Available, not yet subscribed. */
  | { status: 'off' }
  | { status: 'on'; endpoint: string };

/**
 * iOS is the case worth naming explicitly: Safari only grants the Push API to
 * a site the user has added to the Home Screen. Silently reporting
 * "unsupported" on the one device the morning brief matters most on would send
 * Ben looking for a bug that isn't there.
 */
function unsupportedReason(): string | null {
  if (typeof window === 'undefined') return 'not a browser';
  if (!('serviceWorker' in navigator)) return 'this browser has no service worker support';
  if (!('PushManager' in window)) {
    const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    // Safari sets navigator.standalone when the site was launched from the
    // Home Screen — the only context where iOS grants the Push API at all.
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (iOS && !standalone) return 'on iPhone, add Cabinet to your Home Screen first — Safari only allows notifications there';
    return 'this browser has no Push API';
  }
  if (!('Notification' in window)) return 'this browser has no Notification API';
  return null;
}

export async function pushState(): Promise<PushState> {
  const reason = unsupportedReason();
  if (reason) return { status: 'unsupported', reason };

  const cfg = await fetch('/api/push/key').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!cfg?.configured || !cfg.publicKey) return { status: 'unconfigured' };
  if (Notification.permission === 'denied') return { status: 'denied' };

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? { status: 'on', endpoint: sub.endpoint } : { status: 'off' };
}

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** A human-readable name for this device, so the settings list is legible. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

/**
 * Ask for permission, subscribe, and register the endpoint with Cabinet.
 * Returns the resulting state — including 'denied', which is a legitimate
 * answer rather than a failure.
 */
export async function enablePush(): Promise<PushState> {
  const reason = unsupportedReason();
  if (reason) return { status: 'unsupported', reason };

  const cfg = await fetch('/api/push/key').then((r) => r.json());
  if (!cfg?.configured || !cfg.publicKey) return { status: 'unconfigured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'denied' };

  // `ready` rather than `getRegistration`: on a first visit the worker may
  // still be installing, and subscribing against a half-registered worker
  // fails in a way that looks like a permission problem.
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      // Required by every current browser: Cabinet may only send pushes that
      // result in a visible notification.
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(cfg.publicKey) as BufferSource,
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }),
  });
  if (!res.ok) {
    // Don't leave a live browser subscription pointing at a server that never
    // recorded it — that's a device that looks subscribed and never rings.
    await sub.unsubscribe().catch(() => {});
    return { status: 'off' };
  }
  return { status: 'on', endpoint: sub.endpoint };
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return { status: 'off' };
}

/** Fire a real notification through the whole chain, as a proof of life. */
export async function testPush(): Promise<{ sent: number; failed: number; pruned: number }> {
  const res = await fetch('/api/push/test', { method: 'POST' });
  if (!res.ok) throw new Error(`test push failed: ${res.status}`);
  return res.json();
}
