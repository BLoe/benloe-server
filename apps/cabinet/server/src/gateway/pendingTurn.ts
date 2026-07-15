// Interrupted-turn resume (2026-07-15, Ben's restart-UX request): when
// cabinet-api dies mid-turn — a self-redeploy SIGKILLing its own process
// tree, a crash, a host reboot — the live-persist throttle (gateway/app.ts)
// already saves whatever the turn produced, but nothing ever *finished* the
// conversation: the last user message sat unanswered until Ben manually
// pinged the thread. This module is the durable breadcrumb + boot-time
// half that closes that loop, structured exactly like its sibling
// deploy/pendingConfirmation.ts:
//
//   * /api/chat writes <dataDir>/pending-turn.json when a user turn starts
//     and removes it on ANY graceful end (clean finish, error event, even a
//     deliberate /api/interrupt — the route's `finally` still runs). Only a
//     hard process death leaves the marker behind.
//   * On boot, a leftover marker means "a turn died mid-flight": the fresh
//     process posts a small system note into that thread, then runs a real
//     agent turn there (full SDK session context via the thread's
//     sdk_session_id) instructing Cabinet to verify any restart/deploy it
//     had initiated and answer whatever went unanswered.
//   * Each step broadcasts `thread-activity` over the out-of-band
//     /api/events channel (via widgetBus's 'push' relay in gateway/app.ts),
//     so a browser tab sitting on the thread re-fetches and the
//     conversation visibly resumes without a reload.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import type { AgentRuntime } from '../runtime/agent.js';
import { createTranscriptRecorder } from './transcript.js';

const MARKER = 'pending-turn.json';
/** Markers older than this are logged and dropped, not resumed — answering a
 *  question from a process that's been down for a day reads as haunted, not
 *  helpful. (Realistic restarts are back in seconds to minutes.) */
const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingTurnMarker {
  threadId: string;
  /** First 200 chars of the user prompt — context for the resume turn, and
   *  for a human reading the marker file, never the full payload. */
  promptHead: string;
  startedAt: string;
}

export function markTurnInFlight(dataDir: string, threadId: string, prompt: string): void {
  try {
    const marker: PendingTurnMarker = { threadId, promptHead: prompt.slice(0, 200), startedAt: new Date().toISOString() };
    writeFileSync(join(dataDir, MARKER), JSON.stringify(marker, null, 2));
  } catch (err) {
    // Never let breadcrumb bookkeeping break the actual turn.
    console.error('pendingTurn: failed to write marker —', err instanceof Error ? err.message : err);
  }
}

export function clearTurnInFlight(dataDir: string): void {
  try {
    unlinkSync(join(dataDir, MARKER));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('pendingTurn: failed to clear marker —', err instanceof Error ? err.message : err);
    }
  }
}

/** Read-and-consume the marker. Consuming FIRST is deliberate: if the resume
 *  turn itself dies, we must not re-fire it forever on every boot. */
export function takePendingTurn(dataDir: string): PendingTurnMarker | null {
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, MARKER), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('pendingTurn: unreadable marker, dropping —', err instanceof Error ? err.message : err);
      clearTurnInFlight(dataDir);
    }
    return null;
  }
  clearTurnInFlight(dataDir);
  try {
    const marker = JSON.parse(raw) as PendingTurnMarker;
    return typeof marker.threadId === 'string' && marker.threadId ? marker : null;
  } catch (err) {
    console.error('pendingTurn: corrupt marker, dropping —', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface ResumeDeps {
  db: Database.Database;
  runtime: Pick<AgentRuntime, 'run'>;
  dataDir: string;
  widgetBus?: EventEmitter;
}

function resumePrompt(marker: PendingTurnMarker): string {
  return [
    `SYSTEM RESUME — the cabinet-api process restarted while you were mid-turn in this thread (turn started ${marker.startedAt}; the interrupted message began: ${JSON.stringify(marker.promptHead)}).`,
    'Whatever your previous turn streamed before the restart was preserved in the transcript; anything after it was lost, and the last user message may be effectively unanswered.',
    'Review the tail of this conversation. If you initiated a deploy or restart yourself, verify it actually landed (healthz buildMarker, service logs) and report the result. Then pick the work back up: finish or re-answer whatever was left hanging.',
    'Address Ben directly as usual; briefly acknowledge the restart so the seam in the conversation is honest, then get to the point.',
  ].join('\n');
}

/**
 * The boot-time half. Returns true if a resume turn actually ran. Exported
 * separately from the scheduling wrapper for tests.
 */
export async function resumeInterruptedTurn(deps: ResumeDeps): Promise<boolean> {
  const marker = takePendingTurn(deps.dataDir);
  if (!marker) return false;

  const ageMs = Date.now() - Date.parse(marker.startedAt);
  if (!Number.isFinite(ageMs) || ageMs > MAX_RESUME_AGE_MS) {
    console.log(`pendingTurn: marker for thread ${marker.threadId} too old (${marker.startedAt}), not resuming`);
    return false;
  }

  const thread = deps.db.prepare('SELECT id FROM thread WHERE id = ?').get(marker.threadId) as { id: string } | undefined;
  if (!thread) {
    console.error(`pendingTurn: marker points at unknown thread ${marker.threadId}, dropping`);
    return false;
  }

  const broadcast = (event: string) => deps.widgetBus?.emit('push', { event, data: { threadId: marker.threadId } });

  // Honest seam in the transcript: the reader should see *why* the reply
  // below arrives out of band. role 'system' renders as "System" in the UI.
  deps.db
    .prepare('INSERT INTO message (id, thread_id, role, parts) VALUES (?,?,?,?)')
    .run(randomUUID(), marker.threadId, 'system', JSON.stringify([{ type: 'text', text: 'Process restarted mid-turn — Cabinet is resuming this thread.' }]));
  deps.db.prepare("UPDATE thread SET updated_at = datetime('now') WHERE id = ?").run(marker.threadId);
  // thread-activity drives the open tab's re-fetch; thread-resume-start/end
  // bracket the resume for UI affordances (the conversation's status strip,
  // the thread list's "resuming" badge). Emitted as a start/end PAIR on
  // purpose: /api/events replays its ring to every fresh EventSource, so an
  // unpaired start would leave stale badges on tabs opened later — a
  // replayed pair nets out to nothing.
  broadcast('thread-activity');
  broadcast('thread-resume-start');

  console.log(`pendingTurn: resuming interrupted turn in thread ${marker.threadId} (started ${marker.startedAt})`);
  const recorder = createTranscriptRecorder();
  try {
    await deps.runtime.run({
      threadId: marker.threadId,
      kind: 'user',
      prompt: resumePrompt(marker),
      onEvent: recorder.onEvent,
    });
  } finally {
    recorder.persist(deps.db, marker.threadId);
    deps.db.prepare("UPDATE thread SET updated_at = datetime('now') WHERE id = ?").run(marker.threadId);
    broadcast('thread-activity');
    broadcast('thread-resume-end');
  }
  return true;
}

/**
 * Boot wrapper (index.ts): short delay so the resume turn queues after the
 * process is fully up (listener bound, /api/events ring live to replay the
 * broadcasts to reconnecting tabs), unref'd so it never holds the process,
 * and error-contained so a resume failure can't take down a healthy boot.
 */
export function scheduleInterruptedTurnResume(deps: ResumeDeps, delayMs = 4000): void {
  const timer = setTimeout(() => {
    resumeInterruptedTurn(deps).catch((err) =>
      console.error('pendingTurn: resume failed —', err instanceof Error ? err.message : err),
    );
  }, delayMs);
  timer.unref?.();
}
