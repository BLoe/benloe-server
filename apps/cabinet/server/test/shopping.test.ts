import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { addRecipe, updatePantry } from '../src/domains/food.js';
import { planMeal, updatePlanEntry } from '../src/domains/mealplan.js';
import { generateShoppingList, listGroceryList } from '../src/domains/shopping.js';
import { convert } from '../src/domains/units.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-shopping-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('shopping list generator', () => {
  it('sums two recipes sharing an ingredient in the SAME unit, subtracts pantry, writes the shortfall', () => {
    const breadA = addRecipe(cabinet.db, { title: 'Bread A', servings: 2, ingredients: [{ name: 'flour', quantity: 200, unit: 'g' }] });
    const breadB = addRecipe(cabinet.db, { title: 'Bread B', servings: 2, ingredients: [{ name: 'flour', quantity: 100, unit: 'g' }] });
    planMeal(cabinet.db, { localDay: '2026-07-20', meal: 'breakfast', recipeId: breadA, servings: 2 });
    planMeal(cabinet.db, { localDay: '2026-07-20', meal: 'dinner', recipeId: breadB, servings: 2 });
    updatePantry(cabinet.db, { name: 'flour', quantity: 50, unit: 'g' });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-20', toDay: '2026-07-20' });

    expect(result.needsReview).toHaveLength(0);
    const flour = result.written.find((w) => w.name === 'flour');
    expect(flour).toBeDefined();
    expect(flour!.unit).toBe('g');
    expect(flour!.quantity).toBeCloseTo(300 - 50, 6); // 200 + 100 required, 50 on hand
  });

  it('sums two recipes with the same ingredient in DIFFERENT but convertible units (cup vs ml)', () => {
    const recipeC = addRecipe(cabinet.db, { title: 'Milk Recipe C', servings: 1, ingredients: [{ name: 'milk', quantity: 1, unit: 'cup' }] });
    const recipeD = addRecipe(cabinet.db, { title: 'Milk Recipe D', servings: 1, ingredients: [{ name: 'milk', quantity: 236.588, unit: 'ml' }] });
    planMeal(cabinet.db, { localDay: '2026-07-21', meal: 'breakfast', recipeId: recipeC, servings: 1 });
    planMeal(cabinet.db, { localDay: '2026-07-21', meal: 'lunch', recipeId: recipeD, servings: 1 });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-21', toDay: '2026-07-21' });

    expect(result.needsReview).toHaveLength(0);
    const milk = result.written.find((w) => w.name === 'milk');
    expect(milk).toBeDefined();
    expect(milk!.unit).toBe('cup'); // canonical = first-seen unit (breakfast entry)
    expect(milk!.quantity).toBeCloseTo(2, 6); // 1 cup + (236.588ml == 1 cup)
  });

  it('diffs a volume requirement against mass pantry stock for a known-density ingredient', () => {
    const cake = addRecipe(cabinet.db, { title: 'Cake', servings: 1, ingredients: [{ name: 'all-purpose flour', quantity: 2, unit: 'cup' }] });
    planMeal(cabinet.db, { localDay: '2026-07-22', meal: 'dinner', recipeId: cake, servings: 1 });
    updatePantry(cabinet.db, { name: 'all-purpose flour', quantity: 100, unit: 'g' });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-22', toDay: '2026-07-22' });

    expect(result.needsReview).toHaveLength(0);
    const onHandCups = convert(100, 'g', 'cup', 'all-purpose flour');
    expect(onHandCups.ok).toBe(true);
    if (!onHandCups.ok) return;
    const flour = result.written.find((w) => w.name === 'all-purpose flour');
    expect(flour).toBeDefined();
    expect(flour!.unit).toBe('cup');
    expect(flour!.quantity).toBeCloseTo(2 - onHandCups.value, 6);
  });

  it('an ingredient with no known density hitting a volume<->mass mismatch lands in needsReview, not a guessed shortfall', () => {
    const weirdBake = addRecipe(cabinet.db, { title: 'Weird Bake', servings: 1, ingredients: [{ name: 'unobtainium', quantity: 1, unit: 'cup' }] });
    const weirdStew = addRecipe(cabinet.db, { title: 'Weird Stew', servings: 1, ingredients: [{ name: 'unobtainium', quantity: 50, unit: 'g' }] });
    planMeal(cabinet.db, { localDay: '2026-07-23', meal: 'breakfast', recipeId: weirdBake, servings: 1 });
    planMeal(cabinet.db, { localDay: '2026-07-23', meal: 'lunch', recipeId: weirdStew, servings: 1 });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-23', toDay: '2026-07-23' });

    expect(result.written.find((w) => w.name === 'unobtainium')).toBeUndefined();
    expect(result.fullyCovered.find((c) => c.name === 'unobtainium')).toBeUndefined();
    const review = result.needsReview.find((n) => n.name === 'unobtainium');
    expect(review).toBeDefined();
    expect(review!.reason).toMatch(/need density for unobtainium/);
    expect(review!.requirements).toHaveLength(2);
    expect(review!.requirements.map((r) => r.unit).sort()).toEqual(['cup', 'g']);
  });

  it('pantry fully covering a requirement lands in fullyCovered, no grocery row written', () => {
    const simple = addRecipe(cabinet.db, { title: 'Simple', servings: 1, ingredients: [{ name: 'salt', quantity: 5, unit: 'g' }] });
    planMeal(cabinet.db, { localDay: '2026-07-24', meal: 'dinner', recipeId: simple, servings: 1 });
    updatePantry(cabinet.db, { name: 'salt', quantity: 100, unit: 'g' });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-24', toDay: '2026-07-24' });

    expect(result.written.find((w) => w.name === 'salt')).toBeUndefined();
    const covered = result.fullyCovered.find((c) => c.name === 'salt');
    expect(covered).toEqual({ name: 'salt', required: 5, onHand: 100, unit: 'g' });

    const groceryRows = listGroceryList(cabinet.db).filter((r) => r.name === 'salt');
    expect(groceryRows).toHaveLength(0);
  });

  it('an ad-hoc entry in range is reported in adHocMealsSkipped and does not break the run', () => {
    const riceRecipe = addRecipe(cabinet.db, { title: 'Rice', servings: 1, ingredients: [{ name: 'rice', quantity: 1, unit: 'cup' }] });
    planMeal(cabinet.db, { localDay: '2026-07-25', meal: 'lunch', recipeId: riceRecipe, servings: 1 });
    planMeal(cabinet.db, { localDay: '2026-07-25', meal: 'dinner', adHocDescription: 'leftover pizza' });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-25', toDay: '2026-07-25' });

    expect(result.adHocMealsSkipped).toHaveLength(1);
    expect(result.adHocMealsSkipped[0]).toMatchObject({ localDay: '2026-07-25', meal: 'dinner', description: 'leftover pizza' });
    // the recipe-backed entry still processed normally alongside the ad-hoc one
    const rice = result.written.find((w) => w.name === 'rice');
    expect(rice).toBeDefined();
    expect(rice!.quantity).toBeCloseTo(1, 6);
  });

  it("'skipped' entries are excluded from requirements entirely", () => {
    const pepperRecipe = addRecipe(cabinet.db, { title: 'Peppered', servings: 1, ingredients: [{ name: 'pepper', quantity: 1, unit: 'tsp' }] });
    const entryId = planMeal(cabinet.db, { localDay: '2026-07-26', meal: 'dinner', recipeId: pepperRecipe, servings: 1 });
    updatePlanEntry(cabinet.db, entryId, { status: 'skipped' });

    const result = generateShoppingList(cabinet.db, { fromDay: '2026-07-26', toDay: '2026-07-26' });

    expect(result.written.find((w) => w.name === 'pepper')).toBeUndefined();
    expect(result.fullyCovered.find((c) => c.name === 'pepper')).toBeUndefined();
    expect(result.needsReview.find((n) => n.name === 'pepper')).toBeUndefined();
  });

  it('regeneration REPLACES prior mealplan rows and leaves manual/staple rows intact', () => {
    cabinet.db.prepare(`INSERT INTO grocery_list_item (name, quantity, unit, added_by) VALUES (?,?,?, 'manual')`).run('paper towels', 1, 'pack');
    cabinet.db.prepare(`INSERT INTO grocery_list_item (name, quantity, unit, added_by) VALUES (?,?,?, 'staple')`).run('olive oil', 1, 'bottle');

    const onion = addRecipe(cabinet.db, { title: 'Onion Soup', servings: 1, ingredients: [{ name: 'onion', quantity: 1, unit: 'each' }] });
    planMeal(cabinet.db, { localDay: '2026-07-27', meal: 'dinner', recipeId: onion, servings: 1 });

    const first = generateShoppingList(cabinet.db, { fromDay: '2026-07-27', toDay: '2026-07-27' });
    expect(first.written.find((w) => w.name === 'onion')?.quantity).toBeCloseTo(1, 6);

    let all = listGroceryList(cabinet.db);
    expect(all.filter((r) => r.added_by === 'mealplan')).toHaveLength(1);
    expect(all.find((r) => r.name === 'paper towels' && r.added_by === 'manual')).toBeDefined();
    expect(all.find((r) => r.name === 'olive oil' && r.added_by === 'staple')).toBeDefined();

    // demand doubles: a second onion-needing entry
    planMeal(cabinet.db, { localDay: '2026-07-27', meal: 'lunch', recipeId: onion, servings: 1 });
    const second = generateShoppingList(cabinet.db, { fromDay: '2026-07-27', toDay: '2026-07-27' });
    expect(second.written.find((w) => w.name === 'onion')?.quantity).toBeCloseTo(2, 6);

    all = listGroceryList(cabinet.db);
    const mealplanRows = all.filter((r) => r.added_by === 'mealplan');
    expect(mealplanRows).toHaveLength(1); // replaced, not duplicated
    expect(mealplanRows[0]!.quantity).toBeCloseTo(2, 6);
    expect(all.find((r) => r.name === 'paper towels' && r.added_by === 'manual')).toBeDefined();
    expect(all.find((r) => r.name === 'olive oil' && r.added_by === 'staple')).toBeDefined();
  });
});
