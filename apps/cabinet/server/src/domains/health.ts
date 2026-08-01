import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

/**
 * Apple Health ingest.
 *
 * Nothing wrote health_daily before this (2026-08-01) — the table shipped in
 * 001_init and stayed empty, which is why plans/health.md still carries a
 * literal TBD where the daily walking budget should be. That budget is the
 * single most load-bearing unknown in the ankle plan: Ben's talus lesion means
 * steps are a dosed variable, and you cannot dose what you cannot see.
 *
 * The source is an iOS Shortcut on Ben's phone POSTing to /api/ingest/health,
 * not a HealthKit integration — Cabinet is a server and HealthKit only speaks
 * to a signed iOS app. A Shortcut is the honest 90% solution: it runs on an
 * automation trigger, needs no App Store review, and Ben can read every line
 * of what it sends.
 */

export interface HealthDay {
  local_day?: string;
  steps?: number | null;
  active_kcal?: number | null;
  resting_hr?: number | null;
  hrv_ms?: number | null;
  sleep_minutes?: number | null;
  sleep_deep_min?: number | null;
  sleep_rem_min?: number | null;
  vo2max?: number | null;
  source?: string;
}

const FIELDS = [
  'steps',
  'active_kcal',
  'resting_hr',
  'hrv_ms',
  'sleep_minutes',
  'sleep_deep_min',
  'sleep_rem_min',
  'vo2max',
] as const;

/**
 * Shortcuts is loosely typed — a health value can arrive as 4200, "4200",
 * "4,200", or "" depending on which action produced it. Anything that isn't a
 * finite number becomes null rather than NaN or 0, because a silent 0 step-day
 * would read as a rest day and quietly corrupt the ankle budget.
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Upsert one day, field-by-field.
 *
 * COALESCE(excluded, existing) rather than a straight overwrite: the Shortcut
 * is expected to fire more than once a day (sleep is only available after
 * waking, steps keep climbing until midnight), and a morning sleep-only POST
 * must not blank out yesterday's step count. Omitting a field means "no news,"
 * never "zero."
 */
export function ingestHealthDay(db: Database.Database, day: HealthDay): { local_day: string; updated: string[] } {
  const d = day.local_day ?? localDay();
  const values: Record<string, number | null> = {};
  for (const f of FIELDS) values[f] = num(day[f]);

  db.prepare(
    `INSERT INTO health_daily (local_day, steps, active_kcal, resting_hr, hrv_ms, sleep_minutes, sleep_deep_min, sleep_rem_min, vo2max, source, ingested_at)
     VALUES (@local_day, @steps, @active_kcal, @resting_hr, @hrv_ms, @sleep_minutes, @sleep_deep_min, @sleep_rem_min, @vo2max, @source, datetime('now'))
     ON CONFLICT(local_day) DO UPDATE SET
       steps          = COALESCE(excluded.steps, health_daily.steps),
       active_kcal    = COALESCE(excluded.active_kcal, health_daily.active_kcal),
       resting_hr     = COALESCE(excluded.resting_hr, health_daily.resting_hr),
       hrv_ms         = COALESCE(excluded.hrv_ms, health_daily.hrv_ms),
       sleep_minutes  = COALESCE(excluded.sleep_minutes, health_daily.sleep_minutes),
       sleep_deep_min = COALESCE(excluded.sleep_deep_min, health_daily.sleep_deep_min),
       sleep_rem_min  = COALESCE(excluded.sleep_rem_min, health_daily.sleep_rem_min),
       vo2max         = COALESCE(excluded.vo2max, health_daily.vo2max),
       source         = excluded.source,
       ingested_at    = datetime('now')`,
  ).run({ local_day: d, ...values, source: day.source ?? 'apple_health' });

  return { local_day: d, updated: FIELDS.filter((f) => values[f] !== null) };
}

export function ingestHealthDays(db: Database.Database, days: HealthDay[]): { days: number; rows: string[] } {
  const tx = db.transaction((batch: HealthDay[]) => batch.map((d) => ingestHealthDay(db, d).local_day));
  const rows = tx(days);
  return { days: rows.length, rows };
}

export interface AnkleLoad {
  local_day: string;
  steps: number | null;
  active_kcal: number | null;
  resting_hr: number | null;
  sleep_minutes: number | null;
}

/**
 * Recent days, newest last — the shape the morning brief and Sunday review
 * both want. Kept deliberately thin; correlation work belongs in the review
 * turn where the sparse-data caveat can be stated in words.
 */
export function recentHealth(db: Database.Database, days = 14): AnkleLoad[] {
  const since = localDay(new Date(Date.now() - days * 86_400_000));
  return db
    .prepare(
      `SELECT local_day, steps, active_kcal, resting_hr, sleep_minutes
       FROM health_daily WHERE local_day >= ? ORDER BY local_day`,
    )
    .all(since) as AnkleLoad[];
}
