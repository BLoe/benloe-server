// Interrupted-turn resume (2026-07-15, Ben's restart-UX request): when
// cabinet-api dies mid-turn — a self-redeploy SIGKILLing its own process
// tree, a crash, a host reboot — the live-persist throttle (gateway/app.ts)
// already saves whatever the turn produced, but nothing ever *finished* the
// conversation: the last user message sat unanswered until Ben manually
// pinged the chat. This module is the durable breadcrumb + boot-time
// half that closes that loop, structured exactly like its sibling
// deploy/pendingConfirmation.ts:
//
//   * /api/chat writes <dataDir>/pending-turn.json when a user turn starts
//     and removes it on ANY graceful end (clean finish, error event, even a
//     deliberate /api/interrupt — the route's `finally` still runs). Only a
//     hard process death leaves the marker behind.
//   * On boot, a leftover marker means "a turn died mid-flight": the fresh
//     process posts a small system note into that chat, then runs a real
//     agent turn there (full SDK session context via the chat's
//     sdk_session_id) instructing Cabinet to verify any restart/deploy it
//     had initiated and answer whatever went unanswered.
//   * Each step broadcasts `chat-activity` over the out-of-band
//     /api/events channel (via widgetBus's 'push' relay in gateway/app.ts),
//     so a browser tab sitting on the chat re-fetches and the
//     conversation visibly resumes without a reload.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import type { AgentRuntime } from '../runtime/agent.js';
import { createTranscriptRecorder, persistAssistantMessage, systemChat } from './transcript.js';
import { formatDeployReport, takeDeployIntent } from '../deploy/deployIntent.js';

const MARKER = 'pending-turn.json';
/** Markers older than this are logged and dropped, not resumed — answering a
 *  question from a process that's been down for a day reads as haunted, not
 *  helpful. (Realistic restarts are back in seconds to minutes.) */
const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000;
/** A resume turn re-arms its own marker so a restart DURING the resume gets
 *  resumed too (learned live: a self-deploy fired from inside a resume turn
 *  killed it, and the chat simply went quiet). Bounded: generations 1 and
 *  2 re-arm, generation 3 runs without a net — a resume that reliably
 *  crashes the process must not ping-pong the server forever. */
const MAX_RESUME_GENERATIONS = 2;

export interface PendingTurnMarker {
  chatId: string;
  /** First 200 chars of the user prompt — context for the resume turn, and
   *  for a human reading the marker file, never the full payload. */
  promptHead: string;
  startedAt: string;
  /** How many resume attempts this marker descends from (absent = a fresh
   *  user turn; resumeInterruptedTurn re-arms with generation + 1). */
  generation?: number;
}

/** How a turn reached its `finally`. This — not a signal race — is what
 *  decides whether the breadcrumb stands down.
 *
 *  'completed': runtime.run() RESOLVED. The turn reached its own end, so
 *    whatever it was going to say, it said. Includes a deliberate
 *    /api/interrupt (the run resolves with an 'interrupted' stopReason), which
 *    is why an interrupt still clears: Ben stopping the agent on purpose is
 *    not something to resume.
 *  'aborted': runtime.run() THREW. The turn did not finish. The dominant
 *    cause in production is the process dying underneath it — pm2 tears down
 *    the whole process tree, the Claude CLI subprocess is killed, and the SDK
 *    surfaces that as a rejection. */
export type TurnOutcome = 'completed' | 'aborted';

/** Shutdown latch (2026-07-15). Kept as a second line of defence, but it is
 *  NO LONGER what protects the breadcrumb — see the 2026-08-01 note below.
 *  A stop signal still freezes clears, which helps in the one ordering it can
 *  actually observe: SIGINT arriving before the turn unwinds. */
let shuttingDown = false;
export function markShutdown(state = true): void {
  shuttingDown = state;
}

function writeMarker(dataDir: string, marker: PendingTurnMarker): void {
  try {
    writeFileSync(join(dataDir, MARKER), JSON.stringify(marker, null, 2));
  } catch (err) {
    // Never let breadcrumb bookkeeping break the actual turn.
    console.error('pendingTurn: failed to write marker —', err instanceof Error ? err.message : err);
  }
}

/** Returns the marker it wrote so the caller can later stand down exactly
 *  this breadcrumb (clearTurnInFlightIf) without clobbering a newer one. */
export function markTurnInFlight(dataDir: string, chatId: string, prompt: string): PendingTurnMarker {
  const marker: PendingTurnMarker = { chatId, promptHead: prompt.slice(0, 200), startedAt: new Date().toISOString() };
  writeMarker(dataDir, marker);
  return marker;
}

export function clearTurnInFlight(dataDir: string): void {
  if (shuttingDown) return; // see markShutdown — the breadcrumb must outlive us
  try {
    unlinkSync(join(dataDir, MARKER));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('pendingTurn: failed to clear marker —', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Clear the marker only if (a) the turn actually COMPLETED and (b) the file
 * still holds exactly `expected` — the compare-before-unlink that keeps one
 * turn's cleanup from destroying a breadcrumb some newer turn has since
 * written.
 *
 * The outcome gate is the 2026-08-01 fix. The shutdown latch alone was never
 * enough, and the reason is an ordering it cannot see: `pm2 restart` signals
 * the whole process TREE, so the Claude CLI subprocess dies too. Its death
 * rejects runtime.run(), which runs /api/chat's `finally` — and that happens
 * while the parent's own SIGINT handler is still sitting in the event queue,
 * i.e. while `shuttingDown` is still false. The dying turn then deleted the
 * exact breadcrumb the next boot needed. Evidence: every boot for weeks
 * logged "no marker — clean start", including boots that provably killed a
 * turn mid-flight (2026-08-01 23:04, a 14-minute turn with zero assistant
 * output persisted). Regression test: test/pending-turn-race.test.ts.
 *
 * Gating on the outcome removes the race instead of re-tuning it: an aborted
 * turn keeps its breadcrumb no matter which signal landed when, or whether
 * one landed at all.
 */
export function clearTurnInFlightIf(dataDir: string, expected: PendingTurnMarker, outcome: TurnOutcome): void {
  // A turn that never finished must leave its breadcrumb behind, full stop.
  // The cost of being wrong here is asymmetric: a stale marker costs one
  // redundant resume turn that the resume prompt itself tells the agent to
  // no-op ("answer only what's actually unanswered"), while a missing marker
  // costs Ben a silently dropped conversation — the failure he actually hit.
  if (outcome === 'aborted') return;
  try {
    const current = JSON.parse(readFileSync(join(dataDir, MARKER), 'utf8')) as PendingTurnMarker;
    if (
      current.chatId !== expected.chatId ||
      current.startedAt !== expected.startedAt ||
      current.generation !== expected.generation
    ) {
      return; // someone newer owns the file now — leave it be
    }
  } catch {
    return; // gone or unreadable — nothing to stand down
  }
  clearTurnInFlight(dataDir);
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
    // Legacy compat (Threads→Chat rename, 2026-07-15): a marker written by a
    // pre-rename process keys the conversation as `threadId`. The rename's own
    // deploy is exactly the case that hits this — the old code writes the
    // marker, the new code resumes from it. Accept both, normalize to chatId.
    const marker = JSON.parse(raw) as PendingTurnMarker & { threadId?: string };
    const chatId = typeof marker.chatId === 'string' && marker.chatId ? marker.chatId : marker.threadId;
    return typeof chatId === 'string' && chatId ? { ...marker, chatId } : null;
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
  /** buildMarker of THIS process — what actually came up. Lets the boot
   *  announce a self-deploy's verified outcome (deploy/deployIntent.ts). */
  liveSha?: string;
}

function resumePrompt(marker: PendingTurnMarker, deploy: string | null): string {
  return [
    `SYSTEM RESUME — the cabinet-api process restarted while you were mid-turn in this chat (turn started ${marker.startedAt}; the interrupted message began: ${JSON.stringify(marker.promptHead)}).`,
    'Whatever your previous turn streamed before the restart was preserved in the transcript; anything after it was lost, and the last user message may be effectively unanswered.',
    // When the restart was a self-deploy, the outcome has ALREADY been
    // verified and posted above by the boot path — so the agent must not
    // re-run healthz/pm2 checks to rediscover what it can simply read. That
    // re-verification is what used to eat the first minute of every resume.
    deploy
      ? `That restart was your own deploy, and its verified outcome is already posted in this chat: "${deploy}". Do not re-verify it — take it as given and say what it means for the work in one clause at most.`
      : 'If you initiated a deploy or restart yourself, verify it actually landed (healthz buildMarker, service logs) and report the result.',
    'Review the tail of this conversation, then pick the work back up: finish or re-answer whatever was left hanging.',
    'Address Ben directly as usual; briefly acknowledge the restart so the seam in the conversation is honest, then get to the point.',
  ].join('\n');
}

/**
 * Announce a self-deploy's verified outcome into `chatId`, if this boot was
 * one. Returns the posted text (for the resume prompt) or null.
 *
 * Posted as an assistant message rather than a system note on purpose: from
 * Ben's side this is Cabinet reporting back on work it chose to do, which is
 * exactly the "success message fires on its own" beat he asked for.
 */
function announceDeploy(deps: ResumeDeps, chatId: string): string | null {
  const intent = takeDeployIntent(deps.dataDir);
  if (!intent) return null;
  const text = formatDeployReport(intent, deps.liveSha ?? 'unknown');
  try {
    persistAssistantMessage(deps.db, chatId, [{ type: 'text', text }]);
    deps.db.prepare("UPDATE chat SET updated_at = datetime('now') WHERE id = ?").run(chatId);
    console.log(`deployIntent: announced in chat ${chatId} — ${text}`);
  } catch (err) {
    // Never let the announcement break the resume it precedes.
    console.error('deployIntent: failed to post report —', err instanceof Error ? err.message : err);
    return null;
  }
  return text;
}

/**
 * The boot-time half. Returns true if a resume turn actually ran. Exported
 * separately from the scheduling wrapper for tests.
 */
export async function resumeInterruptedTurn(deps: ResumeDeps): Promise<boolean> {
  const marker = takePendingTurn(deps.dataDir);
  if (!marker) {
    // Still announce a deploy that happened while nothing was in flight —
    // it just has no conversation to land in, so it goes to the deploy log.
    const intentChat = () => systemChat(deps.db, 'sys-deploy', 'user', 'Deploys');
    if (existsSync(join(deps.dataDir, 'deploy-intent.json'))) announceDeploy(deps, intentChat());
    // Deliberately logged, not silent: this is the ONLY line that
    // distinguishes "the boot-resume check ran and found nothing to do"
    // (normal — most restarts aren't mid-turn) from "the check never ran at
    // all" in the logs. Found live 2026-07-17: two self-redeploys mid-turn
    // left the chat silently unresumed for 6+ hours with zero log trace
    // either way, so this couldn't be diagnosed after the fact.
    console.log('pendingTurn: boot resume check found no marker — clean start');
    return false;
  }

  const ageMs = Date.now() - Date.parse(marker.startedAt);
  if (!Number.isFinite(ageMs) || ageMs > MAX_RESUME_AGE_MS) {
    console.log(`pendingTurn: marker for chat ${marker.chatId} too old (${marker.startedAt}), not resuming`);
    return false;
  }

  const chat = deps.db.prepare('SELECT id FROM chat WHERE id = ?').get(marker.chatId) as { id: string } | undefined;
  if (!chat) {
    console.error(`pendingTurn: marker points at unknown chat ${marker.chatId}, dropping`);
    return false;
  }

  const broadcast = (event: string) => deps.widgetBus?.emit('push', { event, data: { chatId: marker.chatId } });

  // Was this restart Cabinet's own deploy? Decided BEFORE the seam note so
  // the note can say which of the two it was — "I restarted myself to ship
  // something" reads very differently from "I crashed".
  const wasDeploy = existsSync(join(deps.dataDir, 'deploy-intent.json'));

  // Honest seam in the transcript: the reader should see *why* the reply
  // below arrives out of band. role 'system' renders as "System" in the UI.
  deps.db
    .prepare('INSERT INTO message (id, chat_id, role, parts) VALUES (?,?,?,?)')
    .run(
      randomUUID(),
      marker.chatId,
      'system',
      JSON.stringify([
        {
          type: 'text',
          text: wasDeploy
            ? 'Restarted to deploy — resuming this chat.'
            : 'Process restarted mid-turn — Cabinet is resuming this chat.',
        },
      ]),
    );
  deps.db.prepare("UPDATE chat SET updated_at = datetime('now') WHERE id = ?").run(marker.chatId);

  // The deploy result, verified against what actually booted, posted before
  // the agent says anything — so Ben sees the outcome immediately rather than
  // waiting out a whole model turn to hear whether his deploy worked.
  const deploy = announceDeploy(deps, marker.chatId);
  // chat-activity drives the open tab's re-fetch; chat-resume-start/end
  // bracket the resume for UI affordances (the conversation's status strip,
  // the chat list's "resuming" badge). Emitted as a start/end PAIR on
  // purpose: /api/events replays its ring to every fresh EventSource, so an
  // unpaired start would leave stale badges on tabs opened later — a
  // replayed pair nets out to nothing.
  broadcast('chat-activity');
  broadcast('chat-resume-start');

  // Re-arm before running: if THIS resume dies uncleanly too (learned live —
  // a self-deploy triggered from inside a resume turn SIGKILLs it), the next
  // boot resumes again, up to MAX_RESUME_GENERATIONS.
  const generation = (marker.generation ?? 0) + 1;
  const rearmed: PendingTurnMarker | null =
    generation <= MAX_RESUME_GENERATIONS
      ? { ...marker, generation, startedAt: new Date().toISOString() }
      : null;
  if (rearmed) writeMarker(deps.dataDir, rearmed);
  else console.log(`pendingTurn: generation cap reached for chat ${marker.chatId} — running this resume without a re-arm`);

  console.log(`pendingTurn: resuming interrupted turn in chat ${marker.chatId} (started ${marker.startedAt}, generation ${generation})`);
  // Live-persisting recorder (transcript.ts): the resume's own transcript
  // survives a mid-turn kill — the exact failure that erased resume #2's
  // reply the night this feature shipped.
  const recorder = createTranscriptRecorder({ db: deps.db, chatId: marker.chatId });
  let outcome: TurnOutcome = 'aborted';
  try {
    await deps.runtime.run({
      chatId: marker.chatId,
      kind: 'user',
      prompt: resumePrompt(marker, deploy),
      onEvent: recorder.onEvent,
    });
    outcome = 'completed';
  } finally {
    recorder.persist(deps.db, marker.chatId);
    deps.db.prepare("UPDATE chat SET updated_at = datetime('now') WHERE id = ?").run(marker.chatId);
    // Stand the re-arm down — but only if the file still holds OUR marker.
    // A user turn that queued behind this resume has already overwritten it
    // with its own breadcrumb (app.ts marks before the queue), and blindly
    // unlinking here would strip that turn of its crash protection.
    if (rearmed) clearTurnInFlightIf(deps.dataDir, rearmed, outcome);
    broadcast('chat-activity');
    broadcast('chat-resume-end');
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
    // Unconditional — pairs with the "no marker" log above so a silent gap
    // is diagnosable: if neither line shows up, the timer itself never fired.
    console.log('pendingTurn: boot resume check firing');
    resumeInterruptedTurn(deps).catch((err) =>
      console.error('pendingTurn: resume failed —', err instanceof Error ? err.message : err),
    );
  }, delayMs);
  timer.unref?.();
}
