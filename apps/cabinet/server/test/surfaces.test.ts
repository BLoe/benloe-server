import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, localDay, type CabinetDb } from '../src/db/index.js';
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

let dir: string; let cabinet: CabinetDb; let server: Server; let base: string; let mem: ReturnType<typeof fakeMemory>;

async function start() {
  mem = fakeMemory();
  const app = buildApp({
    db: cabinet.db,
    runtime: { authMode: 'subscription', queue: { depth: 0 }, interrupt: () => true, titleFor: async () => null, run: async () => ({ stopReason: 'success', sessionId: 's' }) } as never,
    approvals: new ApprovalQueue(cabinet.db),
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
  dir = mkdtempSync(join(tmpdir(), 'cabinet-surf-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  await start();
});
afterEach(async () => { await new Promise((r) => server.close(r)); cabinet.close(); rmSync(dir, { recursive: true, force: true }); });

describe('surface endpoints — frozen contract', () => {
  it('all surface routes sit behind the owner wall', async () => {
    for (const p of ['/api/today', '/api/domains/nutrition', '/api/ops', '/api/recall', '/api/memory']) {
      expect((await fetch(base + p)).status).toBe(401);
    }
  });

  it('GET /api/today returns an empty-but-valid briefing against a fresh DB', async () => {
    const t = await (await owner('/api/today')).json();
    expect(t.greeting).toContain('Ben');
    expect(Array.isArray(t.attention)).toBe(true);
    expect(t.vitals.every((v: { kind: string }) => ['dial', 'rule', 'ring', 'gauge', 'stat'].includes(v.kind))).toBe(true);
    expect(t.overnight).toBeNull();
  });

  describe('/api/today.briefing / .checkin (mentorship: durable Today surface)', () => {
    /** SQLite datetime('now')-style UTC stamp, matching what persistAssistantMessage's INSERT default produces. */
    const sqliteUtc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
    const seedThread = (id: string, kind = 'cron') => cabinet.db.prepare('INSERT INTO thread (id, title, kind) VALUES (?,?,?)').run(id, id, kind);
    const seedMessage = (threadId: string, parts: unknown, createdAt: Date) =>
      cabinet.db
        .prepare('INSERT INTO message (id, thread_id, role, parts, created_at) VALUES (?,?,?,?,?)')
        .run(`${threadId}-${createdAt.getTime()}`, threadId, 'assistant', JSON.stringify(parts), sqliteUtc(createdAt));

    it('both are null when neither job has ever run', async () => {
      const t = await (await owner('/api/today')).json();
      expect(t.briefing).toBeNull();
      expect(t.checkin).toBeNull();
    });

    it('briefing is populated and isCurrent when sys-briefing has a fresh text part', async () => {
      seedThread('sys-briefing');
      seedMessage('sys-briefing', [{ type: 'widget', widgetType: 'briefing', data: { sections: [] } }, { type: 'text', text: 'Quiet day, nothing urgent.' }], new Date());
      const t = await (await owner('/api/today')).json();
      expect(t.briefing).toMatchObject({ isCurrent: true, narrative: 'Quiet day, nothing urgent.' });
      expect(new Date(t.briefing.at).toString()).not.toBe('Invalid Date');
    });

    it('briefing is stale (isCurrent: false) but still returned, not silently swapped for the template', async () => {
      seedThread('sys-briefing');
      seedMessage('sys-briefing', [{ type: 'text', text: 'Two days old.' }], new Date(Date.now() - 2 * 86_400_000));
      const t = await (await owner('/api/today')).json();
      expect(t.briefing).toMatchObject({ isCurrent: false, narrative: 'Two days old.' });
    });

    it('briefing is null when the persisted turn has no text part (tool calls only, nothing to lead with)', async () => {
      seedThread('sys-briefing');
      seedMessage('sys-briefing', [{ type: 'tool-run', toolId: 't1', name: 'x', input: {}, output: '', isError: false, done: true }], new Date());
      const t = await (await owner('/api/today')).json();
      expect(t.briefing).toBeNull();
    });

    it('checkin is populated and isCurrent when sys-checkin has a fresh checkin widget', async () => {
      seedThread('sys-checkin');
      const vitals = [{ kind: 'stat', label: 'Protein · tonight', big: '90', unit: 'g', sub: '1400 kcal · 2 meals' }];
      seedMessage('sys-checkin', [{ type: 'widget', widgetType: 'checkin', data: { vitals, prompt: 'How was today?' } }], new Date());
      const t = await (await owner('/api/today')).json();
      expect(t.checkin).toMatchObject({ isCurrent: true, vitals, prompt: 'How was today?' });
    });

    it('checkin is stale (isCurrent: false) when yesterday\'s check-in is the only one on record', async () => {
      seedThread('sys-checkin');
      const vitals = [{ kind: 'stat', label: 'Protein · tonight', big: '50', unit: 'g', sub: '800 kcal · 1 meal' }];
      seedMessage('sys-checkin', [{ type: 'widget', widgetType: 'checkin', data: { vitals, prompt: 'How was today?' } }], new Date(Date.now() - 2 * 86_400_000));
      const t = await (await owner('/api/today')).json();
      expect(t.checkin).toMatchObject({ isCurrent: false });
    });

    it('checkin is null when the widget lacks a vitals array (malformed/unexpected shape) rather than throwing', async () => {
      seedThread('sys-checkin');
      seedMessage('sys-checkin', [{ type: 'widget', widgetType: 'checkin', data: { prompt: 'oops, no vitals' } }], new Date());
      const t = await (await owner('/api/today')).json();
      expect(t.checkin).toBeNull();
    });

    it('the template greeting/read fields are unchanged and still present alongside briefing/checkin — they remain the frontend\'s fallback', async () => {
      seedThread('sys-briefing');
      seedMessage('sys-briefing', [{ type: 'text', text: 'Real narrative.' }], new Date());
      const t = await (await owner('/api/today')).json();
      expect(t.greeting).toBe('Good morning, Ben.');
      expect(typeof t.read).toBe('string');
      expect(t.briefing.narrative).toBe('Real narrative.');
    });
  });

  it('GET /api/today surfaces a real attention item for a low medication', async () => {
    cabinet.db.prepare(
      `INSERT INTO medication (name, dose, schedule, days_supply, last_filled_on, refills_left, active) VALUES (?,?,?,?,?,?,1)`,
    ).run('Metformin', '500mg', '2x/day', 5, '2020-01-01', 0);
    const t = await (await owner('/api/today')).json();
    expect(t.attention.length).toBeGreaterThan(0);
    expect(t.attention.some((a: { title: string }) => a.title.includes('Metformin'))).toBe(true);
  });

  it('GET /api/domains/:id is contract-valid and 404s unknown domains', async () => {
    const v = await (await owner('/api/domains/money')).json();
    expect(v).toMatchObject({ id: 'money', label: 'Money' });
    expect(Array.isArray(v.instruments) && Array.isArray(v.log)).toBe(true);
    expect((await owner('/api/domains/nope')).status).toBe(404);
  });

  it('GET /api/domains/nutrition reflects real food_log + body_metric rows', async () => {
    const today = localDay();
    cabinet.db.prepare(
      `INSERT INTO food_log (eaten_at, local_day, meal, description, kcal, protein_g) VALUES (?,?,?,?,?,?)`,
    ).run(new Date().toISOString(), today, 'breakfast', '3 eggs and toast', 410, 34);
    cabinet.db.prepare(`INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)`)
      .run(new Date().toISOString(), today, 'weight_lb', 178.4);
    const v = await (await owner('/api/domains/nutrition')).json();
    expect(v.log.some((l: { text: string }) => l.text.includes('eggs'))).toBe(true);
    expect(v.narrative).toContain('34');
    const dial = v.instruments.find((i: { kind: string }) => i.kind === 'dial');
    expect(dial.value).toBe(34);
  });

  it('GET /api/domains/admin reflects real open tasks', async () => {
    const today = localDay();
    cabinet.db.prepare(`INSERT INTO task (title, due_on, status) VALUES (?,?, 'open')`).run('Renew car registration', today);
    const v = await (await owner('/api/domains/admin')).json();
    expect(v.log.some((l: { text: string }) => l.text === 'Renew car registration')).toBe(true);
    expect(v.narrative).toContain('1 open task');
  });

  it('GET /api/ops reads the real audit trail and filters by kind', async () => {
    cabinet.db.prepare('INSERT INTO action_audit (tool, tier, decision, session_kind) VALUES (?,?,?,?)').run('Write', 3, 'autonomous', 'cron');
    cabinet.db.prepare('INSERT INTO action_audit (tool, tier, decision, session_kind) VALUES (?,?,?,?)').run('Bash', 2, 'autonomous', 'user');
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
    expect(cabinet.db.prepare('SELECT id FROM thread WHERE id = ?').get(c.threadId)).toBeTruthy();
    cabinet.db.prepare(`INSERT INTO journal_entry (written_at, local_day, body) VALUES (?,?,?)`)
      .run(new Date().toISOString(), localDay(), 'Had a good breakfast today, felt energized.');
    const r = await (await owner('/api/recall?q=breakfast')).json();
    expect(r.query).toBe('breakfast');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].source).toBe('episodic');
  });

  it('GET /api/recall is contract-valid (empty results) when nothing matches', async () => {
    const r = await (await owner('/api/recall?q=zzzznothingmatchesthis')).json();
    expect(r.results).toEqual([]);
  });

  it('health carries presence for the strip', async () => {
    const h = await (await owner('/api/healthz')).json();
    expect(['idle', 'working', 'thinking', 'offline']).toContain(h.presence);
    expect(typeof h.presenceMeta).toBe('string');
  });
});
