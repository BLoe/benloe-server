/* ============================================================================
   integrations/plaid.ts + gateway/plaidRoutes.ts

   Two properties are load-bearing here and both fail SILENTLY if broken:

   1. An access token is a permanent bearer credential for Ben's bank. It must
      never appear in a response body, and the sealed row must be real
      ciphertext. These tests assert on RAW response text before parsing, the
      same way credentials.test.ts does — a token nested three levels deep in
      JSON still shows up in a substring check.

   2. The webhook endpoint sits outside the auth wall by necessity (Plaid can't
      hold a session cookie), so the ES256 signature IS the authentication. A
      verification function that accidentally returns true is an unauthenticated
      public write endpoint. Every rejection path is tested individually.

   No network: fetch is stubbed per-path. The webhook signatures are genuinely
   signed with a locally generated P-256 key, so the crypto path under test is
   the real one — including the ieee-p1363 detail that silently breaks every
   legitimate webhook if it regresses.
   ========================================================================== */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { putCredential } from '../src/domains/credentials.js';
import {
  PlaidClient,
  PlaidApiError,
  PlaidNotConfiguredError,
  itemCredentialName,
  plaidEnv,
  CLIENT_ID_CRED,
  SECRET_CRED,
} from '../src/integrations/plaid.js';
import { registerPlaidRoutes, registerPlaidWebhook } from '../src/gateway/plaidRoutes.js';
import { getItemByItemId, listAccounts, listItems, recentTransactions } from '../src/domains/money.js';

const KEY = Buffer.alloc(32, 7);
const ACCESS_TOKEN = 'access-production-11111111-2222-3333-4444-555555555555';
const CLIENT_ID = 'client-id-not-real';
const API_SECRET = 'api-secret-not-real';

let dir: string;
let cabinet: CabinetDb;

/* ------------------------------------------------------------ fetch stub -- */

type Responder = (body: Record<string, unknown>) => unknown;
let routes: Record<string, Responder>;
let calls: { path: string; body: Record<string, unknown> }[];

function stubFetch() {
  calls = [];
  // Only *.plaid.com is intercepted. The route tests below drive a real
  // express server over a real socket, and swallowing those requests too would
  // make this stub the thing under test instead of the code.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const parsed = new URL(href);
    if (!parsed.hostname.endsWith('plaid.com')) return realFetch(url as string, init);
    const path = parsed.pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ path, body });
    const responder = routes[path];
    if (!responder) {
      return new Response(JSON.stringify({ error_code: 'NOT_STUBBED', error_message: `no stub for ${path}` }), {
        status: 400,
      });
    }
    const result = responder(body);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200 });
  });
}

function configured(): PlaidClient {
  putCredential(cabinet.db, KEY, { name: CLIENT_ID_CRED, secret: CLIENT_ID });
  putCredential(cabinet.db, KEY, { name: SECRET_CRED, secret: API_SECRET });
  return new PlaidClient(cabinet.db, KEY, 'sandbox', 'https://cabinet.example.com');
}

/* ------------------------------------------------------- webhook signing -- */

let webhookKey: { privateKey: KeyObject; publicKey: KeyObject };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Sign a webhook exactly the way Plaid does: ES256 over header.payload, JWS r||s. */
function signWebhook(
  rawBody: Buffer,
  opts: { kid?: string; alg?: string; iat?: number; bodyHash?: string } = {},
): string {
  const header = { alg: opts.alg ?? 'ES256', kid: opts.kid ?? 'test-kid', typ: 'JWT' };
  const payload = {
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: opts.bodyHash ?? createHash('sha256').update(rawBody).digest('hex'),
  };
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = createSign('sha256')
    .update(input)
    .sign({ key: webhookKey.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

/** Serve the matching public JWK, as /webhook_verification_key/get would. */
function stubVerificationKey() {
  routes['/webhook_verification_key/get'] = () => ({
    key: { ...webhookKey.publicKey.export({ format: 'jwk' }), kid: 'test-kid', use: 'sig', alg: 'ES256' },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-plaid-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  routes = {};
  stubFetch();
  webhookKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

/* =========================================================== configuration */

describe('configuration', () => {
  it('is a normal degraded state, not a crash, when no keys are stored', async () => {
    const plaid = new PlaidClient(cabinet.db, KEY, 'sandbox', 'https://cabinet.example.com');
    expect(plaid.configured()).toBe(false);
    await expect(plaid.createLinkToken({ userId: 'ben' })).rejects.toBeInstanceOf(PlaidNotConfiguredError);
  });

  it('reports unconfigured when the master key itself is absent', () => {
    putCredential(cabinet.db, KEY, { name: CLIENT_ID_CRED, secret: CLIENT_ID });
    putCredential(cabinet.db, KEY, { name: SECRET_CRED, secret: API_SECRET });
    // Metadata-only mode: rows exist but nothing can be decrypted.
    expect(new PlaidClient(cabinet.db, null).configured()).toBe(false);
  });

  it('defaults to sandbox and only accepts the two real environments', () => {
    expect(plaidEnv({})).toBe('sandbox');
    expect(plaidEnv({ PLAID_ENV: 'production' })).toBe('production');
    // 'development' was decommissioned by Plaid in 2024; anything unrecognised
    // must fall back to sandbox rather than reach production by accident.
    expect(plaidEnv({ PLAID_ENV: 'development' })).toBe('sandbox');
    expect(plaidEnv({ PLAID_ENV: 'PRODUCTION' })).toBe('production');
  });

  it('derives a legal, deterministic credential name from any item_id', () => {
    // Plaid item_ids are mixed-case; credential names are a lowercase slug.
    const name = itemCredentialName('AbCdEf123-XYZ');
    expect(name).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
    // Deterministic: re-linking the same Item rotates the row in place instead
    // of orphaning a live bearer token under a name nothing references.
    expect(itemCredentialName('AbCdEf123-XYZ')).toBe(name);
    expect(itemCredentialName('different-item')).not.toBe(name);
  });

  it('builds the redirect and webhook URLs from the configured origin', () => {
    const plaid = new PlaidClient(cabinet.db, KEY, 'production', 'https://cabinet.benloe.com');
    expect(plaid.redirectUri).toBe('https://cabinet.benloe.com/plaid/oauth');
    // Must live under /api/ — Caddy proxies nothing else to this server.
    expect(plaid.webhookUrl).toBe('https://cabinet.benloe.com/api/plaid/webhook');
  });
});

/* ================================================================ linking */

describe('linking', () => {
  it('never sends credentials to the caller and never stores a token in plaintext', async () => {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    routes['/item/get'] = () => ({ item: { institution_id: 'ins_127989' } });
    routes['/institutions/get_by_id'] = () => ({ institution: { name: 'Bank of America' } });

    const item = await plaid.exchangePublicToken('public-sandbox-xyz');
    expect(item.institution_name).toBe('Bank of America');
    expect(item.token_credential).toBe(itemCredentialName('item-boa'));

    // The returned row is what routes serialize. It must carry the credential
    // NAME, never the token itself.
    expect(JSON.stringify(item)).not.toContain(ACCESS_TOKEN);

    // And the stored row must be genuine ciphertext.
    const row = cabinet.db
      .prepare('SELECT ciphertext FROM credential WHERE name = ?')
      .get(item.token_credential!) as { ciphertext: Buffer };
    expect(row.ciphertext.toString('utf8')).not.toContain(ACCESS_TOKEN);
    expect(row.ciphertext.toString('base64')).not.toContain(Buffer.from(ACCESS_TOKEN).toString('base64'));
  });

  it('links successfully even when the institution name lookup fails', async () => {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    // /item/get deliberately unstubbed → 400. Cosmetic metadata must never
    // fail a link that already succeeded at the bank.
    const item = await plaid.exchangePublicToken('public-sandbox-xyz');
    expect(item.institution_name).toBeNull();
    expect(item.status).toBe('active');
    expect(item.token_credential).not.toBeNull();
  });

  it('requests transactions as required and investments as optional', async () => {
    const plaid = configured();
    routes['/link/token/create'] = () => ({ link_token: 'link-sandbox-1' });
    await plaid.createLinkToken({ userId: 'ben' });
    const body = calls.find((c) => c.path === '/link/token/create')!.body;
    // Requiring investments would filter every checking-only bank out of Link's
    // institution search — including Bank of America.
    expect(body.products).toEqual(['transactions']);
    expect(body.optional_products).toEqual(['investments']);
    // Never requested: auth (account/routing numbers), identity, transfer.
    expect(JSON.stringify(body)).not.toContain('"auth"');
    expect(JSON.stringify(body)).not.toContain('"identity"');
  });

  it('leaves a revocable record when sealing the token fails', async () => {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    // Force the seal to fail at exactly the right moment. A trigger is the
    // honest way to do it: the exchange genuinely succeeds at Plaid and the
    // credential write genuinely fails, which is the real-world case (disk
    // full, key rotated mid-flight) this ordering exists for.
    cabinet.db.exec(`
      CREATE TRIGGER no_item_creds BEFORE INSERT ON credential
      WHEN NEW.name LIKE 'plaid-item-%'
      BEGIN SELECT RAISE(ABORT, 'seal failed'); END;
    `);

    await expect(plaid.exchangePublicToken('public-sandbox-xyz')).rejects.toThrow();

    // The token now exists at Plaid. If no local row survived, Cabinet would
    // have a live bearer credential for Ben's bank that it cannot see and
    // therefore cannot revoke. An orphaned row is a cleanup task; an orphaned
    // token is a security problem — hence write the row first.
    const item = getItemByItemId(cabinet.db, 'item-boa');
    expect(item).toBeTruthy();
    expect(item!.status).toBe('error');
    expect(item!.error_code).toBe('TOKEN_STORE_FAILED');
    expect(item!.token_credential).toBeNull();
  });
});

/* =================================================================== sync */

describe('sync', () => {
  async function linked(): Promise<{ plaid: PlaidClient; itemPk: number }> {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    const item = await plaid.exchangePublicToken('public-sandbox-xyz');
    return { plaid, itemPk: item.id };
  }

  it('pulls accounts before transactions so nothing is silently skipped', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () => ({
      accounts: [
        { account_id: 'acct-checking', name: 'Checking', mask: '4421', type: 'depository', subtype: 'checking', balances: { current: 5200, available: 5100 } },
      ],
      added: [{ transaction_id: 't1', account_id: 'acct-checking', amount: 43.17, date: '2026-08-01', name: 'Grubhub' }],
      modified: [],
      removed: [],
      next_cursor: 'cursor-1',
      has_more: false,
    });

    const report = await plaid.syncItem(itemPk);
    expect(report.ok).toBe(true);
    expect(report.accounts).toBe(1);
    expect(report.transactions.added).toBe(1);
    // The failure this ordering prevents.
    expect(report.transactions.skipped).toBe(0);
    expect(listAccounts(cabinet.db)).toHaveLength(1);
  });

  it('follows pagination and persists the final cursor', async () => {
    const { plaid, itemPk } = await linked();
    let page = 0;
    routes['/transactions/sync'] = () => {
      page += 1;
      return {
        accounts: page === 1
          ? [{ account_id: 'a1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } }]
          : [],
        added: [{ transaction_id: `t${page}`, account_id: 'a1', amount: 10, date: '2026-08-01', name: 'x' }],
        modified: [],
        removed: [],
        next_cursor: `cursor-${page}`,
        has_more: page < 3,
      };
    };
    const report = await plaid.syncItem(itemPk);
    expect(report.transactions.added).toBe(3);
    expect(getItemByItemId(cabinet.db, 'item-boa')!.transactions_cursor).toBe('cursor-3');
  });

  it('resumes from the stored cursor instead of re-pulling two years', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () => ({
      accounts: [], added: [], modified: [], removed: [], next_cursor: 'cursor-2', has_more: false,
    });
    await plaid.syncItem(itemPk);
    calls.length = 0;
    await plaid.syncItem(itemPk);
    expect(calls.find((c) => c.path === '/transactions/sync')!.body.cursor).toBe('cursor-2');
  });

  it('keeps a successful transaction sync when the bank has no investments product', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () => ({
      accounts: [{ account_id: 'a1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } }],
      added: [{ transaction_id: 't1', account_id: 'a1', amount: 10, date: '2026-08-01', name: 'x' }],
      modified: [], removed: [], next_cursor: 'c1', has_more: false,
    });
    routes['/investments/holdings/get'] = () =>
      new Response(
        JSON.stringify({ error_code: 'PRODUCTS_NOT_SUPPORTED', error_type: 'INVALID_REQUEST', error_message: 'nope' }),
        { status: 400 },
      );

    const report = await plaid.syncItem(itemPk);
    // Bank of America is exactly this shape. A checking-only bank must not
    // report a failed sync because it has no brokerage.
    expect(report.ok).toBe(true);
    expect(report.holdings).toBe(0);
    expect(recentTransactions(cabinet.db, { days: 3650 })).toHaveLength(1);
  });

  it('flags an expired login as needing a relink rather than as a generic error', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () =>
      new Response(
        JSON.stringify({ error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', error_message: 'reauth' }),
        { status: 400 },
      );
    const report = await plaid.syncItem(itemPk);
    expect(report.ok).toBe(false);
    expect(report.status).toBe('login_required');
    expect(getItemByItemId(cabinet.db, 'item-boa')!.status).toBe('login_required');
  });

  it('classifies relink-required error codes', () => {
    expect(new PlaidApiError(400, 'ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', null, 'x').needsRelink).toBe(true);
    expect(new PlaidApiError(400, 'PENDING_EXPIRATION', 'ITEM_ERROR', null, 'x').needsRelink).toBe(true);
    expect(new PlaidApiError(400, 'RATE_LIMIT', 'RATE_LIMIT_EXCEEDED', null, 'x').needsRelink).toBe(false);
  });

  it('never lets an access token reach an error message', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () =>
      new Response(JSON.stringify({ error_code: 'INTERNAL_SERVER_ERROR', error_message: 'boom' }), { status: 500 });
    const report = await plaid.syncItem(itemPk);
    expect(JSON.stringify(report)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(report)).not.toContain(API_SECRET);
  });
});

/* ================================================== webhook verification */

describe('webhook verification', () => {
  const BODY = Buffer.from(JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-boa' }));

  it('accepts a correctly signed webhook', async () => {
    const plaid = configured();
    stubVerificationKey();
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY))).toBe(true);
  });

  it('rejects a missing header', async () => {
    const plaid = configured();
    stubVerificationKey();
    expect(await plaid.verifyWebhook(BODY, undefined)).toBe(false);
    expect(await plaid.verifyWebhook(BODY, 'not-a-jwt')).toBe(false);
  });

  it('rejects a body that does not match the signed hash', async () => {
    const plaid = configured();
    stubVerificationKey();
    const jwt = signWebhook(BODY);
    // Same valid signature, different payload — the replay-with-substitution
    // attack the body hash exists to stop.
    const tampered = Buffer.from(JSON.stringify({ webhook_type: 'ITEM', item_id: 'attacker' }));
    expect(await plaid.verifyWebhook(tampered, jwt)).toBe(false);
  });

  it('rejects a signature made with the wrong key', async () => {
    const plaid = configured();
    stubVerificationKey();
    const real = webhookKey;
    webhookKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const forged = signWebhook(BODY);
    webhookKey = real;
    expect(await plaid.verifyWebhook(BODY, forged)).toBe(false);
  });

  it('rejects a stale signature outside the 5-minute window', async () => {
    const plaid = configured();
    stubVerificationKey();
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY, { iat: old }))).toBe(false);
    // And a future-dated one, which a clock-skew-only check would let through.
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY, { iat: future }))).toBe(false);
  });

  it('rejects any algorithm other than ES256', async () => {
    const plaid = configured();
    stubVerificationKey();
    // alg-confusion: 'none' must not be honoured, and neither must an HMAC alg
    // whose "key" would be the public JWK.
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY, { alg: 'none' }))).toBe(false);
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY, { alg: 'HS256' }))).toBe(false);
  });

  it('rejects when the key lookup fails instead of failing open', async () => {
    const plaid = configured();
    // No /webhook_verification_key/get stub → the request errors.
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY))).toBe(false);
  });

  it('caches the verification key rather than calling Plaid per webhook', async () => {
    const plaid = configured();
    stubVerificationKey();
    await plaid.verifyWebhook(BODY, signWebhook(BODY));
    await plaid.verifyWebhook(BODY, signWebhook(BODY));
    expect(calls.filter((c) => c.path === '/webhook_verification_key/get')).toHaveLength(1);
  });
});

/* ================================================================= routes */

describe('routes', () => {
  let server: Server;
  let base: string;

  async function serve(plaid: PlaidClient) {
    const app = express();
    // Mirrors buildApp's ordering exactly: the raw-body webhook is registered
    // before express.json(), because a re-serialized body breaks the hash.
    registerPlaidWebhook(app, { db: cabinet.db, plaid });
    app.use(express.json());
    registerPlaidRoutes(app, { db: cabinet.db, plaid });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reports configuration status without revealing any secret', async () => {
    const plaid = configured();
    await serve(plaid);
    const res = await fetch(`${base}/api/plaid/status`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain(API_SECRET);
    const body = JSON.parse(text);
    expect(body.configured).toBe(true);
    expect(body.environment).toBe('sandbox');
  });

  it('answers 503, not 500, when Plaid keys have not been stored yet', async () => {
    await serve(new PlaidClient(cabinet.db, KEY, 'sandbox', 'https://cabinet.example.com'));
    const res = await fetch(`${base}/api/plaid/link-token`, { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()).configured).toBe(false);
  });

  it('returns no access token from the exchange route', async () => {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    routes['/transactions/sync'] = () => ({ accounts: [], added: [], modified: [], removed: [], next_cursor: 'c', has_more: false });
    await serve(plaid);
    const res = await fetch(`${base}/api/plaid/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_token: 'public-sandbox-xyz' }),
    });
    const text = await res.text();
    expect(res.status).toBe(201);
    // Asserted on the raw text: a token nested anywhere in the JSON fails this.
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain('access_token');
  });

  it('rejects an unsigned webhook with 403 and does nothing', async () => {
    const plaid = configured();
    await serve(plaid);
    const res = await fetch(`${base}/api/plaid/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-boa' }),
    });
    // This route is outside the auth wall. An unsigned request reaching 200
    // would be an unauthenticated public write endpoint.
    expect(res.status).toBe(403);
  });

  it('accepts a signed webhook with the raw bytes intact', async () => {
    const plaid = configured();
    stubVerificationKey();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    await plaid.exchangePublicToken('public-sandbox-xyz');
    routes['/transactions/sync'] = () => ({ accounts: [], added: [], modified: [], removed: [], next_cursor: 'c', has_more: false });
    await serve(plaid);

    // Signed over the EXACT bytes sent. If express re-serialized the body
    // before hashing, this is the test that fails.
    const raw = Buffer.from(JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-boa' }));
    const res = await fetch(`${base}/api/plaid/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Verification': signWebhook(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
  });

  it('serves money read routes without any credential material', async () => {
    const plaid = configured();
    await serve(plaid);
    for (const path of ['/api/money/summary', '/api/money/transactions', '/api/money/trend', '/api/money/categories', '/api/money/holdings']) {
      const res = await fetch(`${base}${path}`);
      const text = await res.text();
      expect(res.status, path).toBe(200);
      expect(text, path).not.toContain(API_SECRET);
      expect(text, path).not.toContain(CLIENT_ID);
      expect(text, path).not.toContain(ACCESS_TOKEN);
    }
  });

  it('lists linked institutions by name and status, never by token', async () => {
    const plaid = configured();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    routes['/item/get'] = () => ({ item: { institution_id: 'ins_127989' } });
    routes['/institutions/get_by_id'] = () => ({ institution: { name: 'Bank of America' } });
    await plaid.exchangePublicToken('public-sandbox-xyz');
    await serve(plaid);
    const text = await (await fetch(`${base}/api/plaid/status`)).text();
    expect(text).toContain('Bank of America');
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(listItems(cabinet.db)).toHaveLength(1);
  });
});
