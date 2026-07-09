import type Database from 'better-sqlite3';
import type { Embedder } from '../embeddings/index.js';
import type { EpisodicStore, LessonRow } from '../episodic/index.js';
import { logRetrieval } from '../episodic/retrieval-log.js';

export interface LessonCandidate {
  text: string;
  domain: string | null;
  evidence: string;
  confidence: number; // 0..1
}

export type LessonVerdict = { ok: true } | { ok: false; reason: string };

const MIN_CONFIDENCE = 0.6;

/**
 * Patterns that smell like an autonomy escalation. A lesson may teach facts
 * and tactics; it may never widen what the agent is allowed to do — that
 * path runs exclusively through STANDING_ORDERS.md, which only Ben edits.
 */
const ESCALATION_PATTERNS: RegExp[] = [
  /without (asking|approval|confirmation|permission)/i,
  /no longer (needs?|requires?) (approval|confirmation|permission)/i,
  /(skip|bypass|ignore|disable|remove) .{0,30}(approval|gate|tier|guardrail|permission|audit)/i,
  /auto-?approve/i,
  /standing[ _-]?orders?/i,
  /\btier\s*[0-4]\b/i,
  /(allowed|permitted|free) to (push|send|deploy|purchase|buy|execute|delete)/i,
  /treat .{0,40}as (approved|pre-?approved)/i,
];

/** The four governance requirements from §7.3: evaluated, evidenced, governed. */
export function validateLesson(candidate: LessonCandidate): LessonVerdict {
  if (!candidate.text.trim()) return { ok: false, reason: 'empty lesson text' };
  if (candidate.text.length > 500) return { ok: false, reason: 'lesson too long — lessons are single insights' };
  if (!candidate.evidence.trim()) return { ok: false, reason: 'lesson requires evidence' };
  if (!(candidate.confidence >= MIN_CONFIDENCE)) {
    return { ok: false, reason: `confidence ${candidate.confidence} below ${MIN_CONFIDENCE} — hold, do not store` };
  }
  for (const p of ESCALATION_PATTERNS) {
    if (p.test(candidate.text)) {
      return { ok: false, reason: 'lesson would expand autonomy — that requires Ben editing STANDING_ORDERS.md' };
    }
  }
  return { ok: true };
}

export async function addLesson(
  store: EpisodicStore,
  embedder: Embedder,
  candidate: LessonCandidate,
): Promise<{ id: number } | { rejected: string }> {
  const verdict = validateLesson(candidate);
  if (!verdict.ok) return { rejected: verdict.reason };
  const [vector] = await embedder.embed([candidate.text]);
  const id = store.insertLesson(candidate.text, candidate.domain, candidate.evidence, candidate.confidence, vector!);
  return { id };
}

/**
 * Relevance cutoff on sqlite-vec's L2 distance over normalized bge-small
 * vectors, chosen empirically (2026-07-09) from real recall queries against
 * the live lesson store, not guessed:
 *   - genuinely on-topic hits: 0.853, 0.860, 0.932
 *   - generic/ambiguous queries against either lesson: 1.002–1.070
 *   - a clearly unrelated topic (dinner) against either lesson: 1.105–1.130
 * There's a clean gap between the relevant cluster's ceiling (0.932) and the
 * ambiguous cluster's floor (1.002); 0.95 sits in that gap. Revisit once the
 * lesson store has more than two rows to draw the line from.
 */
export const LESSON_RELEVANCE_MAX_DISTANCE = 0.95;

/** Backstop on how many lessons get injected into a single turn, regardless of how many clear the distance cutoff. */
export const LESSON_INJECT_MAX = 3;

/**
 * Recall + filter to what's actually relevant enough to show. times_applied
 * is meant to mean "shaped a turn" — so only lessons that survive the
 * relevance cutoff (and therefore get returned/injected) are marked used;
 * a weak KNN hit that gets discarded here must not count as applied.
 *
 * `db` (cabinet.db, not episodic.db) is for retrieval_log instrumentation
 * only (§ mentorship Phase 3, item 3) — optional so a caller that doesn't
 * care about the harness (or a test with no cabinet.db in scope) can omit
 * it; both real call sites (the /api/chat auto-recall and the recall_lessons
 * MCP tool) always have one and always pass it, so this is the one hook that
 * covers both. Logs the RAW hits (before the relevance-cutoff filter below),
 * not just what got returned — a future scorer eval needs the near-misses
 * too, not only what already passed today's cutoff.
 */
export async function recallLessons(
  store: EpisodicStore,
  embedder: Embedder,
  context: string,
  k = 4,
  db?: Database.Database,
): Promise<(LessonRow & { distance: number })[]> {
  const [vector] = await embedder.embed([context]);
  const hits = store.searchLessons(vector!, k);
  if (db) {
    logRetrieval(db, {
      caller: 'recallLessons',
      queryText: context,
      k,
      results: hits.map((h) => ({ id: h.id, distance: h.distance, kind: 'lesson' })),
    });
  }
  const relevant = hits.filter((h) => h.distance <= LESSON_RELEVANCE_MAX_DISTANCE).slice(0, LESSON_INJECT_MAX);
  for (const h of relevant) store.markLessonUsed(h.id);
  return relevant;
}

export function retireLesson(store: EpisodicStore, id: number, superseded = false): void {
  store.setLessonStatus(id, superseded ? 'superseded' : 'retired');
}

/**
 * Promotion criteria (§ lessons-graduation, 2026-07-09): a conjunction, not
 * any single signal. minAgeDays is load-bearing — it's the only gate immune
 * to same-day recall bursts. Deliberately no domain requirement here: a
 * missing domain must not permanently block graduation (see
 * EpisodicStore.listPromotableLessons and the weekly-review promotion step,
 * which routes null-domain lessons by judgment instead).
 */
export const PROMOTION_MIN_CONFIDENCE = 0.75;
export const PROMOTION_MIN_TIMES_APPLIED = 3;
export const PROMOTION_MIN_AGE_DAYS = 7;

/** Lessons proven durable enough to graduate from situational recall into always-on memory (PREFERENCES.md / PLATFORM.md). */
export function promotableLessons(store: EpisodicStore): LessonRow[] {
  return store.listPromotableLessons(PROMOTION_MIN_CONFIDENCE, PROMOTION_MIN_TIMES_APPLIED, PROMOTION_MIN_AGE_DAYS);
}

/**
 * Marks a lesson graduated. Deliberately a separate action from retireLesson
 * — 'retired'/'superseded' mean "wrong or stale, discard"; 'promoted' means
 * "correct, and now permanently in the system prompt via a memory file, so
 * situational recall would be redundant." Reuses searchLessons'/
 * listPromotableLessons' existing status='active' filter as the double-
 * injection guard — no new exclusion logic needed.
 */
export function promoteLesson(store: EpisodicStore, id: number): void {
  store.setLessonStatus(id, 'promoted');
}
