import type Database from 'better-sqlite3';
import { logFood, updatePantry } from './food.js';
import { convert } from './units.js';

/**
 * Meal-plan spine (Phase C, build 2) — the set of `meal_plan_entry` rows over
 * a date range IS the plan; there's no parent `meal_plan` object (see
 * migrations/006_meal_plan_entry.sql). Read-only surface + CRUD, plus
 * consumePlanEntry (build 5) — the transactional log-food + decrement-pantry
 * + mark-eaten flow. The shopping-list generator (build 4) lives in
 * domains/shopping.ts.
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

// ---------- consume: log food + decrement pantry + mark eaten, atomically ----------

export interface ConsumeDecrement {
  name: string;
  amount: number;
  unit: string;
}

export interface ConsumeNotDecremented {
  name: string;
  required: number;
  unit: string;
  reason: string;
}

export interface ConsumePlanEntryResult {
  ok: true;
  /** true when the entry was already 'eaten' — a no-op, nothing logged or decremented a second time. */
  alreadyEaten: boolean;
  foodLogId: number | null;
  /** true for an ad-hoc entry (no recipe_id) — there's no ingredient breakdown or stored macros to act on. */
  adHoc: boolean;
  decremented: ConsumeDecrement[];
  notDecremented: ConsumeNotDecremented[];
  note?: string;
}

/**
 * Consume a planned meal: log the food entry, decrement matching pantry
 * stock (unit-converted via the units module), and mark the plan entry
 * eaten — all inside ONE db.transaction(), so a failure anywhere (a bad
 * decrement, a DB error) rolls back the whole thing. The failure mode this
 * guards against is partial application: food logged but pantry untouched,
 * or vice versa, leaving macros and inventory inconsistent.
 *
 * Idempotent: calling this twice on the same entry does not double-log food
 * or double-decrement the pantry — the second call is a no-op (alreadyEaten).
 *
 * Never guesses: an ingredient with no pantry match, no recorded unit, or an
 * unconvertible unit (missing density, count-unit mismatch) is NOT silently
 * skipped or approximated — it lands in `notDecremented` with a reason, and
 * the food is still logged (the macros are known regardless of whether the
 * pantry side could be resolved).
 */
export function consumePlanEntry(db: Database.Database, entryId: number, opts?: { localDay?: string }): ConsumePlanEntryResult {
  const entry = db
    .prepare('SELECT id, local_day, meal, recipe_id, ad_hoc_description, servings, status FROM meal_plan_entry WHERE id = ?')
    .get(entryId) as
    | { id: number; local_day: string; meal: MealSlot | null; recipe_id: number | null; ad_hoc_description: string | null; servings: number; status: PlanEntryStatus }
    | undefined;
  if (!entry) {
    throw new Error(`consumePlanEntry: no meal_plan_entry with id ${entryId}`);
  }
  if (entry.status === 'eaten') {
    return { ok: true, alreadyEaten: true, foodLogId: null, adHoc: entry.recipe_id === null, decremented: [], notDecremented: [] };
  }

  // noon UTC lands on the same America/New_York calendar day regardless of
  // DST or the host process's own timezone — see localDay() in db/index.ts.
  const when = opts?.localDay ? new Date(`${opts.localDay}T12:00:00Z`) : new Date();

  if (entry.recipe_id === null) {
    // ad-hoc: no ingredient breakdown, no stored macros — never fabricate either
    const markEaten = db.transaction(() => {
      db.prepare("UPDATE meal_plan_entry SET status = 'eaten' WHERE id = ?").run(entry.id);
    });
    markEaten();
    return {
      ok: true,
      alreadyEaten: false,
      foodLogId: null,
      adHoc: true,
      decremented: [],
      notDecremented: [],
      note: 'ad-hoc planned meal marked eaten; no recipe macros or ingredients to log/decrement — log macros manually if needed',
    };
  }

  const recipe = db
    .prepare('SELECT title, servings, kcal_per_serving, protein_g, carbs_g, fat_g FROM recipe WHERE id = ?')
    .get(entry.recipe_id) as
    | { title: string; servings: number | null; kcal_per_serving: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
    | undefined;
  if (!recipe) {
    throw new Error(`consumePlanEntry: entry ${entryId} references missing recipe ${entry.recipe_id}`);
  }
  // same guard as build 4's shopping-list generator: an unrecorded yield can't scale meaningfully
  const recipeServings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
  const scale = entry.servings / recipeServings;
  const ingredients = db
    .prepare('SELECT name, quantity, unit FROM recipe_ingredient WHERE recipe_id = ? ORDER BY id ASC')
    .all(entry.recipe_id) as { name: string; quantity: number | null; unit: string | null }[];

  const decremented: ConsumeDecrement[] = [];
  const notDecremented: ConsumeNotDecremented[] = [];

  const consume = db.transaction(() => {
    const { id: foodLogId } = logFood(db, {
      description: recipe.title,
      meal: entry.meal ?? undefined,
      kcal: recipe.kcal_per_serving !== null ? recipe.kcal_per_serving * entry.servings : undefined,
      protein_g: recipe.protein_g !== null ? recipe.protein_g * entry.servings : undefined,
      carbs_g: recipe.carbs_g !== null ? recipe.carbs_g * entry.servings : undefined,
      fat_g: recipe.fat_g !== null ? recipe.fat_g * entry.servings : undefined,
      source: 'recipe',
      recipe_id: entry.recipe_id!,
      when,
    });

    for (const ing of ingredients) {
      if (ing.quantity === null || ing.unit === null) {
        notDecremented.push({ name: ing.name, required: NaN, unit: ing.unit ?? '(no unit)', reason: `no quantity/unit recorded for '${ing.name}' in recipe '${recipe.title}'` });
        continue;
      }
      const required = ing.quantity * scale;
      const pantryRow = db
        .prepare('SELECT id, name, quantity, unit FROM pantry_item WHERE lower(name) = lower(?) ORDER BY id ASC LIMIT 1')
        .get(ing.name) as { id: number; name: string; quantity: number | null; unit: string | null } | undefined;
      if (!pantryRow) {
        notDecremented.push({ name: ing.name, required, unit: ing.unit, reason: `'${ing.name}' is not in the pantry` });
        continue;
      }
      if (pantryRow.unit === null) {
        notDecremented.push({ name: ing.name, required, unit: ing.unit, reason: `pantry stock for '${ing.name}' has no recorded unit` });
        continue;
      }
      const converted = convert(required, ing.unit, pantryRow.unit, ing.name);
      if (!converted.ok) {
        notDecremented.push({ name: ing.name, required, unit: ing.unit, reason: converted.reason });
        continue;
      }
      updatePantry(db, { name: pantryRow.name, quantityDelta: -converted.value });
      decremented.push({ name: pantryRow.name, amount: converted.value, unit: pantryRow.unit });
    }

    db.prepare("UPDATE meal_plan_entry SET status = 'eaten' WHERE id = ?").run(entry.id);
    return foodLogId;
  });

  const foodLogId = consume();

  return { ok: true, alreadyEaten: false, foodLogId, adHoc: false, decremented, notDecremented };
}
