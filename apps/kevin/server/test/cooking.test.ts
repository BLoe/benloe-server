import { describe, expect, it } from 'vitest';
import cooking from '../src/domains/cooking.js';
import pantry from '../src/domains/pantry.js';
import { addDays } from '../src/domains/_pantry/names.js';
import { keywordSearch } from '../src/memory.js';
import { localDay } from '../src/time.js';
import { call, makeKevin, ok, view } from './helpers.js';

const today = localDay();
const inDays = (n: number) => addDays(today, n);

const chili = {
  title: 'Weeknight Chili',
  source: 'Mom',
  servings: 6,
  total_minutes: 50,
  difficulty: 'easy',
  ingredients: [
    { name: 'Ground beef', quantity: 1, unit: 'lb' },
    { name: 'Yellow onion', quantity: 1, note: 'diced' },
    { name: 'Garlic', quantity: 3, unit: 'clove', note: 'minced' },
    { name: 'Black beans', quantity: 2, unit: 'can' },
    { name: 'Crushed tomatoes', quantity: 1, unit: 'can' },
    { name: 'Chili powder', quantity: 2, unit: 'tbsp' },
    { name: 'Water', quantity: 1, unit: 'cup' },
    { name: 'Salt' },
  ],
  steps: [
    { text: 'Brown the beef in a Dutch oven over medium-high heat.', timer_seconds: 480 },
    { text: 'Add the onion and garlic; cook until soft.', timer_seconds: 300 },
    { text: 'Stir in the chili powder, beans, tomatoes and water.' },
    { text: 'Simmer, partly covered, stirring now and then.', timer_seconds: 1800 },
  ],
  tags: ['Weeknight', ' comfort food ', 'weeknight'],
  techniques: ['Browning', 'simmering'],
};

const risotto = {
  title: 'Mushroom Risotto',
  url: 'https://example.com/risotto',
  servings: 4,
  total_minutes: 45,
  difficulty: 'medium',
  ingredients: [
    { name: 'Arborio rice', quantity: 1.5, unit: 'cup' },
    { name: 'Mushrooms', quantity: 8, unit: 'oz' },
    { name: 'Chicken broth', quantity: 4, unit: 'cup' },
    { name: 'Parmesan', quantity: 2, unit: 'oz' },
    { name: 'Butter', quantity: 2, unit: 'tbsp' },
    { name: 'White wine', quantity: 0.5, unit: 'cup' },
  ],
  steps: [{ text: 'Warm the broth.' }, { text: 'Toast the rice in butter.', timer_seconds: 120 }, { text: 'Add broth a ladle at a time, stirring.', timer_seconds: 1200 }, { text: 'Finish with parmesan.' }],
  tags: ['italian'],
  techniques: ['risotto method', 'toasting grains'],
};

const hollandaise = {
  title: 'Eggs Benedict',
  difficulty: 'hard',
  total_minutes: 40,
  ingredients: [{ name: 'Eggs', quantity: 6 }, { name: 'Butter', quantity: 8, unit: 'tbsp' }, { name: 'English muffins', quantity: 2 }, { name: 'Lemon', quantity: 1 }],
  steps: [{ text: 'Poach the eggs.', timer_seconds: 180 }, { text: 'Whisk the hollandaise.' }],
  techniques: ['poaching', 'emulsifying'],
};

const stockPantry = (kevin: Awaited<ReturnType<typeof makeKevin>>) =>
  ok(kevin, 'pantry_update', {
    items: [
      { name: 'Ground beef', quantity: 1.5, unit: 'lb', location: 'fridge', expires_on: inDays(1) },
      { name: 'Yellow onions', quantity: 3, location: 'pantry' },
      { name: 'Garlic cloves', quantity: 10, location: 'pantry' },
      { name: 'black beans', quantity: 2, unit: 'can', location: 'pantry' },
      { name: 'Crushed tomatoes', quantity: 2, unit: 'can', location: 'pantry' },
      { name: 'Chili powder', quantity: 1, unit: 'jar', location: 'pantry' },
      { name: 'Salt', location: 'pantry' },
      { name: 'Arborio rice', quantity: 2, unit: 'lb', location: 'pantry' },
      { name: 'Butter', quantity: 1, unit: 'lb', location: 'fridge' },
      { name: 'Parmesan', quantity: 8, unit: 'oz', location: 'fridge', expires_on: inDays(30) },
      { name: 'Eggs', quantity: 12, location: 'fridge', expires_on: inDays(10) },
    ],
  });

describe('recipes', () => {
  it('saves a recipe whole, with ordered ingredients and steps, and indexes it for recall', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    const r = await ok(kevin, 'cooking_recipe_save', chili);
    expect(r).toEqual({
      id: 1, title: 'Weeknight Chili', saved: 'created', ingredient_count: 8, step_count: 4, difficulty: 'easy',
      techniques: ['browning', 'simmering'], tags: ['weeknight', 'comfort food'], rating: null, favourite: false,
    });
    const full = (await view(kevin, 'cooking/recipe', { id: '1' })).recipe;
    expect(full).toMatchObject({ id: 1, title: 'Weeknight Chili', source: 'Mom', url: null, servings: 6, total_minutes: 50, difficulty: 'easy', rating: null, favourite: false, notes: null, ingredient_count: 8, step_count: 4, times_cooked: 0, last_cooked_on: null });
    expect(full.ingredients.map((i: any) => [i.position, i.name, i.amount, i.note])).toEqual([
      [1, 'Ground beef', '1 lb', null], [2, 'Yellow onion', '1', 'diced'], [3, 'Garlic', '3 clove', 'minced'], [4, 'Black beans', '2 can', null],
      [5, 'Crushed tomatoes', '1 can', null], [6, 'Chili powder', '2 tbsp', null], [7, 'Water', '1 cup', null], [8, 'Salt', '', null],
    ]);
    expect(full.steps).toEqual([
      { position: 1, text: 'Brown the beef in a Dutch oven over medium-high heat.', timer_seconds: 480 },
      { position: 2, text: 'Add the onion and garlic; cook until soft.', timer_seconds: 300 },
      { position: 3, text: 'Stir in the chili powder, beans, tomatoes and water.', timer_seconds: null },
      { position: 4, text: 'Simmer, partly covered, stirring now and then.', timer_seconds: 1800 },
    ]);
    expect(full.log).toEqual([]);

    // Recall finds it by an ingredient and by a word in a step.
    expect(keywordSearch(kevin.db, 'crushed tomatoes', 5, ['recipe'])[0]).toMatchObject({ kind: 'recipe', ref: '1', title: 'Weeknight Chili' });
    expect(keywordSearch(kevin.db, 'dutch oven', 5, ['recipe'])).toHaveLength(1);
    // (The core also indexes the save call itself as a log event, so the recipe is one of the hits, not always the first.)
    expect((await ok(kevin, 'recall', { query: 'chili recipe from mom' })).hits).toContainEqual(expect.objectContaining({ kind: 'recipe', ref: '1' }));

    // The SQL a model writes against the schema.
    const sql = await ok(kevin, 'query', { sql: "SELECT r.title FROM cooking_recipes r WHERE EXISTS (SELECT 1 FROM json_each(r.tags) WHERE value = 'weeknight')" });
    expect(sql.rows).toEqual([{ title: 'Weeknight Chili' }]);
    expect(kevin.stableSystem).toMatch(/CREATE TABLE cooking_recipe_ingredients/);
    expect(kevin.stableSystem).toMatch(/timer_seconds INTEGER\s+-- a timer the cooking mode offers/);
  });

  it('updates only the fields passed, and replaces ingredient and step lists whole', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    const rated = await ok(kevin, 'cooking_recipe_save', { id: 1, rating: 5, favourite: true, notes: 'Double the garlic.' });
    expect(rated).toMatchObject({ saved: 'updated', rating: 5, favourite: true, ingredient_count: 8, step_count: 4, tags: ['weeknight', 'comfort food'] });

    await ok(kevin, 'cooking_recipe_save', { id: 1, title: 'Weeknight Turkey Chili', ingredients: [{ name: 'Ground turkey', quantity: 1, unit: 'lb' }, { name: 'Kidney beans', quantity: 2, unit: 'can' }], techniques: ['browning'] });
    const full = (await view(kevin, 'cooking/recipe', { id: '1' })).recipe;
    expect(full).toMatchObject({ title: 'Weeknight Turkey Chili', source: 'Mom', rating: 5, favourite: true, notes: 'Double the garlic.', techniques: ['browning'], step_count: 4 });
    expect(full.ingredients.map((i: any) => i.name)).toEqual(['Ground turkey', 'Kidney beans']);
    // The index follows the change.
    expect(keywordSearch(kevin.db, 'turkey', 5, ['recipe'])).toHaveLength(1);
    expect(keywordSearch(kevin.db, 'beef', 5, ['recipe'])).toHaveLength(1); // still in step 1's text
    expect(keywordSearch(kevin.db, 'crushed', 5, ['recipe'])).toHaveLength(0);
    // Clearing a field.
    await ok(kevin, 'cooking_recipe_save', { id: 1, rating: null, notes: null });
    expect((await view(kevin, 'cooking/recipe', { id: '1' })).recipe).toMatchObject({ rating: null, notes: null });
  });

  it('refuses a duplicate title, an unknown id and malformed input, with messages to act on', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', risotto);
    expect((await call(kevin, 'cooking_recipe_save', { title: 'weeknight chili' })).text).toBe('There is already a recipe "Weeknight Chili" (id 1). Pass id: 1 to update it, or use a different title.');
    expect((await call(kevin, 'cooking_recipe_save', { id: 12, rating: 4 })).text).toMatch(/^No recipe 12\. Recipes: .*1 Weeknight Chili/);
    expect((await call(kevin, 'cooking_recipe_save', { id: 2, title: 'Weeknight Chili' })).text).toMatch(/already called/);
    expect((await call(kevin, 'cooking_recipe_save', { ingredients: [] })).text).toBe('A new recipe needs a title.');
    for (const [input, re] of [
      [{ title: 'x', rating: 6 }, /rating/],
      [{ title: 'x', difficulty: 'expert' }, /difficulty/],
      [{ title: 'x', ingredients: [{ quantity: 1 }] }, /ingredients\.0\.name/],
      [{ title: 'x', ingredients: [{ name: 'salt', quantity: '1/2' }] }, /ingredients\.0\.quantity/],
      [{ title: 'x', steps: [{ text: 'wait', timer_seconds: 0 }] }, /timer_seconds/],
    ] as [unknown, RegExp][]) {
      const r = await call(kevin, 'cooking_recipe_save', input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(r.text).toMatch(re);
    }
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM cooking_recipes').get()).toEqual({ n: 2 });
    expect((await view(kevin, 'cooking/recipe', { id: '99' })).recipe).toBeNull();
    expect((await view(kevin, 'cooking/recipe', {})).recipe).toBeNull();
  });

  it('deletes only after Ben confirms, keeps the cook log, and drops the search entry', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_log_meal', { recipe_id: 1, rating: 4 });
    const declined = await call(kevin, 'cooking_recipe_delete', { id: 1 }, { confirm: false });
    expect(declined.ok).toBe(false);
    expect(declined.text).toBe('Ben declined to delete "Weeknight Chili". It is still saved.');
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM cooking_recipes').get()).toEqual({ n: 1 });

    expect(await ok(kevin, 'cooking_recipe_delete', { id: 1 })).toEqual({ deleted: 'Weeknight Chili', id: 1 });
    for (const t of ['cooking_recipes', 'cooking_recipe_ingredients', 'cooking_recipe_steps']) {
      expect(kevin.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    }
    expect(keywordSearch(kevin.db, 'chili', 5, ['recipe'])).toEqual([]);
    expect((await view(kevin, 'cooking/log')).entries).toMatchObject([{ dish: 'Weeknight Chili', recipe_id: null, rating: 4, techniques: ['browning', 'simmering'] }]);
    expect((await call(kevin, 'cooking_recipe_delete', { id: 1 })).text).toBe('No recipe 1. No recipes are saved yet.');
    // From the page (which shows its own dialog) the delete goes straight through.
    await ok(kevin, 'cooking_recipe_save', risotto);
    expect((await call(kevin, 'cooking_recipe_delete', { id: 2 }, { source: 'ui' })).ok).toBe(true);
  });

  it('lists and filters recipes for the page', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', { ...risotto, favourite: true });
    await ok(kevin, 'cooking_recipe_save', hollandaise);
    const titles = async (p: Record<string, string>) => (await view(kevin, 'cooking/recipes', p)).recipes.map((r: any) => r.title);
    expect(await titles({})).toEqual(['Eggs Benedict', 'Mushroom Risotto', 'Weeknight Chili']);
    expect(await titles({ tag: 'Italian' })).toEqual(['Mushroom Risotto']);
    expect(await titles({ technique: 'poaching' })).toEqual(['Eggs Benedict']);
    expect(await titles({ favourite: '1' })).toEqual(['Mushroom Risotto']);
    expect(await titles({ q: 'chili' })).toEqual(['Weeknight Chili']);
    expect(await titles({ q: 'butter' })).toEqual(['Eggs Benedict', 'Mushroom Risotto']); // by ingredient
  });
});

describe('what can I make tonight', () => {
  it('matches each recipe against the pantry, fewest missing first, flagging what is expiring', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await stockPantry(kevin);
    await ok(kevin, 'cooking_recipe_save', risotto);
    await ok(kevin, 'cooking_recipe_save', hollandaise);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', { title: 'Idea with no ingredients yet' });
    await ok(kevin, 'pantry_shopping_list_update', { add: [{ name: 'mushrooms', recipe_id: 1 }] });

    const v = await view(kevin, 'cooking/can_make');
    expect(v).toMatchObject({ today, soon_days: 3, pantry_item_count: 11 });
    expect(v.recipes.map((r: any) => [r.title, r.missing_count, r.can_make])).toEqual([
      ['Weeknight Chili', 0, true], ['Eggs Benedict', 2, false], ['Mushroom Risotto', 3, false],
    ]);
    const c = v.recipes[0];
    expect(c).toMatchObject({ id: 3, ingredient_count: 8, have_count: 8, missing: [], total_minutes: 50, difficulty: 'easy', times_cooked: 0, last_cooked_on: null });
    expect(c.uses_expiring).toEqual([{ name: 'Ground beef', expires_on: inDays(1), days_left: 1 }]);
    expect(c.have.map((h: any) => [h.name, h.match, h.pantry_name])).toEqual([
      ['Ground beef', 'exact', 'Ground beef'], ['Yellow onion', 'exact', 'Yellow onions'], ['Garlic', 'similar', 'Garlic cloves'], ['Black beans', 'exact', 'black beans'],
      ['Crushed tomatoes', 'exact', 'Crushed tomatoes'], ['Chili powder', 'exact', 'Chili powder'], ['Water', 'always_on_hand', null], ['Salt', 'exact', 'Salt'],
    ]);
    expect(c.have[0]).toEqual({
      name: 'Ground beef', amount: '1 lb', match: 'exact', pantry_item_id: 1, pantry_name: 'Ground beef', pantry_amount: '1.5 lb', location: 'fridge',
      expires_on: inDays(1), days_left: 1, expiring_soon: true,
    });
    const r = v.recipes[2];
    expect(r.missing).toEqual([
      { name: 'Mushrooms', quantity: 8, unit: 'oz', amount: '8 oz', on_shopping_list: true },
      { name: 'Chicken broth', quantity: 4, unit: 'cup', amount: '4 cup', on_shopping_list: false },
      { name: 'White wine', quantity: 0.5, unit: 'cup', amount: '0.5 cup', on_shopping_list: false },
    ]);
    // The shopping list remembers which recipe an item is for.
    expect((await view(kevin, 'pantry/shopping_list')).items[0]).toMatchObject({ name: 'mushrooms', source: 'recipe', recipe_id: 1, for_recipe: 'Mushroom Risotto' });

    expect((await view(kevin, 'cooking/can_make', { max_missing: '0' })).recipes.map((x: any) => x.title)).toEqual(['Weeknight Chili']);
    // Running out of something moves a recipe down.
    await ok(kevin, 'pantry_update', { items: [{ name: 'black beans', op: 'out' }, { name: 'ground beef', op: 'out' }] });
    const after = await view(kevin, 'cooking/can_make');
    expect(after.recipes.map((x: any) => [x.title, x.missing_count])).toEqual([['Eggs Benedict', 2], ['Weeknight Chili', 2], ['Mushroom Risotto', 3]]);
    expect(after.recipes[1].missing.map((m: any) => m.name)).toEqual(['Ground beef', 'Black beans']);
  });

  it('is answerable in SQL by joining on name_key', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await stockPantry(kevin);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', risotto);
    const r = await ok(kevin, 'query', {
      sql: `SELECT r.id, r.title, COUNT(*) AS ingredients, SUM(p.id IS NULL) AS missing, GROUP_CONCAT(CASE WHEN p.id IS NULL THEN i.name END, ', ') AS missing_names, MIN(p.expires_on) AS soonest_expiry
            FROM cooking_recipes r JOIN cooking_recipe_ingredients i ON i.recipe_id = r.id
            LEFT JOIN pantry_items p ON p.name_key = i.name_key AND p.in_stock = 1
            GROUP BY r.id ORDER BY missing, soonest_expiry IS NULL, soonest_expiry LIMIT 15`,
    });
    expect(r.rows).toEqual([
      { id: 1, title: 'Weeknight Chili', ingredients: 8, missing: 2, missing_names: 'Garlic, Water', soonest_expiry: inDays(1) },
      { id: 2, title: 'Mushroom Risotto', ingredients: 6, missing: 3, missing_names: 'Mushrooms, Chicken broth, White wine', soonest_expiry: inDays(30) },
    ]);
  });

  it('works with an empty pantry and with the pantry domain absent', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', hollandaise);
    expect((await view(kevin, 'cooking/can_make')).recipes[0]).toMatchObject({ have_count: 0, missing_count: 4, can_make: false, uses_expiring: [] });
    const alone = await makeKevin([cooking]);
    await ok(alone, 'cooking_recipe_save', chili);
    expect((await view(alone, 'cooking/can_make')).recipes[0]).toMatchObject({ have_count: 1, missing_count: 7 });
    expect((await ok(alone, 'cooking_log_meal', { dish: 'chili' })).entry.recipe_id).toBe(1);
    expect((await call(alone, 'cooking_log_meal', { dish: 'chili', deduct_recipe_ingredients: true })).text).toMatch(/pantry is not available/);
  });
});

describe('cook log', () => {
  it('"I cooked the chili tonight, 4 stars, used the last of the beans" is one call', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await stockPantry(kevin);
    await ok(kevin, 'cooking_recipe_save', chili);
    const r = await ok(kevin, 'cooking_log_meal', { dish: 'chili', rating: 4, deduct_recipe_ingredients: true, used: [{ name: 'beans', finished: true }] });
    expect(r.saved).toBe('logged');
    expect(r.entry).toEqual({ id: 1, cooked_on: today, recipe_id: 1, dish: 'Weeknight Chili', rating: 4, notes: null, techniques: ['browning', 'simmering'] });
    expect(r.times_cooked).toBe(1);
    expect(r.pantry.changed).toEqual([
      { name: 'black beans', did: 'ran_out', now: 'out of stock' },
      { name: 'Ground beef', did: 'used', now: `0.5 lb in fridge, expires ${inDays(1)}` },
      { name: 'Yellow onions', did: 'used', now: '2 in pantry' },
      { name: 'Garlic cloves', did: 'used', now: '7 in pantry' },
      { name: 'Crushed tomatoes', did: 'used', now: '1 can in pantry' },
      { name: 'Chili powder', did: 'unchanged', now: '1 jar in pantry', note: 'cannot subtract 2 tbsp from 1 jar; set what is left' },
    ]);
    expect(r.pantry.not_applied).toBeUndefined();
    // The rating lands on the recipe too; water and unmeasured salt were left alone.
    expect((await view(kevin, 'cooking/recipe', { id: '1' })).recipe).toMatchObject({ rating: 4, times_cooked: 1, last_cooked_on: today });
    expect(kevin.db.prepare("SELECT in_stock FROM pantry_items WHERE name_key = 'salt'").get()).toEqual({ in_stock: 1 });
    expect((await ok(kevin, 'query', { sql: 'SELECT name FROM pantry_items WHERE in_stock = 0' })).rows).toEqual([{ name: 'black beans' }]);
  });

  it('logs a meal with no saved recipe by name, and reports what it could not deduct', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await stockPantry(kevin);
    const r = await ok(kevin, 'cooking_log_meal', {
      dish: 'Grilled cheese', cooked_on: inDays(-1), notes: 'Too much butter.', techniques: ['Pan frying'],
      used: [{ name: 'butter', quantity: 2, unit: 'tbsp' }, { name: 'sourdough', quantity: 2 }], deduct_recipe_ingredients: true,
    });
    expect(r.entry).toEqual({ id: 1, cooked_on: inDays(-1), recipe_id: null, dish: 'Grilled cheese', rating: null, notes: 'Too much butter.', techniques: ['pan frying'] });
    expect(r.times_cooked).toBeUndefined();
    expect(r.pantry.changed).toEqual([{ name: 'Butter', did: 'unchanged', now: '1 lb in fridge', note: 'cannot subtract 2 tbsp from 1 lb; set what is left' }]);
    expect(r.pantry.not_applied).toEqual([
      { name: 'sourdough', reason: 'No "sourdough" in the pantry.' },
      { name: 'Grilled cheese', reason: 'No saved recipe matches this dish, so there were no recipe ingredients to deduct. Name what was used in `used`.' },
    ]);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM cooking_log').get()).toEqual({ n: 1 });
    // No pantry arguments, no pantry section.
    expect((await ok(kevin, 'cooking_log_meal', { dish: 'Toast' })).pantry).toBeUndefined();
  });

  it('corrects and deletes an entry, and explains bad calls', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', risotto);
    await ok(kevin, 'cooking_log_meal', { recipe_id: 1, cooked_on: inDays(-3) });
    const fixed = await ok(kevin, 'cooking_log_meal', { id: 1, rating: 5, notes: 'Best batch yet.', cooked_on: inDays(-2) });
    expect(fixed).toMatchObject({ saved: 'updated', entry: { id: 1, cooked_on: inDays(-2), recipe_id: 1, dish: 'Weeknight Chili', rating: 5, notes: 'Best batch yet.' } });
    expect((await view(kevin, 'cooking/recipe', { id: '1' })).recipe.rating).toBe(5);
    // It was actually the risotto.
    const relinked = await ok(kevin, 'cooking_log_meal', { id: 1, dish: 'risotto' });
    expect(relinked.entry).toMatchObject({ recipe_id: 2, dish: 'Mushroom Risotto', techniques: ['risotto method', 'toasting grains'], rating: 5 });

    expect((await call(kevin, 'cooking_log_meal', {})).text).toMatch(/Say what was cooked/);
    expect((await call(kevin, 'cooking_log_meal', { recipe_id: 9 })).text).toMatch(/^No recipe 9\. Recipes:/);
    expect((await call(kevin, 'cooking_log_meal', { id: 7, rating: 3 })).text).toMatch(/^No cook log entry 7\. Recent: 1 /);
    expect((await call(kevin, 'cooking_log_meal', { delete: true })).text).toMatch(/needs the id/);
    expect((await call(kevin, 'cooking_log_meal', { dish: 'x', cooked_on: 'tonight' })).text).toMatch(/cooked_on.*YYYY-MM-DD/);
    expect((await call(kevin, 'cooking_log_meal', { dish: 'x', rating: 0 })).text).toMatch(/rating/);
    expect(kevin.db.prepare('SELECT COUNT(*) AS n FROM cooking_log').get()).toEqual({ n: 1 });

    expect(await ok(kevin, 'cooking_log_meal', { id: 1, delete: true })).toEqual({ deleted: { id: 1, cooked_on: inDays(-2), dish: 'Mushroom Risotto' } });
    expect((await view(kevin, 'cooking/log')).entries).toEqual([]);
  });

  it('refreshes both pages and is offered to the model', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    const tools = kevin.tools.list().filter((t) => t.name.startsWith('cooking_'));
    expect(tools.map((t) => [t.name, t.touches])).toEqual([
      ['cooking_log_meal', ['cooking', 'pantry']], ['cooking_recipe_delete', ['cooking']], ['cooking_recipe_save', ['cooking']],
    ]);
    expect(kevin.tools.apiTools().find((t) => t.name === 'cooking_log_meal')!.input_schema).toMatchObject({ type: 'object' });
    expect((await call(kevin, 'cooking_log_meal', { dish: 'Toast' }, { source: 'ui' })).ok).toBe(true);
  });
});

describe('skills, overview and home', () => {
  it('shows which techniques Ben has practised and which saved dishes would add a new one', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', risotto);
    await ok(kevin, 'cooking_recipe_save', hollandaise);
    await ok(kevin, 'cooking_log_meal', { recipe_id: 1, cooked_on: inDays(-20) });
    await ok(kevin, 'cooking_log_meal', { recipe_id: 1, cooked_on: inDays(-6) });
    await ok(kevin, 'cooking_log_meal', { dish: 'Smash burgers', cooked_on: inDays(-4), techniques: ['browning', 'griddling'] });

    const s = await view(kevin, 'cooking/skills');
    expect(s.practised).toEqual([
      { technique: 'browning', times: 3, last_on: inDays(-4), dishes: ['Weeknight Chili', 'Smash burgers'] },
      { technique: 'simmering', times: 2, last_on: inDays(-6), dishes: ['Weeknight Chili'] },
      { technique: 'griddling', times: 1, last_on: inDays(-4), dishes: ['Smash burgers'] },
    ]);
    expect(s.untried).toEqual([
      { technique: 'emulsifying', recipes: [{ id: 3, title: 'Eggs Benedict', difficulty: 'hard', total_minutes: 40 }] },
      { technique: 'poaching', recipes: [{ id: 3, title: 'Eggs Benedict', difficulty: 'hard', total_minutes: 40 }] },
      { technique: 'risotto method', recipes: [{ id: 2, title: 'Mushroom Risotto', difficulty: 'medium', total_minutes: 45 }] },
      { technique: 'toasting grains', recipes: [{ id: 2, title: 'Mushroom Risotto', difficulty: 'medium', total_minutes: 45 }] },
    ]);
    expect(s.never_cooked).toEqual([
      { id: 3, title: 'Eggs Benedict', difficulty: 'hard', total_minutes: 40, techniques: ['poaching', 'emulsifying'], new_techniques: ['poaching', 'emulsifying'] },
      { id: 2, title: 'Mushroom Risotto', difficulty: 'medium', total_minutes: 45, techniques: ['risotto method', 'toasting grains'], new_techniques: ['risotto method', 'toasting grains'] },
    ]);
    // The same count in the SQL the schema comment suggests.
    const sql = await ok(kevin, 'query', { sql: 'SELECT value AS technique, COUNT(*) AS times FROM cooking_log, json_each(techniques) GROUP BY value ORDER BY times DESC, value' });
    expect(sql.rows).toEqual([{ technique: 'browning', times: 3 }, { technique: 'simmering', times: 2 }, { technique: 'griddling', times: 1 }]);
  });

  it('gives the page everything in one overview call', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    await stockPantry(kevin);
    await ok(kevin, 'cooking_recipe_save', risotto);
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_log_meal', { recipe_id: 2, rating: 4, cooked_on: inDays(-1) });
    const o = await view(kevin, 'cooking/overview');
    expect(Object.keys(o)).toEqual(['today', 'recipes', 'can_make_order', 'tags', 'techniques', 'recent_meals', 'meals_logged', 'skills']);
    expect(o.recipes.map((r: any) => r.title)).toEqual(['Mushroom Risotto', 'Weeknight Chili']);
    expect(o.can_make_order).toEqual([2, 1]);
    expect(o.tags).toEqual(['comfort food', 'italian', 'weeknight']);
    expect(o.techniques).toEqual(['browning', 'risotto method', 'simmering', 'toasting grains']);
    const c = o.recipes[1];
    expect(Object.keys(c)).toEqual([
      'id', 'title', 'source', 'url', 'servings', 'total_minutes', 'difficulty', 'tags', 'techniques', 'rating', 'favourite', 'notes',
      'ingredient_count', 'step_count', 'times_cooked', 'last_cooked_on', 'pantry', 'created_at', 'updated_at',
    ]);
    expect(c).toMatchObject({ rating: 4, times_cooked: 1, last_cooked_on: inDays(-1), step_count: 4 });
    expect(Object.keys(c.pantry)).toEqual(['ingredient_count', 'have_count', 'missing_count', 'can_make', 'have', 'missing', 'uses_expiring']);
    expect(c.pantry).toMatchObject({ ingredient_count: 8, have_count: 8, missing_count: 0, can_make: true });
    expect(o.recent_meals).toEqual([{ id: 1, cooked_on: inDays(-1), recipe_id: 2, dish: 'Weeknight Chili', rating: 4, notes: null, techniques: ['browning', 'simmering'] }]);
    expect(o.meals_logged).toBe(1);
    expect(o.skills.practised.map((p: any) => p.technique)).toEqual(['browning', 'simmering']);

    // The recipe screen marks each ingredient against the pantry.
    const full = (await view(kevin, 'cooking/recipe', { id: '1' })).recipe;
    expect(full.ingredients[0]).toEqual({
      position: 1, name: 'Arborio rice', quantity: 1.5, unit: 'cup', note: null, amount: '1.5 cup', in_pantry: true, match: 'exact',
      pantry_item: { id: 8, name: 'Arborio rice', amount: '2 lb', location: 'pantry', expires_on: null, days_left: null }, on_shopping_list: false,
    });
    expect(full.ingredients[1]).toMatchObject({ name: 'Mushrooms', in_pantry: false, match: null, pantry_item: null });
    const log = await view(kevin, 'cooking/log', { recipe_id: '2' });
    expect(log).toMatchObject({ total: 1, entries: [{ dish: 'Weeknight Chili' }] });
    expect((await view(kevin, 'cooking/log', { recipe_id: '1' })).entries).toEqual([]);
  });

  it('puts a card on Home only when it is useful', async () => {
    const kevin = await makeKevin([pantry, cooking]);
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [] });
    await ok(kevin, 'cooking_recipe_save', chili);
    await ok(kevin, 'cooking_recipe_save', risotto);
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [] });

    // Everything for the chili is in, and the beef goes off tomorrow.
    await stockPantry(kevin);
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [{ title: 'Cook tonight', lines: ['Weeknight Chili — uses ground beef'], link: '/cooking' }] });

    // Cooked it, not rated yet: one nudge, which a rating clears.
    await ok(kevin, 'cooking_log_meal', { dish: 'chili', cooked_on: inDays(-1), used: [{ name: 'ground beef', finished: true }] });
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [{ title: 'Rate your last meal', lines: ['Weeknight Chili — cooked yesterday'], link: '/cooking' }] });
    await ok(kevin, 'cooking_log_meal', { id: 1, rating: 5 });
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [] });
    // An old unrated meal is not worth a card.
    await ok(kevin, 'cooking_log_meal', { dish: 'Leftovers', cooked_on: inDays(-10) });
    await ok(kevin, 'cooking_log_meal', { id: 1, rating: null, cooked_on: inDays(-12) });
    expect(await view(kevin, 'cooking/home')).toEqual({ cards: [] });
  });
});
