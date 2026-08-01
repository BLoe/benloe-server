import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

export type Substance = 'cannabis' | 'alcohol' | 'caffeine' | 'nicotine' | 'other';
export type Route = 'smoked' | 'vaped' | 'edible' | 'drink' | 'oral' | 'other';

export interface SubstanceEntry {
  substance: Substance;
  route?: Route;
  dose?: number;
  unit?: string;
  product?: string;
  context?: string;
  notes?: string;
  when?: Date;
}

export interface SubstanceRow extends SubstanceEntry {
  id: number;
  taken_at: string;
  local_day: string;
}

/**
 * Ben's wall-clock hour for an instant, as a float (21.5 === 9:30pm).
 *
 * Computed with Intl rather than a SQLite `datetime(x, '-4 hours')` because
 * that offset is wrong for five months of the year, and this codebase has
 * already paid once for delegating a timezone conversion to something that
 * didn't do it (see runtime/prompt.ts, 2026-08-01). Every hour-of-day
 * question in this module routes through here.
 */
const BEN_TZ = 'America/New_York';
export function localHour(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h + m / 60;
}

export function logSubstance(db: Database.Database, e: SubstanceEntry): { id: number; local_day: string } {
  const when = e.when ?? new Date();
  const day = localDay(when);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO substance_log (taken_at, local_day, substance, route, dose, unit, product, context, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      when.toISOString(),
      day,
      e.substance,
      e.route ?? null,
      e.dose ?? null,
      e.unit ?? null,
      e.product ?? null,
      e.context ?? null,
      e.notes ?? null,
    );
  return { id: Number(lastInsertRowid), local_day: day };
}

export function substanceDay(db: Database.Database, day: string = localDay()): SubstanceRow[] {
  return db
    .prepare('SELECT * FROM substance_log WHERE local_day = ? ORDER BY taken_at')
    .all(day) as SubstanceRow[];
}

export interface SubstanceNight {
  local_day: string;
  /** Total dose per substance for the day, in whatever unit each was logged. */
  cannabis_mg: number | null;
  cannabis_events: number;
  /** Hour-of-day (float, Ben-local) of the LAST cannabis event. The E2 variable. */
  cannabis_last_hour: number | null;
  /** Routes used that day, deduped — the sore-throat read. */
  cannabis_routes: string[];
  alcohol_drinks: number | null;
  nicotine_events: number;
  caffeine_mg: number | null;
  /** Hour of the last caffeine event — the other sleep confound. */
  caffeine_last_hour: number | null;
  sleep_minutes: number | null;
  /** Calories logged after 8pm — the grazing window RHYTHM/P4 are aimed at. */
  late_kcal: number;
  late_entries: number;
}

/**
 * The Phase 0 experiment read, one row per day.
 *
 * TUNING E2 asks whether shifting weed later (post-dinner, post-ops-block)
 * reduces unplanned snacking and improves sleep. That question needs three
 * things on the same row: when the last dose landed, how much was eaten in the
 * 8pm–midnight window, and how the night slept. This assembles exactly that
 * and nothing else — it is meant to be read at Sunday review and to be boring
 * enough to trust.
 *
 * Caveat worth stating out loud when quoting it: with fewer than ~10 nights
 * this is a table, not a correlation. PLATFORM.md already records the lesson
 * about manufacturing signal from sparse quantified-self rows; this function
 * hands back the raw days so that judgment stays with the reader.
 */
export function substanceNights(db: Database.Database, days = 14): SubstanceNight[] {
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceDay = localDay(since);

  const subs = db
    .prepare('SELECT * FROM substance_log WHERE local_day >= ? ORDER BY taken_at')
    .all(sinceDay) as SubstanceRow[];
  const foods = db
    .prepare('SELECT local_day, eaten_at, kcal FROM food_log WHERE local_day >= ?')
    .all(sinceDay) as { local_day: string; eaten_at: string; kcal: number | null }[];
  const sleeps = db
    .prepare('SELECT local_day, sleep_minutes FROM health_daily WHERE local_day >= ?')
    .all(sinceDay) as { local_day: string; sleep_minutes: number | null }[];

  const byDay = new Map<string, SubstanceNight>();
  const blank = (d: string): SubstanceNight => ({
    local_day: d,
    cannabis_mg: null,
    cannabis_events: 0,
    cannabis_last_hour: null,
    cannabis_routes: [],
    alcohol_drinks: null,
    nicotine_events: 0,
    caffeine_mg: null,
    caffeine_last_hour: null,
    sleep_minutes: null,
    late_kcal: 0,
    late_entries: 0,
  });
  const get = (d: string) => {
    let row = byDay.get(d);
    if (!row) byDay.set(d, (row = blank(d)));
    return row;
  };

  for (const s of subs) {
    const row = get(s.local_day);
    const hour = localHour(s.taken_at);
    if (s.substance === 'cannabis') {
      row.cannabis_events++;
      // Only mg sums meaningfully; flower logged in grams stays out of the
      // total rather than being silently added to an mg figure.
      if (s.dose != null && s.unit === 'mg') row.cannabis_mg = (row.cannabis_mg ?? 0) + s.dose;
      if (row.cannabis_last_hour == null || hour > row.cannabis_last_hour) row.cannabis_last_hour = hour;
      if (s.route && !row.cannabis_routes.includes(s.route)) row.cannabis_routes.push(s.route);
    } else if (s.substance === 'alcohol') {
      if (s.dose != null) row.alcohol_drinks = (row.alcohol_drinks ?? 0) + s.dose;
    } else if (s.substance === 'nicotine') {
      row.nicotine_events++;
    } else if (s.substance === 'caffeine') {
      if (s.dose != null && s.unit === 'mg') row.caffeine_mg = (row.caffeine_mg ?? 0) + s.dose;
      if (row.caffeine_last_hour == null || hour > row.caffeine_last_hour) row.caffeine_last_hour = hour;
    }
  }

  for (const f of foods) {
    if (localHour(f.eaten_at) < 20) continue;
    const row = get(f.local_day);
    row.late_kcal += f.kcal ?? 0;
    row.late_entries++;
  }

  for (const s of sleeps) get(s.local_day).sleep_minutes = s.sleep_minutes;

  return [...byDay.values()].sort((a, b) => a.local_day.localeCompare(b.local_day));
}
