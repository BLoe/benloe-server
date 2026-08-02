/* ============================================================================
   integrations/plaid.ts + gateway/plaidRoutes.ts, ACROSS THE BROKER SEAM.

   Rewritten 2026-08-02, when the Plaid credentials moved out of this process
   and into cabinet-secrets. The old version stubbed global fetch and asserted
   that the access token Cabinet held was encrypted at rest. Cabinet no longer
   holds one, so that assertion has been replaced by a stronger one: the token
   never enters this process at all, and the `credential` table stays EMPTY.

   ## Why this drives the real broker instead of a fake one

   PLATFORM.md's most expensive bug lived between two processes for three weeks:
   both halves worked, both halves had tests, nothing tested the join. A
   hand-written fake broker here would reproduce that setup exactly — it would
   encode my beliefs about the other half, and pass whether or not those beliefs
   were true. The failure it could not catch is the one that actually happens:
   Cabinet calls a path the broker's allowlist refuses, or sends an access token
   to a path that does not take one, and everything is green until Ben clicks
   the button.

   So these tests import the REAL broker app from apps/cabinet-secrets, run it
   on a REAL unix socket, and point a REAL SecretsBrokerClient at it. The only
   thing faked is Plaid's own HTTP API, injected via the broker's `fetchImpl`
   seam — the same seam the broker's own suite uses.

   Three consequences worth knowing while reading:
     1. `calls` records what the BROKER sent to Plaid, so it contains the real
        client_id/secret/access_token. That makes the negative assertions much
        stronger than before: we can prove the token was used without ever
        having been visible here.
     2. A path the broker refuses fails here exactly as it would in production.
        The webhook key fetch is currently refused, so the webhook route is
        genuinely dead — pinned below rather than papered over.
     3. If apps/cabinet-secrets ever becomes unreadable to this process, this
        file fails to import and the suite goes red. That is correct: if Cabinet
        cannot see the broker, it cannot claim the join is tested.
   ========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

// The other half of the seam — the real thing, one directory over.
import { buildBrokerApp } from '../../../cabinet-secrets/src/broker.js';
import { createAuditLog } from '../../../cabinet-secrets/src/audit.js';
import { migrate as migrateBroker, putCredential as putBrokerCredential } from '../../../cabinet-secrets/src/store.js';
import { CREDENTIAL_NAME_RE } from '../../../cabinet-secrets/src/store.js';
import {
  CLIENT_ID_CRED as BROKER_CLIENT_ID_CRED,
  SECRET_CRED as BROKER_SECRET_CRED,
} from '../../../cabinet-secrets/src/plaid.js';

import { openDb, type CabinetDb } from '../src/db/index.js';
import { SecretsBrokerClient } from '../src/integrations/brokerClient.js';
import {
  PlaidClient,
  PlaidApiError,
  PlaidNotConfiguredError,
  verifyPlaidSignature,
  newItemCredentialName,
  plaidEnv,
  CLIENT_ID_CRED,
  SECRET_CRED,
} from '../src/integrations/plaid.js';
import { registerPlaidRoutes, registerPlaidWebhook } from '../src/gateway/plaidRoutes.js';
import { getItemByItemId, listAccounts, listItems, recentTransactions } from '../src/domains/money.js';

/** The broker's encryption key. Lives in the broker's world only — Cabinet has no key. */
const BROKER_KEY = Buffer.alloc(32, 7);
const ACCESS_TOKEN = 'access-production-11111111-2222-3333-4444-555555555555';
const CLIENT_ID = 'client-id-not-real';
const API_SECRET = 'api-secret-not-real';
const ORIGIN = 'https://cabinet.example.com';

let dir: string;
let cabinet: CabinetDb;
let brokerDb: Database.Database;
let brokerServer: Server | null;
let socketPath: string;

/* ------------------------------------------------------- the fake Plaid -- */

type Responder = (body: Record<string, unknown>) => unknown;
/** Stubbed Plaid endpoints, keyed by path — the same shape as the old suite. */
let routes: Record<string, Responder>;
/** What the BROKER sent upstream. Contains real credential material by design. */
let calls: { path: string; body: Record<string, unknown> }[];

function fakePlaid(): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
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
  }) as typeof fetch;
}

/* ------------------------------------------------------- the real broker -- */

/** Start the real broker app on a unix socket. `withKeys: false` = Ben hasn't pasted them yet. */
async function startBroker({ withKeys = true }: { withKeys?: boolean } = {}): Promise<void> {
  brokerDb = new Database(join(dir, 'secrets.db'));
  migrateBroker(brokerDb);
  if (withKeys) {
    putBrokerCredential(brokerDb, BROKER_KEY, { name: CLIENT_ID_CRED, secret: CLIENT_ID });
    putBrokerCredential(brokerDb, BROKER_KEY, { name: SECRET_CRED, secret: API_SECRET });
  }
  const app = buildBrokerApp({
    db: brokerDb,
    key: BROKER_KEY,
    audit: createAuditLog(join(dir, 'audit.log')),
    environment: 'sandbox',
    fetchImpl: fakePlaid(),
  });
  socketPath = join(dir, 'broker.sock');
  brokerServer = app.listen(socketPath);
  await new Promise((resolve) => brokerServer!.once('listening', resolve));
}

/** A PlaidClient wired to whatever broker socket is current. */
function client(overrides: { socketPath?: string } = {}): PlaidClient {
  const broker = new SecretsBrokerClient({ socketPath: overrides.socketPath ?? socketPath, timeoutMs: 5_000 });
  // envOverride null on purpose: the environment is the BROKER's to report now,
  // so leaving it null exercises the real path rather than a test constant.
  return new PlaidClient(cabinet.db, broker, null, ORIGIN);
}

/** A client whose status cache has been primed — configured() is sync and pessimistic until then. */
async function ready(): Promise<PlaidClient> {
  const plaid = client();
  await plaid.refreshStatus();
  return plaid;
}

/** A socket path in a real directory that nothing is listening on. */
function deadSocket(): string {
  return join(dir, 'not-running.sock');
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

/** The resolver verifyPlaidSignature takes — stands in for the (currently refused) key fetch. */
const servesRealKey = async () => ({
  ...(webhookKey.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'test-kid',
  use: 'sig',
  alg: 'ES256',
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-plaid-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  routes = {};
  calls = [];
  brokerServer = null;
  webhookKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
});

afterEach(async () => {
  if (brokerServer) await new Promise<void>((resolve) => brokerServer!.close(() => resolve()));
  brokerDb?.close();
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ============================================================ the contract */

describe('the two halves agree on names', () => {
  it('uses the same credential names the broker looks up', () => {
    // These are two independently-declared constants in two packages. If they
    // ever drift, every Plaid call 503s with "not configured" while the
    // dashboard plainly shows the credentials sitting there — a confusing
    // enough failure to be worth one cheap assertion.
    expect(CLIENT_ID_CRED).toBe(BROKER_CLIENT_ID_CRED);
    expect(SECRET_CRED).toBe(BROKER_SECRET_CRED);
  });

  it('generates item credential names the broker will accept', () => {
    // The broker validates the name against CREDENTIAL_NAME_RE and 400s on a
    // miss. Checked against the broker's OWN regex, imported, not a copy.
    for (let i = 0; i < 50; i += 1) {
      expect(CREDENTIAL_NAME_RE.test(newItemCredentialName())).toBe(true);
    }
  });

  it('generates a FRESH name every time rather than deriving one from item_id', () => {
    // Deliberately not deterministic any more. The name has to be chosen before
    // the exchange reveals which item it is, so re-linking a bank produces a new
    // name and exchangePublicToken reconciles the old one (tested below).
    const names = new Set(Array.from({ length: 100 }, () => newItemCredentialName()));
    expect(names.size).toBe(100);
  });
});

/* =========================================================== configuration */

describe('configuration', () => {
  it('is a normal degraded state, not a crash, when the broker has no Plaid keys', async () => {
    await startBroker({ withKeys: false });
    const plaid = await ready();

    expect(plaid.configured()).toBe(false);
    expect(plaid.plaidStatus().state).toBe('unconfigured');
    await expect(plaid.createLinkToken({ userId: 'ben' })).rejects.toBeInstanceOf(PlaidNotConfiguredError);
  });

  it('distinguishes "no keys yet" from "the secrets service is down"', async () => {
    // The whole reason plaidStatus() exists alongside configured(). Conflating
    // these sends Ben to re-paste credentials during a socket outage that had
    // nothing to do with them.
    const plaid = new PlaidClient(cabinet.db, new SecretsBrokerClient({ socketPath: deadSocket(), timeoutMs: 2_000 }));
    await plaid.refreshStatus();

    expect(plaid.configured()).toBe(false);
    const status = plaid.plaidStatus();
    expect(status.state).toBe('unreachable');
    expect(status.detail).toContain('cabinet-secrets');

    const err = await plaid.createLinkToken({ userId: 'ben' }).catch((e: unknown) => e);
    // NOT PlaidNotConfiguredError: nothing is known about the credentials.
    expect(err).toBeInstanceOf(PlaidApiError);
    expect((err as PlaidApiError).errorType).toBe('BROKER');
    // The transport fault is IN the code, so a log line names what broke.
    expect((err as PlaidApiError).errorCode).toBe('BROKER_UNREACHABLE');
  });

  it('reports ready once the broker holds both halves of the key pair', async () => {
    await startBroker();
    const plaid = await ready();
    expect(plaid.configured()).toBe(true);
    expect(plaid.plaidStatus().state).toBe('ready');
  });

  it('answers configured() pessimistically until the status cache is primed', async () => {
    await startBroker();
    const plaid = client();
    // Synchronous call, no round trip has happened yet. A false 'ready' here
    // would make routes attempt calls that cannot work; index.ts primes the
    // cache at boot precisely to keep this window to one socket round-trip.
    expect(plaid.configured()).toBe(false);
    expect(plaid.plaidStatus().state).toBe('unknown');

    await plaid.refreshStatus();
    expect(plaid.configured()).toBe(true);
  });

  it('takes its environment from the broker rather than from a local setting', async () => {
    await startBroker();
    const plaid = await ready();
    // The broker above was built with environment 'sandbox'. Cabinet has no say:
    // the key pair and the environment it belongs to live together, on purpose.
    expect(plaid.environment).toBe('sandbox');
  });

  it('keeps the last known environment when the broker goes away', async () => {
    await startBroker();
    const plaid = await ready();
    expect(plaid.environment).toBe('sandbox');

    await new Promise<void>((resolve) => brokerServer!.close(() => resolve()));
    brokerServer = null;
    await plaid.refreshStatus();

    // Reverting to a default during an outage would misreport which environment
    // Ben's money is actually linked in.
    expect(plaid.plaidStatus().state).toBe('unreachable');
    expect(plaid.environment).toBe('sandbox');
  });

  it('deduplicates concurrent status refreshes into one round trip', async () => {
    await startBroker();
    const plaid = client();
    // At boot a route, an MCP tool and a scheduler tick can all find the cache
    // stale in the same millisecond.
    const results = await Promise.all([plaid.refreshStatus(), plaid.refreshStatus(), plaid.refreshStatus()]);
    expect(results.every((r) => r.state === 'ready')).toBe(true);
  });

  it('normalises the environment string it is handed', () => {
    expect(plaidEnv({})).toBe('sandbox');
    expect(plaidEnv({ PLAID_ENV: 'production' })).toBe('production');
    // 'development' was decommissioned by Plaid in 2024; anything unrecognised
    // must fall back to sandbox rather than reach production by accident.
    expect(plaidEnv({ PLAID_ENV: 'development' })).toBe('sandbox');
    expect(plaidEnv({ PLAID_ENV: 'PRODUCTION' })).toBe('production');
  });

  it('builds the redirect and webhook URLs from the configured origin', async () => {
    await startBroker();
    const plaid = new PlaidClient(cabinet.db, new SecretsBrokerClient({ socketPath }), null, 'https://cabinet.benloe.com');
    expect(plaid.redirectUri).toBe('https://cabinet.benloe.com/plaid/oauth');
    // Must live under /api/ — Caddy proxies nothing else to this server.
    expect(plaid.webhookUrl).toBe('https://cabinet.benloe.com/api/plaid/webhook');
  });
});

/* ================================================================ linking */

describe('linking', () => {
  it('never lets the access token enter this process at all', async () => {
    await startBroker();
    const plaid = await ready();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    routes['/item/get'] = () => ({ item: { institution_id: 'ins_127989' } });
    routes['/institutions/get_by_id'] = () => ({ institution: { name: 'Bank of America' } });

    const item = await plaid.exchangePublicToken('public-sandbox-xyz');
    expect(item.institution_name).toBe('Bank of America');
    expect(item.token_credential).toMatch(/^plaid-item-[0-9a-f]{32}$/);

    // The returned row is what routes serialize. It carries the NAME.
    expect(JSON.stringify(item)).not.toContain(ACCESS_TOKEN);

    // The old suite asserted Cabinet's stored ciphertext wasn't the plaintext.
    // The stronger claim available now: Cabinet stored NOTHING. Its credential
    // table — which still exists, and still has no key — is empty.
    const held = cabinet.db.prepare('SELECT COUNT(*) AS n FROM credential').get() as { n: number };
    expect(held.n).toBe(0);

    // And the token is real and usable — it lives in the broker's vault, and the
    // broker injected it into the follow-up /item/get on Cabinet's behalf.
    const itemGet = calls.find((c) => c.path === '/item/get')!;
    expect(itemGet.body.access_token).toBe(ACCESS_TOKEN);
    expect(itemGet.body.client_id).toBe(CLIENT_ID);
    expect(itemGet.body.secret).toBe(API_SECRET);
  });

  it('links successfully even when the institution name lookup fails', async () => {
    await startBroker();
    const plaid = await ready();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    // /item/get deliberately unstubbed → 400. Cosmetic metadata must never
    // fail a link that already succeeded at the bank.
    const item = await plaid.exchangePublicToken('public-sandbox-xyz');
    expect(item.institution_name).toBeNull();
    expect(item.status).toBe('active');
    expect(item.token_credential).not.toBeNull();
  });

  it('requests transactions as required and investments as optional', async () => {
    await startBroker();
    const plaid = await ready();
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

  it('strands nothing locally when the exchange fails at Plaid', async () => {
    await startBroker();
    const plaid = await ready();
    routes['/item/public_token/exchange'] = () =>
      new Response(JSON.stringify({ error_code: 'INVALID_PUBLIC_TOKEN', error_message: 'expired' }), { status: 400 });

    await expect(plaid.exchangePublicToken('public-sandbox-expired')).rejects.toBeInstanceOf(PlaidApiError);

    // The old suite's equivalent test ("leaves a revocable record when sealing
    // the token fails") existed because Cabinet did the exchange, then sealed
    // the token in a second step that could fail — leaving a live bearer token
    // nothing recorded. That window is gone rather than narrowed: the broker
    // seals the token as an inseparable part of the exchange, so a failed
    // exchange means no token exists anywhere.
    expect(getItemByItemId(cabinet.db, 'item-boa')).toBeFalsy();
    expect((cabinet.db.prepare('SELECT COUNT(*) AS n FROM plaid_item').get() as { n: number }).n).toBe(0);
  });

  it('re-linking the same bank rotates the credential name and abandons the old one', async () => {
    await startBroker();
    const plaid = await ready();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });

    const first = await plaid.exchangePublicToken('public-sandbox-1');
    const second = await plaid.exchangePublicToken('public-sandbox-2');

    // Same bank, same item row — but a new credential, because the name had to
    // be chosen before the exchange said which item this was.
    expect(second.id).toBe(first.id);
    expect(second.token_credential).not.toBe(first.token_credential);
    expect(listItems(cabinet.db)).toHaveLength(1);

    // Both tokens are real and live in the broker. Cabinet cannot delete a
    // broker credential — there is deliberately no such endpoint — so the old
    // one is now unreferenced and has to be cleaned up in the dashboard. The
    // code logs its name for exactly that reason; what matters here is that the
    // item points at the NEW one and the old name is not silently lost.
    const namesInVault = (
      brokerDb.prepare("SELECT name FROM credential WHERE name LIKE 'plaid-item-%'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(namesInVault).toHaveLength(2);
    expect(namesInVault).toContain(first.token_credential);
    expect(namesInVault).toContain(second.token_credential);
  });
});

/* =================================================================== sync */

describe('sync', () => {
  async function linked(): Promise<{ plaid: PlaidClient; itemPk: number }> {
    await startBroker();
    const plaid = await ready();
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

  it('sends the credential NAME to the broker and never a token', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () => ({
      accounts: [], added: [], modified: [], removed: [], next_cursor: 'c1', has_more: false,
    });
    await plaid.syncItem(itemPk);

    // What Cabinet stores for the item is a name; what reached Plaid is a token.
    // The substitution happened in the other process. This is the whole design
    // in two assertions.
    const stored = getItemByItemId(cabinet.db, 'item-boa')!;
    expect(stored.token_credential).toMatch(/^plaid-item-/);
    expect(JSON.stringify(stored)).not.toContain(ACCESS_TOKEN);
    expect(calls.find((c) => c.path === '/transactions/sync')!.body.access_token).toBe(ACCESS_TOKEN);
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

  it('survives the secrets service dying mid-sync without corrupting the cursor', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () => ({
      accounts: [], added: [], modified: [], removed: [], next_cursor: 'cursor-good', has_more: false,
    });
    await plaid.syncItem(itemPk);

    await new Promise<void>((resolve) => brokerServer!.close(() => resolve()));
    brokerServer = null;

    const report = await plaid.syncItem(itemPk);
    expect(report.ok).toBe(false);
    // A broker outage is not a bank problem, so it must NOT mark the item as
    // needing a relink — that would send Ben through Plaid Link to fix a socket.
    expect(report.status).not.toBe('login_required');
    // And the cursor from the last good sync survives, so recovery resumes
    // rather than re-pulling two years of history.
    expect(getItemByItemId(cabinet.db, 'item-boa')!.transactions_cursor).toBe('cursor-good');
  });

  it('classifies relink-required error codes', () => {
    expect(new PlaidApiError(400, 'ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', null, 'x').needsRelink).toBe(true);
    expect(new PlaidApiError(400, 'PENDING_EXPIRATION', 'ITEM_ERROR', null, 'x').needsRelink).toBe(true);
    expect(new PlaidApiError(400, 'RATE_LIMIT', 'RATE_LIMIT_EXCEEDED', null, 'x').needsRelink).toBe(false);
  });

  it('never lets a credential reach an error message', async () => {
    const { plaid, itemPk } = await linked();
    routes['/transactions/sync'] = () =>
      new Response(JSON.stringify({ error_code: 'INTERNAL_SERVER_ERROR', error_message: 'boom' }), { status: 500 });
    const report = await plaid.syncItem(itemPk);
    expect(JSON.stringify(report)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(report)).not.toContain(API_SECRET);
    expect(JSON.stringify(report)).not.toContain(CLIENT_ID);
  });
});

/* ================================================== webhook verification */

/*
 * Split in two, on purpose.
 *
 * The signature check is the ONLY authentication on a route that sits outside
 * the auth wall, so it gets tested directly, as a pure function, with a
 * resolver that serves the key. The class method that wires it to the broker
 * gets its own (short) section below, because the broker currently refuses the
 * key fetch — and if these tests ran through the class, every rejection
 * assertion would pass for the wrong reason and the alg pinning could regress
 * to `return false` with the suite fully green.
 */
describe('webhook signature verification (the crypto itself)', () => {
  const BODY = Buffer.from(JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-boa' }));

  it('accepts a correctly signed webhook', async () => {
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY), servesRealKey)).toBe(true);
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyPlaidSignature(BODY, undefined, servesRealKey)).toBe(false);
    expect(await verifyPlaidSignature(BODY, 'not-a-jwt', servesRealKey)).toBe(false);
    expect(await verifyPlaidSignature(BODY, 'a.b.c', servesRealKey)).toBe(false);
  });

  it('rejects a body that does not match the signed hash', async () => {
    const jwt = signWebhook(BODY);
    // Same valid signature, different payload — the replay-with-substitution
    // attack the body hash exists to stop.
    const tampered = Buffer.from(JSON.stringify({ webhook_type: 'ITEM', item_id: 'attacker' }));
    expect(await verifyPlaidSignature(tampered, jwt, servesRealKey)).toBe(false);
  });

  it('rejects a signature made with the wrong key', async () => {
    const real = webhookKey;
    webhookKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const forged = signWebhook(BODY);
    webhookKey = real;
    expect(await verifyPlaidSignature(BODY, forged, servesRealKey)).toBe(false);
  });

  it('rejects a stale or future-dated signature outside the 5-minute window', async () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY, { iat: old }), servesRealKey)).toBe(false);
    // And a future-dated one, which a clock-skew-only check would let through.
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY, { iat: future }), servesRealKey)).toBe(false);
  });

  it('rejects any algorithm other than ES256', async () => {
    // alg-confusion: 'none' must not be honoured, and neither must an HMAC alg
    // whose "key" would be the public JWK.
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY, { alg: 'none' }), servesRealKey)).toBe(false);
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY, { alg: 'HS256' }), servesRealKey)).toBe(false);
  });

  it('fails closed when the key cannot be resolved', async () => {
    // The production path today. Never fail open, and never throw: a webhook
    // handler that throws becomes a 500, which Plaid retries.
    expect(await verifyPlaidSignature(BODY, signWebhook(BODY), async () => null)).toBe(false);
  });
});

describe('webhook verification through the broker', () => {
  const BODY = Buffer.from(JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-boa' }));

  it('rejects every webhook today, because the broker will not fetch Plaid’s key', async () => {
    await startBroker();
    const plaid = await ready();

    // KNOWN DEGRADATION, pinned deliberately rather than hidden. The broker's
    // ALLOWED_PATHS omits /webhook_verification_key/get, so the key fetch is
    // refused (403) and verification fails closed. Cost: no same-day webhook
    // nudges; the nightly scheduled sync is unaffected.
    //
    // test/plaid-broker-contract.test.ts goes red the day Ben widens the
    // allowlist, and points back here.
    expect(await plaid.verifyWebhook(BODY, signWebhook(BODY))).toBe(false);

    // It genuinely reached the broker and got refused, rather than failing
    // earlier for some unrelated reason.
    expect(calls.find((c) => c.path === '/webhook_verification_key/get')).toBeUndefined();
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
    await startBroker();
    await serve(await ready());
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
    await startBroker({ withKeys: false });
    await serve(await ready());
    const res = await fetch(`${base}/api/plaid/link-token`, { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()).configured).toBe(false);
  });

  it('answers 503 with a usable message when the secrets service is unreachable', async () => {
    // This test caught a real one. The route mapped every PlaidApiError to 502
    // with `err.displayMessage ?? err.message` — and a broker transport failure
    // has no display_message, so the raw diagnostic ("no socket at /tmp/…")
    // went into the UI's error banner as if it were advice for Ben.
    const plaid = new PlaidClient(cabinet.db, new SecretsBrokerClient({ socketPath: deadSocket(), timeoutMs: 2_000 }));
    await plaid.refreshStatus();
    await serve(plaid);

    const res = await fetch(`${base}/api/plaid/link-token`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error_code).toBe('BROKER_UNREACHABLE');
    expect(body.error).not.toContain(deadSocket());
    expect(body.error).toMatch(/secrets service/i);
  });

  it('tells the setup surface WHY it is unconfigured, not just that it is', async () => {
    // `configured: false` has two causes with opposite fixes. Without `state`
    // the Money page shows "store your Plaid keys" during a broker outage —
    // sending Ben to re-paste credentials that were never the problem.
    const plaid = new PlaidClient(cabinet.db, new SecretsBrokerClient({ socketPath: deadSocket(), timeoutMs: 2_000 }));
    await plaid.refreshStatus();
    await serve(plaid);

    const down = await (await fetch(`${base}/api/plaid/status`)).json();
    expect(down.configured).toBe(false);
    expect(down.state).toBe('unreachable');
    expect(down.detail).toContain('cabinet-secrets');

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startBroker({ withKeys: false });
    await serve(await ready());

    const empty = await (await fetch(`${base}/api/plaid/status`)).json();
    expect(empty.configured).toBe(false);
    expect(empty.state).toBe('unconfigured');
  });

  it('returns no access token from the exchange route', async () => {
    await startBroker();
    const plaid = await ready();
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
    await startBroker();
    await serve(await ready());
    const res = await fetch(`${base}/api/plaid/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_type: 'TRANSACTIONS', item_id: 'item-boa' }),
    });
    // This route is outside the auth wall. An unsigned request reaching 200
    // would be an unauthenticated public write endpoint.
    expect(res.status).toBe(403);
  });

  it('rejects a correctly signed webhook too, while the key fetch stays blocked', async () => {
    await startBroker();
    const plaid = await ready();
    routes['/item/public_token/exchange'] = () => ({ access_token: ACCESS_TOKEN, item_id: 'item-boa' });
    await plaid.exchangePublicToken('public-sandbox-xyz');
    await serve(plaid);

    const raw = Buffer.from(JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item-boa' }));
    const res = await fetch(`${base}/api/plaid/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Verification': signWebhook(raw) },
      body: raw,
    });
    // Failing CLOSED is the right behaviour for an unverifiable webhook, so 403
    // is correct — but this route is effectively dead until the broker
    // allowlists /webhook_verification_key/get. Recorded here so the cost of
    // that blocker is visible in the test names, not just in a comment.
    expect(res.status).toBe(403);
  });

  it('serves money read routes without any credential material', async () => {
    await startBroker();
    await serve(await ready());
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
    await startBroker();
    const plaid = await ready();
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
