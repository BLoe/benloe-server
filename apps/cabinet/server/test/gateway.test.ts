import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';
import { createSseParser, encodeSse, type SseEvent } from '../src/gateway/sse.js';
import { extractText, foldEvent, type MessagePart } from '../src/gateway/fold.js';
import { saveAttachment } from '../src/gateway/attachments.js';
import type { TurnEvent } from '../src/runtime/agent.js';
import { EpisodicStore } from '../src/episodic/index.js';
import { Embedder } from '../src/embeddings/index.js';
import { addLesson } from '../src/memory/lessons.js';
import { MemoryStore } from '../src/memory/index.js';
import { upsertConstraint, upsertGoal } from '../src/domains/misc.js';
import { logBodyMetric } from '../src/domains/training.js';

const OWNER = 'below413@gmail.com';
const MODEL_TIMEOUT = 300_000;

// Fake artanis: token "owner" → Ben, token "guest" → someone else, anything else → 401.
const fakeAuthFetch = (async (url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  const authz = String((init?.headers as Record<string, string>)?.Authorization ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER } }), { status: 200 });
  if (cookie.includes('token=guest')) return new Response(JSON.stringify({ user: { email: 'guest@x.com' } }), { status: 200 });
  // an agent presents a bearer key → Artanis resolves it to a role:"agent" user
  if (authz.includes('benji')) return new Response(JSON.stringify({ user: { email: 'benji@agents.benloe.com', name: 'benji', role: 'agent' } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

// Scripted runtime standing in for the real SDK-backed one.
function fakeRuntime(
  script?: (onEvent: (e: TurnEvent) => void) => Promise<void>,
  titleFor: (u: string, a: string) => Promise<string | null> = async () => 'Auto Title',
) {
  return {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor,
    run: async (req: { chatId: string; onEvent: (e: TurnEvent) => void }) => {
      if (script) await script(req.onEvent);
      return { stopReason: 'success', sessionId: 's1' };
    },
  };
}

let dir: string;
let cabinet: CabinetDb;
let approvals: ApprovalQueue;
let widgetBus: EventEmitter;
let server: Server;
let base: string;

async function startApp(runtime = fakeRuntime()) {
  const app = buildApp({
    db: cabinet.db,
    runtime: runtime as never,
    approvals,
    widgetBus,
    ownerEmail: OWNER,
    authFetch: fakeAuthFetch,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const asOwner = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Cookie: 'token=owner', ...(init.headers ?? {}) } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-gw-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth wall', () => {
  it('401 without a cookie, 403 for a non-owner artanis user, 200 for Ben', async () => {
    await startApp();
    expect((await fetch(base + '/api/chats')).status).toBe(401);
    expect((await fetch(base + '/api/chats', { headers: { Cookie: 'token=guest' } })).status).toBe(403);
    expect((await fetch(base + '/api/chats', { headers: { Cookie: 'token=bogus' } })).status).toBe(401);
    expect((await asOwner('/api/chats')).status).toBe(200);
  });

  it('accepts an agent bearer key as an authorized (non-owner) principal', async () => {
    await startApp();
    // no credential at all → 401
    expect((await fetch(base + '/api/chats')).status).toBe(401);
    // a valid agent key → 200 (agents are first-class principals, not the owner)
    const r = await fetch(base + '/api/chats', { headers: { Authorization: 'Bearer agk_benji_test' } });
    expect(r.status).toBe(200);
    // a bearer Artanis doesn't recognize → 401
    expect((await fetch(base + '/api/chats', { headers: { Authorization: 'Bearer agk_nope' } })).status).toBe(401);
  });

  it('public liveness stays open; detailed health is walled', async () => {
    await startApp();
    expect((await fetch(base + '/healthz')).status).toBe(200);
    expect((await fetch(base + '/api/healthz')).status).toBe(401);
    const detailed = await (await asOwner('/api/healthz')).json();
    expect(detailed).toMatchObject({ ok: true, db: true, authMode: 'subscription' });
  });

  it('/healthz.presence + queueDepth mirror queue depth unauthenticated — cabinet-deploy-watch.sh drains off these exact fields', async () => {
    const runtime = fakeRuntime();
    await startApp(runtime);
    expect(await (await fetch(base + '/healthz')).json()).toMatchObject({ presence: 'idle', queueDepth: 0 });
    runtime.queue.depth = 1;
    expect(await (await fetch(base + '/healthz')).json()).toMatchObject({ presence: 'working', queueDepth: 1 });
    runtime.queue.depth = 0;
    expect(await (await fetch(base + '/healthz')).json()).toMatchObject({ presence: 'idle', queueDepth: 0 });
  });

  it('/api/healthz.buildMarker is "unknown" when unwired (e.g. dev/test), not a stale hardcoded string', async () => {
    await startApp(); // default fixture never passes buildMarker
    expect((await (await asOwner('/api/healthz')).json()).buildMarker).toBe('unknown');
  });

  it('/api/healthz.buildMarker reflects the actually-built commit when wired', async () => {
    const app = buildApp({
      db: cabinet.db,
      runtime: fakeRuntime() as never,
      approvals,
      widgetBus,
      ownerEmail: OWNER,
      authFetch: fakeAuthFetch,
      buildMarker: 'abc123def456',
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await (await asOwner('/api/healthz')).json()).buildMarker).toBe('abc123def456');
  });

  it('/api/healthz carries the embedder status object plus a pendingBackfill count, not a bare boolean', async () => {
    const app = buildApp({
      db: cabinet.db,
      runtime: fakeRuntime() as never,
      approvals,
      widgetBus,
      ownerEmail: OWNER,
      authFetch: fakeAuthFetch,
      embedderStatus: () => ({ state: 'crashed', lastError: 'embedding process exited (code 1)', since: '2026-07-09T06:00:00.000Z' }),
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const body = await (await asOwner('/api/healthz')).json();
    expect(body.embedder).toEqual({
      state: 'crashed',
      lastError: 'embedding process exited (code 1)',
      since: '2026-07-09T06:00:00.000Z',
      pendingBackfill: 0,
    });
  });

  it('/api/healthz reports embedder: null when no status fn is wired', async () => {
    await startApp();
    const body = await (await asOwner('/api/healthz')).json();
    expect(body.embedder).toBeNull();
  });

  it('/api/healthz.embedder.pendingBackfill reflects unembedded journal rows — the "ready but rotting" signal', async () => {
    cabinet.db.prepare("INSERT INTO journal_entry (written_at, local_day, body, embedded) VALUES (datetime('now'), '2026-07-09', 'a', 0)").run();
    cabinet.db.prepare("INSERT INTO journal_entry (written_at, local_day, body, embedded) VALUES (datetime('now'), '2026-07-09', 'b', 1)").run();
    const app = buildApp({
      db: cabinet.db,
      runtime: fakeRuntime() as never,
      approvals,
      widgetBus,
      ownerEmail: OWNER,
      authFetch: fakeAuthFetch,
      embedderStatus: () => ({ state: 'ready', lastError: null, since: '2026-07-09T06:00:00.000Z' }),
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const body = await (await asOwner('/api/healthz')).json();
    expect(body.embedder.state).toBe('ready');
    expect(body.embedder.pendingBackfill).toBe(1); // the un-embedded row, not the embedded one
  });

  it('/api/healthz.retrievalLog reflects the row count — "is the instrumentation harness actually accumulating" (mentorship: Phase 3 item 3)', async () => {
    await startApp();
    expect((await (await asOwner('/api/healthz')).json()).retrievalLog).toBe(0);
    cabinet.db
      .prepare("INSERT INTO retrieval_log (caller, query_text, k, results, result_count) VALUES ('recallLessons','x',4,'[]',0)")
      .run();
    expect((await (await asOwner('/api/healthz')).json()).retrievalLog).toBe(1);
  });

  describe('/api/healthz.jobs (mentorship: observability audit, phase 2 #1)', () => {
    type JobsHealth = Record<string, { lastRun: string | null; lastError: string | null; nextFireAt: string | null; lastResult: unknown }>;
    function withJobsHealth(jobsHealth: () => JobsHealth) {
      const app = buildApp({
        db: cabinet.db,
        runtime: fakeRuntime() as never,
        approvals,
        widgetBus,
        ownerEmail: OWNER,
        authFetch: fakeAuthFetch,
        scheduler: { has: () => true, runNow: async () => {}, jobsHealth },
      });
      server = app.listen(0, '127.0.0.1');
      return new Promise<void>((r) => {
        server.once('listening', () => {
          base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          r();
        });
      });
    }

    it('carries the scheduler\'s per-job snapshot verbatim', async () => {
      await withJobsHealth(() => ({
        heartbeat: { lastRun: '2026-07-09T10:00:00.000Z', lastError: null, nextFireAt: '2026-07-09T10:30:00.000Z', lastResult: null },
        maintenance: { lastRun: '2026-07-09T07:00:00.000Z', lastError: null, nextFireAt: '2026-07-10T07:00:00.000Z', lastResult: { backups: ['/x/2026-07-09-cabinet.db'], backfilled: 3, expired: 0 } },
      }));
      const body = await (await asOwner('/api/healthz')).json();
      expect(body.jobs.heartbeat).toEqual({ lastRun: '2026-07-09T10:00:00.000Z', lastError: null, nextFireAt: '2026-07-09T10:30:00.000Z', lastResult: null });
      expect(body.jobs.maintenance.lastResult).toEqual({ backups: ['/x/2026-07-09-cabinet.db'], backfilled: 3, expired: 0 });
    });

    it('a never-fired job reads lastRun: null with nextFireAt populated — distinguishable from "should have run and didn\'t"', async () => {
      await withJobsHealth(() => ({
        'weekly-review': { lastRun: null, lastError: null, nextFireAt: '2026-07-12T13:00:00.000Z', lastResult: null },
      }));
      const body = await (await asOwner('/api/healthz')).json();
      expect(body.jobs['weekly-review']).toEqual({ lastRun: null, lastError: null, nextFireAt: '2026-07-12T13:00:00.000Z', lastResult: null });
    });

    it('the maintenance zero-backups acceptance bar: lastRun present + lastResult.backups empty reads distinctly from a healthy run, from healthz alone', async () => {
      await withJobsHealth(() => ({
        maintenance: { lastRun: '2026-07-09T07:00:00.000Z', lastError: null, nextFireAt: '2026-07-10T07:00:00.000Z', lastResult: { backups: [], backfilled: 0, expired: 0 } },
      }));
      const body = await (await asOwner('/api/healthz')).json();
      expect(body.jobs.maintenance.lastRun).not.toBeNull(); // it ran...
      expect(body.jobs.maintenance.lastResult.backups).toEqual([]); // ...but shipped nothing — not silently equivalent to success
    });

    it('jobs is {} when no scheduler is wired (e.g. CABINET_SCHEDULER=off) — not a missing field or a throw', async () => {
      await startApp(); // default fixture never passes `scheduler`
      const body = await (await asOwner('/api/healthz')).json();
      expect(body.jobs).toEqual({});
    });

    it('jobs is {} when a scheduler is wired but predates jobsHealth (e.g. the admin-trigger-only fakes elsewhere in this file)', async () => {
      const app = buildApp({
        db: cabinet.db,
        runtime: fakeRuntime() as never,
        approvals,
        widgetBus,
        ownerEmail: OWNER,
        authFetch: fakeAuthFetch,
        scheduler: { has: () => true, runNow: async () => {} }, // no jobsHealth
      });
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const body = await (await asOwner('/api/healthz')).json();
      expect(body.jobs).toEqual({});
    });
  });
});

describe('admin job trigger', () => {
  function withScheduler(scheduler: { has(name: string): boolean; runNow(name: string): Promise<void> }) {
    const app = buildApp({
      db: cabinet.db,
      runtime: fakeRuntime() as never,
      approvals,
      widgetBus,
      ownerEmail: OWNER,
      authFetch: fakeAuthFetch,
      scheduler,
    });
    server = app.listen(0, '127.0.0.1');
    return new Promise<void>((r) => {
      server.once('listening', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        r();
      });
    });
  }

  it('owner can trigger a named job; runs the exact scheduler-held job, not a rebuilt copy', async () => {
    const calls: string[] = [];
    await withScheduler({ has: (n) => n === 'weekly-review', runNow: async (n) => { calls.push(n); } });
    const res = await asOwner('/api/admin/jobs/weekly-review/run', { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, started: 'weekly-review' });
    // runNow is fired async (not awaited by the handler) — give its microtask a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['weekly-review']);
  });

  it('an agent peer (e.g. benji) can trigger a job too — not owner-only', async () => {
    const calls: string[] = [];
    await withScheduler({ has: () => true, runNow: async (n) => { calls.push(n); } });
    const res = await fetch(base + '/api/admin/jobs/heartbeat/run', { method: 'POST', headers: { Authorization: 'Bearer agk_benji_test' } });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['heartbeat']);
  });

  it('a non-owner, non-agent principal is refused', async () => {
    await withScheduler({ has: () => true, runNow: async () => {} });
    const res = await fetch(base + '/api/admin/jobs/heartbeat/run', { method: 'POST', headers: { Cookie: 'token=guest' } });
    expect(res.status).toBe(403);
  });

  it('unknown job name is 404, not a silent no-op', async () => {
    await withScheduler({ has: () => false, runNow: async () => {} });
    const res = await asOwner('/api/admin/jobs/not-a-job/run', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('503s when no scheduler is wired (e.g. CABINET_SCHEDULER=off)', async () => {
    await startApp(); // default fixture never passes `scheduler`
    const res = await asOwner('/api/admin/jobs/weekly-review/run', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('a job that throws asynchronously is logged, not left to crash the process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await withScheduler({ has: () => true, runNow: async () => { throw new Error('opus refused'); } });
    const res = await asOwner('/api/admin/jobs/weekly-review/run', { method: 'POST' });
    expect(res.status).toBe(202); // the HTTP call already returned before the job finished
    await new Promise((r) => setTimeout(r, 10));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('admin job trigger: weekly-review failed: opus refused'));
    warn.mockRestore();
  });
});

describe('chats', () => {
  it('create → list → patch → paginate messages', async () => {
    await startApp();
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'main' }) })).json();
    const list = await (await asOwner('/api/chats')).json();
    expect(list.chats[0]).toMatchObject({ id, title: 'main' });
    expect((await asOwner(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ model_override: 'fable' }) })).status).toBe(200);
    expect((await asOwner('/api/chats/nope', { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(404);
    const msgs = await (await asOwner(`/api/chats/${id}/messages`)).json();
    expect(msgs.messages).toEqual([]);
  });
});

const deps_chat = (id: string) => cabinet.db.prepare('SELECT title FROM chat WHERE id = ?').get(id) as { title: string | null };

async function collectSse(res: globalThis.Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const parse = createSseParser((e) => events.push(e));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parse(dec.decode(value));
  }
  return events;
}

describe('chat stream', () => {
  it('streams the turn, persists user + folded assistant messages', async () => {
    await startApp(
      fakeRuntime(async (onEvent) => {
        onEvent({ type: 'turn-start', messageId: 'm1', chatId: 't', model: 'claude-sonnet-5' });
        onEvent({ type: 'text-delta', delta: 'Working' });
        onEvent({ type: 'tool-start', toolId: 'tu1', name: 'Bash', input: { command: 'ls' } });
        onEvent({ type: 'tool-end', toolId: 'tu1', output: 'ok', isError: false });
        onEvent({ type: 'text-delta', delta: ' — done.' });
        onEvent({ type: 'turn-end', usage: { output_tokens: 9 }, sessionId: 's1', stopReason: 'success' });
      }),
    );
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    const res = await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'go' }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await collectSse(res);
    expect(events.map((e) => e.event)).toEqual(['turn-start', 'text-delta', 'tool-start', 'tool-end', 'text-delta', 'turn-end']);

    const rows = cabinet.db.prepare('SELECT role, parts FROM message WHERE chat_id = ? ORDER BY created_at').all(id) as { role: string; parts: string }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    const parts = JSON.parse(rows[1]!.parts) as MessagePart[];
    expect(parts).toEqual([
      { type: 'text', text: 'Working' },
      { type: 'tool-run', toolId: 'tu1', name: 'Bash', input: { command: 'ls' }, output: 'ok', isError: false, done: true, at: expect.any(String) },
      { type: 'text', text: ' — done.' },
    ]);
  });

  it('live-persists the assistant message mid-turn, so a tool call already run is durable before turn-end (or a hard process kill, e.g. self-redeploying cabinet-api mid-turn) ever fires', async () => {
    let sawMidTurnRow: { role: string; parts: string } | undefined;
    await startApp(
      fakeRuntime(async (onEvent) => {
        onEvent({ type: 'turn-start', messageId: 'm1', chatId: 't', model: 'claude-sonnet-5' });
        onEvent({ type: 'tool-start', toolId: 'tu1', name: 'Bash', input: { command: 'ls' } });
        onEvent({ type: 'tool-end', toolId: 'tu1', output: 'ok', isError: false });
        // Snapshot the DB right here — before turn-end, and before this route's
        // `finally` block has any chance to run. This is exactly the window a
        // hard process kill would land in; if the row isn't here yet, a crash
        // (or a self-redeploy of the very process serving this turn) would
        // erase the tool call with zero trace.
        sawMidTurnRow = cabinet.db.prepare("SELECT role, parts FROM message WHERE role = 'assistant'").get() as
          | { role: string; parts: string }
          | undefined;
        onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
      }),
    );
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'go' }) }));
    expect(sawMidTurnRow).toBeDefined();
    const parts = JSON.parse(sawMidTurnRow!.parts) as MessagePart[];
    expect(parts).toEqual([{ type: 'tool-run', toolId: 'tu1', name: 'Bash', input: { command: 'ls' }, output: 'ok', isError: false, done: true, at: expect.any(String) }]);
  });

  it('auto-titles an untitled chat from its first turn, but never re-titles', async () => {
    let titleCalls = 0;
    let turn = 0;
    const script = async (onEvent: (e: TurnEvent) => void) => {
      onEvent({ type: 'turn-start', messageId: `m${++turn}`, chatId: 't', model: 'claude-sonnet-5' });
      onEvent({ type: 'text-delta', delta: 'Here is your answer.' });
      onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
    };
    await startApp(
      fakeRuntime(script, async () => {
        titleCalls++;
        return 'Weight Tracker Deploy';
      }),
    );
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    // first turn — titles it (awaited before the stream closes)
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'deploy the weight tracker' }) }));
    let row = deps_chat(id);
    expect(row.title).toBe('Weight Tracker Deploy');
    expect(titleCalls).toBe(1);
    // second turn — established title is left alone, no extra titling call
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'now add a chart' }) }));
    row = deps_chat(id);
    expect(row.title).toBe('Weight Tracker Deploy');
    expect(titleCalls).toBe(1);
  });

  it('leaves the chat untitled when the titler returns null', async () => {
    const script = async (onEvent: (e: TurnEvent) => void) => {
      onEvent({ type: 'turn-start', messageId: 'm1', chatId: 't', model: 'claude-sonnet-5' });
      onEvent({ type: 'text-delta', delta: 'ok' });
      onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
    };
    await startApp(fakeRuntime(script, async () => null));
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'hi' }) }));
    expect(deps_chat(id).title).toBeNull();
  });

  it(
    '/api/chat auto-recalls a relevant lesson into promptInput.lessons and filters an irrelevant one',
    async () => {
      const episodicDir = mkdtempSync(join(tmpdir(), 'cabinet-lessons-'));
      const episodic = new EpisodicStore(join(episodicDir, 'episodic.db'));
      const embedder = new Embedder();
      try {
        await addLesson(episodic, embedder, {
          text: 'Ben prefers high-protein dinners on lifting days.',
          domain: 'nutrition',
          evidence: 'meal logs 2026-06',
          confidence: 0.8,
        });

        let capturedPromptInput: { lessons?: { text: string; domain: string | null }[] } | undefined;
        const runtime = {
          authMode: 'subscription' as const,
          queue: { depth: 0 },
          interrupt: () => true,
          titleFor: async () => null,
          run: async (req: { promptInput?: typeof capturedPromptInput; onEvent: (e: TurnEvent) => void }) => {
            capturedPromptInput = req.promptInput;
            req.onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
            return { stopReason: 'success' as const, sessionId: 's1' };
          },
        };
        const app = buildApp({
          db: cabinet.db,
          runtime: runtime as never,
          approvals,
          widgetBus,
          ownerEmail: OWNER,
          authFetch: fakeAuthFetch,
          episodic,
          embedder,
        });
        server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();

        // On-topic turn: the lesson should clear the relevance cutoff and get injected.
        await collectSse(
          await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'what should I eat tonight after lifting?' }) }),
        );
        expect(capturedPromptInput?.lessons).toEqual([{ text: 'Ben prefers high-protein dinners on lifting days.', domain: 'nutrition' }]);

        // Off-topic turn: same lesson exists, but it's a weak match and must be filtered out, not injected.
        await collectSse(
          await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'how much is left on my HSA deductible this year?' }) }),
        );
        expect(capturedPromptInput?.lessons).toBeUndefined();
      } finally {
        await embedder.close();
        episodic.close();
        rmSync(episodicDir, { recursive: true, force: true });
      }
    },
    MODEL_TIMEOUT,
  );

  it('/api/chat carries profileGap + domainFiles: ["ONBOARDING.md"] into promptInput when the profile is incomplete, and omits both once it is not (mentorship Phase B)', async () => {
    const memDir = mkdtempSync(join(tmpdir(), 'cabinet-profile-chat-'));
    const memory = new MemoryStore(memDir);
    memory.ensureTemplates();
    try {
      let capturedPromptInput: { profileGap?: string; domainFiles?: string[] } | undefined;
      const runtime = {
        authMode: 'subscription' as const,
        queue: { depth: 0 },
        interrupt: () => true,
        titleFor: async () => null,
        run: async (req: { promptInput?: typeof capturedPromptInput; onEvent: (e: TurnEvent) => void }) => {
          capturedPromptInput = req.promptInput;
          req.onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
          return { stopReason: 'success' as const, sessionId: 's1' };
        },
      };
      const app = buildApp({ db: cabinet.db, runtime: runtime as never, approvals, widgetBus, ownerEmail: OWNER, authFetch: fakeAuthFetch, memory });
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();

      // Fresh profile — incomplete.
      await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'hey' }) }));
      expect(capturedPromptInput?.profileGap).toContain('still need');
      expect(capturedPromptInput?.domainFiles).toEqual(['ONBOARDING.md']);

      // Fill every dimension via sentinels — now complete.
      upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 180, unit: 'g' });
      logBodyMetric(cabinet.db, { metric: 'weight_lb', value: 198 });
      memory.update('USER.md', '# USER\n\nreal content', 'seed');
      memory.update('domains/health.md', '# Health\n\nreal content', 'seed');
      memory.update('domains/training.md', '# Training\n\nreal content', 'seed');
      memory.update('domains/nutrition.md', '# Nutrition\n\nreal content', 'seed');
      memory.update('domains/mind.md', '# Mind\n\nreal content', 'seed');
      memory.update('domains/money.md', '# Money\n\nreal content', 'seed');
      memory.update('domains/admin.md', '# Admin\n\nreal content', 'seed');
      memory.update('domains/social.md', '# Social\n\nreal content', 'seed');
      upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
      upsertConstraint(cabinet.db, { kind: 'physical', confirmedNone: true });

      await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'hey again' }) }));
      expect(capturedPromptInput?.profileGap).toBeUndefined();
      expect(capturedPromptInput?.domainFiles).toBeUndefined();
    } finally {
      rmSync(memDir, { recursive: true, force: true });
    }
  });

  it('rejects unknown chats and empty text', async () => {
    await startApp();
    expect((await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: 'x', text: 'hi' }) })).status).toBe(404);
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    expect((await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: '  ' }) })).status).toBe(400);
  });
});

describe('chat + attachments (§ vision spike, 2026-07-11)', () => {
  it('turns an attachment id into a base64 image for the turn, and persists image-then-text parts in order', async () => {
    const attachDir = mkdtempSync(join(tmpdir(), 'cabinet-chat-attach-'));
    try {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { id: attId } = saveAttachment(attachDir, 'image/png', pngBytes.toString('base64'));
      let capturedImages: { mediaType: string; base64: string }[] | undefined;
      const runtime = {
        authMode: 'subscription' as const,
        queue: { depth: 0 },
        interrupt: () => true,
        titleFor: async () => null,
        run: async (req: { images?: typeof capturedImages; onEvent: (e: TurnEvent) => void }) => {
          capturedImages = req.images;
          req.onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
          return { stopReason: 'success' as const, sessionId: 's1' };
        },
      };
      const app = buildApp({
        db: cabinet.db, runtime: runtime as never, approvals, widgetBus, ownerEmail: OWNER, authFetch: fakeAuthFetch, attachmentsDir: attachDir,
      });
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const { id: chatId } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
      await collectSse(
        await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId, text: 'what is this?', attachments: [{ id: attId }] }) }),
      );

      expect(capturedImages).toEqual([{ mediaType: 'image/png', base64: pngBytes.toString('base64') }]);

      const row = cabinet.db.prepare("SELECT parts FROM message WHERE chat_id = ? AND role = 'user'").get(chatId) as { parts: string };
      expect(JSON.parse(row.parts)).toEqual([
        { type: 'image', id: attId, mediaType: 'image/png' },
        { type: 'text', text: 'what is this?' },
      ]);
    } finally {
      rmSync(attachDir, { recursive: true, force: true });
    }
  });

  it('allows an image-only message — no caption required, attachments alone satisfy the "something to send" gate', async () => {
    const attachDir = mkdtempSync(join(tmpdir(), 'cabinet-chat-attach2-'));
    try {
      const { id: attId } = saveAttachment(attachDir, 'image/jpeg', Buffer.from([1, 2, 3]).toString('base64'));
      const app = buildApp({
        db: cabinet.db, runtime: fakeRuntime() as never, approvals, widgetBus, ownerEmail: OWNER, authFetch: fakeAuthFetch, attachmentsDir: attachDir,
      });
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const { id: chatId } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
      const res = await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId, text: '', attachments: [{ id: attId }] }) });
      expect(res.status).toBe(200);
      await collectSse(res);

      const row = cabinet.db.prepare("SELECT parts FROM message WHERE chat_id = ? AND role = 'user'").get(chatId) as { parts: string };
      expect(JSON.parse(row.parts)).toEqual([{ type: 'image', id: attId, mediaType: 'image/jpeg' }]);
    } finally {
      rmSync(attachDir, { recursive: true, force: true });
    }
  });

  it('400s an unknown/invalid attachment id before ever opening the SSE stream', async () => {
    await startApp();
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    const res = await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'hi', attachments: [{ id: 'nope.png' }] }) });
    expect(res.status).toBe(400);
  });

  it('still 400s empty text with no attachments at all', async () => {
    await startApp();
    const { id } = await (await asOwner('/api/chats', { method: 'POST', body: JSON.stringify({}) })).json();
    expect((await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: id, text: '' }) })).status).toBe(400);
  });
});

describe('approvals API', () => {
  it('lists pending and resolves the blocking decision', async () => {
    await startApp();
    const { id, decision } = approvals.enqueue({
      tier: 2, action: 'git-push', payload: '{}', reasoning: 'r', confidence: null, reversibility: null, chatId: null,
    });
    const pending = await (await asOwner('/api/approvals')).json();
    expect(pending.approvals[0].id).toBe(id);
    expect((await asOwner(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ approved: true }) })).status).toBe(200);
    expect(await decision).toMatchObject({ approved: true });
    expect((await asOwner(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ approved: false }) })).status).toBe(404); // already decided
  });
});

describe('/api/events channel', () => {
  it('broadcasts approvals live and replays the ring on Last-Event-ID', async () => {
    await startApp();
    // one event lands BEFORE anyone connects — it must replay from the ring
    approvals.enqueue({ tier: 2, action: 'first', payload: '{}', reasoning: '', confidence: null, reversibility: null, chatId: null });

    const ac = new AbortController();
    const res = await fetch(base + '/api/events', { headers: { Cookie: 'token=owner' }, signal: ac.signal });
    const events: SseEvent[] = [];
    const parse = createSseParser((e) => events.push(e));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(dec.decode(value));
        }
      } catch { /* aborted */ }
    })();

    await new Promise((r) => setTimeout(r, 50));
    approvals.enqueue({ tier: 2, action: 'second', payload: '{}', reasoning: '', confidence: null, reversibility: null, chatId: null });
    widgetBus.emit('push', { event: 'notice', data: { text: 'briefing ready' } });
    await new Promise((r) => setTimeout(r, 80));
    ac.abort();
    await pump;

    const kinds = events.map((e) => `${e.event}:${(e.data as { action?: string; text?: string }).action ?? (e.data as { text?: string }).text ?? ''}`);
    expect(kinds).toContain('approval:first'); // ring replay
    expect(kinds).toContain('approval:second'); // live
    expect(kinds).toContain('notice:briefing ready'); // widget bus push
    expect(events.every((e) => e.id !== undefined)).toBe(true);
  });
});

describe('SSE round-trip fuzz', () => {
  it('parser reassembles events across arbitrary chunk boundaries', () => {
    const original: SseEvent[] = Array.from({ length: 40 }, (_, i) => ({
      event: i % 2 ? 'text-delta' : 'tool-start',
      data: { i, s: `payload ${'x'.repeat(i)} with\nnewline and "quotes"` },
      id: String(i),
    }));
    const wire = original.map(encodeSse).join('');
    // deterministic pseudo-random chunking
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const out: SseEvent[] = [];
    const parse = createSseParser((e) => out.push(e));
    let pos = 0;
    while (pos < wire.length) {
      const n = 1 + Math.floor(rand() * 7);
      parse(wire.slice(pos, pos + n));
      pos += n;
    }
    expect(out).toEqual(original);
  });
});

describe('foldEvent', () => {
  it('accumulates text, completes tool runs, appends widgets and inline approvals', () => {
    const parts: MessagePart[] = [];
    const packet = {
      id: 'ap1', tier: 2, action: 'Bash:git-push', payload: 'git push', reasoning: 'r',
      confidence: null, reversibility: null, chatId: 't1', expiresAt: '2026-07-08T00:00:00Z',
    };
    const feed: (TurnEvent | { type: 'widget'; widgetType: string; data: unknown })[] = [
      { type: 'text-delta', delta: 'a' },
      { type: 'text-delta', delta: 'b' },
      { type: 'tool-start', toolId: 't1', name: 'Read', input: {} },
      { type: 'widget', widgetType: 'macro-ring', data: { p: 1 } },
      { type: 'tool-end', toolId: 't1', output: 'x', isError: false },
      { type: 'approval', packet },
      { type: 'text-delta', delta: 'c' },
    ];
    for (const e of feed) foldEvent(parts, e as never);
    // Approval folds inline, in order — NOT pinned to the top (the reported bug).
    expect(parts.map((p) => p.type)).toEqual(['text', 'tool-run', 'widget', 'approval', 'text']);
    expect((parts[3] as { packet: { id: string } }).packet.id).toBe('ap1');
    expect((parts[0] as { text: string }).text).toBe('ab');
    expect((parts[1] as { done: boolean }).done).toBe(true);
  });
});

describe('extractText (mentorship: Phase 3 item 3 keystone — conversation indexing)', () => {
  it('joins every text part\'s prose, in order', () => {
    expect(extractText([{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }])).toBe('hello world');
  });

  it('excludes tool-run, widget, notice, and approval parts — only prose is embeddable', () => {
    const packet = { id: 'ap1', tier: 2, action: 'x', payload: 'x', reasoning: 'r', confidence: null, reversibility: null, chatId: null, expiresAt: '2026-07-08T00:00:00Z' };
    const parts: MessagePart[] = [
      { type: 'text', text: 'the real content' },
      { type: 'tool-run', toolId: 't1', name: 'Bash', input: {}, output: 'ls output', isError: false, done: true },
      { type: 'widget', widgetType: 'macro-ring', data: { p: 1 } },
      { type: 'notice', level: 'info', text: 'a notice' },
      { type: 'approval', packet },
    ];
    expect(extractText(parts)).toBe('the real content');
  });

  it('returns an empty string for an empty or all-non-text parts array', () => {
    expect(extractText([])).toBe('');
    expect(extractText([{ type: 'widget', widgetType: 'checkin', data: {} }])).toBe('');
  });
});
