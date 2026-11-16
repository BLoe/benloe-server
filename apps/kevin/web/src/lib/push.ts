// Web push for this device: the service worker, the subscription, and the
// reasons it might not be possible here.
import { api } from './api';

export type PushSupport =
  | { state: 'ready' }
  /** iPhone/iPad Safari tab: push exists only once the app is on the Home Screen. */
  | { state: 'needs-install' }
  | { state: 'unsupported' }
  | { state: 'denied' }
  | { state: 'no-key' };

export function isIos(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(vapidKey: string | undefined): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!capable) return isIos() && !isStandalone() ? { state: 'needs-install' } : { state: 'unsupported' };
  if (isIos() && !isStandalone()) return { state: 'needs-install' };
  if (!vapidKey) return { state: 'no-key' };
  if (Notification.permission === 'denied') return { state: 'denied' };
  return { state: 'ready' };
}

/** VAPID keys travel as URL-safe base64; PushManager wants the bytes. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e: unknown) => {
    console.warn('service worker registration failed', e);
    return null;
  });
  return registration;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Asks permission, subscribes this device and tells the server. Throws with a message fit to show. */
export async function enablePush(vapidKey: string): Promise<void> {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('This browser could not start Kevin’s background worker.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for Kevin in this browser’s settings.');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidKey) }));
  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

export const sendTestPush = () => api.post<{ id: number; pushed: number }>('/push/test');
