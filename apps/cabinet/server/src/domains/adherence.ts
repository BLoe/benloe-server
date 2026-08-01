import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

/**
 * Goal adherence — the half of Phase 0 that had no implementation.
 *
 * Seven active goals were written the night before Phase 0 began. `goal` had
 * rows, `habit_event` had a schema, and nothing in the codebase ever wrote
 * between them (verified: the only reference to habit_event outside this file
 * is the wipe script's table list). Sunday review would have computed
 * adherence from an empty table and reported zeros as if they were behavior.
 *
 * DESIGN: derive first, ask second.
 *
 * PLAYBOOK P1 is that Ben does not sustain self-generated structure, and
 * CHARTER's prime directive is to remove decisions rather than add them. A
 * system that requires Ben to tick seven boxes a day to score itself has
 * simply moved the work onto him and renamed it. So every goal that CAN be
 * computed from data he already produces IS computed — logging a weight
 * scores the weigh-in goal for free, and nobody has to remember anything.
 *
 * Only the goals that are genuinely unobservable from data (did the wind-down
 * happen, did the evening block start, was he out of the apartment) need an
 * explicit mark, and those come from the evening check-in he already gets.
 */

export interface GoalRow {
  id: number;
  title: string;
  domain: string | null;
  target_value: number | null;
  unit: string | null;
  cadence: string | null;
}

export interface AdherenceRow {
  goal_id: number;
  title: string;
  domain: string | null;
  cadence: string;
  /** How many days/occurrences the window called for. */
  expected: number;
  /** How many were actually marked or derived. */
  actual: number;
  /** actual/expected, capped at 1 — a 3-trainer week doesn't buy credit forward. */
  rate: number;
  /** Consecutive days up to and including `through`, daily goals only. */
  streak: number;
  /** True when nothing can be derived and Ben has never marked it — an unmeasured goal, not a failed one. */
  unmeasured: boolean;
  derived: boolean;
}

/**
 * Goals whose satisfaction is visible in data Ben already generates.
 *
 * Matched on a title regex rather than a hardcoded id, because goal rows get
 * rewritten between phases (Phase 1 will replace most of these) and an id
 * table would silently stop matching the day that happens — failing closed to
 * "no adherence data" while looking perfectly healthy.
 */
const DERIVERS: { match: RegExp; sql: string; label: string }[] = [
  {
    match: /weigh-?in/i,
    label: 'a weight row exists for the day',
    sql: `SELECT 1 FROM body_metric WHERE local_day = @day AND lower(metric) LIKE '%weight%' LIMIT 1`,
  },
  {
    match: /trainer/i,
    label: 'a workout naming the trainer exists',
    sql: `SELECT 1 FROM workout WHERE local_day = @day
            AND (lower(COALESCE(name,'')) LIKE '%trainer%' OR lower(COALESCE(name,'')) LIKE '%emanuel%'
                 OR lower(COALESCE(notes,'')) LIKE '%emanuel%') LIMIT 1`,
  },
  {
    // The degraded-mode floor (PLAYBOOK P9): the metric Cabinet defends is
    // days-with-ANY-signal, so literally any row in any log counts. This is
    // the goal that must never be hard to satisfy.
    match: /at least one signal|any signal/i,
    label: 'any log row exists for the day',
    sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM body_metric WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM food_log      WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM mood_log      WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM journal_entry WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM substance_log WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM workout       WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM symptom_log   WHERE local_day = @day)
             OR EXISTS (SELECT 1 FROM health_daily  WHERE local_day = @day)`,
  },
  {
    // Phase 0's own completion meter: a day counts as instrumented when the
    // three streams the phase exists to collect all produced something.
    match: /instrumentation/i,
    label: 'weight + food + (substance or health) all present',
    sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM body_metric WHERE local_day = @day AND lower(metric) LIKE '%weight%')
             AND EXISTS (SELECT 1 FROM food_log WHERE local_day = @day)
             AND (EXISTS (SELECT 1 FROM substance_log WHERE local_day = @day)
                  OR EXISTS (SELECT 1 FROM health_daily WHERE local_day = @day))`,
  },
];

function deriverFor(title: string) {
  return DERIVERS.find((d) => d.match.test(title));
}

export function activeGoals(db: Database.Database): GoalRow[] {
  return db
    .prepare('SELECT id, title, domain, target_value, unit, cadence FROM goal WHERE active = 1 ORDER BY id')
    .all() as GoalRow[];
}

/**
 * Explicit mark, for the goals no query can see. Idempotent by (goal_id,
 * local_day) — migration 017 added the unique constraint that makes it so.
 */
export function markHabit(
  db: Database.Database,
  opts: { goalId: number; localDay?: string; done?: boolean },
): { goal_id: number; local_day: string; done: boolean } {
  const day = opts.localDay ?? localDay();
  const done = opts.done === false ? 0 : 1;
  db.prepare(
    `INSERT INTO habit_event (goal_id, local_day, done) VALUES (?,?,?)
     ON CONFLICT(goal_id, local_day) DO UPDATE SET done = excluded.done`,
  ).run(opts.goalId, day, done);
  return { goal_id: opts.goalId, local_day: day, done: !!done };
}

/**
 * Run every deriver for one day and persist the results as habit_events.
 *
 * Idempotent, so it is safe to call from the nightly maintenance job, from the
 * morning brief for yesterday, and ad hoc during a review — all three happen.
 * Derived marks are written into the same table as explicit ones so that
 * everything downstream reads one uniform source.
 */
export function deriveHabits(db: Database.Database, day: string = localDay()): { day: string; marked: string[] } {
  const marked: string[] = [];
  for (const g of activeGoals(db)) {
    const d = deriverFor(g.title);
    if (!d) continue;
    const hit = db.prepare(d.sql).get({ day });
    if (hit) {
      markHabit(db, { goalId: g.id, localDay: day, done: true });
      marked.push(g.title);
    }
  }
  return { day, marked };
}

/** Back-fill derived habit marks across a window — used when a deriver is added or a log lands late. */
export function deriveHabitsRange(db: Database.Database, days = 14, through: string = localDay()): number {
  const end = new Date(`${through}T12:00:00Z`);
  let n = 0;
  for (let i = 0; i < days; i++) {
    const d = localDay(new Date(end.getTime() - i * 86_400_000));
    n += deriveHabits(db, d).marked.length;
  }
  return n;
}

function daysBack(through: string, n: number): string[] {
  const end = new Date(`${through}T12:00:00Z`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(localDay(new Date(end.getTime() - i * 86_400_000)));
  return out;
}

/**
 * Adherence over a trailing window.
 *
 * Weekly-cadence goals are scored against target_value per 7 days; daily goals
 * against one per day. `unmeasured` is reported separately from a zero rate —
 * conflating "Ben didn't do it" with "nobody wrote it down" is exactly the
 * error that would make Cabinet confidently wrong at Sunday review, and the
 * distinction is cheap to keep.
 */
export function adherence(db: Database.Database, days = 7, through: string = localDay()): AdherenceRow[] {
  // A zero/negative window would leave `first` undefined and hand SQLite a
  // null bound, silently returning nothing — a caller typo shouldn't read as
  // "no adherence." Clamp ONCE, here, so the expected-count math below uses
  // the same number the window was actually built from.
  const span = Math.max(1, Math.floor(days));
  const window = daysBack(through, span);
  const first = window[0] as string;
  const last = window[window.length - 1] as string;

  return activeGoals(db).map((g) => {
    const cadence = g.cadence ?? 'daily';

    // A 'once' goal ("14 days of Phase 0 instrumentation") is a cumulative
    // count toward a fixed target, not a rate inside a trailing window — it
    // must read ALL of its history or day 15 would report 7/14 forever.
    const cumulative = cadence === 'once';
    const rows = cumulative
      ? (db
          .prepare('SELECT local_day, done FROM habit_event WHERE goal_id = ? AND local_day <= ?')
          .all(g.id, last) as { local_day: string; done: number }[])
      : (db
          .prepare('SELECT local_day, done FROM habit_event WHERE goal_id = ? AND local_day BETWEEN ? AND ?')
          .all(g.id, first, last) as { local_day: string; done: number }[]);
    const doneDays = new Set(rows.filter((r) => r.done).map((r) => r.local_day));
    const actual = doneDays.size;

    const expected = cumulative
      ? (g.target_value ?? 1)
      : cadence === 'weekly'
        ? Math.max(1, ((g.target_value ?? 1) * span) / 7)
        : span;

    // Streaks are a daily-cadence idea. A weekly goal has no meaningful
    // consecutive-day count, and reporting one would invite reading a
    // 2×/week target as a 7-day failure.
    let streak = 0;
    if (cadence !== 'weekly') {
      for (const d of [...window].reverse()) {
        if (doneDays.has(d)) streak++;
        else break;
      }
    }

    return {
      goal_id: g.id,
      title: g.title,
      domain: g.domain,
      cadence,
      expected: Math.round(expected * 100) / 100,
      actual,
      rate: Math.min(1, expected > 0 ? actual / expected : 0),
      streak,
      unmeasured: rows.length === 0 && !deriverFor(g.title),
      derived: !!deriverFor(g.title),
    };
  });
}
