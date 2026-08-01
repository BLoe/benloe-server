import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

/**
 * Symptom log — the response variable the ankle budget was missing.
 *
 * plans/health.md doses walking against the ankle, and until tonight the only
 * ankle-adjacent data in the system was a step count: pure dose, no response.
 * You can watch the load climb for fourteen days and learn nothing about what
 * it cost. `ankleLoadResponse()` is the join that closes that loop.
 *
 * Deliberately generic. Ben's other live symptom — a 3/10 sore throat since
 * Mother's Day that he suspects tracks with smoking — has exactly the same
 * shape, and substance_log now carries nicotine with a route, so throat
 * severity beside it is a real differential instead of a memory.
 */

/** Canonical keys. Free-form strings are allowed; these are what the readouts join on. */
export const ANKLE_AM = 'ankle_ache_am';
export const ANKLE_PM = 'ankle_ache_pm';
export const THROAT = 'sore_throat';

export interface SymptomEntry {
  symptom: string;
  severity?: number | null;
  localDay?: string;
  context?: string | null;
  notes?: string | null;
}

export interface SymptomRow {
  id: number;
  local_day: string;
  symptom: string;
  severity: number | null;
  context: string | null;
  notes: string | null;
  logged_at: string;
}

/**
 * Idempotent per (day, symptom): re-reporting corrects rather than duplicates.
 * Morning and evening readings of the same joint use different keys, so this
 * never silently overwrites a real second observation.
 */
export function logSymptom(
  db: Database.Database,
  e: SymptomEntry,
): { local_day: string; symptom: string; severity: number | null } {
  const day = e.localDay ?? localDay();
  const severity = e.severity ?? null;
  db.prepare(
    `INSERT INTO symptom_log (local_day, symptom, severity, context, notes)
     VALUES (?,?,?,?,?)
     ON CONFLICT(local_day, symptom) DO UPDATE SET
       severity = excluded.severity,
       context  = COALESCE(excluded.context, symptom_log.context),
       notes    = COALESCE(excluded.notes,   symptom_log.notes),
       logged_at = datetime('now')`,
  ).run(day, e.symptom, severity, e.context ?? null, e.notes ?? null);
  return { local_day: day, symptom: e.symptom, severity };
}

export function symptomsOn(db: Database.Database, day: string = localDay()): SymptomRow[] {
  return db
    .prepare('SELECT * FROM symptom_log WHERE local_day = ? ORDER BY symptom')
    .all(day) as SymptomRow[];
}

export function symptomHistory(
  db: Database.Database,
  symptom: string,
  days = 30,
  through: string = localDay(),
): SymptomRow[] {
  const first = localDay(new Date(new Date(`${through}T12:00:00Z`).getTime() - (days - 1) * 86_400_000));
  return db
    .prepare('SELECT * FROM symptom_log WHERE symptom = ? AND local_day BETWEEN ? AND ? ORDER BY local_day')
    .all(symptom, first, through) as SymptomRow[];
}

export interface AnkleDay {
  local_day: string;
  steps: number | null;
  ache_am: number | null;
  ache_pm: number | null;
  /** Yesterday's steps — the lag that actually matters (flares follow the day after). */
  steps_prev: number | null;
}

/**
 * Ankle load vs. response, with the lag built in.
 *
 * `ache_am` is paired against the PREVIOUS day's steps on purpose. Ben's own
 * account is that the ankle aches in the evening and flares after heavy walking
 * days — so a morning reading is a verdict on yesterday's load, and joining it
 * to the same calendar day's step count would systematically mis-attribute
 * every flare by 24 hours. Evening ache (`ache_pm`) pairs with same-day steps.
 *
 * This is the row the Tuesday walk (40th → 27th, immediately before lifting)
 * gets judged on.
 */
export function ankleLoadResponse(db: Database.Database, days = 21, through: string = localDay()): AnkleDay[] {
  const end = new Date(`${through}T12:00:00Z`);
  const out: AnkleDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(new Date(end.getTime() - i * 86_400_000));
    const prev = localDay(new Date(end.getTime() - (i + 1) * 86_400_000));
    const steps = (db.prepare('SELECT steps FROM health_daily WHERE local_day = ?').get(day) as
      | { steps: number | null }
      | undefined)?.steps ?? null;
    const stepsPrev = (db.prepare('SELECT steps FROM health_daily WHERE local_day = ?').get(prev) as
      | { steps: number | null }
      | undefined)?.steps ?? null;
    const sev = (s: string) =>
      (db.prepare('SELECT severity FROM symptom_log WHERE local_day = ? AND symptom = ?').get(day, s) as
        | { severity: number | null }
        | undefined)?.severity ?? null;
    out.push({ local_day: day, steps, ache_am: sev(ANKLE_AM), ache_pm: sev(ANKLE_PM), steps_prev: stepsPrev });
  }
  return out;
}

export interface AnkleThreshold {
  n_pairs: number;
  /** Mean previous-day steps on mornings that ached above `acheCut`. */
  steps_before_flare: number | null;
  /** Mean previous-day steps on mornings at or below `acheCut`. */
  steps_before_calm: number | null;
  /** Null until there are enough pairs on both sides to mean anything. */
  read: string | null;
}

/**
 * A first pass at "how many steps can Ben spend before the ankle bills him."
 *
 * Two group means, not a regression — with a fortnight of data a regression
 * would produce a slope with a confidence interval wider than the effect, and
 * the number would get quoted anyway. Returns a null `read` until at least
 * three days sit on each side of the cut, for the same reason E1 withholds its
 * verdict: an underpowered answer that sounds precise is worse than no answer.
 */
export function ankleThreshold(
  db: Database.Database,
  days = 28,
  through: string = localDay(),
  acheCut = 3,
): AnkleThreshold {
  const rows = ankleLoadResponse(db, days, through).filter(
    (r) => r.ache_am !== null && r.steps_prev !== null,
  );
  const flare = rows.filter((r) => (r.ache_am as number) > acheCut).map((r) => r.steps_prev as number);
  const calm = rows.filter((r) => (r.ache_am as number) <= acheCut).map((r) => r.steps_prev as number);
  const mean = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  const flareMean = mean(flare);
  const calmMean = mean(calm);
  let read: string | null = null;
  if (flare.length >= 3 && calm.length >= 3 && flareMean !== null && calmMean !== null) {
    read =
      flareMean > calmMean
        ? `Mornings that ache above ${acheCut}/10 follow days averaging ${flareMean} steps; calm mornings follow ${calmMean}. Working ceiling sits between them.`
        : `No step-load signal yet: ache-above-${acheCut} mornings follow ${flareMean} steps vs ${calmMean} on calm mornings. Look for another driver (weather, session load, footwear).`;
  }

  return { n_pairs: rows.length, steps_before_flare: flareMean, steps_before_calm: calmMean, read };
}
