// The service worker is a plain script in public/. It is loaded here with a stand-in for the
// worker's global scope, so what it does with a pushed link can be checked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://kevin.example';

interface Shown { title: string; options: { data: { id: number | null; link: string } } }

function loadWorker(openWindows: { url: string; focus(): Promise<void>; postMessage(m: unknown): void }[] = []) {
  const listeners = new Map<string, (event: any) => void>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
    skipWaiting: () => undefined,
    registration: { showNotification: async (title: string, options: Shown['options']) => void shown.push({ title, options }) },
    clients: {
      claim: async () => undefined,
      matchAll: async () => openWindows,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  new Function('self', 'caches', 'fetch', source)(self, {}, () => Promise.reject(new Error('no network in tests')));
  const dispatch = async (name: string, event: Record<string, unknown>) => {
    let waited: Promise<unknown> = Promise.resolve();
    listeners.get(name)!({ ...event, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  };
  return {
    shown, opened,
    push: (payload: unknown) => dispatch('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
    click: (data: unknown) => dispatch('notificationclick', { notification: { close: () => undefined, data } }),
  };
}

const OUTSIDE = ['//evil.example/signin', '/\\evil.example/signin', '/\\/evil.example', '/\t/evil.example', 'https://evil.example/signin', 'javascript:alert(1)', 'evil', '', null, 7];

describe('the service worker and notification links', () => {
  it('stores only a path on its own origin with the notification it shows', async () => {
    const sw = loadWorker();
    await sw.push({ id: 3, title: 'Use the milk', body: 'Expires tomorrow', link: '/pantry?tab=fridge' });
    expect(sw.shown[0]).toMatchObject({ title: 'Use the milk', options: { data: { id: 3, link: '/pantry?tab=fridge' } } });
    for (const link of OUTSIDE) await sw.push({ id: 4, title: 'Sign in again', link });
    expect(sw.shown.slice(1).map((n) => n.options.data.link)).toEqual(OUTSIDE.map(() => '/'));
  });

  it('opens a tapped notification only inside the app, whatever link the notification carries', async () => {
    const sw = loadWorker();
    await sw.click({ id: 1, link: '/s/car-maintenance' });
    expect(sw.opened).toEqual(['/s/car-maintenance']);
    // A notification shown by an older worker, or one whose data was tampered with, is checked at the tap too.
    for (const link of OUTSIDE) await sw.click({ id: 2, link });
    await sw.click(null);
    expect(sw.opened.slice(1)).toEqual([...OUTSIDE.map(() => '/'), '/']);
    for (const url of sw.opened) expect(new URL(url, ORIGIN).origin).toBe(ORIGIN);
  });

  it('sends an already-open window an in-app path, never an outside address', async () => {
    const messages: any[] = [];
    let focused = 0;
    const sw = loadWorker([{ url: `${ORIGIN}/money`, focus: async () => void focused++, postMessage: (m) => messages.push(m) }]);
    await sw.click({ id: 9, link: '//evil.example/signin' });
    await sw.click({ id: 10, link: '/taxes' });
    expect(sw.opened).toEqual([]);
    expect(focused).toBe(2);
    expect(messages).toEqual([{ type: 'navigate', link: '/', notificationId: 9 }, { type: 'navigate', link: '/taxes', notificationId: 10 }]);
  });
});
