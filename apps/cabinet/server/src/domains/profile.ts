import type Database from 'better-sqlite3';
import { isStillTemplate } from '../memory/index.js';
import { listConstraints } from './misc.js';

/** Narrow — anything with a MemoryStore-shaped `.read()`, so a test can fake it without a real MemoryStore. */
interface MemoryReadable {
  read(file: string): string;
}

const NARRATIVE_FILES = ['domains/health.md', 'domains/training.md', 'domains/nutrition.md'];

/**
 * Deterministic completeness pre-check (mirrors heartbeatFindings' SQL-only
 * shape, scheduler/jobs.ts) — mentorship Phase B: is there enough of a
 * profile to plan from? Returns a human-readable "still need: ..." string
 * when incomplete, null when complete. Cheap (a few indexed COUNT queries +
 * 3 file reads) — safe to call on every /api/chat turn; self-quieting once
 * genuinely complete, so there's no reason to ever gate this off.
 *
 * Each dimension mirrors a design decision made explicit during Phase B:
 * - goal / body_metric: at least one row, no specific title/metric required
 *   — presence is the signal, not which ones (Ben's actual goals vary).
 * - the three domains/*.md files: isStillTemplate(), the exact check the
 *   drift guard already uses — reused, not re-derived a second way.
 * - hard_constraint, BOTH kinds independently: satisfied by a real
 *   constraint row OR the confirmed-none sentinel — either counts. Once any
 *   row exists for a kind, the topic has unambiguously been asked about;
 *   requiring more (e.g. a separate "allergies specifically" sub-check)
 *   would demand a taxonomy the table was deliberately built without.
 */
export function profileGap(db: Database.Database, memory: MemoryReadable): string | null {
  const missing: string[] = [];

  const goalCount = (db.prepare('SELECT COUNT(*) AS n FROM goal WHERE active = 1').get() as { n: number }).n;
  if (goalCount === 0) missing.push('goals (target weight, protein, calories, etc. — upsert_goal)');

  const metricCount = (db.prepare('SELECT COUNT(*) AS n FROM body_metric').get() as { n: number }).n;
  if (metricCount === 0) missing.push('baseline body metrics (weight, etc. — log_body_metric)');

  for (const file of NARRATIVE_FILES) {
    let content: string;
    try {
      content = memory.read(file);
    } catch {
      missing.push(`${file} (missing entirely — update_memory)`);
      continue;
    }
    if (isStillTemplate(file, content)) missing.push(`${file} (still the seed template — update_memory)`);
  }

  if (listConstraints(db, 'dietary').length === 0) {
    missing.push('dietary constraints — real hard_constraint rows, or upsert_constraint({kind:"dietary", confirmedNone:true}) if genuinely none');
  }
  if (listConstraints(db, 'physical').length === 0) {
    missing.push('physical constraints — real hard_constraint rows, or upsert_constraint({kind:"physical", confirmedNone:true}) if genuinely none');
  }

  if (missing.length === 0) return null;
  return `Ben's profile looks incomplete — still need: ${missing.join('; ')}.`;
}
