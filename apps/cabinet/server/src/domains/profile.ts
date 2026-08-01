import type Database from 'better-sqlite3';
import { isStillTemplate } from '../memory/index.js';
import { listConstraints } from './misc.js';

/** Narrow — anything with a MemoryStore-shaped `.read()`, so a test can fake it without a real MemoryStore. */
interface MemoryReadable {
  read(file: string): string;
}

/**
 * Deterministic completeness pre-check: is there enough on file to plan from?
 * Returns a short line for the turn context when something real is missing,
 * null when Cabinet has what it needs.
 *
 * REWRITTEN 2026-08-01 with the v2 persona stack, for two reasons:
 *
 * 1. The v1 version enumerated raw fields ("still need: goals (target weight,
 *    protein, calories — upsert_goal); dietary constraints — real
 *    hard_constraint rows, or upsert_constraint({kind:"dietary"...})"). Ben
 *    then met an agent that read that list back to him as an intake form. The
 *    agent recites whatever this line says, so the line must name the OUTCOME
 *    that's missing and nothing else. Naming the tools here guarantees a form.
 *
 * 2. The v1 criteria demanded eight rolling-narrative files be non-template,
 *    which manufactured completeness pressure across money, admin, and social
 *    before those conversations had any reason to happen. Those files fill in
 *    when the topic comes up; they are not onboarding gates.
 *
 * What actually gates "can Cabinet run the plan": a health plan that Ben has
 * confirmed (plans/health.md, non-template), at least one live goal projected
 * from it, both constraint categories genuinely ASKED about (a real row or the
 * confirmed-none sentinel — an unasked category is not a completed one, the
 * one v1 rule worth keeping), and the baseline measurements the plan's math
 * needs: height and at least one body metric.
 */
export function profileGap(db: Database.Database, memory: MemoryReadable): string | null {
  const missing: string[] = [];

  let planContent: string | null = null;
  try {
    planContent = memory.read('plans/health.md');
  } catch {
    planContent = null;
  }
  if (planContent === null || isStillTemplate('plans/health.md', planContent)) {
    missing.push('no health plan Ben has actually confirmed');
  }

  const goalCount = (db.prepare('SELECT COUNT(*) AS n FROM goal WHERE active = 1').get() as { n: number }).n;
  if (goalCount === 0) missing.push('no live targets projected from the plan');

  // Height is separate from "any body metric": every calorie and TDEE number
  // in plans/health.md is computed from it, and it is the one measurement that
  // never arrives on its own from a morning weigh-in.
  const heightCount = (
    db.prepare("SELECT COUNT(*) AS n FROM body_metric WHERE metric = 'height'").get() as { n: number }
  ).n;
  const otherCount = (
    db.prepare("SELECT COUNT(*) AS n FROM body_metric WHERE metric <> 'height'").get() as { n: number }
  ).n;
  if (heightCount === 0 || otherCount === 0) missing.push('missing baseline measurements');

  const unasked: string[] = [];
  if (listConstraints(db, 'dietary').length === 0) unasked.push('dietary');
  if (listConstraints(db, 'physical').length === 0) unasked.push('physical');
  if (unasked.length > 0) missing.push(`${unasked.join(' and ')} constraints never asked about`);

  if (missing.length === 0) return null;
  // One line, outcomes only, with the register named — because whatever this
  // says is what Ben hears.
  return `Profile gap — ${missing.join('; ')}. Close these through counsel conversation, not a form; one at a time, when it fits.`;
}
