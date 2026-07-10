import type Database from 'better-sqlite3';
import { convert } from './units.js';
import type { MealSlot } from './mealplan.js';

/**
 * Shopping-list generator (Phase C, build 4): meal plan requirements minus
 * pantry stock = what to buy. This is where the units module earns its
 * keep — recipes and pantry stock are routinely written in different unit
 * families (cups vs grams) for the same ingredient, and the ONLY correctness
 * rule that matters here is: never silently produce a wrong number. Every
 * convert() call (aggregating requirements across recipes, diffing against
 * pantry) is checked; a failure moves that ingredient to `needsReview`
 * instead of guessing or dropping it.
 */

const MEAL_RANK = "CASE e.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END";

export interface ShoppingListLineWritten {
  name: string;
  quantity: number;
  unit: string;
}

export interface ShoppingListLineCovered {
  name: string;
  required: number;
  onHand: number;
  unit: string;
}

export interface ShoppingListRequirement {
  quantity: number;
  unit: string;
  recipeTitle: string;
  localDay: string;
}

export interface ShoppingListNeedsReview {
  name: string;
  reason: string;
  /** raw required amounts, in their original (unconverted) units, one per recipe that calls for this ingredient */
  requirements: ShoppingListRequirement[];
  /** raw pantry on-hand amounts, in their original (unconverted) units */
  pantryOnHand: { quantity: number; unit: string }[];
}

export interface AdHocMealSkipped {
  id: number;
  localDay: string;
  meal: MealSlot | null;
  description: string;
}

export interface ShoppingListResult {
  written: ShoppingListLineWritten[];
  fullyCovered: ShoppingListLineCovered[];
  needsReview: ShoppingListNeedsReview[];
  adHocMealsSkipped: AdHocMealSkipped[];
}

interface IngredientAgg {
  displayName: string;
  canonicalUnit: string | null;
  totalQty: number;
  requirements: ShoppingListRequirement[];
  needsReview: boolean;
  reason: string | null;
}

/**
 * Reads the meal plan over [fromDay, toDay], computes total ingredient
 * requirements (scaled by entry.servings / recipe.servings), diffs against
 * pantry_item, and REPLACES the 'mealplan'-sourced rows in grocery_list_item
 * with the shortfalls (regeneration is idempotent — 'staple'/'manual' rows
 * are untouched). Returns a fully inspectable summary; nothing here is
 * silent — nothing convertible cleanly is ever dropped, and nothing
 * unconvertible is ever guessed at.
 */
export function generateShoppingList(db: Database.Database, range: { fromDay: string; toDay: string }): ShoppingListResult {
  const entries = db
    .prepare(
      `SELECT e.id, e.local_day, e.meal, e.recipe_id, e.ad_hoc_description, e.servings
       FROM meal_plan_entry e
       WHERE e.local_day >= ? AND e.local_day <= ? AND e.status != 'skipped'
       ORDER BY e.local_day ASC, ${MEAL_RANK} ASC, e.id ASC`,
    )
    .all(range.fromDay, range.toDay) as {
    id: number;
    local_day: string;
    meal: string | null;
    recipe_id: number | null;
    ad_hoc_description: string | null;
    servings: number;
  }[];

  const adHocMealsSkipped: AdHocMealSkipped[] = [];
  const agg = new Map<string, IngredientAgg>();

  const recipeStmt = db.prepare('SELECT title, servings FROM recipe WHERE id = ?');
  const ingredientsStmt = db.prepare('SELECT name, quantity, unit FROM recipe_ingredient WHERE recipe_id = ? ORDER BY id ASC');

  for (const entry of entries) {
    if (entry.recipe_id === null) {
      adHocMealsSkipped.push({
        id: entry.id,
        localDay: entry.local_day,
        meal: entry.meal as MealSlot | null,
        description: entry.ad_hoc_description ?? '',
      });
      continue;
    }
    const recipe = recipeStmt.get(entry.recipe_id) as { title: string; servings: number | null } | undefined;
    if (!recipe) continue; // dangling recipe_id shouldn't happen (FK enforced), but don't let one bad row crash the run
    // a recipe with no recorded yield can't be scaled meaningfully — assume its
    // ingredient list already represents 1 serving rather than guessing wrong
    const recipeServings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
    const scaleFactor = entry.servings / recipeServings;
    const ingredients = ingredientsStmt.all(entry.recipe_id) as { name: string; quantity: number | null; unit: string | null }[];

    for (const ing of ingredients) {
      const key = ing.name.trim().toLowerCase();
      let a = agg.get(key);
      if (!a) {
        a = { displayName: ing.name.trim(), canonicalUnit: null, totalQty: 0, requirements: [], needsReview: false, reason: null };
        agg.set(key, a);
      }
      if (ing.quantity === null || ing.unit === null) {
        a.needsReview = true;
        a.reason ??= `no quantity/unit recorded for '${ing.name}' in recipe '${recipe.title}'`;
        continue;
      }
      const qty = ing.quantity * scaleFactor;
      a.requirements.push({ quantity: qty, unit: ing.unit, recipeTitle: recipe.title, localDay: entry.local_day });
      if (a.canonicalUnit === null) {
        // first-seen requirement sets the canonical unit for this ingredient
        a.canonicalUnit = ing.unit;
        a.totalQty += qty;
        continue;
      }
      if (a.needsReview) continue; // already broken — keep collecting requirements for visibility, stop computing a total
      const converted = convert(qty, ing.unit, a.canonicalUnit, a.displayName);
      if (!converted.ok) {
        a.needsReview = true;
        a.reason = converted.reason;
        continue;
      }
      a.totalQty += converted.value;
    }
  }

  const pantryStmt = db.prepare('SELECT quantity, unit FROM pantry_item WHERE lower(name) = ? AND quantity IS NOT NULL');

  const written: ShoppingListLineWritten[] = [];
  const fullyCovered: ShoppingListLineCovered[] = [];
  const needsReview: ShoppingListNeedsReview[] = [];

  for (const [key, a] of agg) {
    const pantryRows = pantryStmt.all(key) as { quantity: number; unit: string | null }[];
    if (a.needsReview || a.canonicalUnit === null) {
      needsReview.push({
        name: a.displayName,
        reason: a.reason ?? 'unresolved requirement',
        requirements: a.requirements,
        pantryOnHand: pantryRows.map((p) => ({ quantity: p.quantity, unit: p.unit ?? '(no unit)' })),
      });
      continue;
    }
    const canonicalUnit = a.canonicalUnit;
    let onHand = 0;
    let pantryFailReason: string | null = null;
    for (const p of pantryRows) {
      if (p.unit === null) {
        pantryFailReason = `pantry stock for '${a.displayName}' has a quantity but no recorded unit`;
        break;
      }
      const converted = convert(p.quantity, p.unit, canonicalUnit, a.displayName);
      if (!converted.ok) {
        pantryFailReason = converted.reason;
        break;
      }
      onHand += converted.value;
    }
    if (pantryFailReason !== null) {
      // the diff itself (requirement vs pantry) is also a convert() call —
      // the same never-guess rule applies to the pantry side, not just aggregation
      needsReview.push({
        name: a.displayName,
        reason: pantryFailReason,
        requirements: a.requirements,
        pantryOnHand: pantryRows.map((p) => ({ quantity: p.quantity, unit: p.unit ?? '(no unit)' })),
      });
      continue;
    }
    const shortfall = Math.max(0, a.totalQty - onHand);
    if (shortfall > 0) {
      written.push({ name: a.displayName, quantity: shortfall, unit: canonicalUnit });
    } else {
      fullyCovered.push({ name: a.displayName, required: a.totalQty, onHand, unit: canonicalUnit });
    }
  }

  const commit = db.transaction(() => {
    db.prepare(`DELETE FROM grocery_list_item WHERE added_by = 'mealplan'`).run();
    const insert = db.prepare(`INSERT INTO grocery_list_item (name, quantity, unit, added_by) VALUES (?,?,?, 'mealplan')`);
    for (const w of written) insert.run(w.name, w.quantity, w.unit);
  });
  commit();

  return { written, fullyCovered, needsReview, adHocMealsSkipped };
}

export interface GroceryListItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string | null;
  checked: number;
  added_by: 'mealplan' | 'staple' | 'manual' | null;
  created_at: string;
}

export function listGroceryList(db: Database.Database): GroceryListItem[] {
  return db
    .prepare(
      `SELECT id, name, quantity, unit, aisle, checked, added_by, created_at
       FROM grocery_list_item
       ORDER BY added_by ASC, lower(name) ASC`,
    )
    .all() as GroceryListItem[];
}
