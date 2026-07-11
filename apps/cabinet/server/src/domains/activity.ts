import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

/**
 * Activity-plan spine (Phase D, build 1) — mirrors meal_plan_entry's shape
 * and its no-parent-entity call (migrations/007_activity_plan_entry.sql):
 * the set of `activity_plan_entry` rows over a date range IS the plan, same
 * YAGNI reasoning as Phase C's meal plan.
 *
 * `is_anchor` marks the fixed trainer sessions so future re-planning can
 * recognize and route around them — but that "never move an anchor"
 * discipline lives in the anchor-seeding/planning logic (build 2+), not
 * here. At the domain level an anchor is editable and removable like any
 * other entry; nothing in this file treats is_anchor as a write guard.
 */

export type ActivityKind = 'strength' | 'cardio' | 'mobility' | 'sport' | 'rest';
export type ActivityPlanStatus = 'planned' | 'done' | 'skipped';

export interface PlanActivityInput {
  localDay: string;
  kind: ActivityKind;
  title?: string;
  notes?: string;
  isAnchor?: boolean;
  status?: ActivityPlanStatus;
}

export interface ActivityPlanEntry {
  id: number;
  local_day: string;
  kind: ActivityKind;
  title: string | null;
  notes: string | null;
  is_anchor: number;
  status: ActivityPlanStatus;
  workout_id: number | null;
  /** joined from workout.name once workout_id is attached (updateActivityEntry); null until then. */
  workout_name: string | null;
  created_at: string;
}

/** Insert one planned activity entry. `kind='rest'` is a legitimate planned entry — an intentional recovery day is a plan, not an absence. */
export function planActivity(db: Database.Database, p: PlanActivityInput): number {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO activity_plan_entry (local_day, kind, title, notes, is_anchor, status)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(p.localDay, p.kind, p.title ?? null, p.notes ?? null, Number(p.isAnchor ?? false), p.status ?? 'planned');
  return Number(lastInsertRowid);
}

const KIND_RANK = "CASE e.kind WHEN 'strength' THEN 0 WHEN 'cardio' THEN 1 WHEN 'mobility' THEN 2 WHEN 'sport' THEN 3 WHEN 'rest' THEN 4 ELSE 5 END";

/** Entries in [fromDay, toDay] (inclusive), ordered by day then kind (strength<cardio<mobility<sport<rest), joined against workout for the linked session's name once performed. */
export function listActivityPlan(db: Database.Database, range: { fromDay: string; toDay: string }): ActivityPlanEntry[] {
  return db
    .prepare(
      `SELECT e.id, e.local_day, e.kind, e.title, e.notes, e.is_anchor, e.status, e.workout_id, e.created_at,
              w.name AS workout_name
       FROM activity_plan_entry e
       LEFT JOIN workout w ON w.id = e.workout_id
       WHERE e.local_day >= ? AND e.local_day <= ?
       ORDER BY e.local_day ASC, ${KIND_RANK} ASC, e.id ASC`,
    )
    .all(range.fromDay, range.toDay) as ActivityPlanEntry[];
}

/** Patch kind/title/notes/status/workoutId on an existing entry (mark done/skipped, attach the logged workout, adjust kind/title). COALESCE patch, same convention as updatePlanEntry — a field can be set, not explicitly unset. */
export function updateActivityEntry(
  db: Database.Database,
  id: number,
  patch: { kind?: ActivityKind; title?: string; notes?: string; status?: ActivityPlanStatus; workoutId?: number },
): { changes: number } {
  const r = db
    .prepare(
      `UPDATE activity_plan_entry
       SET kind = COALESCE(?,kind), title = COALESCE(?,title), notes = COALESCE(?,notes),
           status = COALESCE(?,status), workout_id = COALESCE(?,workout_id)
       WHERE id = ?`,
    )
    .run(patch.kind ?? null, patch.title ?? null, patch.notes ?? null, patch.status ?? null, patch.workoutId ?? null, id);
  return { changes: r.changes };
}

export function removeActivityEntry(db: Database.Database, id: number): { deleted: boolean } {
  const r = db.prepare('DELETE FROM activity_plan_entry WHERE id = ?').run(id);
  return { deleted: r.changes > 0 };
}

// ---------- rolling trainer-anchor seeding (build 2) ----------

/**
 * noon UTC on a 'YYYY-MM-DD' local_day lands on the same America/New_York
 * calendar day regardless of DST or the host process's own timezone (same
 * trick consumePlanEntry uses) — midnight UTC would NOT: converted to NY
 * (UTC-4/-5) it falls in the PREVIOUS evening, silently shifting every
 * downstream date back one day. Anchoring at noon is what keeps
 * addDaysLocal/weekdayOfLocalDay correct no matter where this process runs.
 */
function addDaysLocal(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return localDay(d);
}

/** 0=Sun..6=Sat, JS Date#getDay() convention — read via getUTCDay() off the same noon-UTC anchor, so it's host-timezone-independent. */
function weekdayOfLocalDay(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export interface SeedTrainerAnchorsResult {
  created: string[];
  alreadyPresent: string[];
}

/** Tue, Thu — JS Date#getDay() convention (Sun=0..Sat=6). Matches the fixed trainer-session routine in domains/training.md. */
const DEFAULT_ANCHOR_WEEKDAYS = [2, 4];

/**
 * Rolling, idempotent seeding of the fixed trainer-session anchors —
 * deliberately NOT a general recurrence engine. One fixed weekly pattern
 * doesn't justify that infrastructure (same YAGNI call as skipping a
 * meal_plan parent entity in Phase C). Call this periodically (e.g. from a
 * weekly job) to top up the horizon; a day that already has a strength
 * anchor is detected and skipped, never duplicated — safe to call as often
 * as you like.
 */
export function seedTrainerAnchors(
  db: Database.Database,
  opts: { fromDay?: string; weeks?: number; weekdays?: number[] } = {},
): SeedTrainerAnchorsResult {
  const fromDay = opts.fromDay ?? localDay();
  const weeks = opts.weeks ?? 4;
  const weekdays = new Set(opts.weekdays ?? DEFAULT_ANCHOR_WEEKDAYS);

  const exists = db.prepare(`SELECT id FROM activity_plan_entry WHERE local_day = ? AND is_anchor = 1 AND kind = 'strength' LIMIT 1`);

  const created: string[] = [];
  const alreadyPresent: string[] = [];
  const totalDays = weeks * 7;
  for (let i = 0; i <= totalDays; i++) {
    const day = addDaysLocal(fromDay, i);
    if (!weekdays.has(weekdayOfLocalDay(day))) continue;
    if (exists.get(day)) {
      alreadyPresent.push(day);
      continue;
    }
    planActivity(db, {
      localDay: day,
      kind: 'strength',
      title: 'Strength — trainer',
      notes: '6:30–7:30am, trainer-led',
      isAnchor: true,
      status: 'planned',
    });
    created.push(day);
  }
  return { created, alreadyPresent };
}
