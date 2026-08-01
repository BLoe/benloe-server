import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';
import { localHour } from './substances.js';

/**
 * Craving events — the response variable for the evening war.
 *
 * Two consumers, both of which already existed on paper and neither of which
 * had any data to read:
 *
 *   TUNING E1 — "a 3:30pm protein snack reduces late-evening craving events,"
 *   measured as craving pings + unplanned intake after 8pm on snack-days vs
 *   skip-days. That comparison is `e1Readout()` below.
 *
 *   PLAYBOOK P4 — "log the event + what worked → rank the redirects." That is
 *   `redirectRanking()`.
 *
 * Both are implemented here rather than left to be assembled by hand at Sunday
 * review, because a statistic a human has to recompute from raw rows every week
 * is a statistic that gets computed twice and then quietly dropped.
 */

export type CravingOutcome = 'held' | 'planned_snack' | 'unplanned_intake' | 'ordered_out';

export interface CravingEntry {
  occurredAt?: string;
  intensity?: number | null;
  trigger?: string | null;
  context?: string | null;
  redirect?: string | null;
  outcome?: CravingOutcome | null;
  minutesToResolve?: number | null;
  notes?: string | null;
}

export interface CravingRow {
  id: number;
  occurred_at: string;
  local_day: string;
  intensity: number | null;
  trigger: string | null;
  context: string | null;
  redirect: string | null;
  outcome: CravingOutcome | null;
  minutes_to_resolve: number | null;
  notes: string | null;
}

/** Outcomes that mean the evening plan survived. */
const GOOD_OUTCOMES: CravingOutcome[] = ['held', 'planned_snack'];

export function logCraving(
  db: Database.Database,
  e: CravingEntry,
): { id: number; local_day: string; hour: number } {
  const occurredAt = e.occurredAt ?? new Date().toISOString();
  const day = localDay(new Date(occurredAt));
  const info = db
    .prepare(
      `INSERT INTO craving_event
         (occurred_at, local_day, intensity, trigger, context, redirect, outcome, minutes_to_resolve, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      occurredAt,
      day,
      e.intensity ?? null,
      e.trigger ?? null,
      e.context ?? null,
      e.redirect ?? null,
      e.outcome ?? null,
      e.minutesToResolve ?? null,
      e.notes ?? null,
    );
  return { id: Number(info.lastInsertRowid), local_day: day, hour: localHour(occurredAt) };
}

/**
 * Close out an event whose outcome wasn't known when it was logged.
 *
 * This is the normal path, not an edge case: the craving gets logged live at
 * 9:40pm when Cabinet is running damage control and the outcome isn't known for
 * another twenty minutes. Requiring the outcome up front would mean either
 * logging nothing in the moment or guessing — and a guessed outcome poisons the
 * exact ranking the table exists to produce.
 */
export function resolveCraving(
  db: Database.Database,
  id: number,
  patch: { outcome?: CravingOutcome; redirect?: string; minutesToResolve?: number; notes?: string },
): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.outcome !== undefined) (sets.push('outcome = ?'), vals.push(patch.outcome));
  if (patch.redirect !== undefined) (sets.push('redirect = ?'), vals.push(patch.redirect));
  if (patch.minutesToResolve !== undefined)
    (sets.push('minutes_to_resolve = ?'), vals.push(patch.minutesToResolve));
  if (patch.notes !== undefined) (sets.push('notes = ?'), vals.push(patch.notes));
  if (!sets.length) return false;
  vals.push(id);
  return db.prepare(`UPDATE craving_event SET ${sets.join(', ')} WHERE id = ?`).run(...vals).changes > 0;
}

export function cravingsOn(db: Database.Database, day: string = localDay()): CravingRow[] {
  return db
    .prepare('SELECT * FROM craving_event WHERE local_day = ? ORDER BY occurred_at')
    .all(day) as CravingRow[];
}

export interface RedirectRank {
  redirect: string;
  uses: number;
  held: number;
  /** Share of uses that ended in 'held' or 'planned_snack'. */
  success_rate: number;
  avg_minutes: number | null;
  avg_intensity: number | null;
}

/**
 * P4 ranking: which concrete move actually works on Ben.
 *
 * Sorted by raw success count before rate, deliberately. A redirect used once
 * that worked once is 100% and means nothing; sorting by rate would put it
 * above a move that has held nine times out of twelve and is the one Cabinet
 * should actually reach for at 9:40pm. Small-n noise at the top of a ranking is
 * worse than useless — it's confidently wrong advice in a failure moment.
 */
export function redirectRanking(db: Database.Database, days = 30, through: string = localDay()): RedirectRank[] {
  const first = localDay(new Date(new Date(`${through}T12:00:00Z`).getTime() - (days - 1) * 86_400_000));
  const rows = db
    .prepare(
      `SELECT redirect, outcome, minutes_to_resolve, intensity FROM craving_event
        WHERE local_day BETWEEN ? AND ? AND redirect IS NOT NULL AND redirect <> ''`,
    )
    .all(first, through) as Pick<CravingRow, 'redirect' | 'outcome' | 'minutes_to_resolve' | 'intensity'>[];

  const byRedirect = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = (r.redirect as string).trim().toLowerCase();
    const list = byRedirect.get(key) ?? [];
    list.push(r);
    byRedirect.set(key, list);
  }

  const out: RedirectRank[] = [];
  for (const [redirect, list] of byRedirect) {
    const held = list.filter((r) => r.outcome && GOOD_OUTCOMES.includes(r.outcome)).length;
    const scored = list.filter((r) => r.outcome !== null).length;
    const mins = list.map((r) => r.minutes_to_resolve).filter((m): m is number => m !== null);
    const ints = list.map((r) => r.intensity).filter((i): i is number => i !== null);
    out.push({
      redirect,
      uses: list.length,
      held,
      success_rate: scored ? held / scored : 0,
      avg_minutes: mins.length ? Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) / 10 : null,
      avg_intensity: ints.length
        ? Math.round((ints.reduce((a, b) => a + b, 0) / ints.length) * 10) / 10
        : null,
    });
  }
  return out.sort((a, b) => b.held - a.held || b.success_rate - a.success_rate);
}

export interface E1Readout {
  days_analyzed: number;
  snack_days: E1Arm;
  skip_days: E1Arm;
  /** Null until BOTH arms have at least `minPerArm` days — see note below. */
  verdict: string | null;
}

export interface E1Arm {
  days: number;
  avg_cravings: number;
  avg_late_kcal: number;
  unplanned_rate: number;
}

/**
 * TUNING E1: does the 3:30pm protein snack defuse the late spike?
 *
 * A "snack day" is one with a logged food entry between 2:30pm and 5:30pm. The
 * window is wide because the 3:30 ping is a default, not a stopwatch, and a
 * 4:10pm snack is the same intervention.
 *
 * The verdict stays null until both arms have `minPerArm` days. TUNING's
 * standing rule is a one-week minimum or five observations, and a comparison
 * built on two days would produce a confident-sounding number that Cabinet
 * would then act on for a fortnight. An honest "not yet" is the correct output
 * of an underpowered experiment.
 */
export function e1Readout(
  db: Database.Database,
  days = 14,
  through: string = localDay(),
  minPerArm = 4,
): E1Readout {
  const end = new Date(`${through}T12:00:00Z`);
  const arms = { snack: [] as DayStat[], skip: [] as DayStat[] };

  for (let i = 0; i < days; i++) {
    const day = localDay(new Date(end.getTime() - i * 86_400_000));
    const stat = dayStat(db, day);
    if (!stat.hasAnyFood) continue; // an unlogged day is not evidence either way
    (stat.hadAfternoonSnack ? arms.snack : arms.skip).push(stat);
  }

  const summarize = (list: DayStat[]): E1Arm => ({
    days: list.length,
    avg_cravings: list.length ? round2(list.reduce((a, d) => a + d.cravings, 0) / list.length) : 0,
    avg_late_kcal: list.length ? Math.round(list.reduce((a, d) => a + d.lateKcal, 0) / list.length) : 0,
    unplanned_rate: list.length ? round2(list.filter((d) => d.unplanned > 0).length / list.length) : 0,
  });

  const snack = summarize(arms.snack);
  const skip = summarize(arms.skip);

  let verdict: string | null = null;
  if (snack.days >= minPerArm && skip.days >= minPerArm) {
    const dc = round2(skip.avg_cravings - snack.avg_cravings);
    const dk = Math.round(skip.avg_late_kcal - snack.avg_late_kcal);
    verdict =
      dc > 0 || dk > 0
        ? `Snack days run ${dc} fewer craving events and ${dk} fewer late kcal than skip days (n=${snack.days}/${skip.days}).`
        : `No protective effect visible: snack days run ${-dc} more craving events and ${-dk} more late kcal (n=${snack.days}/${skip.days}).`;
  }

  return { days_analyzed: snack.days + skip.days, snack_days: snack, skip_days: skip, verdict };
}

interface DayStat {
  day: string;
  hasAnyFood: boolean;
  hadAfternoonSnack: boolean;
  cravings: number;
  lateKcal: number;
  unplanned: number;
}

function dayStat(db: Database.Database, day: string): DayStat {
  const foods = db
    .prepare('SELECT eaten_at, kcal FROM food_log WHERE local_day = ?')
    .all(day) as { eaten_at: string; kcal: number | null }[];
  const cravings = db
    .prepare('SELECT outcome FROM craving_event WHERE local_day = ?')
    .all(day) as { outcome: CravingOutcome | null }[];

  let hadAfternoonSnack = false;
  let lateKcal = 0;
  for (const f of foods) {
    const h = localHour(f.eaten_at);
    if (h >= 14.5 && h <= 17.5) hadAfternoonSnack = true;
    if (h >= 20) lateKcal += f.kcal ?? 0;
  }

  return {
    day,
    hasAnyFood: foods.length > 0,
    hadAfternoonSnack,
    cravings: cravings.length,
    lateKcal,
    unplanned: cravings.filter((c) => c.outcome === 'unplanned_intake' || c.outcome === 'ordered_out').length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
