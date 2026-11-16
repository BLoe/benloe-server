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

// ---- caching after a deploy ----------------------------------------------------

interface FakeRes { status: number; redirected: boolean; type: string; headers: Headers; body: string; clone(): FakeRes }
const res = (status: number, contentType: string, body: string, o: { redirected?: boolean; type?: string } = {}): FakeRes => {
  const r: FakeRes = { status, redirected: o.redirected ?? false, type: o.type ?? 'basic', headers: new Headers({ 'Content-Type': contentType }), body, clone: () => r };
  return r;
};

function cachingWorker(network: (url: string) => FakeRes) {
  const listeners = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, FakeRes>>();
  const keyOf = (r: any) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const open = async (name: string) => {
    const m = stores.get(name) ?? stores.set(name, new Map()).get(name)!;
    return {
      match: async (r: any) => m.get(keyOf(r)),
      put: async (r: any, v: FakeRes) => void m.set(keyOf(r), v),
      delete: async (r: any) => m.delete(keyOf(r)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: any, o: { cacheName: string }) => stores.get(o.cacheName)?.get(keyOf(r)),
  };
  const self = { location: { origin: ORIGIN }, addEventListener: (n: string, fn: (e: any) => void) => listeners.set(n, fn), skipWaiting: () => undefined, clients: { claim: async () => undefined } };
  const fetched: string[] = [];
  new Function('self', 'caches', 'fetch', source)(self, caches, async (req: any) => (fetched.push(req.url), network(req.url)));
  const get = async (path: string, mode = 'no-cors') => {
    let answer: Promise<FakeRes> | undefined;
    listeners.get('fetch')!({ request: { method: 'GET', url: ORIGIN + path, mode }, respondWith: (p: Promise<FakeRes>) => (answer = p) });
    return answer ? await answer : undefined;
  };
  const activate = async () => {
    let waited: Promise<unknown> = Promise.resolve();
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  };
  return { get, activate, stores, fetched };
}

describe('the service worker after a deploy', () => {
  it('keeps a real script or stylesheet, and never a page, an error or a redirect stored under an asset name', async () => {
    const answers: Record<string, FakeRes> = {
      '/assets/Pantry-new.js': res(200, 'text/javascript; charset=utf-8', 'export default 1'),
      '/assets/index-new.css': res(200, 'text/css', 'body{}'),
      '/assets/Pantry-old.js': res(404, 'text/plain', 'Not found'),
      '/assets/Money-old.js': res(200, 'text/html; charset=utf-8', '<!doctype html>'), // an older server's SPA fallback
      '/assets/Taxes-old.css': res(200, 'text/html', '<!doctype html>'),
      '/assets/Jobs-x.js': res(200, 'text/javascript', 'x', { redirected: true }),
      '/assets/icon.png': res(200, 'image/png', 'png'),
      '/assets/odd.js': res(200, 'application/json', '{}'),
      '/assets/logo-old.svg': res(200, 'text/html', '<!doctype html>'), // no expected type for .svg, but never HTML
    };
    const sw = cachingWorker((url) => answers[new URL(url).pathname]!);
    for (const path of Object.keys(answers)) await sw.get(path);
    const kept = [...(sw.stores.get('kevin-assets-v2')?.keys() ?? [])].map((u) => new URL(u).pathname).sort();
    expect(kept).toEqual(['/assets/Pantry-new.js', '/assets/icon.png', '/assets/index-new.css']);
    // What was not kept is still passed through, so the page sees the failure (and reloads for the new build).
    expect((await sw.get('/assets/Pantry-old.js'))!.status).toBe(404);
    // A kept asset is served from the cache.
    const before = sw.fetched.length;
    expect((await sw.get('/assets/Pantry-new.js'))!.body).toBe('export default 1');
    expect(sw.fetched.length).toBe(before);
  });

  it('drops caches from the version that could hold a page under a script name, and a bad entry it finds', async () => {
    const sw = cachingWorker(() => res(200, 'text/javascript', 'fresh'));
    sw.stores.set('kevin-assets-v1', new Map([[`${ORIGIN}/assets/a.js`, res(200, 'text/html', '<!doctype html>')]]));
    await sw.activate();
    expect([...sw.stores.keys()]).not.toContain('kevin-assets-v1');
    // An HTML entry under a script name, however it got there, is not served.
    sw.stores.set('kevin-assets-v2', new Map([[`${ORIGIN}/assets/b.js`, res(200, 'text/html', '<!doctype html>')]]));
    expect((await sw.get('/assets/b.js'))!.body).toBe('fresh');
    expect(sw.stores.get('kevin-assets-v2')!.get(`${ORIGIN}/assets/b.js`)!.body).toBe('fresh');
  });

  it('keeps only the app page as the offline shell, not an error page or a sign-in redirect', async () => {
    let next = res(503, 'text/html', 'auth is down');
    const sw = cachingWorker(() => next);
    await sw.get('/money', 'navigate');
    expect(sw.stores.get('kevin-shell-v2')?.size ?? 0).toBe(0);
    next = res(200, 'text/html', 'signin', { redirected: true });
    await sw.get('/money', 'navigate');
    expect(sw.stores.get('kevin-shell-v2')?.size ?? 0).toBe(0);
    next = res(200, 'text/html; charset=utf-8', '<div id=root>');
    await sw.get('/money', 'navigate');
    expect(sw.stores.get('kevin-shell-v2')!.get(`${ORIGIN}/`)!.body).toBe('<div id=root>');
  });
});
