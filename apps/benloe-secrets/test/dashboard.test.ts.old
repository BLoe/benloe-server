// The operator surface. Two things under test that matter more than the CRUD:
// that an agent-role principal is refused even with a valid artanis session,
// and that a stored secret cannot be read back through any route here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { buildDashboardApp } from '../src/dashboard.js';
import { createAuditLog } from '../src/audit.js';
import { migrate } from '../src/store.js';

const KEY = Buffer.alloc(32, 3);
const OWNER = 'below413@gmail.com';
const SECRET_VALUE = 'plaid-secret-DO-NOT-LEAK-9999';

let dir: string;
let db: Database.Database;
let server: Server;
let base: string;

/** token=owner → Ben; token=agent → a valid agent principal; else 401. */
const fakeAuthFetch = (async (_url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER, role: 'admin' } }), { status: 200 });
  if (cookie.includes('token=agent'))
    return new Response(JSON.stringify({ user: { email: 'benji@agents.benloe.com', role: 'agent' } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

async function start() {
  const app = buildDashboardApp({
    db,
    key: KEY,
    audit: createAuditLog(join(dir, 'audit.log')),
    environment: 'sandbox',
    ownerEmail: OWNER,
    auditLogPath: join(dir, 'audit.log'),
    authFetch: fakeAuthFetch,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const as = (who: string) => ({ Cookie: `token=${who}`, 'Content-Type': 'application/json' });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dash-'));
  db = new Database(join(dir, 'secrets.db'));
  migrate(db);
  await start();
});

afterEach(() => {
  server?.close();
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('dashboard auth', () => {
  it('refuses an unauthenticated request', async () => {
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
  });

  it('refuses a VALID agent session — owner only', async () => {
    // The critical case: Cabinet's own agent key authenticates fine at artanis
    // and must still be useless here.
    const res = await fetch(`${base}/api/state`, { headers: as('agent') });
    expect(res.status).toBe(403);
  });

  it('serves the owner', async () => {
    const res = await fetch(`${base}/api/state`, { headers: as('owner') });
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.actor).toBe(OWNER);
    expect(s.keyLoaded).toBe(true);
  });

  it('leaves /healthz open so an uptime check needs no session', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe('credential management', () => {
  it('stores, rotates and deletes — never returning the value', async () => {
    const put = await fetch(`${base}/api/credentials/plaid-secret`, {
      method: 'PUT',
      headers: as('owner'),
      body: JSON.stringify({ secret: SECRET_VALUE, description: 'Plaid API secret, sandbox' }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ name: 'plaid-secret', created: true });

    const state = await (await fetch(`${base}/api/state`, { headers: as('owner') })).text();
    expect(state).toContain('plaid-secret');
    expect(state, 'the stored value must never appear in any response').not.toContain(SECRET_VALUE);

    // Rotating reports created:false, which is what makes "last rotated" honest.
    const rot = await fetch(`${base}/api/credentials/plaid-secret`, {
      method: 'PUT',
      headers: as('owner'),
      body: JSON.stringify({ secret: 'a-new-value' }),
    });
    expect((await rot.json()).created).toBe(false);

    const del = await fetch(`${base}/api/credentials/plaid-secret`, { method: 'DELETE', headers: as('owner') });
    expect(await del.json()).toEqual({ deleted: true });
  });

  it('rejects a bad name and an empty secret', async () => {
    const bad = await fetch(`${base}/api/credentials/Not_A_Slug`, {
      method: 'PUT',
      headers: as('owner'),
      body: JSON.stringify({ secret: 'x' }),
    });
    expect(bad.status).toBe(400);

    const empty = await fetch(`${base}/api/credentials/ok-name`, {
      method: 'PUT',
      headers: as('owner'),
      body: JSON.stringify({ secret: '' }),
    });
    expect(empty.status).toBe(400);
  });

  it('an agent session cannot write or delete either', async () => {
    const put = await fetch(`${base}/api/credentials/plaid-secret`, {
      method: 'PUT',
      headers: as('agent'),
      body: JSON.stringify({ secret: 'nope' }),
    });
    expect(put.status).toBe(403);
    const del = await fetch(`${base}/api/credentials/plaid-secret`, { method: 'DELETE', headers: as('agent') });
    expect(del.status).toBe(403);
  });

  it('surfaces credential use in the audit feed', async () => {
    await fetch(`${base}/api/credentials/plaid-secret`, {
      method: 'PUT',
      headers: as('owner'),
      body: JSON.stringify({ secret: SECRET_VALUE }),
    });
    const feed = await (await fetch(`${base}/api/audit`, { headers: as('owner') })).text();
    expect(feed).toContain('credential.put');
    expect(feed).toContain(OWNER);
    expect(feed).not.toContain(SECRET_VALUE);
  });
});
