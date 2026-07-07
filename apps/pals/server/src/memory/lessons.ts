import type { Embedder } from '../embeddings/index.js';
import type { EpisodicStore, LessonRow } from '../episodic/index.js';

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

export async function recallLessons(
  store: EpisodicStore,
  embedder: Embedder,
  context: string,
  k = 4,
): Promise<LessonRow[]> {
  const [vector] = await embedder.embed([context]);
  const hits = store.searchLessons(vector!, k);
  for (const h of hits) store.markLessonUsed(h.id);
  return hits;
}

export function retireLesson(store: EpisodicStore, id: number, superseded = false): void {
  store.setLessonStatus(id, superseded ? 'superseded' : 'retired');
}
