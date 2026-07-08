import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type PalsDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';

const OWNER = 'below413@gmail.com';
const fakeAuthFetch = (async (_url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

// in-memory MemoryLike
function fakeMemory() {
  const store = new Map<string, string>([['SOUL.md', '# SOUL\n\ndry, candid.'], ['STANDING_ORDERS.md', '# orders']]);
  return {
    list: () => [...store.keys()],
    read: (f: string) => store.get(f) ?? '',
    update: (f: string, c: string) => { if (f === 'STANDING_ORDERS.md') throw new Error('read-only'); store.set(f, c); },
    _store: store,
  };
}

let dir: string; let pals: PalsDb; let server: Server; let base: string; let mem: ReturnType<typeof fakeMemory>;

async function start() {
  mem = fakeMemory();
  const app = buildApp({
    db: pals.db,
    runtime: { authMode: 'subscription', queue: { depth: 0 }, interrupt: () => true, titleFor: async () => null, run: async () => ({ stopReason: 'success', sessionId: 's' }) } as never,
    approvals: new ApprovalQueue(pals.db),
    widgetBus: new EventEmitter(),
    ownerEmail: OWNER,
    authFetch: fakeAuthFetch,
    memory: mem,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const owner = (p: string, init: RequestInit = {}) =>
  fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', Cookie: 'token=owner', ...(init.headers ?? {}) } });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pals-surf-'));
  pals = openDb(join(dir, 'pals.db'));
  await start();
});
afterEach(async () => { await new Promise((r) => server.close(r)); pals.close(); rmSync(dir, { recursive: true, force: true }); });

describe('surface endpoints — frozen contract', () => {
  it('all surface routes sit behind the owner wall', async () => {
    for (const p of ['/api/today', '/api/domains/nutrition', '/api/ops', '/api/recall', '/api/memory']) {
      expect((await fetch(base + p)).status).toBe(401);
    }
  });

  it('GET /api/today returns a briefing with attention + instrument vitals', async () => {
    const t = await (await owner('/api/today')).json();
    expect(t.greeting).toContain('Ben');
    expect(t.attention.length).toBeGreaterThan(0);
    expect(t.vitals.every((v: { kind: string }) => ['dial', 'rule', 'ring', 'gauge', 'stat'].includes(v.kind))).toBe(true);
  });

  it('GET /api/domains/:id is contract-valid and 404s unknown domains', async () => {
    const v = await (await owner('/api/domains/money')).json();
    expect(v).toMatchObject({ id: 'money', label: 'Money' });
    expect(Array.isArray(v.instruments) && Array.isArray(v.log)).toBe(true);
    expect((await owner('/api/domains/nope')).status).toBe(404);
  });

  it('GET /api/ops reads the real audit trail and filters by kind', async () => {
    pals.db.prepare('INSERT INTO action_audit (tool, tier, decision, session_kind) VALUES (?,?,?,?)').run('Write', 3, 'autonomous', 'cron');
    pals.db.prepare('INSERT INTO action_audit (tool, tier, decision, session_kind) VALUES (?,?,?,?)').run('Bash', 2, 'autonomous', 'user');
    const all = await (await owner('/api/ops')).json();
    expect(all.entries.length).toBe(2);
    expect(all.entries.find((e: { tool: string }) => e.tool === 'Write').reversible).toBe(true);
    const cron = await (await owner('/api/ops?kind=cron')).json();
    expect(cron.entries.every((e: { kind: string }) => e.kind === 'cron')).toBe(true);
  });

  it('GET /api/memory lists curated files (STANDING_ORDERS read-only); PUT saves', async () => {
    const m = await (await owner('/api/memory')).json();
    expect(m.files.find((f: { name: string }) => f.name === 'SOUL.md').editable).toBe(true);
    expect(m.files.find((f: { name: string }) => f.name === 'STANDING_ORDERS.md').editable).toBe(false);
    expect((await owner('/api/memory/SOUL.md', { method: 'PUT', body: JSON.stringify({ content: '# SOUL\n\nedited' }) })).status).toBe(200);
    expect(mem.read('SOUL.md')).toContain('edited');
    // read-only file rejects
    expect((await owner('/api/memory/STANDING_ORDERS.md', { method: 'PUT', body: JSON.stringify({ content: 'x' }) })).status).toBe(400);
  });

  it('POST /api/command opens a thread; GET /api/recall echoes the query', async () => {
    const c = await (await owner('/api/command', { method: 'POST', body: JSON.stringify({ intent: 'log two eggs' }) })).json();
    expect(typeof c.threadId).toBe('string');
    expect(pals.db.prepare('SELECT id FROM thread WHERE id = ?').get(c.threadId)).toBeTruthy();
    const r = await (await owner('/api/recall?q=breakfast')).json();
    expect(r.query).toBe('breakfast');
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('health carries presence for the strip', async () => {
    const h = await (await owner('/api/healthz')).json();
    expect(['idle', 'working', 'thinking', 'offline']).toContain(h.presence);
    expect(typeof h.presenceMeta).toBe('string');
  });
});
