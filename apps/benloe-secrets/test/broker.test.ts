// The capability boundary, exercised end-to-end over the real Express app.
//
// The assertions that matter are the negative ones: that a credential's VALUE
// never appears in anything the broker returns, even when the broker has just
// used it. A test suite for this service that only checked happy paths would
// miss the entire point of building it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { buildBrokerApp } from '../src/broker.js';
import { createAuditLog } from '../src/audit.js';
import { migrate, putCredential } from '../src/credentials.js';
import { CLIENT_ID_CRED, SECRET_CRED } from '../src/plaid.js';

const KEY = Buffer.alloc(32, 7);
const CLIENT_ID = 'client-id-VERYSECRET-1234';
const API_SECRET = 'api-secret-VERYSECRET-5678';
const ITEM_TOKEN = 'access-sandbox-VERYSECRET-tok';

let dir: string;
let db: Database.Database;
let server: Server;
let base: string;
/** Captures what the broker actually sent upstream, so we can prove the
 *  credentials went to Plaid and nowhere else. */
let sent: { url: string; body: Record<string, unknown> }[];

function fakeFetch(response: unknown = { ok: true }, status = 200): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

async function start(fetchImpl: typeof fetch) {
  const app = buildBrokerApp({
    db,
    key: KEY,
    audit: createAuditLog(join(dir, 'audit.log')),
    environment: 'sandbox',
    fetchImpl,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'broker-'));
  db = new Database(join(dir, 'secrets.db'));
  migrate(db);
  putCredential(db, KEY, { name: CLIENT_ID_CRED, secret: CLIENT_ID });
  putCredential(db, KEY, { name: SECRET_CRED, secret: API_SECRET });
  putCredential(db, KEY, { name: 'plaid-item-1', secret: ITEM_TOKEN });
  sent = [];
});

afterEach(() => {
  server?.close();
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('broker capability API', () => {
  it('lists credentials as metadata only — no ciphertext, no secret', async () => {
    await start(fakeFetch());
    const res = await fetch(`${base}/v1/credentials`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain(CLIENT_ID_CRED);
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain(API_SECRET);
    expect(text).not.toMatch(/ciphertext|auth_tag/);
  });

  it('proxies an allowlisted call, injecting credentials upstream only', async () => {
    await start(fakeFetch({ link_token: 'link-sandbox-xyz' }));
    const res = await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/link/token/create', body: { user: { client_user_id: 'ben' } } }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).body).toEqual({ link_token: 'link-sandbox-xyz' });

    // Went to Plaid...
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://sandbox.plaid.com/link/token/create');
    expect(sent[0]!.body.client_id).toBe(CLIENT_ID);
    expect(sent[0]!.body.secret).toBe(API_SECRET);
    // ...and NOT back to the caller.
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain(API_SECRET);
  });

  it('resolves an access token by NAME and never echoes it', async () => {
    await start(fakeFetch({ added: [], has_more: false }));
    const res = await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/transactions/sync', body: { cursor: 'abc' }, accessTokenCredential: 'plaid-item-1' }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(sent[0]!.body.access_token).toBe(ITEM_TOKEN);
    expect(sent[0]!.body.cursor).toBe('abc');
    expect(text).not.toContain(ITEM_TOKEN);
  });

  it('refuses a path that is not allowlisted', async () => {
    await start(fakeFetch());
    const res = await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/item/public_token/exchange', body: {} }),
    });
    expect(res.status).toBe(403);
    expect(sent, 'nothing may reach Plaid on a refused path').toHaveLength(0);
  });

  it('drops a caller-supplied literal access_token instead of forwarding it', async () => {
    // Cabinet having a raw token to pass would itself be the regression this
    // design prevents; honouring it silently would hide that.
    await start(fakeFetch({ accounts: [] }));
    await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/accounts/get',
        body: { access_token: 'smuggled-token' },
        accessTokenCredential: 'plaid-item-1',
      }),
    });
    expect(sent[0]!.body.access_token).toBe(ITEM_TOKEN);
    expect(sent[0]!.body.access_token).not.toBe('smuggled-token');
  });

  it('requires an access token credential for item-scoped paths', async () => {
    await start(fakeFetch());
    const res = await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/accounts/get', body: {} }),
    });
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it('stores an exchanged access token and returns only its name', async () => {
    await start(fakeFetch({ access_token: 'access-sandbox-NEW', item_id: 'item-99' }));
    const res = await fetch(`${base}/v1/plaid/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicToken: 'public-sandbox-1', credentialName: 'plaid-item-99' }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ item_id: 'item-99', accessTokenCredential: 'plaid-item-99' });
    expect(text, 'the exchanged token must not come back to the caller').not.toContain('access-sandbox-NEW');
    // ...but it IS retained, so a later call can use it.
    expect(db.prepare('SELECT 1 FROM credential WHERE name = ?').get('plaid-item-99')).toBeTruthy();
  });

  it('has no endpoint that returns a secret', async () => {
    await start(fakeFetch());
    for (const p of ['/v1/credentials/plaid-secret/secret', '/v1/secret/plaid-secret', '/v1/decrypt']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, `${p} must not exist`).toBe(404);
    }
  });

  it('records every use in the audit log, without the values', async () => {
    await start(fakeFetch({ link_token: 'x' }));
    await fetch(`${base}/v1/plaid/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/link/token/create', body: {} }),
    });
    const log = readFileSync(join(dir, 'audit.log'), 'utf8');
    expect(log).toContain('plaid.request');
    expect(log).toContain(CLIENT_ID_CRED);
    expect(log).not.toContain(CLIENT_ID);
    expect(log).not.toContain(API_SECRET);
  });
});
