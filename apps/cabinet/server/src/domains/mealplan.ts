import type Database from 'better-sqlite3';

/**
 * Meal-plan spine (Phase C, build 2) — the set of `meal_plan_entry` rows over
 * a date range IS the plan; there's no parent `meal_plan` object (see
 * migrations/006_meal_plan_entry.sql). Read-only surface + CRUD only: the
 * shopping-list generator (build 4) and the consume→pantry-decrement flow
 * (build 5) are separate, later builds that import from here.
 */

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type PlanEntryStatus = 'planned' | 'eaten' | 'skipped';

export interface PlanMealInput {
  localDay: string;
  meal?: MealSlot;
  recipeId?: number;
  adHocDescription?: string;
  servings?: number;
}

export interface MealPlanEntry {
  id: number;
  local_day: string;
  meal: MealSlot | null;
  recipe_id: number | null;
  recipe_title: string | null;
  ad_hoc_description: string | null;
  servings: number;
  status: PlanEntryStatus;
  /** per-serving macros from the joined recipe; null for an ad-hoc entry or an unrecognized recipe_id. Multiply by `servings` for this entry's planned total. */
  kcal_per_serving: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
}

/** Insert one planned meal. Enforces recipe-XOR-adhoc at the call site (not just the DB CHECK) so the failure comes with a legible reason. */
export function planMeal(db: Database.Database, p: PlanMealInput): number {
  const hasRecipe = p.recipeId !== undefined && p.recipeId !== null;
  const hasAdHoc = p.adHocDescription !== undefined && p.adHocDescription.trim() !== '';
  if (hasRecipe && hasAdHoc) {
    throw new Error('planMeal takes exactly one of recipeId or adHocDescription, not both');
  }
  if (!hasRecipe && !hasAdHoc) {
    throw new Error('planMeal needs either a recipeId or an adHocDescription — a planned meal must reference something');
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO meal_plan_entry (local_day, meal, recipe_id, ad_hoc_description, servings, status)
       VALUES (?,?,?,?,?, 'planned')`,
    )
    .run(p.localDay, p.meal ?? null, hasRecipe ? p.recipeId : null, hasAdHoc ? p.adHocDescription!.trim() : null, p.servings ?? 1);
  return Number(lastInsertRowid);
}

const MEAL_RANK = "CASE e.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END";

/** Entries in [fromDay, toDay] (inclusive), ordered by day then meal slot (breakfast<lunch<dinner<snack), joined against recipe for title + per-serving macros. */
export function listMealPlan(db: Database.Database, range: { fromDay: string; toDay: string }): MealPlanEntry[] {
  return db
    .prepare(
      `SELECT e.id, e.local_day, e.meal, e.recipe_id, e.ad_hoc_description, e.servings, e.status, e.created_at,
              r.title AS recipe_title, r.kcal_per_serving, r.protein_g, r.carbs_g, r.fat_g
       FROM meal_plan_entry e
       LEFT JOIN recipe r ON r.id = e.recipe_id
       WHERE e.local_day >= ? AND e.local_day <= ?
       ORDER BY e.local_day ASC, ${MEAL_RANK} ASC, e.id ASC`,
    )
    .all(range.fromDay, range.toDay) as MealPlanEntry[];
}

/** Patch servings/status/meal on an existing entry (mark eaten/skipped, adjust servings, move meal slot). */
export function updatePlanEntry(
  db: Database.Database,
  id: number,
  patch: { servings?: number; status?: PlanEntryStatus; meal?: MealSlot },
): { changes: number } {
  const r = db
    .prepare('UPDATE meal_plan_entry SET servings = COALESCE(?,servings), status = COALESCE(?,status), meal = COALESCE(?,meal) WHERE id = ?')
    .run(patch.servings ?? null, patch.status ?? null, patch.meal ?? null, id);
  return { changes: r.changes };
}

export function removePlanEntry(db: Database.Database, id: number): { deleted: boolean } {
  const r = db.prepare('DELETE FROM meal_plan_entry WHERE id = ?').run(id);
  return { deleted: r.changes > 0 };
}
