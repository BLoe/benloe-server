// The gateway's two guards, exercised over real HTTP: who may come in (the owner, as the auth
// service names him) and which state-changing requests are believed (those a foreign page cannot forge).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createHttp } from '../src/http.js';
import type { Kevin } from '../src/kevin.js';
import { makeKevin, view } from './helpers.js';

// A stand-in for the box's auth service: it answers /api/auth/me from the session cookie.
const SESSIONS: Record<string, string> = { 'owner-session': 'Ben@Example.com', 'owner-session-2': 'ben@example.com', 'stranger-session': 'mallory@example.com' };
let authCalls = 0;
let authUp = true;
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
    const token = /(?:^|;\s*)token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const email = token ? SESSIONS[token] : undefined;
    if (req.url !== '/api/auth/me' || !email) return void res.writeHead(401).end('{}');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ user: { email } }));
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
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(401);
    authUp = true;
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(200);
    const calls = authCalls;
    expect((await req('/api/me', { cookie: 'token=owner-session-2' })).status).toBe(200);
    expect(authCalls).toBe(calls);
  });

  it('serves only the install files without a session', async () => {
    // 200 when the web app has been built, 404 when it has not; never a 401 or the sign-in redirect.
    for (const path of ['/manifest.webmanifest', '/icons/icon-192.png', '/favicon.ico']) expect([200, 404], path).toContain((await req(path)).status);
    for (const path of ['/icons/../api/me', '/sw.js', '/index.html', '/assets/app.js']) expect([302, 401], path).toContain((await req(path)).status);
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
