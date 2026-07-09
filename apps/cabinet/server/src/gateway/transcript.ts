import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { TurnEvent } from '../runtime/agent.js';
import { foldEvent, type MessagePart } from './fold.js';

/**
 * Folds a turn's events into a persisted assistant message — the same
 * pattern /api/chat always used, factored out so any caller (a user turn or
 * a cron job) gets an equally auditable transcript instead of hand-rolling
 * the fold+INSERT twice, or a cron job discarding it via onEvent: () => {}.
 * A job that git-commits memory rewrites and adds lessons must leave a
 * reviewable trace when it does something wrong, not just its side effects.
 */
export function createTranscriptRecorder(): {
  /** Live reference (mutated by onEvent) — e.g. for auto-titling off the folded text, same as /api/chat always read. */
  parts: readonly MessagePart[];
  onEvent(e: TurnEvent): void;
  /** No-ops if the turn produced no visible parts (nothing worth persisting). */
  persist(db: Database.Database, threadId: string): void;
} {
  const parts: MessagePart[] = [];
  let assistantId: string | null = null;
  let usage: unknown = null;
  return {
    parts,
    onEvent(e) {
      if (e.type === 'turn-start') assistantId = e.messageId;
      if (e.type === 'turn-end') usage = e.usage;
      foldEvent(parts, e);
    },
    persist(db, threadId) {
      if (parts.length === 0) return;
      db.prepare('INSERT INTO message (id, thread_id, role, parts, usage) VALUES (?,?,?,?,?)')
        .run(assistantId ?? randomUUID(), threadId, 'assistant', JSON.stringify(parts), usage ? JSON.stringify(usage) : null);
    },
  };
}

/** Persists the human-readable side of a turn (a real chat message, or a cron job's prompt) so a thread reads as a real conversation. */
export function persistUserMessage(db: Database.Database, threadId: string, text: string, author: string | null = null): void {
  db.prepare('INSERT INTO message (id, thread_id, role, parts, author) VALUES (?,?,?,?,?)')
    .run(randomUUID(), threadId, 'user', JSON.stringify([{ type: 'text', text }]), author);
}
