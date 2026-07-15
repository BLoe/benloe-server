import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  markTurnInFlight,
  clearTurnInFlight,
  takePendingTurn,
  resumeInterruptedTurn,
  type PendingTurnMarker,
} from '../src/gateway/pendingTurn.js';
import type { TurnEvent } from '../src/runtime/agent.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-turn-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

const MARKER_PATH = () => join(dir, 'pending-turn.json');

function makeThread(id = 't-1'): string {
  cabinet.db.prepare("INSERT INTO thread (id, title, kind) VALUES (?, 'Test', 'user')").run(id);
  return id;
}

/** A runtime fake that streams one text part, like a minimal real turn. */
function fakeRuntime(calls: { threadId: string; prompt: string }[]) {
  return {
    run: async (req: { threadId: string; prompt: string; onEvent: (e: TurnEvent) => void }) => {
      calls.push({ threadId: req.threadId, prompt: req.prompt });
      req.onEvent({ type: 'turn-start', messageId: 'resume-msg', threadId: req.threadId, model: 'test' });
      req.onEvent({ type: 'text-delta', delta: 'Back up — deploy verified, continuing.' });
      req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
      return { stopReason: 'success', sessionId: null };
    },
  };
}

describe('markTurnInFlight / clearTurnInFlight / takePendingTurn', () => {
  it('round-trips a marker and consumes it on take', () => {
    markTurnInFlight(dir, 't-1', 'hello there');
    const marker = JSON.parse(readFileSync(MARKER_PATH(), 'utf8')) as PendingTurnMarker;
    expect(marker.threadId).toBe('t-1');
    expect(marker.promptHead).toBe('hello there');

    const taken = takePendingTurn(dir);
    expect(taken?.threadId).toBe('t-1');
    expect(existsSync(MARKER_PATH())).toBe(false); // consumed — a crash mid-resume must not loop forever
    expect(takePendingTurn(dir)).toBeNull();
  });

  it('truncates long prompts in the marker', () => {
    markTurnInFlight(dir, 't-1', 'x'.repeat(1000));
    expect(takePendingTurn(dir)?.promptHead).toHaveLength(200);
  });

  it('clear tolerates a missing marker', () => {
    expect(() => clearTurnInFlight(dir)).not.toThrow();
  });

  it('drops (and consumes) a corrupt marker instead of crashing', () => {
    writeFileSync(MARKER_PATH(), 'not json');
    expect(takePendingTurn(dir)).toBeNull();
    expect(existsSync(MARKER_PATH())).toBe(false);
  });
});

describe('resumeInterruptedTurn', () => {
  it('no-ops with no marker', async () => {
    const calls: { threadId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('runs a resume turn in the marked thread: system note + assistant transcript persisted, marker consumed', async () => {
    const threadId = makeThread();
    markTurnInFlight(dir, threadId, 'the interrupted question');
    const calls: { threadId: string; prompt: string }[] = [];

    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.threadId).toBe(threadId);
    expect(calls[0]!.prompt).toContain('restarted');
    expect(calls[0]!.prompt).toContain('the interrupted question');

    const rows = cabinet.db
      .prepare('SELECT role, parts FROM message WHERE thread_id = ? ORDER BY created_at, rowid')
      .all(threadId) as { role: string; parts: string }[];
    expect(rows.map((r) => r.role)).toEqual(['system', 'assistant']);
    expect(rows[0]!.parts).toContain('restarted mid-turn');
    expect(rows[1]!.parts).toContain('deploy verified');
    expect(existsSync(MARKER_PATH())).toBe(false);
  });

  it('broadcasts thread-activity plus a paired resume-start/resume-end over the widgetBus push relay', async () => {
    const threadId = makeThread();
    markTurnInFlight(dir, threadId, 'q');
    const pushes: { event: string; data: unknown }[] = [];
    const bus = { emit: (_: string, n: { event: string; data: unknown }) => pushes.push(n) };

    await resumeInterruptedTurn({
      db: cabinet.db,
      runtime: fakeRuntime([]),
      dataDir: dir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      widgetBus: bus as any,
    });

    const events = pushes.map((p) => p.event);
    // Re-fetch trigger at the seam note and again after the turn persists.
    expect(events.filter((e) => e === 'thread-activity')).toHaveLength(2);
    // Badge lifecycle: a start must always be paired with an end (the
    // /api/events ring replays to fresh tabs — an unpaired start would
    // strand a stale "resuming" badge), and start precedes end.
    expect(events.indexOf('thread-resume-start')).toBeGreaterThan(-1);
    expect(events.indexOf('thread-resume-end')).toBeGreaterThan(events.indexOf('thread-resume-start'));
    expect(pushes.every((p) => JSON.stringify(p.data) === JSON.stringify({ threadId }))).toBe(true);
  });

  it('refuses a stale marker (>24h old)', async () => {
    makeThread();
    writeFileSync(
      MARKER_PATH(),
      JSON.stringify({ threadId: 't-1', promptHead: 'old', startedAt: '2020-01-01T00:00:00.000Z' }),
    );
    const calls: { threadId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    expect(existsSync(MARKER_PATH())).toBe(false); // still consumed — no retry loop
  });

  it('drops a marker pointing at a thread that no longer exists', async () => {
    markTurnInFlight(dir, 'ghost-thread', 'q');
    const calls: { threadId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('persists whatever streamed even when the resume turn itself throws', async () => {
    const threadId = makeThread();
    markTurnInFlight(dir, threadId, 'q');
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'm', threadId, model: 'test' });
        req.onEvent({ type: 'text-delta', delta: 'partial…' });
        throw new Error('boom');
      },
    };
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir })).rejects.toThrow('boom');
    const rows = cabinet.db.prepare('SELECT role FROM message WHERE thread_id = ?').all(threadId) as { role: string }[];
    expect(rows.map((r) => r.role).sort()).toEqual(['assistant', 'system']);
  });
});
