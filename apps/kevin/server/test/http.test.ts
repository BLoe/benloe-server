// The gateway's two guards, exercised over real HTTP: who may come in (the owner, as the auth
// service names him) and which state-changing requests are believed (those a foreign page cannot forge).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { getSetting, OWNER_ACCOUNT_KEY } from '../src/db.js';
import { createHttp } from '../src/http.js';
import type { Kevin } from '../src/kevin.js';
import { makeKevin, view } from './helpers.js';

// A stand-in for the box's auth service: it answers /api/auth/me from the session cookie.
const SESSIONS: Record<string, string> = { 'owner-session': 'Ben@Example.com', 'owner-session-2': 'ben@example.com', 'stranger-session': 'mallory@example.com' };
let authCalls = 0;
let authUp = true;
/** When set, the auth service answers every request with this status (an outage that still answers). */
let authStatus: number | null = null;
let auth: Server;
let app: Server;
let kevin: Kevin;
let base: string;
const saved = { testUser: config.testUser, authUrl: config.authUrl, publicUrl: config.publicUrl };

const listen = (s: Server) => new Promise<string>((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

beforeAll(async () => {
  auth = createServer((req, res) => {
    authCalls++;
    if (!authUp) return void req.socket.destroy();
    if (authStatus) return void res.writeHead(authStatus).end('{"error":"down"}');
    const token = /(?:^|;\s*)token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const email = token ? SESSIONS[token] : undefined;
    if (req.url !== '/api/auth/me' || !email) return void res.writeHead(401).end('{}');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ user: { id: `acct-${email.toLowerCase()}`, email } }));
  });
  config.authUrl = await listen(auth);
  config.publicUrl = 'https://kevin.example';
  kevin = await makeKevin();
  app = createServer(createHttp(kevin));
  base = await listen(app);
});
afterAll(() => {
  Object.assign(config, saved);
  auth.close();
  app.close();
});
beforeEach(() => {
  // Production has no test user: every request is checked against the auth service.
  config.testUser = '';
  authUp = true;
  authStatus = null;
});

const req = (path: string, o: { method?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  fetch(base + path, {
    method: o.method ?? 'GET',
    redirect: 'manual',
    headers: { ...(o.cookie ? { Cookie: o.cookie } : {}), ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
const owner = 'token=owner-session';
const cap = async () => (await view(kevin, 'system/spend')).capUsd as number;

describe('owner-only access', () => {
  it('turns away a request with no session: 401 for the API, the sign-in page for the app', async () => {
    const api = await req('/api/me');
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: 'sign in' });
    const page = await req('/pantry?tab=list');
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe(`https://auth.benloe.com/?redirect=${encodeURIComponent('https://kevin.example/pantry?tab=list')}`);
    for (const path of ['/api/threads', '/api/view/system/facts', '/api/events', '/api/attachments/1/raw', '/api/tools']) expect((await req(path)).status, path).toBe(401);
  });

  it('turns away a signed-in user who is not the owner, and a session the auth service does not know', async () => {
    const stranger = 'token=stranger-session';
    expect((await req('/api/me', { cookie: stranger })).status).toBe(403);
    expect((await req('/api/view/system/facts', { cookie: stranger })).status).toBe(403);
    const page = await req('/', { cookie: stranger });
    expect(page.status).toBe(403);
    expect(await page.text()).not.toContain('<html');
    expect((await req('/api/act/settings_update', { method: 'POST', cookie: stranger, headers: { 'X-Kevin': '1' }, body: { monthly_cap_usd: 999 } })).status).toBe(403);
    expect((await req('/api/me', { cookie: 'token=made-up' })).status).toBe(401);
    expect((await req('/api/me', { cookie: 'other=owner-session' })).status).toBe(401);
    expect(await cap()).toBe(config.defaultMonthlyCapUsd);
  });

  it('lets the owner in, matching his address whatever its case', async () => {
    const me = await req('/api/me', { cookie: `theme=dark; ${owner}` });
    expect(me.status).toBe(200);
    expect((await me.json()).email).toBe('ben@example.com');
  });

  it('asks the auth service again after a failure instead of remembering it, and remembers an answer for a short while', async () => {
    authUp = false;
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(503);
    authUp = true;
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(200);
    const calls = authCalls;
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(200);
    expect(authCalls).toBe(calls);
  });

  it('does not remember an auth service that answers with an error as "not signed in"', async () => {
    authStatus = 500;
    const api = await req('/api/me', { cookie: 'token=owner-session-3' });
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: 'sign-in service unavailable' });
    // A page is not sent to sign in, which would loop for as long as the outage lasts: it says what is wrong.
    const page = await req('/money', { cookie: 'token=owner-session-3' });
    expect(page.status).toBe(503);
    expect(page.headers.get('location')).toBeNull();
    expect(await page.text()).toMatch(/sign-in service is not answering/);
    authStatus = null;
    authUp = false;
    expect((await req('/money', { cookie: 'token=owner-session-3' })).status).toBe(503);
    authUp = true;
    authStatus = 503;
    expect((await req('/api/me', { cookie: 'token=owner-session-3' })).status).toBe(503);
    const calls = authCalls;
    authStatus = null;
    // Asked again at once, not after 30 seconds.
    SESSIONS['owner-session-3'] = 'ben@example.com';
    expect((await req('/api/me', { cookie: 'token=owner-session-3' })).status).toBe(200);
    expect(authCalls).toBe(calls + 1);
    // A refusal (401) is an answer about the session, and is remembered.
    expect((await req('/api/me', { cookie: 'token=refused-session' })).status).toBe(401);
    const after = authCalls;
    expect((await req('/api/me', { cookie: 'token=refused-session' })).status).toBe(401);
    expect(authCalls).toBe(after);
  });

  it('sends a page to sign in only on a real "not signed in", and never redirects a file', async () => {
    const page = await req('/money', { cookie: 'token=made-up' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toMatch(/^https:\/\/auth\.benloe\.com\//);
    for (const path of ['/assets/Money-abc123.js', '/sw.js', '/index.html']) {
      const r = await req(path, { cookie: 'token=made-up' });
      expect(r.status, path).toBe(401);
      expect(r.headers.get('location'), path).toBeNull();
    }
  });

  it('learns the owner\'s account id from his own sign-in, and never from anyone else\'s', async () => {
    kevin.db.prepare('DELETE FROM settings WHERE key = ?').run(OWNER_ACCOUNT_KEY);
    await req('/api/me', { cookie: 'token=stranger-session' });
    expect(getSetting(kevin.db, OWNER_ACCOUNT_KEY, null)).toBeNull();
    SESSIONS['owner-session-4'] = 'BEN@example.com';
    expect((await req('/api/me', { cookie: 'token=owner-session-4' })).status).toBe(200);
    expect(getSetting(kevin.db, OWNER_ACCOUNT_KEY, null)).toBe('acct-ben@example.com');
  });

  it('serves only the install files without a session', async () => {
    // 200 when the web app has been built, 404 when it has not; never a 401 or the sign-in redirect.
    for (const path of ['/manifest.webmanifest', '/icons/icon-192.png', '/favicon.ico']) expect([200, 404], path).toContain((await req(path)).status);
    for (const path of ['/icons/../api/me', '/sw.js', '/index.html', '/assets/app.js']) expect([302, 401], path).toContain((await req(path)).status);
    expect((await req('/assets/app.js')).status).toBe(401);
    // Only for GET.
    expect([302, 401]).toContain((await req('/manifest.webmanifest', { method: 'POST' })).status);
  });

  it('accepts anyone only when the test user is configured, which production never is', async () => {
    config.testUser = 'ben';
    expect((await req('/api/me')).status).toBe(200);
  });
});

describe('cross-site request forgery', () => {
  const post = (headers: Record<string, string>, path = '/api/act/settings_update', body: unknown = { monthly_cap_usd: 777 }) => req(path, { method: 'POST', cookie: owner, headers, body });

  it('refuses a state-changing request without the X-Kevin header, even with the owner\'s cookie', async () => {
    const r = await post({});
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'bad origin' });
    expect((await post({ 'X-Kevin': '0' })).status).toBe(403);
    expect((await post({ 'X-Kevin': 'true' })).status).toBe(403);
    // What a plain cross-site form can send: no custom header, a form content type.
    const form = await fetch(`${base}/api/act/settings_update`, { method: 'POST', headers: { Cookie: owner, 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: '{"monthly_cap_usd":777}' });
    expect(form.status).toBe(403);
    expect(await cap()).toBe(config.defaultMonthlyCapUsd);
  });

  it('refuses the header when the request names another origin', async () => {
    for (const origin of ['https://evil.example', 'https://kevin.example.evil.example', 'http://kevin.example', 'https://kevin.example:8443', 'null']) {
      expect((await post({ 'X-Kevin': '1', Origin: origin })).status, origin).toBe(403);
    }
    expect(await cap()).toBe(config.defaultMonthlyCapUsd);
  });

  it('covers every method that changes state, on every API route', async () => {
    const thread = await (await post({ 'X-Kevin': '1' }, '/api/threads', {})).json();
    for (const [method, path] of [['POST', '/api/threads'], ['PATCH', `/api/threads/${thread.id}`], ['POST', `/api/threads/${thread.id}/messages`], ['POST', `/api/threads/${thread.id}/stop`], ['POST', '/api/uploads?filename=a.txt'], ['POST', '/api/push/subscribe'], ['DELETE', '/api/threads'], ['PUT', '/api/act/settings_update'], ['OPTIONS', '/api/act/settings_update']] as const) {
      const r = await req(path, { method, cookie: owner, body: method === 'OPTIONS' ? undefined : { title: 'renamed', text: 'hi' } });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect(kevin.db.prepare('SELECT title FROM threads WHERE id = ?').get(thread.id)).toEqual({ title: 'New chat' });
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM turns').get()).toEqual({ n: 0 });
  });

  it('accepts the app\'s own requests: the header with the app\'s origin, or with none', async () => {
    const same = await post({ 'X-Kevin': '1', Origin: 'https://kevin.example' });
    expect(same.status).toBe(200);
    expect(await cap()).toBe(777);
    expect((await post({ 'X-Kevin': '1' }, '/api/act/settings_update', { monthly_cap_usd: 60 })).status).toBe(200);
    expect(await cap()).toBe(60);
  });

  it('lets reads through without the header, and still applies the header rule in test mode', async () => {
    expect((await req('/api/me', { cookie: owner, headers: { Origin: 'https://evil.example' } })).status).toBe(200);
    config.testUser = 'ben';
    // Test mode skips only the Origin comparison (the dev server runs on another origin).
    expect((await post({})).status).toBe(403);
    expect((await post({ 'X-Kevin': '1', Origin: 'http://localhost:5173' }, '/api/act/settings_update', { monthly_cap_usd: 61 })).status).toBe(200);
  });

  it('sets the headers that keep the app out of frames and its uploads from being sniffed', async () => {
    const r = await req('/api/me', { cookie: owner });
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
});

describe('the built web app', () => {
  it('serves index.html for the app\'s pages and a 404 for any missing file, never the page in a file\'s place', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(config.dataDir, `web-${Date.now()}`);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'Pantry-new.js'), 'export default 1;');
    const savedWeb = config.webDir;
    config.webDir = dir;
    config.testUser = 'ben';
    const server = createServer(createHttp(kevin));
    const url = await listen(server);
    try {
      for (const path of ['/', '/money', '/money/accounts', '/s/car-maintenance', '/chat/abc-123']) {
        const r = await fetch(url + path);
        expect(r.status, path).toBe(200);
        expect(r.headers.get('content-type'), path).toMatch(/^text\/html/);
      }
      const js = await fetch(`${url}/assets/Pantry-new.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toMatch(/javascript/);
      // A chunk of the previous build, asked for by a copy of the app left open over a deploy.
      for (const path of ['/assets/Pantry-old.js', '/assets/index-old.css', '/assets/', '/assets/sub/x', '/favicon.ico', '/robots.txt', '/money/report.pdf']) {
        const r = await fetch(url + path);
        expect(r.status, path).toBe(404);
        expect(r.headers.get('content-type'), path).not.toMatch(/html/);
        expect(await r.text(), path).not.toContain('<div id="root">');
      }
    } finally {
      server.close();
      config.webDir = savedWeb;
    }
  });
});
