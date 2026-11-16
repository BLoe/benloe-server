import { describe, expect, it } from 'vitest';
import {
  blankIngredient, blankStep, clock, draftOfRecipe, filterRecipes, labelsOf, minutesLabel, missingToAdd, moveRow, parseTimer, recipeInput, recipeMeta,
  timerLabel, timerText, tonightList, type PantryFit, type RecipeFull, type RecipeSummary,
} from './logic';
import { activeKeys, anyRunning, extend, newTimer, pause, remaining, reset, start, tick, tickAll } from './timers';

const fit = (over: Partial<PantryFit> = {}): PantryFit => ({ ingredient_count: 2, have_count: 2, missing_count: 0, can_make: true, have: [], missing: [], uses_expiring: [], ...over });
const recipe = (over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: 1, title: 'Weeknight chili', source: null, url: null, servings: 4, total_minutes: 45, difficulty: 'easy', tags: ['weeknight'], techniques: ['simmering'],
  rating: null, favourite: false, notes: null, ingredient_count: 2, step_count: 3, times_cooked: 0, last_cooked_on: null, pantry: fit(), ...over,
});

describe('labels', () => {
  it('reads times', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(60)).toBe('1 hr');
    expect(minutesLabel(80)).toBe('1 hr 20 min');
    expect(minutesLabel(null)).toBe('');
    expect(recipeMeta({ total_minutes: 35, difficulty: 'medium', servings: 4 })).toBe('35 min · medium · serves 4');
    expect(recipeMeta({ total_minutes: null, difficulty: null })).toBe('');
  });
  it('formats countdowns, rounding up', () => {
    expect(clock(90_000)).toBe('1:30');
    expect(clock(89_001)).toBe('1:30');
    expect(clock(999)).toBe('0:01');
    expect(clock(0)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
  it('names timer lengths', () => {
    expect(timerLabel(600)).toBe('10 min');
    expect(timerLabel(90)).toBe('1 min 30 s');
    expect(timerLabel(45)).toBe('45 s');
    expect(timerLabel(5400)).toBe('1 hr 30 min');
  });
  it('parses the timer box and round-trips it', () => {
    expect(parseTimer('10')).toBe(600);
    expect(parseTimer('1.5')).toBe(90);
    expect(parseTimer('1/2')).toBe(30);
    expect(parseTimer('1:30')).toBe(90);
    expect(parseTimer('1:05:00')).toBe(3900);
    expect(parseTimer('')).toBeNull();
    expect(parseTimer('soon')).toBeNull();
    expect(parseTimer('0')).toBeNull();
    expect(parseTimer('2000')).toBeNull();
    expect(timerText(600)).toBe('10');
    expect(timerText(90)).toBe('1:30');
    expect(timerText(null)).toBe('');
    expect(parseTimer(timerText(3900))).toBe(3900);
  });
});

describe('tonight', () => {
  it('follows the server order and drops recipes with no ingredients', () => {
    const recipes = [recipe({ id: 1 }), recipe({ id: 2 }), recipe({ id: 3, ingredient_count: 0 })];
    expect(tonightList({ recipes, can_make_order: [2, 9, 1, 3] }).map((r) => r.id)).toEqual([2, 1]);
  });
  it('lists only missing ingredients not already on the shopping list', () => {
    const f = fit({ missing: [
      { name: 'Cream', quantity: 1, unit: 'cup', amount: '1 cup', on_shopping_list: false },
      { name: 'Shallots', quantity: null, unit: null, amount: '', on_shopping_list: false },
      { name: 'Butter', quantity: 2, unit: 'tbsp', amount: '2 tbsp', on_shopping_list: true },
    ] });
    expect(missingToAdd(f, 12)).toEqual([{ name: 'Cream', quantity: 1, unit: 'cup', recipe_id: 12 }, { name: 'Shallots', recipe_id: 12 }]);
  });
});

describe('filterRecipes', () => {
  const have = (name: string) => ({ name, amount: '', match: 'exact' as const, pantry_item_id: 1, pantry_name: name, pantry_amount: null, location: null, expires_on: null, days_left: null, expiring_soon: false });
  const recipes = [
    recipe({ id: 1, title: 'Weeknight chili', pantry: fit({ have: [have('Black beans')] }) }),
    recipe({ id: 2, title: 'Risotto', tags: ['italian'], techniques: ['toasting rice'], favourite: true }),
    recipe({ id: 3, title: 'Roast chicken', tags: ['weeknight', 'sunday'], techniques: ['roasting'] }),
  ];
  it('searches titles, tags, techniques and ingredients', () => {
    expect(filterRecipes(recipes, { q: 'chili' }).map((r) => r.id)).toEqual([1]);
    expect(filterRecipes(recipes, { q: 'beans' }).map((r) => r.id)).toEqual([1]);
    expect(filterRecipes(recipes, { q: 'italian' }).map((r) => r.id)).toEqual([2]);
    expect(filterRecipes(recipes, { q: 'roast' }).map((r) => r.id)).toEqual([3]);
  });
  it('combines tag, technique and favourites', () => {
    expect(filterRecipes(recipes, { tag: 'weeknight' }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterRecipes(recipes, { tag: 'weeknight', technique: 'roasting' }).map((r) => r.id)).toEqual([3]);
    expect(filterRecipes(recipes, { favourite: true }).map((r) => r.id)).toEqual([2]);
    expect(filterRecipes(recipes, {}).length).toBe(3);
  });
});

describe('recipe form', () => {
  const blank = () => draftOfRecipe(null);
  it('needs a title', () => {
    expect(recipeInput(blank())).toEqual({ error: 'Give the recipe a title.' });
  });
  it('drops blank rows and parses amounts and timers', () => {
    const d = blank();
    d.title = ' Pan sauce ';
    d.minutes = '15';
    d.difficulty = 'medium';
    d.ingredients = [{ ...blankIngredient(), quantity: '1/2', unit: 'cup', name: 'white wine' }, blankIngredient(), { ...blankIngredient(), name: 'salt', note: 'to taste' }];
    d.steps = [{ ...blankStep(), text: 'Reduce by half.', timer: '3' }, blankStep(), { ...blankStep(), text: 'Whisk in butter.' }];
    d.tags = 'Weeknight, french,, weeknight';
    d.techniques = 'Emulsifying';
    expect(recipeInput(d)).toEqual({
      input: {
        title: 'Pan sauce', source: null, url: null, servings: null, total_minutes: 15, difficulty: 'medium',
        ingredients: [{ name: 'white wine', quantity: 0.5, unit: 'cup', note: null }, { name: 'salt', quantity: null, unit: null, note: 'to taste' }],
        steps: [{ text: 'Reduce by half.', timer_seconds: 180 }, { text: 'Whisk in butter.', timer_seconds: null }],
        tags: ['weeknight', 'french'], techniques: ['emulsifying'], notes: null,
      },
    });
  });
  it('carries the id on an edit', () => {
    const d = blank();
    d.title = 'X';
    const r = recipeInput(d, 12);
    expect('input' in r && r.input.id).toBe(12);
  });
  it('says what is wrong', () => {
    const base = { ...blank(), title: 'X' };
    expect(recipeInput({ ...base, servings: '2.5' })).toHaveProperty('error');
    expect(recipeInput({ ...base, minutes: 'an hour' })).toHaveProperty('error');
    expect(recipeInput({ ...base, ingredients: [{ ...blankIngredient(), quantity: '2' }] })).toHaveProperty('error');
    expect(recipeInput({ ...base, ingredients: [{ ...blankIngredient(), quantity: 'some', name: 'salt' }] })).toHaveProperty('error');
    expect(recipeInput({ ...base, steps: [{ ...blankStep(), timer: '5' }] })).toHaveProperty('error');
    expect(recipeInput({ ...base, steps: [{ ...blankStep(), text: 'Wait', timer: 'a bit' }] })).toHaveProperty('error');
  });
  it('round-trips a saved recipe', () => {
    const full: RecipeFull = {
      ...recipe({ source: 'Mom', notes: 'double the garlic' }),
      ingredients: [{ position: 1, name: 'Ground beef', quantity: 1.5, unit: 'lb', note: null, amount: '1.5 lb', in_pantry: true, match: 'exact', pantry_item: null, on_shopping_list: false }],
      steps: [{ position: 1, text: 'Brown the beef.', timer_seconds: 480 }, { position: 2, text: 'Simmer.', timer_seconds: 90 }],
      log: [],
    };
    const r = recipeInput(draftOfRecipe(full), 1);
    expect(r).toEqual({
      input: {
        id: 1, title: 'Weeknight chili', source: 'Mom', url: null, servings: 4, total_minutes: 45, difficulty: 'easy',
        ingredients: [{ name: 'Ground beef', quantity: 1.5, unit: 'lb', note: null }],
        steps: [{ text: 'Brown the beef.', timer_seconds: 480 }, { text: 'Simmer.', timer_seconds: 90 }],
        tags: ['weeknight'], techniques: ['simmering'], notes: 'double the garlic',
      },
    });
  });
  it('tidies labels and moves rows', () => {
    expect(labelsOf(' Knife  Work,\nbraising, knife work ')).toEqual(['knife work', 'braising']);
    expect(moveRow(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('timer', () => {
  const T0 = 1_000_000;
  it('starts, counts down on the wall clock and finishes', () => {
    let t = newTimer(60);
    expect(t.status).toBe('idle');
    expect(remaining(t, T0)).toBe(60_000);
    t = start(t, T0);
    expect(t.status).toBe('running');
    expect(remaining(t, T0 + 15_000)).toBe(45_000);
    expect(tick(t, T0 + 59_999)).toBe(t);
    t = tick(t, T0 + 60_000);
    expect(t.status).toBe('done');
    expect(remaining(t, T0 + 99_000)).toBe(0);
  });
  it('survives a long gap between ticks (a sleeping tab)', () => {
    const t = tick(start(newTimer(60), T0), T0 + 600_000);
    expect(t.status).toBe('done');
  });
  it('pauses and resumes without losing or gaining time', () => {
    let t = pause(start(newTimer(60), T0), T0 + 20_000);
    expect(t.status).toBe('paused');
    expect(remaining(t, T0 + 500_000)).toBe(40_000);
    t = start(t, T0 + 500_000);
    expect(remaining(t, T0 + 510_000)).toBe(30_000);
    expect(tick(t, T0 + 540_000).status).toBe('done');
  });
  it('ignores a pause when idle and a start when running', () => {
    const idle = newTimer(60);
    expect(pause(idle, T0)).toBe(idle);
    const running = start(idle, T0);
    expect(start(running, T0 + 5000)).toBe(running);
  });
  it('pausing after the time is up finishes it', () => {
    expect(pause(start(newTimer(10), T0), T0 + 11_000).status).toBe('done');
  });
  it('resets to the full length from any state', () => {
    const done = tick(start(newTimer(30), T0), T0 + 30_000);
    expect(reset(done)).toEqual(newTimer(30));
    expect(reset(pause(start(newTimer(30), T0), T0 + 1000))).toEqual(newTimer(30));
  });
  it('restarts from the top when started after finishing', () => {
    const again = start(tick(start(newTimer(30), T0), T0 + 30_000), T0 + 40_000);
    expect(again.status).toBe('running');
    expect(remaining(again, T0 + 40_000)).toBe(30_000);
  });
  it('extends a running, paused or finished timer', () => {
    const running = extend(start(newTimer(60), T0), 60_000, T0 + 10_000);
    expect(remaining(running, T0 + 10_000)).toBe(110_000);
    const paused = extend(pause(start(newTimer(60), T0), T0 + 10_000), 60_000, T0 + 20_000);
    expect(paused.status).toBe('paused');
    expect(remaining(paused, T0 + 20_000)).toBe(110_000);
    const done = extend(tick(start(newTimer(60), T0), T0 + 60_000), 60_000, T0 + 70_000);
    expect(done.status).toBe('running');
    expect(remaining(done, T0 + 70_000)).toBe(60_000);
  });
  it('ticks several timers at once and reports which finished', () => {
    const timers = { 0: start(newTimer(10), T0), 2: start(newTimer(100), T0), 5: newTimer(30) };
    const same = tickAll(timers, T0 + 5000);
    expect(same.timers).toBe(timers);
    expect(same.finished).toEqual([]);
    const after = tickAll(timers, T0 + 10_000);
    expect(after.finished).toEqual([0]);
    expect(after.timers[0]!.status).toBe('done');
    expect(after.timers[2]!.status).toBe('running');
    expect(activeKeys(after.timers)).toEqual([0, 2]);
    expect(anyRunning(after.timers)).toBe(true);
    expect(anyRunning({ 0: newTimer(5) })).toBe(false);
  });
});
