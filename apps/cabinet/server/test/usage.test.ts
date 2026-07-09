import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';

// Covers the two usage endpoints added alongside the cache-caching-fix
// verification: /api/usage (by-day/model — "why did we spike") and
// /api/usage/rolling (fixed 5h/24h/7d windows — "are we near a wall").
// Mirrors the fixture setup in gateway.test.ts (kept as a separate file
// rather than extending it).

const OWNER = 'below413@gmail.com';

const fakeAuthFetch = (async (url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

function fakeRuntime() {
  return {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor: async () => null,
    run: async () => ({ stopReason: 'success', sessionId: 's1' }),
  };
}

let dir: string;
let cabinet: CabinetDb;
let approvals: ApprovalQueue;
let widgetBus: EventEmitter;
let server: Server;
let base: string;

async function startApp() {
  const app = buildApp({
    db: cabinet.db,
    runtime: fakeRuntime() as never,
    approvals,
    widgetBus,
    ownerEmail: OWNER,
    authFetch: fakeAuthFetch,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const asOwner = (path: string) => fetch(base + path, { headers: { Cookie: 'token=owner' } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-usage-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/usage', () => {
  it('sums cache_write alongside the other columns, grouped by day+model', async () => {
    await startApp();
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, session_kind, thread_id)
         VALUES ('claude-sonnet-5', 100, 50, 9000, 300, 0.01, 'user', 't1')`,
      )
      .run();
    const res = await asOwner('/api/usage');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authMode: string; byDay: { input: number; output: number; cache_read: number; cache_write: number }[] };
    expect(body.authMode).toBe('subscription');
    expect(body.byDay).toHaveLength(1);
    expect(body.byDay[0]).toMatchObject({ input: 100, output: 50, cache_read: 9000, cache_write: 300 });
  });
});

describe('GET /api/usage/rolling', () => {
  it('buckets into 5h/24h/7d windows and excludes rows outside all three', async () => {
    await startApp();
    // inside 5h
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
         VALUES (datetime('now','-1 hour'), 1000, 500, 20000, 200, 'user', 't1')`,
      )
      .run();
    // inside 24h but outside 5h
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
         VALUES (datetime('now','-10 hours'), 2000, 1000, 0, 400, 'user', 't1')`,
      )
      .run();
    // inside 7d but outside 24h
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
         VALUES (datetime('now','-3 days'), 3000, 1500, 0, 0, 'user', 't1')`,
      )
      .run();
    // outside all windows
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
         VALUES (datetime('now','-30 days'), 9999, 9999, 0, 0, 'user', 't1')`,
      )
      .run();

    const res = await asOwner('/api/usage/rolling');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authMode: string;
      windows: { window: string; input: number; output: number; cache_read: number; cache_write: number; cacheReadWriteRatio: number | null }[];
    };
    expect(body.authMode).toBe('subscription');
    const byId = Object.fromEntries(body.windows.map((w) => [w.window, w]));

    expect(byId['5h']).toMatchObject({ input: 1000, output: 500, cache_read: 20000, cache_write: 200 });
    expect(byId['5h'].cacheReadWriteRatio).toBe(100); // 20000/200

    expect(byId['24h']).toMatchObject({ input: 3000, output: 1500, cache_write: 600 }); // 1h + 10h rows
    expect(byId['7d']).toMatchObject({ input: 6000, output: 3000 }); // + the 3-day row
    expect(byId['7d'].cache_write).toBe(600); // the 30-day row must not leak in
  });

  it('reports a null ratio when there has been no cache write yet', async () => {
    await startApp();
    cabinet.db
      .prepare(
        `INSERT INTO token_usage (ts, input_tokens, output_tokens, cache_read, cache_write, session_kind, thread_id)
         VALUES (datetime('now'), 100, 50, 0, 0, 'user', 't1')`,
      )
      .run();
    const res = await asOwner('/api/usage/rolling');
    const body = (await res.json()) as { windows: { window: string; cacheReadWriteRatio: number | null }[] };
    expect(body.windows.find((w) => w.window === '5h')!.cacheReadWriteRatio).toBeNull();
  });

  it('requires owner auth', async () => {
    await startApp();
    const res = await fetch(base + '/api/usage/rolling');
    expect(res.status).toBe(401);
  });
});
