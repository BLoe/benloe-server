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
import { createSseParser, encodeSse, type SseEvent } from '../src/gateway/sse.js';
import { foldEvent, type MessagePart } from '../src/gateway/fold.js';
import type { TurnEvent } from '../src/runtime/agent.js';

const OWNER = 'below413@gmail.com';

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
    run: async (req: { threadId: string; onEvent: (e: TurnEvent) => void }) => {
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
    expect((await fetch(base + '/api/threads')).status).toBe(401);
    expect((await fetch(base + '/api/threads', { headers: { Cookie: 'token=guest' } })).status).toBe(403);
    expect((await fetch(base + '/api/threads', { headers: { Cookie: 'token=bogus' } })).status).toBe(401);
    expect((await asOwner('/api/threads')).status).toBe(200);
  });

  it('accepts an agent bearer key as an authorized (non-owner) principal', async () => {
    await startApp();
    // no credential at all → 401
    expect((await fetch(base + '/api/threads')).status).toBe(401);
    // a valid agent key → 200 (agents are first-class principals, not the owner)
    const r = await fetch(base + '/api/threads', { headers: { Authorization: 'Bearer agk_benji_test' } });
    expect(r.status).toBe(200);
    // a bearer Artanis doesn't recognize → 401
    expect((await fetch(base + '/api/threads', { headers: { Authorization: 'Bearer agk_nope' } })).status).toBe(401);
  });

  it('public liveness stays open; detailed health is walled', async () => {
    await startApp();
    expect((await fetch(base + '/healthz')).status).toBe(200);
    expect((await fetch(base + '/api/healthz')).status).toBe(401);
    const detailed = await (await asOwner('/api/healthz')).json();
    expect(detailed).toMatchObject({ ok: true, db: true, authMode: 'subscription' });
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
});

describe('threads', () => {
  it('create → list → patch → paginate messages', async () => {
    await startApp();
    const { id } = await (await asOwner('/api/threads', { method: 'POST', body: JSON.stringify({ title: 'main' }) })).json();
    const list = await (await asOwner('/api/threads')).json();
    expect(list.threads[0]).toMatchObject({ id, title: 'main' });
    expect((await asOwner(`/api/threads/${id}`, { method: 'PATCH', body: JSON.stringify({ model_override: 'fable' }) })).status).toBe(200);
    expect((await asOwner('/api/threads/nope', { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(404);
    const msgs = await (await asOwner(`/api/threads/${id}/messages`)).json();
    expect(msgs.messages).toEqual([]);
  });
});

const deps_thread = (id: string) => cabinet.db.prepare('SELECT title FROM thread WHERE id = ?').get(id) as { title: string | null };

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
        onEvent({ type: 'turn-start', messageId: 'm1', threadId: 't', model: 'claude-sonnet-5' });
        onEvent({ type: 'text-delta', delta: 'Working' });
        onEvent({ type: 'tool-start', toolId: 'tu1', name: 'Bash', input: { command: 'ls' } });
        onEvent({ type: 'tool-end', toolId: 'tu1', output: 'ok', isError: false });
        onEvent({ type: 'text-delta', delta: ' — done.' });
        onEvent({ type: 'turn-end', usage: { output_tokens: 9 }, sessionId: 's1', stopReason: 'success' });
      }),
    );
    const { id } = await (await asOwner('/api/threads', { method: 'POST', body: JSON.stringify({}) })).json();
    const res = await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: id, text: 'go' }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await collectSse(res);
    expect(events.map((e) => e.event)).toEqual(['turn-start', 'text-delta', 'tool-start', 'tool-end', 'text-delta', 'turn-end']);

    const rows = cabinet.db.prepare('SELECT role, parts FROM message WHERE thread_id = ? ORDER BY created_at').all(id) as { role: string; parts: string }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    const parts = JSON.parse(rows[1]!.parts) as MessagePart[];
    expect(parts).toEqual([
      { type: 'text', text: 'Working' },
      { type: 'tool-run', toolId: 'tu1', name: 'Bash', input: { command: 'ls' }, output: 'ok', isError: false, done: true },
      { type: 'text', text: ' — done.' },
    ]);
  });

  it('auto-titles an untitled thread from its first turn, but never re-titles', async () => {
    let titleCalls = 0;
    let turn = 0;
    const script = async (onEvent: (e: TurnEvent) => void) => {
      onEvent({ type: 'turn-start', messageId: `m${++turn}`, threadId: 't', model: 'claude-sonnet-5' });
      onEvent({ type: 'text-delta', delta: 'Here is your answer.' });
      onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
    };
    await startApp(
      fakeRuntime(script, async () => {
        titleCalls++;
        return 'Weight Tracker Deploy';
      }),
    );
    const { id } = await (await asOwner('/api/threads', { method: 'POST', body: JSON.stringify({}) })).json();
    // first turn — titles it (awaited before the stream closes)
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: id, text: 'deploy the weight tracker' }) }));
    let row = deps_thread(id);
    expect(row.title).toBe('Weight Tracker Deploy');
    expect(titleCalls).toBe(1);
    // second turn — established title is left alone, no extra titling call
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: id, text: 'now add a chart' }) }));
    row = deps_thread(id);
    expect(row.title).toBe('Weight Tracker Deploy');
    expect(titleCalls).toBe(1);
  });

  it('leaves the thread untitled when the titler returns null', async () => {
    const script = async (onEvent: (e: TurnEvent) => void) => {
      onEvent({ type: 'turn-start', messageId: 'm1', threadId: 't', model: 'claude-sonnet-5' });
      onEvent({ type: 'text-delta', delta: 'ok' });
      onEvent({ type: 'turn-end', usage: null, sessionId: 's1', stopReason: 'success' });
    };
    await startApp(fakeRuntime(script, async () => null));
    const { id } = await (await asOwner('/api/threads', { method: 'POST', body: JSON.stringify({}) })).json();
    await collectSse(await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: id, text: 'hi' }) }));
    expect(deps_thread(id).title).toBeNull();
  });

  it('rejects unknown threads and empty text', async () => {
    await startApp();
    expect((await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: 'x', text: 'hi' }) })).status).toBe(404);
    const { id } = await (await asOwner('/api/threads', { method: 'POST', body: JSON.stringify({}) })).json();
    expect((await asOwner('/api/chat', { method: 'POST', body: JSON.stringify({ threadId: id, text: '  ' }) })).status).toBe(400);
  });
});

describe('approvals API', () => {
  it('lists pending and resolves the blocking decision', async () => {
    await startApp();
    const { id, decision } = approvals.enqueue({
      tier: 2, action: 'git-push', payload: '{}', reasoning: 'r', confidence: null, reversibility: null, threadId: null,
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
    approvals.enqueue({ tier: 2, action: 'first', payload: '{}', reasoning: '', confidence: null, reversibility: null, threadId: null });

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
    approvals.enqueue({ tier: 2, action: 'second', payload: '{}', reasoning: '', confidence: null, reversibility: null, threadId: null });
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
      confidence: null, reversibility: null, threadId: 't1', expiresAt: '2026-07-08T00:00:00Z',
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
