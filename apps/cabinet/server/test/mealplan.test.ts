import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { addRecipe } from '../src/domains/food.js';
import { listMealPlan, planMeal, removePlanEntry, updatePlanEntry } from '../src/domains/mealplan.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-mealplan-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('mealplan', () => {
  it('plans a recipe-backed meal and an ad-hoc meal', () => {
    const recipeId = addRecipe(cabinet.db, { title: 'Chili', servings: 6, kcal_per_serving: 420, protein_g: 38, carbs_g: 30, fat_g: 15 });
    const recipeEntryId = planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'dinner', recipeId, servings: 2 });
    const adHocEntryId = planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'lunch', adHocDescription: 'leftover salad' });

    expect(recipeEntryId).toBeGreaterThan(0);
    expect(adHocEntryId).toBeGreaterThan(0);
    expect(recipeEntryId).not.toBe(adHocEntryId);

    const entries = listMealPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entries).toHaveLength(2);
    const recipeEntry = entries.find((e) => e.id === recipeEntryId)!;
    expect(recipeEntry.recipe_id).toBe(recipeId);
    expect(recipeEntry.ad_hoc_description).toBeNull();
    expect(recipeEntry.servings).toBe(2);
    expect(recipeEntry.status).toBe('planned');

    const adHocEntry = entries.find((e) => e.id === adHocEntryId)!;
    expect(adHocEntry.recipe_id).toBeNull();
    expect(adHocEntry.ad_hoc_description).toBe('leftover salad');
  });

  it('rejects a both-null call — a planned meal must reference something', () => {
    expect(() => planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'breakfast' })).toThrow(
      /needs either a recipeId or an adHocDescription/,
    );
  });

  it('rejects a both-set call — exactly one of recipeId or adHocDescription', () => {
    const recipeId = addRecipe(cabinet.db, { title: 'Oats', servings: 1 });
    expect(() => planMeal(cabinet.db, { localDay: '2026-07-14', recipeId, adHocDescription: 'or maybe toast' })).toThrow(
      /exactly one of recipeId or adHocDescription/,
    );
  });

  it('listMealPlan filters to the inclusive date range and orders by day then meal slot', () => {
    const recipeId = addRecipe(cabinet.db, { title: 'Pancakes', servings: 4 });
    planMeal(cabinet.db, { localDay: '2026-07-15', meal: 'snack', adHocDescription: 'trail mix' });
    planMeal(cabinet.db, { localDay: '2026-07-15', meal: 'breakfast', recipeId });
    planMeal(cabinet.db, { localDay: '2026-07-15', meal: 'dinner', adHocDescription: 'takeout' });
    planMeal(cabinet.db, { localDay: '2026-07-15', meal: 'lunch', adHocDescription: 'sandwich' });
    // outside the queried range on either side
    planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'dinner', adHocDescription: 'out of range before' });
    planMeal(cabinet.db, { localDay: '2026-07-16', meal: 'breakfast', adHocDescription: 'out of range after' });

    const entries = listMealPlan(cabinet.db, { fromDay: '2026-07-15', toDay: '2026-07-15' });
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.meal)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);

    // joined recipe macros surface on the recipe-backed entry, and only that one
    const breakfast = entries.find((e) => e.meal === 'breakfast')!;
    expect(breakfast.recipe_title).toBe('Pancakes');
    const lunch = entries.find((e) => e.meal === 'lunch')!;
    expect(lunch.recipe_title).toBeNull();
    expect(lunch.kcal_per_serving).toBeNull();
  });

  it('a multi-day range spans days in order', () => {
    planMeal(cabinet.db, { localDay: '2026-07-20', meal: 'dinner', adHocDescription: 'day 3' });
    planMeal(cabinet.db, { localDay: '2026-07-18', meal: 'dinner', adHocDescription: 'day 1' });
    planMeal(cabinet.db, { localDay: '2026-07-19', meal: 'dinner', adHocDescription: 'day 2' });

    const entries = listMealPlan(cabinet.db, { fromDay: '2026-07-18', toDay: '2026-07-20' });
    expect(entries.map((e) => e.local_day)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20']);
    expect(entries.map((e) => e.ad_hoc_description)).toEqual(['day 1', 'day 2', 'day 3']);
  });

  it('updatePlanEntry marks an entry eaten without disturbing other fields', () => {
    const id = planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'dinner', adHocDescription: 'stir fry', servings: 1.5 });
    const { changes } = updatePlanEntry(cabinet.db, id, { status: 'eaten' });
    expect(changes).toBe(1);

    const [entry] = listMealPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entry.status).toBe('eaten');
    expect(entry.servings).toBe(1.5); // untouched
    expect(entry.ad_hoc_description).toBe('stir fry'); // untouched
  });

  it('updatePlanEntry can adjust servings and move the meal slot independently', () => {
    const id = planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'lunch', adHocDescription: 'soup' });
    updatePlanEntry(cabinet.db, id, { servings: 3 });
    updatePlanEntry(cabinet.db, id, { meal: 'dinner' });

    const [entry] = listMealPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entry.servings).toBe(3);
    expect(entry.meal).toBe('dinner');
    expect(entry.status).toBe('planned'); // untouched by either patch
  });

  it('removePlanEntry deletes the row outright', () => {
    const id = planMeal(cabinet.db, { localDay: '2026-07-14', meal: 'snack', adHocDescription: 'apple' });
    expect(listMealPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' })).toHaveLength(1);

    const { deleted } = removePlanEntry(cabinet.db, id);
    expect(deleted).toBe(true);
    expect(listMealPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' })).toHaveLength(0);

    expect(removePlanEntry(cabinet.db, id).deleted).toBe(false); // already gone
  });
});
