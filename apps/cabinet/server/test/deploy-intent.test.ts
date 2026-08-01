// The self-deploy announcement (2026-08-01). Covers the module itself and,
// more importantly, the seam: a boot that follows a self-deploy must post a
// VERIFIED outcome into the chat Ben was working in, before the resume turn
// says anything — the beat that was missing when a deploy just dropped the
// stream and went quiet.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { formatDeployReport, takeDeployIntent, type DeployIntent } from '../src/deploy/deployIntent.js';
import { markShutdown, markTurnInFlight, resumeInterruptedTurn } from '../src/gateway/pendingTurn.js';
import type { TurnEvent } from '../src/runtime/agent.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-deploy-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  markShutdown(false);
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

const INTENT_PATH = () => join(dir, 'deploy-intent.json');

function writeIntent(intent: Partial<DeployIntent>) {
  writeFileSync(INTENT_PATH(), JSON.stringify({ app: 'cabinet-api', requestedAt: new Date().toISOString(), ...intent }));
}

/** Captures the prompt so we can assert the resume turn is told not to
 *  re-verify a deploy the boot already verified. */
function fakeRuntime(calls: { prompt: string }[]) {
  return {
    run: async (req: { chatId: string; prompt: string; onEvent: (e: TurnEvent) => void }) => {
      calls.push({ prompt: req.prompt });
      req.onEvent({ type: 'turn-start', messageId: 'm', chatId: req.chatId, model: 'test' });
      req.onEvent({ type: 'text-delta', delta: 'picking back up' });
      req.onEvent({ type: 'turn-end', usage: null, sessionId: null, stopReason: 'success' });
      return { stopReason: 'success', sessionId: null };
    },
  };
}

describe('takeDeployIntent', () => {
  it('reads and consumes the intent file', () => {
    writeIntent({ toSha: 'abc123', subject: 'a change' });
    expect(takeDeployIntent(dir)?.toSha).toBe('abc123');
    expect(existsSync(INTENT_PATH()), 'consumed on read so a boot loop cannot re-announce forever').toBe(false);
  });

  it('returns null with no file, and drops a corrupt one', () => {
    expect(takeDeployIntent(dir)).toBeNull();
    writeFileSync(INTENT_PATH(), 'not json');
    expect(takeDeployIntent(dir)).toBeNull();
    expect(existsSync(INTENT_PATH())).toBe(false);
  });
});

describe('formatDeployReport', () => {
  it('confirms a deploy whose target sha is what actually booted', () => {
    const text = formatDeployReport(
      { app: 'cabinet-api', requestedAt: '', fromSha: 'old111111111', toSha: 'new222222222', subject: 'ship it', drained: true },
      'new222222222',
    );
    expect(text).toContain('✓ Self-deploy landed');
    expect(text).toContain('old111111111 → new222222222');
    expect(text).toContain('ship it');
  });

  it('flags a deploy whose build did NOT come up — the stale-buildMarker trap', () => {
    const text = formatDeployReport(
      { app: 'cabinet-api', requestedAt: '', fromSha: 'old111111111', toSha: 'new222222222' },
      'old111111111', // restarted, but still running the old build
    );
    expect(text).toContain('⚠');
    expect(text).toContain('expected new222222222');
  });

  it('says so when the restart had to cut into a live turn', () => {
    const text = formatDeployReport(
      { app: 'cabinet-api', requestedAt: '', fromSha: 'aaa', toSha: 'bbb', drained: false, waitedSeconds: 600 },
      'bbb',
    );
    expect(text).toContain('cut in after waiting 600s');
  });
});

describe('boot after a self-deploy', () => {
  it('posts the verified result into the interrupted chat, then resumes it', async () => {
    const chatId = 'chat-1';
    cabinet.db.prepare("INSERT INTO chat (id, title, kind) VALUES (?, 'T', 'user')").run(chatId);
    markTurnInFlight(dir, chatId, 'can you keep working?');
    writeIntent({ fromSha: 'old111111111', toSha: 'new222222222', subject: 'RHYTHM timing', drained: true });

    const calls: { prompt: string }[] = [];
    const ran = await resumeInterruptedTurn({
      db: cabinet.db,
      runtime: fakeRuntime(calls),
      dataDir: dir,
      liveSha: 'new222222222',
    });
    expect(ran).toBe(true);

    const rows = cabinet.db
      .prepare('SELECT role, parts FROM message WHERE chat_id = ? ORDER BY rowid')
      .all(chatId) as { role: string; parts: string }[];

    // Order is the point: the seam note, then the deploy result, then the
    // agent picking the work back up.
    expect(rows.map((r) => r.role)).toEqual(['system', 'assistant', 'assistant']);
    expect(rows[0]!.parts).toContain('Restarted to deploy');
    expect(rows[1]!.parts).toContain('✓ Self-deploy landed');
    expect(rows[1]!.parts).toContain('RHYTHM timing');
    expect(rows[2]!.parts).toContain('picking back up');

    // The resume turn is handed the verified result so it doesn't burn the
    // first minute re-checking healthz to rediscover it.
    expect(calls[0]!.prompt).toContain('Do not re-verify it');
    expect(calls[0]!.prompt).toContain('✓ Self-deploy landed');
    expect(existsSync(INTENT_PATH())).toBe(false);
  });

  it('announces a deploy that landed while nothing was in flight in the deploy log', async () => {
    writeIntent({ fromSha: 'old111111111', toSha: 'new222222222', subject: 'quiet ship' });
    const calls: { prompt: string }[] = [];
    const ran = await resumeInterruptedTurn({
      db: cabinet.db,
      runtime: fakeRuntime(calls),
      dataDir: dir,
      liveSha: 'new222222222',
    });

    expect(ran, 'no interrupted turn to resume').toBe(false);
    expect(calls, 'and therefore no agent turn burned on it').toHaveLength(0);
    const rows = cabinet.db
      .prepare("SELECT parts FROM message WHERE chat_id = 'sys-deploy'")
      .all() as { parts: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.parts).toContain('quiet ship');
  });

  it('a plain restart (no deploy) says nothing about deploys', async () => {
    const chatId = 'chat-1';
    cabinet.db.prepare("INSERT INTO chat (id, title, kind) VALUES (?, 'T', 'user')").run(chatId);
    markTurnInFlight(dir, chatId, 'q');

    const calls: { prompt: string }[] = [];
    await resumeInterruptedTurn({ db: cabinet.db, runtime: fakeRuntime(calls), dataDir: dir, liveSha: 'abc' });

    const rows = cabinet.db
      .prepare('SELECT role, parts FROM message WHERE chat_id = ? ORDER BY rowid')
      .all(chatId) as { role: string; parts: string }[];
    expect(rows.map((r) => r.role)).toEqual(['system', 'assistant']);
    expect(rows[0]!.parts).toContain('Process restarted mid-turn');
    expect(calls[0]!.prompt).not.toContain('Do not re-verify');
  });
});
