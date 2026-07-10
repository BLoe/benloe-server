import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { addRecipe, dailyTotals, updatePantry } from '../src/domains/food.js';
import { consumePlanEntry, listMealPlan, planMeal } from '../src/domains/mealplan.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-consume-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

function pantryRow(name: string): { quantity: number | null; unit: string | null } | undefined {
  return cabinet.db.prepare('SELECT quantity, unit FROM pantry_item WHERE lower(name) = lower(?)').get(name) as
    | { quantity: number | null; unit: string | null }
    | undefined;
}

describe('consumePlanEntry', () => {
  it('consumes a recipe-backed entry: scaled macros logged, pantry decremented, entry marked eaten — one consistent read', () => {
    const soup = addRecipe(cabinet.db, {
      title: 'Chicken Soup',
      servings: 2,
      kcal_per_serving: 300,
      protein_g: 25,
      carbs_g: 20,
      fat_g: 8,
      ingredients: [{ name: 'chicken', quantity: 400, unit: 'g' }],
    });
    updatePantry(cabinet.db, { name: 'chicken', quantity: 1000, unit: 'g' });
    const entryId = planMeal(cabinet.db, { localDay: '2026-07-28', meal: 'dinner', recipeId: soup, servings: 4 }); // double the recipe yield

    const result = consumePlanEntry(cabinet.db, entryId, { localDay: '2026-07-28' });

    expect(result.ok).toBe(true);
    expect(result.alreadyEaten).toBe(false);
    expect(result.adHoc).toBe(false);
    expect(result.foodLogId).not.toBeNull();
    expect(result.notDecremented).toHaveLength(0);
    expect(result.decremented).toEqual([{ name: 'chicken', amount: 800, unit: 'g' }]); // 400g/serving * (4 servings / 2 recipe servings)

    // one consistent read across all three effects
    const totals = dailyTotals(cabinet.db, '2026-07-28');
    expect(totals.kcal).toBeCloseTo(1200, 6); // 300/serving * 4 servings eaten
    expect(totals.protein_g).toBeCloseTo(100, 6);
    expect(totals.carbs_g).toBeCloseTo(80, 6);
    expect(totals.fat_g).toBeCloseTo(32, 6);

    expect(pantryRow('chicken')?.quantity).toBeCloseTo(200, 6); // 1000 - 800

    const [entry] = listMealPlan(cabinet.db, { fromDay: '2026-07-28', toDay: '2026-07-28' });
    expect(entry.status).toBe('eaten');
  });

  it('converts units on decrement: recipe ingredient in cups, pantry in grams (known density)', () => {
    const cake = addRecipe(cabinet.db, { title: 'Cake', servings: 1, ingredients: [{ name: 'all-purpose flour', quantity: 2, unit: 'cup' }] });
    updatePantry(cabinet.db, { name: 'all-purpose flour', quantity: 1000, unit: 'g' });
    const entryId = planMeal(cabinet.db, { localDay: '2026-07-29', meal: 'dinner', recipeId: cake, servings: 1 });

    const result = consumePlanEntry(cabinet.db, entryId);

    expect(result.notDecremented).toHaveLength(0);
    expect(result.decremented).toHaveLength(1);
    expect(result.decremented[0]!.name).toBe('all-purpose flour');
    expect(result.decremented[0]!.unit).toBe('g');
    expect(result.decremented[0]!.amount).toBeCloseTo(250.78, 1); // 2 cups of flour (density 0.53 g/ml) ~= 250.8g
    expect(pantryRow('all-purpose flour')?.quantity).toBeCloseTo(1000 - result.decremented[0]!.amount, 6);
  });

  it('an unconvertible unit (no density, volume vs mass) lands in notDecremented; food is still logged; that pantry row is untouched', () => {
    const stew = addRecipe(cabinet.db, { title: 'Mystery Stew', servings: 1, kcal_per_serving: 400, ingredients: [{ name: 'unobtainium', quantity: 1, unit: 'cup' }] });
    updatePantry(cabinet.db, { name: 'unobtainium', quantity: 500, unit: 'g' }); // mass on hand, volume required, no known density
    const entryId = planMeal(cabinet.db, { localDay: '2026-07-30', meal: 'dinner', recipeId: stew, servings: 1 });

    const result = consumePlanEntry(cabinet.db, entryId, { localDay: '2026-07-30' });

    expect(result.foodLogId).not.toBeNull(); // macros are known regardless of the pantry side
    expect(dailyTotals(cabinet.db, '2026-07-30').kcal).toBeCloseTo(400, 6);
    expect(result.decremented).toHaveLength(0);
    expect(result.notDecremented).toHaveLength(1);
    expect(result.notDecremented[0]!.name).toBe('unobtainium');
    expect(result.notDecremented[0]!.reason).toMatch(/need density for unobtainium/);
    expect(pantryRow('unobtainium')?.quantity).toBe(500); // untouched
  });

  it('an ingredient with no pantry row at all lands in notDecremented (reason: not in pantry) without crashing', () => {
    const toast = addRecipe(cabinet.db, { title: 'Toast', servings: 1, ingredients: [{ name: 'bread', quantity: 2, unit: 'each' }] });
    const entryId = planMeal(cabinet.db, { localDay: '2026-07-31', meal: 'breakfast', recipeId: toast, servings: 1 });

    const result = consumePlanEntry(cabinet.db, entryId);

    expect(result.foodLogId).not.toBeNull();
    expect(result.notDecremented).toEqual([{ name: 'bread', required: 2, unit: 'each', reason: "'bread' is not in the pantry" }]);
  });

  it('decrement clamps at 0 when pantry has less than required, never goes negative', () => {
    const eggs = addRecipe(cabinet.db, { title: 'Scramble', servings: 1, ingredients: [{ name: 'eggs', quantity: 3, unit: 'each' }] });
    updatePantry(cabinet.db, { name: 'eggs', quantity: 1, unit: 'each' });
    const entryId = planMeal(cabinet.db, { localDay: '2026-08-01', meal: 'breakfast', recipeId: eggs, servings: 1 });

    const result = consumePlanEntry(cabinet.db, entryId);

    expect(result.decremented).toEqual([{ name: 'eggs', amount: 3, unit: 'each' }]); // the required amount, not clamped
    expect(pantryRow('eggs')?.quantity).toBe(0); // but the pantry itself clamps at 0, never negative
  });

  it('idempotency: consuming the same entry twice does not double-log or double-decrement — second call is a no-op', () => {
    const soup = addRecipe(cabinet.db, { title: 'Soup', servings: 1, kcal_per_serving: 300, ingredients: [{ name: 'carrot', quantity: 100, unit: 'g' }] });
    updatePantry(cabinet.db, { name: 'carrot', quantity: 500, unit: 'g' });
    const entryId = planMeal(cabinet.db, { localDay: '2026-08-02', meal: 'lunch', recipeId: soup, servings: 1 });

    const first = consumePlanEntry(cabinet.db, entryId, { localDay: '2026-08-02' });
    expect(first.alreadyEaten).toBe(false);
    expect(pantryRow('carrot')?.quantity).toBe(400);

    const second = consumePlanEntry(cabinet.db, entryId, { localDay: '2026-08-02' });
    expect(second).toEqual({ ok: true, alreadyEaten: true, foodLogId: null, adHoc: false, decremented: [], notDecremented: [] });

    expect(pantryRow('carrot')?.quantity).toBe(400); // not decremented again
    expect(dailyTotals(cabinet.db, '2026-08-02').entries).toBe(1); // not logged again
  });

  it('consuming an ad-hoc entry marks it eaten with no food_log row and no decrement', () => {
    const entryId = planMeal(cabinet.db, { localDay: '2026-08-03', meal: 'lunch', adHocDescription: 'sandwich from the deli' });

    const result = consumePlanEntry(cabinet.db, entryId, { localDay: '2026-08-03' });

    expect(result).toEqual({
      ok: true,
      alreadyEaten: false,
      foodLogId: null,
      adHoc: true,
      decremented: [],
      notDecremented: [],
      note: 'ad-hoc planned meal marked eaten; no recipe macros or ingredients to log/decrement — log macros manually if needed',
    });
    expect(dailyTotals(cabinet.db, '2026-08-03').entries).toBe(0);
    const [entry] = listMealPlan(cabinet.db, { fromDay: '2026-08-03', toDay: '2026-08-03' });
    expect(entry.status).toBe('eaten');
  });

  it('throws a legible error for an unknown entry id', () => {
    expect(() => consumePlanEntry(cabinet.db, 999999)).toThrow(/no meal_plan_entry with id 999999/);
  });

  it('TRANSACTIONALITY: a decrement failing partway rolls back the food_log insert, the earlier decrement, AND the eaten flag — no partial application', () => {
    const twoIngredients = addRecipe(cabinet.db, {
      title: 'Two Ingredient Bake',
      servings: 1,
      kcal_per_serving: 500,
      ingredients: [
        { name: 'sugar', quantity: 100, unit: 'g' },
        { name: 'butter', quantity: 100, unit: 'g' },
      ],
    });
    updatePantry(cabinet.db, { name: 'sugar', quantity: 1000, unit: 'g' });
    updatePantry(cabinet.db, { name: 'butter', quantity: 1000, unit: 'g' });
    const entryId = planMeal(cabinet.db, { localDay: '2026-08-04', meal: 'dinner', recipeId: twoIngredients, servings: 1 });

    // Inject a real DB-level failure on the SECOND pantry_item UPDATE (butter's
    // decrement) — sugar's decrement succeeds first, then this throws. Proves
    // the whole db.transaction() rolls back, not just the failing statement.
    const originalPrepare = cabinet.db.prepare.bind(cabinet.db);
    let pantryUpdateCalls = 0;
    // @ts-expect-error -- deliberately shadowing the instance method to inject a fault for this one test
    cabinet.db.prepare = (sql: string) => {
      if (sql.includes('UPDATE pantry_item SET quantity')) {
        pantryUpdateCalls++;
        if (pantryUpdateCalls === 2) throw new Error('forced failure for transactionality test');
      }
      return originalPrepare(sql);
    };

    expect(() => consumePlanEntry(cabinet.db, entryId, { localDay: '2026-08-04' })).toThrow(/forced failure/);

    // restore before making further assertions
    // @ts-expect-error -- restoring the shadowed instance method
    cabinet.db.prepare = originalPrepare;

    // nothing committed: no food logged, sugar's decrement rolled back too, entry still 'planned'
    expect(dailyTotals(cabinet.db, '2026-08-04').entries).toBe(0);
    expect(pantryRow('sugar')?.quantity).toBe(1000); // NOT 900 — rolled back even though it "succeeded" first
    expect(pantryRow('butter')?.quantity).toBe(1000);
    const [entry] = listMealPlan(cabinet.db, { fromDay: '2026-08-04', toDay: '2026-08-04' });
    expect(entry.status).toBe('planned');
  });
});
