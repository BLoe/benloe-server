import type Database from 'better-sqlite3';

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
