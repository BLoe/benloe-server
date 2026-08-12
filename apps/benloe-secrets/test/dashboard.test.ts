/**
 * The owner-only boundary.
 *
 * This dashboard is the one surface on the box that can read every secret, so
 * "who is allowed in" is the property most worth testing. Everything else here
 * exists to make sure a save actually reaches the consumers, because a save that
 * did not render has not done anything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import request from 'supertest';
import { buildDashboardApp } from '../src/dashboard.js';
import { migrate, saveSet, readSet, listSets } from '../src/store.js';

const OWNER = 'owner@example.com';
const KEY = randomBytes(32);

let db: Database.Database;
let dir: string;

/** An artanis stand-in that returns whatever principal a test asks for. */
function authAs(user: { email?: string; role?: string } | null): typeof fetch {
  return (async () =>
    user
      ? new Response(JSON.stringify({ user }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('no', { status: 401 })) as unknown as typeof fetch;
}

function app(authFetch: typeof fetch) {
  return buildDashboardApp({
    db,
    key: KEY,
    audit: () => {},
    ownerEmail: OWNER,
    runtimeDir: dir,
    authFetch,
    loginUrl: 'https://auth.example.com/',
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  dir = mkdtempSync(join(tmpdir(), 'benloe-dash-'));
  saveSet(db, KEY, 'shared', 'JWT_SECRET=shared-value\n', 'seed');
  saveSet(db, KEY, 'kickball', 'KICKBALL_DB=/tmp/k.db\n', 'seed');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('authentication', () => {
  it('sends a browser with no session to the login page rather than a JSON error', async () => {
    const res = await request(app(authAs(null))).get('/').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://auth.example.com/');
  });

  it('returns 401 to an API client with no session', async () => {
    const res = await request(app(authAs(null))).get('/').set('Accept', 'application/json');
    expect(res.status).toBe(401);
  });

  it('refuses an authenticated NON-owner', async () => {
    const res = await request(app(authAs({ email: 'someone@example.com', role: 'user' })))
      .get('/')
      .set('Cookie', 'token=t')
      .set('Accept', 'text/html');
    expect(res.status).toBe(403);
  });

  it('refuses an agent-role principal even at the owner address', async () => {
    // The whole point of this service: Cabinet's agent holds valid artanis
    // credentials and must still be unable to read the secret store.
    const res = await request(app(authAs({ email: OWNER, role: 'agent' })))
      .get('/')
      .set('Cookie', 'token=t')
      .set('Accept', 'text/html');
    expect(res.status).toBe(403);
  });

  it('lets the owner in', async () => {
    const res = await request(app(authAs({ email: OWNER, role: 'user' }))).get('/').set('Cookie', 'token=t');
    expect(res.status).toBe(200);
    expect(res.text).toContain('kickball');
  });

  it('serves healthz with no session and leaks nothing from it', async () => {
    const res = await request(app(authAs(null))).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('shared-value');
  });

  it('refuses a write from a non-owner', async () => {
    const res = await request(app(authAs({ email: 'someone@example.com', role: 'user' })))
      .post('/api/sets/kickball')
      .set('Cookie', 'token=t').send({ document: 'STOLEN=1' });
    expect(res.status).toBe(403);
    expect(readSet(db, KEY, 'kickball')).toBe('KICKBALL_DB=/tmp/k.db\n');
  });
});

describe('saving', () => {
  const owner = () => app(authAs({ email: OWNER, role: 'user' }));

  it('saves a set and renders it in the same request', async () => {
    const res = await request(owner()).post('/api/sets/kickball').set('Cookie', 'token=t').send({ document: 'KICKBALL_DB=/tmp/new.db' });
    expect(res.status).toBe(200);
    // A save that did not reach the rendered file has not done anything.
    const rendered = readFileSync(join(dir, 'kickball.env'), 'utf8');
    expect(rendered).toContain('KICKBALL_DB=/tmp/new.db');
    expect(rendered).toContain('JWT_SECRET=shared-value');
  });

  it('keeps one app out of another app\'s rendered file', async () => {
    await request(owner()).post('/api/sets/cabinet').set('Cookie', 'token=t').send({ document: 'MAILGUN_API_KEY=mg-value-xyz' });
    const kickball = readFileSync(join(dir, 'kickball.env'), 'utf8');
    expect(kickball).not.toContain('MAILGUN_API_KEY');
    expect(kickball).not.toContain('mg-value-xyz');
  });

  it('rejects an invalid set name instead of writing outside the directory', async () => {
    const res = await request(owner()).post('/api/sets/..%2Fetc%2Fpasswd').set('Cookie', 'token=t').send({ document: 'A=1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('appends a version rather than overwriting history', async () => {
    await request(owner()).post('/api/sets/kickball').set('Cookie', 'token=t').send({ document: 'A=1' });
    await request(owner()).post('/api/sets/kickball').set('Cookie', 'token=t').send({ document: 'A=2' });
    const res = await request(owner()).get('/').set('Cookie', 'token=t');
    expect(res.status).toBe(200);
    expect(readSet(db, KEY, 'kickball')).toBe('A=2');
  });

  it('refuses to delete the shared set', async () => {
    const res = await request(owner()).delete('/api/sets/shared').set('Cookie', 'token=t');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(listSets(db).some((s) => s.name === 'shared')).toBe(true);
  });
});
