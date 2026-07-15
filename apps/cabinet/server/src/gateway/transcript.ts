import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentRuntime, TurnEvent } from '../runtime/agent.js';
import type { PromptInput } from '../runtime/prompt.js';
import type { TurnKind } from '../runtime/queue.js';
import { extractText, foldEvent, type MessagePart } from './fold.js';

/**
 * Folds a turn's events into a persisted assistant message — the same
 * pattern /api/chat always used, factored out so any caller (a user turn or
 * a cron job) gets an equally auditable transcript instead of hand-rolling
 * the fold+INSERT twice, or a cron job discarding it via onEvent: () => {}.
 * A job that git-commits memory rewrites and adds lessons must leave a
 * reviewable trace when it does something wrong, not just its side effects.
 */
/**
 * The one INSERT for an assistant-role message — every path that writes one
 * (a live turn's folded parts, or a deterministic job with no turn at all,
 * e.g. evening-checkin) goes through here instead of hand-rolling the SQL a
 * second time. No-ops on an empty parts array (nothing worth persisting).
 */
/**
 * Get-or-create a singleton system thread by a fixed id — heartbeat/cron
 * sentinels (sys-heartbeat, sys-briefing, sys-checkin, sys-weekly), and now
 * sys-deploy (deploy/pendingConfirmation.ts). `kind: 'user'` is deliberate
 * when the thread should actually surface in the normal Threads list —
 * GET /api/threads filters `WHERE kind = 'user'`; `'heartbeat'`/`'cron'`
 * threads are intentionally invisible there and instead surface through the
 * dedicated Today-surface endpoints (gateway/surfaces.ts). Moved here (out
 * of scheduler/jobs.ts, which now imports it) so a non-scheduler caller like
 * pendingConfirmation.ts doesn't have to duplicate the INSERT OR IGNORE.
 */
export function systemThread(db: Database.Database, id: string, kind: 'user' | 'heartbeat' | 'cron', title: string): string {
  db.prepare('INSERT OR IGNORE INTO thread (id, title, kind) VALUES (?,?,?)').run(id, title, kind);
  return id;
}

/**
 * Upsert, not insert-only (2026-07-15): /api/chat now calls this repeatedly
 * mid-turn — see the live-persist throttle in gateway/app.ts's `send` — so a
 * hard process kill (crash, or a self-redeploy of cabinet-api mid-turn, which
 * SIGKILLs the very process running the turn before its `finally` block can
 * run) leaves whatever was folded so far durable instead of vanishing with
 * the process. `ON CONFLICT DO UPDATE` makes every call after the first on a
 * given `opts.id` a plain overwrite of the same row rather than a duplicate
 * insert; the final call (in app.ts's `finally`) still runs and is just the
 * last, most-complete write.
 */
export function persistAssistantMessage(
  db: Database.Database,
  threadId: string,
  parts: MessagePart[],
  opts: { id?: string; usage?: unknown } = {},
): void {
  if (parts.length === 0) return;
  db.prepare(
    `INSERT INTO message (id, thread_id, role, parts, usage) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET parts = excluded.parts, usage = excluded.usage`,
  ).run(opts.id ?? randomUUID(), threadId, 'assistant', JSON.stringify(parts), opts.usage ? JSON.stringify(opts.usage) : null);
}

/** Event types that always flush a live persist (structural changes worth a
 *  write); plain text-deltas ride the time throttle instead. */
const ALWAYS_LIVE_PERSIST = new Set<TurnEvent['type']>([
  'turn-start',
  'tool-start',
  'tool-end',
  'turn-end',
  'approval',
  'notice',
  'widget',
  'error',
]);

export function createTranscriptRecorder(
  /**
   * Live-persist mid-turn (2026-07-15, generalized same day): upsert the
   * assistant row as events fold, so a hard process kill (crash, or a
   * self-redeploy SIGKILLing the very process running this turn — its
   * `finally` never runs) can't erase a turn's transcript. Learned twice:
   * first on /api/chat, then AGAIN when a resume turn's whole reply
   * vanished because only the chat route had the fix. Any turn that talks
   * to a thread should pass this; omit only when there's genuinely no
   * thread to persist to.
   */
  live?: { db: Database.Database; threadId: string; minMs?: number },
): {
  /** Live reference (mutated by onEvent) — e.g. for auto-titling off the folded text, same as /api/chat always read. */
  parts: readonly MessagePart[];
  onEvent(e: TurnEvent): void;
  /** No-ops if the turn produced no visible parts (nothing worth persisting). */
  persist(db: Database.Database, threadId: string): void;
} {
  const parts: MessagePart[] = [];
  let assistantId: string | null = null;
  let usage: unknown = null;
  let lastLivePersist = 0;
  return {
    parts,
    onEvent(e) {
      if (e.type === 'turn-start') assistantId = e.messageId;
      if (e.type === 'turn-end') usage = e.usage;
      foldEvent(parts, e);
      if (!live || !assistantId || parts.length === 0) return;
      const now = Date.now();
      if (ALWAYS_LIVE_PERSIST.has(e.type) || now - lastLivePersist >= (live.minMs ?? 800)) {
        lastLivePersist = now;
        persistAssistantMessage(live.db, live.threadId, parts, { id: assistantId });
      }
    },
    persist(db, threadId) {
      persistAssistantMessage(db, threadId, parts, { id: assistantId ?? undefined, usage });
    },
  };
}

/**
 * Persists the human-readable side of a turn (a real chat message, or a cron
 * job's prompt) so a thread reads as a real conversation. `content` is
 * usually plain text (every cron-job caller passes a string); /api/chat
 * passes a pre-built MessagePart[] instead when the turn carries image
 * attachments (image parts first, then the text part — see gateway/app.ts).
 */
export function persistUserMessage(
  db: Database.Database,
  threadId: string,
  content: string | MessagePart[],
  author: string | null = null,
): void {
  const parts: MessagePart[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  db.prepare('INSERT INTO message (id, thread_id, role, parts, author) VALUES (?,?,?,?,?)')
    .run(randomUUID(), threadId, 'user', JSON.stringify(parts), author);
}

/**
 * The choke point for scheduler/jobs.ts's agent-invoking jobs (heartbeat,
 * morning-briefing, weekly-review — NOT evening-checkin or maintenance,
 * which never call runtime.run() and have nothing to persist). Each of
 * those three jobs used to hand-wire persistUserMessage + a recorder +
 * try/finally itself; that's exactly the "someone forgot the recorder"
 * bug class waiting to happen a fourth time. One call here gets a job the
 * prompt persisted, the transcript persisted (even on a mid-run throw —
 * try/finally), and the folded text pre-joined for whatever decision the
 * job needs to make afterward (e.g. heartbeat's HEARTBEAT_OK check).
 *
 * Deliberately NOT hoisted into Scheduler: JobSpec is `{name, next, run}`,
 * intentionally agnostic to whether a job even touches the agent runtime —
 * two of the five jobs don't. Pushing thread/prompt/transcript concerns
 * into the dispatcher would leak agent-specific plumbing into a component
 * that has to stay dumb about what a job does internally.
 */
export async function runAgentCronJob(
  runtime: Pick<AgentRuntime, 'run'>,
  db: Database.Database,
  opts: { threadId: string; kind: TurnKind; prompt: string; promptInput?: Partial<PromptInput>; deep?: boolean },
): Promise<{ parts: readonly MessagePart[]; text: string }> {
  persistUserMessage(db, opts.threadId, opts.prompt);
  const recorder = createTranscriptRecorder({ db, threadId: opts.threadId });
  try {
    await runtime.run({
      threadId: opts.threadId,
      kind: opts.kind,
      deep: opts.deep,
      prompt: opts.prompt,
      promptInput: opts.promptInput,
      onEvent: recorder.onEvent,
    });
  } finally {
    recorder.persist(db, opts.threadId);
  }
  return { parts: recorder.parts, text: extractText(recorder.parts as MessagePart[]) };
}
