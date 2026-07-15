import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  markTurnInFlight,
  clearTurnInFlight,
  clearTurnInFlightIf,
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

function makeChat(id = 't-1'): string {
  cabinet.db.prepare("INSERT INTO chat (id, title, kind) VALUES (?, 'Test', 'user')").run(id);
  return id;
}

/** A runtime fake that streams one text part, like a minimal real turn. */
function fakeRuntime(calls: { chatId: string; prompt: string }[]) {
  return {
    run: async (req: { chatId: string; prompt: string; onEvent: (e: TurnEvent) => void }) => {
      calls.push({ chatId: req.chatId, prompt: req.prompt });
      req.onEvent({ type: 'turn-start', messageId: 'resume-msg', chatId: req.chatId, model: 'test' });
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
    expect(marker.chatId).toBe('t-1');
    expect(marker.promptHead).toBe('hello there');

    const taken = takePendingTurn(dir);
    expect(taken?.chatId).toBe('t-1');
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

  it('clearTurnInFlightIf only removes the exact marker it was given', () => {
    const mine = markTurnInFlight(dir, 't-1', 'first turn');
    // A newer turn overwrites the breadcrumb (queued-behind race)…
    markTurnInFlight(dir, 't-2', 'second turn');
    // …so the first turn's cleanup must leave it alone.
    clearTurnInFlightIf(dir, mine);
    expect(takePendingTurn(dir)?.chatId).toBe('t-2');

    // But it does remove its own marker when unchanged.
    const again = markTurnInFlight(dir, 't-3', 'third turn');
    clearTurnInFlightIf(dir, again);
    expect(existsSync(MARKER_PATH())).toBe(false);
  });

  it('drops (and consumes) a corrupt marker instead of crashing', () => {
    writeFileSync(MARKER_PATH(), 'not json');
    expect(takePendingTurn(dir)).toBeNull();
    expect(existsSync(MARKER_PATH())).toBe(false);
  });
});

describe('resumeInterruptedTurn', () => {
  it('no-ops with no marker', async () => {
    const calls: { chatId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('runs a resume turn in the marked chat: system note + assistant transcript persisted, marker consumed', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'the interrupted question');
    const calls: { chatId: string; prompt: string }[] = [];

    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.chatId).toBe(chatId);
    expect(calls[0]!.prompt).toContain('restarted');
    expect(calls[0]!.prompt).toContain('the interrupted question');

    const rows = cabinet.db
      .prepare('SELECT role, parts FROM message WHERE chat_id = ? ORDER BY created_at, rowid')
      .all(chatId) as { role: string; parts: string }[];
    expect(rows.map((r) => r.role)).toEqual(['system', 'assistant']);
    expect(rows[0]!.parts).toContain('restarted mid-turn');
    expect(rows[1]!.parts).toContain('deploy verified');
    expect(existsSync(MARKER_PATH())).toBe(false);
  });

  it('broadcasts chat-activity plus a paired resume-start/resume-end over the widgetBus push relay', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'q');
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
    expect(events.filter((e) => e === 'chat-activity')).toHaveLength(2);
    // Badge lifecycle: a start must always be paired with an end (the
    // /api/events ring replays to fresh tabs — an unpaired start would
    // strand a stale "resuming" badge), and start precedes end.
    expect(events.indexOf('chat-resume-start')).toBeGreaterThan(-1);
    expect(events.indexOf('chat-resume-end')).toBeGreaterThan(events.indexOf('chat-resume-start'));
    expect(pushes.every((p) => JSON.stringify(p.data) === JSON.stringify({ chatId }))).toBe(true);
  });

  it('refuses a stale marker (>24h old)', async () => {
    makeChat();
    writeFileSync(
      MARKER_PATH(),
      JSON.stringify({ chatId: 't-1', promptHead: 'old', startedAt: '2020-01-01T00:00:00.000Z' }),
    );
    const calls: { chatId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    expect(existsSync(MARKER_PATH())).toBe(false); // still consumed — no retry loop
  });

  it('drops a marker pointing at a chat that no longer exists', async () => {
    markTurnInFlight(dir, 'ghost-chat', 'q');
    const calls: { chatId: string; prompt: string }[] = [];
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('re-arms a bounded marker while the resume runs, and stands it down after', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'q');
    let markerDuringRun: PendingTurnMarker | null = null;
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        markerDuringRun = JSON.parse(readFileSync(MARKER_PATH(), 'utf8')) as PendingTurnMarker;
        req.onEvent({ type: 'turn-start', messageId: 'm', chatId, model: 'test' });
        req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
        return { stopReason: 'success', sessionId: null };
      },
    };
    await resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir });
    // A kill during the resume would have found this generation-1 marker.
    expect(markerDuringRun!.chatId).toBe(chatId);
    expect(markerDuringRun!.generation).toBe(1);
    // Graceful finish stands it down.
    expect(existsSync(MARKER_PATH())).toBe(false);
  });

  it('stops re-arming past the generation cap', async () => {
    const chatId = makeChat();
    writeFileSync(
      MARKER_PATH(),
      JSON.stringify({ chatId, promptHead: 'q', startedAt: new Date().toISOString(), generation: 2 }),
    );
    let markerExistedDuringRun = true;
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        markerExistedDuringRun = existsSync(MARKER_PATH());
        req.onEvent({ type: 'turn-start', messageId: 'm', chatId, model: 'test' });
        req.onEvent({ type: 'text-delta', delta: 'third and final attempt' });
        req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
        return { stopReason: 'success', sessionId: null };
      },
    };
    // Generation-3 resume still RUNS (the chat deserves its answer)…
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir })).resolves.toBe(true);
    // …but with no safety net re-armed: a crash here must not loop forever.
    expect(markerExistedDuringRun).toBe(false);
  });

  it('does not stand down a marker a newer queued turn wrote during the resume', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'q');
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        // A user turn queues behind the resume and writes its own breadcrumb.
        markTurnInFlight(dir, 'newer-chat', 'queued question');
        req.onEvent({ type: 'turn-start', messageId: 'm', chatId, model: 'test' });
        req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
        return { stopReason: 'success', sessionId: null };
      },
    };
    await resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir });
    expect(takePendingTurn(dir)?.chatId).toBe('newer-chat');
  });

  it('live-persists the resume transcript mid-turn — a SIGKILL cannot erase it', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'q');
    let persistedMidTurn: number = 0;
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'live-m', chatId, model: 'test' });
        req.onEvent({ type: 'text-delta', delta: 'progress before any kill' });
        req.onEvent({ type: 'tool-start', toolId: 't1', name: 'Bash', input: {} });
        // Snapshot the DB *as if* the process died right here — before
        // turn-end, before any finally.
        persistedMidTurn = (
          cabinet.db.prepare('SELECT COUNT(*) AS n FROM message WHERE chat_id = ? AND role = ?').get(chatId, 'assistant') as { n: number }
        ).n;
        req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
        return { stopReason: 'success', sessionId: null };
      },
    };
    await resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir });
    expect(persistedMidTurn).toBe(1);
  });

  it('persists whatever streamed even when the resume turn itself throws', async () => {
    const chatId = makeChat();
    markTurnInFlight(dir, chatId, 'q');
    const runtime = {
      run: async (req: { onEvent: (e: TurnEvent) => void }) => {
        req.onEvent({ type: 'turn-start', messageId: 'm', chatId, model: 'test' });
        req.onEvent({ type: 'text-delta', delta: 'partial…' });
        throw new Error('boom');
      },
    };
    await expect(resumeInterruptedTurn({ db: cabinet.db, runtime, dataDir: dir })).rejects.toThrow('boom');
    const rows = cabinet.db.prepare('SELECT role FROM message WHERE chat_id = ?').all(chatId) as { role: string }[];
    expect(rows.map((r) => r.role).sort()).toEqual(['assistant', 'system']);
  });
});
