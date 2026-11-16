// Cooking: saved recipes, the log of meals cooked, and the mechanical half of
// "what can I make tonight" (recipe ingredients matched against the pantry).
// Pantry deductions go through _pantry/store.ts, the same code pantry_update uses.
import { z } from 'zod';
import { type DB, nowIso } from '../db.js';
import { defineDomain } from '../domains.js';
import { indexItem, unindexItem } from '../memory.js';
import { localDay } from '../time.js';
import { defineTool, ToolError } from '../tools.js';
import { cleanName, daysBetween, formatAmount, isDay, nameMatch, normalizeName } from './_pantry/names.js';
import { type PantryChange, type PantryOutcome, type PantryRow, applyPantryChanges, inStockItems, shoppingKeys, tableExists } from './_pantry/store.js';

const SOON_DAYS = 3;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

interface RecipeRow {
  id: number; title: string; source: string | null; url: string | null; servings: number | null; total_minutes: number | null;
  difficulty: string | null; tags: string; techniques: string; rating: number | null; favourite: number; notes: string | null;
  created_at: string; updated_at: string;
}
interface IngredientRow { id: number; recipe_id: number; position: number; name: string; name_key: string; quantity: number | null; unit: string | null; note: string | null }
interface StepRow { id: number; recipe_id: number; position: number; text: string; timer_seconds: number | null }
interface LogRow { id: number; cooked_on: string; recipe_id: number | null; dish: string; rating: number | null; notes: string | null; techniques: string; created_at: string; updated_at: string }

const list = (json: string): string[] => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
/** Tags and techniques are stored lowercase, trimmed, without repeats. */
const labels = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
const intParam = (v: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

// ---- recipes against the pantry ------------------------------------------------

// Never counted as missing.
const ALWAYS_ON_HAND = /^((cold|warm|hot|boiling|lukewarm|tap|ice) )?water$|^ice$/;

interface Have {
  name: string; amount: string; match: 'exact' | 'similar' | 'always_on_hand';
  pantry_item_id: number | null; pantry_name: string | null; pantry_amount: string | null; location: string | null;
  expires_on: string | null; days_left: number | null; expiring_soon: boolean;
}
interface Missing { name: string; quantity: number | null; unit: string | null; amount: string; on_shopping_list: boolean }
interface PantryFit {
  ingredient_count: number; have_count: number; missing_count: number; can_make: boolean;
  have: Have[]; missing: Missing[];
  uses_expiring: { name: string; expires_on: string; days_left: number }[];
}

/** Builds a matcher from the in-stock pantry: exact name first, then a similar one, soonest expiry first. */
function pantryMatcher(db: DB, soonDays: number): (ings: IngredientRow[]) => PantryFit {
  const stock = inStockItems(db);
  const listed = shoppingKeys(db);
  const today = localDay();
  const find = (key: string): { row: PantryRow; match: 'exact' | 'similar' } | null => {
    const exact = stock.find((r) => r.name_key === key);
    if (exact) return { row: exact, match: 'exact' };
    const similar = stock.find((r) => nameMatch(key, r.name_key) === 'similar');
    return similar ? { row: similar, match: 'similar' } : null;
  };
  return (ings) => {
    const have: Have[] = [];
    const missing: Missing[] = [];
    for (const i of ings) {
      const amount = formatAmount(i.quantity, i.unit);
      if (ALWAYS_ON_HAND.test(i.name_key)) {
        have.push({ name: i.name, amount, match: 'always_on_hand', pantry_item_id: null, pantry_name: null, pantry_amount: null, location: null, expires_on: null, days_left: null, expiring_soon: false });
        continue;
      }
      const hit = find(i.name_key);
      if (!hit) {
        missing.push({ name: i.name, quantity: i.quantity, unit: i.unit, amount, on_shopping_list: listed.has(i.name_key) });
        continue;
      }
      const daysLeft = hit.row.expires_on ? daysBetween(today, hit.row.expires_on) : null;
      have.push({
        name: i.name, amount, match: hit.match, pantry_item_id: hit.row.id, pantry_name: hit.row.name,
        pantry_amount: formatAmount(hit.row.quantity, hit.row.unit, hit.row.amount_note), location: hit.row.location,
        expires_on: hit.row.expires_on, days_left: daysLeft, expiring_soon: daysLeft != null && daysLeft <= soonDays,
      });
    }
    const seen = new Set<number>();
    const usesExpiring = have
      .filter((h) => h.expiring_soon && h.pantry_item_id != null && !seen.has(h.pantry_item_id) && seen.add(h.pantry_item_id))
      .map((h) => ({ name: h.pantry_name!, expires_on: h.expires_on!, days_left: h.days_left! }));
    return { ingredient_count: ings.length, have_count: have.length, missing_count: missing.length, can_make: ings.length > 0 && missing.length === 0, have, missing, uses_expiring: usesExpiring };
  };
}

function ingredientsByRecipe(db: DB): Map<number, IngredientRow[]> {
  const out = new Map<number, IngredientRow[]>();
  for (const r of db.prepare('SELECT * FROM cooking_recipe_ingredients ORDER BY recipe_id, position').all() as IngredientRow[]) {
    if (!out.has(r.recipe_id)) out.set(r.recipe_id, []);
    out.get(r.recipe_id)!.push(r);
  }
  return out;
}

function summaries(db: DB, soonDays = SOON_DAYS) {
  const fit = pantryMatcher(db, soonDays);
  const ings = ingredientsByRecipe(db);
  const steps = new Map((db.prepare('SELECT recipe_id, COUNT(*) AS n FROM cooking_recipe_steps GROUP BY recipe_id').all() as { recipe_id: number; n: number }[]).map((r) => [r.recipe_id, r.n]));
  const cooked = new Map(
    (db.prepare('SELECT recipe_id, COUNT(*) AS n, MAX(cooked_on) AS last FROM cooking_log WHERE recipe_id IS NOT NULL GROUP BY recipe_id').all() as { recipe_id: number; n: number; last: string }[]).map((r) => [r.recipe_id, r]),
  );
  return (db.prepare('SELECT * FROM cooking_recipes ORDER BY title COLLATE NOCASE').all() as RecipeRow[]).map((r) => {
    const f = fit(ings.get(r.id) ?? []);
    return {
      id: r.id, title: r.title, source: r.source, url: r.url, servings: r.servings, total_minutes: r.total_minutes, difficulty: r.difficulty,
      tags: list(r.tags), techniques: list(r.techniques), rating: r.rating, favourite: !!r.favourite, notes: r.notes,
      ingredient_count: f.ingredient_count, step_count: steps.get(r.id) ?? 0,
      times_cooked: cooked.get(r.id)?.n ?? 0, last_cooked_on: cooked.get(r.id)?.last ?? null,
      pantry: f,
      created_at: r.created_at, updated_at: r.updated_at,
    };
  });
}
type Summary = ReturnType<typeof summaries>[number];

/** Fewest missing first; then the ones that use up what is about to expire; then Ben's favourites. */
const byMakeable = (a: Summary, b: Summary): number =>
  Number(a.ingredient_count === 0) - Number(b.ingredient_count === 0) ||
  a.pantry.missing_count - b.pantry.missing_count ||
  b.pantry.uses_expiring.length - a.pantry.uses_expiring.length ||
  (b.rating ?? 0) - (a.rating ?? 0) ||
  a.title.localeCompare(b.title);

const logView = (r: LogRow) => ({ id: r.id, cooked_on: r.cooked_on, recipe_id: r.recipe_id, dish: r.dish, rating: r.rating, notes: r.notes, techniques: list(r.techniques) });

function skills(db: DB) {
  const practised = new Map<string, { technique: string; times: number; last_on: string; dishes: string[] }>();
  for (const e of db.prepare('SELECT * FROM cooking_log ORDER BY cooked_on, id').all() as LogRow[]) {
    for (const t of list(e.techniques)) {
      const p = practised.get(t) ?? { technique: t, times: 0, last_on: e.cooked_on, dishes: [] };
      p.times += 1;
      p.last_on = e.cooked_on;
      if (!p.dishes.includes(e.dish)) p.dishes.push(e.dish);
      practised.set(t, p);
    }
  }
  const cookedIds = new Set((db.prepare('SELECT DISTINCT recipe_id FROM cooking_log WHERE recipe_id IS NOT NULL').all() as { recipe_id: number }[]).map((r) => r.recipe_id));
  const recipes = db.prepare('SELECT * FROM cooking_recipes ORDER BY title COLLATE NOCASE').all() as RecipeRow[];
  const untried = new Map<string, { technique: string; recipes: { id: number; title: string; difficulty: string | null; total_minutes: number | null }[] }>();
  for (const r of recipes) {
    for (const t of list(r.techniques)) {
      if (practised.has(t)) continue;
      const u = untried.get(t) ?? { technique: t, recipes: [] };
      u.recipes.push({ id: r.id, title: r.title, difficulty: r.difficulty, total_minutes: r.total_minutes });
      untried.set(t, u);
    }
  }
  return {
    // From the cook log: each technique Ben has used, how often, and when last.
    practised: [...practised.values()].sort((a, b) => b.times - a.times || a.technique.localeCompare(b.technique)),
    // Techniques that saved recipes carry and the cook log has never seen.
    untried: [...untried.values()].sort((a, b) => a.technique.localeCompare(b.technique)),
    // Saved recipes never cooked, with the techniques each would add.
    never_cooked: recipes
      .filter((r) => !cookedIds.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, difficulty: r.difficulty, total_minutes: r.total_minutes, techniques: list(r.techniques), new_techniques: list(r.techniques).filter((t) => !practised.has(t)) })),
  };
}

// ---- writes --------------------------------------------------------------------

function reindex(db: DB, id: number): void {
  const r = db.prepare('SELECT * FROM cooking_recipes WHERE id = ?').get(id) as RecipeRow;
  const ings = db.prepare('SELECT * FROM cooking_recipe_ingredients WHERE recipe_id = ? ORDER BY position').all(id) as IngredientRow[];
  const steps = db.prepare('SELECT * FROM cooking_recipe_steps WHERE recipe_id = ? ORDER BY position').all(id) as StepRow[];
  const body = [
    [r.source, r.difficulty, r.total_minutes ? `${r.total_minutes} minutes` : ''].filter(Boolean).join(' · '),
    list(r.tags).length ? `Tags: ${list(r.tags).join(', ')}` : '',
    list(r.techniques).length ? `Techniques: ${list(r.techniques).join(', ')}` : '',
    ings.length ? `Ingredients: ${ings.map((i) => [formatAmount(i.quantity, i.unit), i.name].filter(Boolean).join(' ')).join(', ')}` : '',
    steps.map((s) => `${s.position}. ${s.text}`).join('\n'),
    r.notes ?? '',
  ].filter(Boolean).join('\n');
  indexItem(db, 'recipe', id, r.title, body, r.updated_at);
}

const recipeTitles = (db: DB): string => {
  const rows = db.prepare('SELECT id, title FROM cooking_recipes ORDER BY updated_at DESC LIMIT 30').all() as { id: number; title: string }[];
  return rows.length ? `Recipes: ${rows.map((r) => `${r.id} ${r.title}`).join('; ')}.` : 'No recipes are saved yet.';
};

function requireRecipe(db: DB, id: number): RecipeRow {
  const r = db.prepare('SELECT * FROM cooking_recipes WHERE id = ?').get(id) as RecipeRow | undefined;
  if (!r) throw new ToolError(`No recipe ${id}. ${recipeTitles(db)}`);
  return r;
}

/** A dish name to a saved recipe: the same title, or the only recipe the name is a looser form of ("chili" -> "Weeknight chili"). */
function recipeByName(db: DB, dish: string): RecipeRow | null {
  const key = normalizeName(dish);
  const all = db.prepare('SELECT * FROM cooking_recipes').all() as RecipeRow[];
  const exact = all.filter((r) => normalizeName(r.title) === key);
  if (exact.length) return exact[0]!;
  const similar = all.filter((r) => nameMatch(key, normalizeName(r.title)) === 'similar');
  return similar.length === 1 ? similar[0]! : null;
}

const day = z.string().refine(isDay, 'must be a real date written YYYY-MM-DD');
const rating = z.number().int().min(1).max(5);

export default defineDomain({
  name: 'cooking',
  migrations: [
    {
      id: 'cooking-001',
      sql: `
      CREATE TABLE cooking_recipes (
        -- Ben's saved recipes. Ingredients are in cooking_recipe_ingredients, steps in cooking_recipe_steps.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source TEXT,                               -- where it came from: 'NYT Cooking', 'Mom', 'Kevin'
        url TEXT,
        servings INTEGER,
        total_minutes INTEGER,                     -- start to table, prep included
        difficulty TEXT,                           -- easy | medium | hard
        tags TEXT NOT NULL DEFAULT '[]',           -- JSON array of lowercase strings: ["weeknight","vegetarian"]. Filter: EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'weeknight')
        techniques TEXT NOT NULL DEFAULT '[]',     -- JSON array, the cooking skills the dish exercises: ["braising","knife work"]
        rating INTEGER,                            -- 1-5, Ben's latest rating; NULL = not rated
        favourite INTEGER NOT NULL DEFAULT 0,      -- 1 = a favourite
        notes TEXT,                                -- Ben's own adjustments: 'double the garlic'
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE cooking_recipe_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL REFERENCES cooking_recipes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,                 -- order in the recipe, from 1
        name TEXT NOT NULL,                        -- the ingredient alone: 'yellow onion'
        name_key TEXT NOT NULL,                    -- normalised like pantry_items.name_key, so the two join: 'yellow onion', 'egg'
        quantity REAL,                             -- NULL for 'to taste'
        unit TEXT,                                 -- cup, tbsp, lb, clove; NULL = counted singly
        note TEXT                                  -- preparation or alternative: 'diced', 'or shallots'
      );
      CREATE INDEX cooking_recipe_ingredients_recipe ON cooking_recipe_ingredients(recipe_id, position);
      CREATE TABLE cooking_recipe_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL REFERENCES cooking_recipes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,                 -- step number, from 1
        text TEXT NOT NULL,
        timer_seconds INTEGER                      -- a timer the cooking mode offers on this step; NULL = none
      );
      CREATE INDEX cooking_recipe_steps_recipe ON cooking_recipe_steps(recipe_id, position);
      CREATE TABLE cooking_log (
        -- Every meal Ben cooked, one row per time.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cooked_on TEXT NOT NULL,                   -- YYYY-MM-DD in Ben's timezone
        recipe_id INTEGER REFERENCES cooking_recipes(id) ON DELETE SET NULL,   -- NULL = cooked without a saved recipe
        dish TEXT NOT NULL,                        -- what it was; the recipe's title when there is one
        rating INTEGER,                            -- 1-5 for that night
        notes TEXT,                                -- how it went, what he changed
        techniques TEXT NOT NULL DEFAULT '[]',     -- JSON array: skills practised that night (copied from the recipe). Count practice: SELECT value, COUNT(*) FROM cooking_log, json_each(techniques) GROUP BY value
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX cooking_log_day ON cooking_log(cooked_on);
      CREATE INDEX cooking_log_recipe ON cooking_log(recipe_id);
      `,
    },
  ],
  promptNote: `Saved recipes (cooking_recipes with cooking_recipe_ingredients and cooking_recipe_steps) and the log of meals cooked (cooking_log). Page: /cooking, which has a step-by-step cooking mode: for "walk me through the risotto", point Ben to the recipe there, or read him the steps from cooking_recipe_steps one at a time.
- "What can I make tonight": join recipe ingredients to the pantry on name_key and count what is missing, favouring what uses food about to expire:
  SELECT r.id, r.title, r.total_minutes, COUNT(*) AS ingredients, SUM(p.id IS NULL) AS missing, GROUP_CONCAT(CASE WHEN p.id IS NULL THEN i.name END, ', ') AS missing_names, MIN(p.expires_on) AS soonest_expiry FROM cooking_recipes r JOIN cooking_recipe_ingredients i ON i.recipe_id = r.id LEFT JOIN pantry_items p ON p.name_key = i.name_key AND p.in_stock = 1 GROUP BY r.id ORDER BY missing, soonest_expiry IS NULL, soonest_expiry LIMIT 15
  The join is exact on name_key, so read missing_names with judgment ("garlic" is covered by "garlic cloves"; salt and water are not worth mentioning). When nothing saved fits, propose a dish from what is in the pantry.
- Saving a recipe: one ingredient per row with the bare ingredient as name ("yellow onion", preparation in note), quantities as numbers (0.5, not "1/2"), steps in order with timer_seconds where a step says to wait or cook for a time. Fill techniques (braising, searing, emulsifying, knife work, ...) and difficulty every time: they drive skill building.
- When Ben says he cooked something, cooking_log_meal records it. Pass deduct_recipe_ingredients: true when he followed a saved recipe, and name in \`used\` anything he says he finished or used. A rating he gives goes in the same call.
- "Teach me something new": find techniques saved recipes carry that cooking_log has never seen, or propose a new dish built on a technique he has not practised, and save it once he agrees.`,
  tools: [
    defineTool({
      name: 'cooking_recipe_save',
      description:
        'Save a new recipe, or change a saved one. Without id it creates the recipe: give title, ingredients and steps. ' +
        'With id it updates only the fields you pass and leaves the rest, so rating a recipe is {id: 12, rating: 5} and marking a favourite is {id: 12, favourite: true}; ' +
        'ingredients and steps, when passed, replace the whole list. Use it when Ben says "save this recipe", pastes or photographs one, or agrees to a dish you proposed.',
      input: z.object({
        id: z.number().int().optional().describe('cooking_recipes.id of the recipe to update. Leave out to create.'),
        title: z.string().min(1).max(200).optional(),
        source: z.string().max(200).nullable().optional().describe('Where it came from: a site, a book, a person, or "Kevin" for one you wrote.'),
        url: z.string().max(1000).nullable().optional(),
        servings: z.number().int().min(1).max(100).nullable().optional(),
        total_minutes: z.number().int().min(1).max(2880).nullable().optional().describe('Start to table, prep included.'),
        difficulty: z.enum(DIFFICULTIES).nullable().optional(),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(120).describe('The bare ingredient, named as it would be in the pantry: "yellow onion", "chicken thighs".'),
              quantity: z.number().positive().nullable().optional().describe('A number: 0.5 for half. Leave out for "to taste".'),
              unit: z.string().max(30).nullable().optional().describe('cup, tbsp, tsp, lb, oz, clove, can. Leave out for things counted singly.'),
              note: z.string().max(200).nullable().optional().describe('Preparation or alternative: "diced", "or shallots".'),
            }),
          )
          .max(100)
          .optional(),
        steps: z
          .array(
            z.object({
              text: z.string().min(1).max(2000).describe('One action Ben can do before looking at the screen again.'),
              timer_seconds: z.number().int().min(1).max(86_400).nullable().optional().describe('When the step has a wait: 600 for "simmer 10 minutes".'),
            }),
          )
          .max(100)
          .optional()
          .describe('In order. The cooking mode shows one step at a time.'),
        tags: z.array(z.string().max(40)).max(20).optional().describe('Short lowercase labels: weeknight, vegetarian, mexican, meal prep.'),
        techniques: z.array(z.string().max(40)).max(12).optional().describe('The cooking skills the dish exercises: searing, braising, emulsifying, knife work, bread dough. Reuse the wording already in cooking_recipes.techniques.'),
        rating: rating.nullable().optional().describe('Ben\'s rating, 1-5.'),
        favourite: z.boolean().optional(),
        notes: z.string().max(4000).nullable().optional().describe('Ben\'s adjustments and verdicts.'),
      }),
      touches: ['cooking'],
      run: (input, ctx) => {
        const { db } = ctx;
        const now = nowIso();
        let id: number;
        let created = false;
        db.transaction(() => {
          if (input.id == null) {
            const title = input.title ? cleanName(input.title) : '';
            if (!title) throw new ToolError('A new recipe needs a title.');
            const dupe = db.prepare('SELECT id, title FROM cooking_recipes WHERE title = ? COLLATE NOCASE').get(title) as { id: number; title: string } | undefined;
            if (dupe) throw new ToolError(`There is already a recipe "${dupe.title}" (id ${dupe.id}). Pass id: ${dupe.id} to update it, or use a different title.`);
            id = Number(
              db.prepare(
                'INSERT INTO cooking_recipes (title, source, url, servings, total_minutes, difficulty, tags, techniques, rating, favourite, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
              ).run(
                title, input.source?.trim() || null, input.url?.trim() || null, input.servings ?? null, input.total_minutes ?? null, input.difficulty ?? null,
                JSON.stringify(labels(input.tags ?? [])), JSON.stringify(labels(input.techniques ?? [])), input.rating ?? null, input.favourite ? 1 : 0, input.notes?.trim() || null, now, now,
              ).lastInsertRowid,
            );
            created = true;
          } else {
            const r = requireRecipe(db, input.id);
            id = r.id;
            const title = input.title ? cleanName(input.title) : r.title;
            const dupe = db.prepare('SELECT id FROM cooking_recipes WHERE title = ? COLLATE NOCASE AND id <> ?').get(title, id);
            if (dupe) throw new ToolError(`Another recipe is already called "${title}".`);
            const pick = <T>(given: T | undefined, current: T): T => (given === undefined ? current : given);
            const text = (given: string | null | undefined, current: string | null): string | null => (given === undefined ? current : given?.trim() || null);
            db.prepare(
              'UPDATE cooking_recipes SET title = ?, source = ?, url = ?, servings = ?, total_minutes = ?, difficulty = ?, tags = ?, techniques = ?, rating = ?, favourite = ?, notes = ?, updated_at = ? WHERE id = ?',
            ).run(
              title, text(input.source, r.source), text(input.url, r.url), pick(input.servings, r.servings), pick(input.total_minutes, r.total_minutes), pick(input.difficulty, r.difficulty),
              input.tags ? JSON.stringify(labels(input.tags)) : r.tags, input.techniques ? JSON.stringify(labels(input.techniques)) : r.techniques,
              pick(input.rating, r.rating), input.favourite === undefined ? r.favourite : input.favourite ? 1 : 0, text(input.notes, r.notes), now, id,
            );
            if (title !== r.title) db.prepare('UPDATE cooking_log SET dish = ?, updated_at = ? WHERE recipe_id = ? AND dish = ?').run(title, now, id, r.title);
          }
          if (input.ingredients) {
            db.prepare('DELETE FROM cooking_recipe_ingredients WHERE recipe_id = ?').run(id);
            const ins = db.prepare('INSERT INTO cooking_recipe_ingredients (recipe_id, position, name, name_key, quantity, unit, note) VALUES (?,?,?,?,?,?,?)');
            input.ingredients.forEach((i, n) => ins.run(id, n + 1, cleanName(i.name), normalizeName(i.name), i.quantity ?? null, i.unit?.trim() || null, i.note?.trim() || null));
          }
          if (input.steps) {
            db.prepare('DELETE FROM cooking_recipe_steps WHERE recipe_id = ?').run(id);
            const ins = db.prepare('INSERT INTO cooking_recipe_steps (recipe_id, position, text, timer_seconds) VALUES (?,?,?,?)');
            input.steps.forEach((s, n) => ins.run(id, n + 1, s.text.trim(), s.timer_seconds ?? null));
          }
          reindex(db, id);
        })();
        const r = db.prepare('SELECT * FROM cooking_recipes WHERE id = ?').get(id!) as RecipeRow;
        const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE recipe_id = ?`).get(r.id) as { n: number }).n;
        return {
          id: r.id, title: r.title, saved: created ? 'created' : 'updated',
          ingredient_count: count('cooking_recipe_ingredients'), step_count: count('cooking_recipe_steps'),
          difficulty: r.difficulty, techniques: list(r.techniques), tags: list(r.tags), rating: r.rating, favourite: !!r.favourite,
        };
      },
    }),
    defineTool({
      name: 'cooking_recipe_delete',
      description: 'Delete a saved recipe with its ingredients and steps. Ben is asked to confirm. Meals already logged from it stay in the cook log under the dish name.',
      input: z.object({ id: z.number().int().describe('cooking_recipes.id') }),
      touches: ['cooking'],
      run: async ({ id }, ctx) => {
        const r = requireRecipe(ctx.db, id);
        if (!(await ctx.confirm(`Delete the recipe "${r.title}"?`))) throw new ToolError(`Ben declined to delete "${r.title}". It is still saved.`);
        ctx.db.transaction(() => {
          ctx.db.prepare('UPDATE cooking_log SET recipe_id = NULL WHERE recipe_id = ?').run(id);
          ctx.db.prepare('DELETE FROM cooking_recipe_ingredients WHERE recipe_id = ?').run(id);
          ctx.db.prepare('DELETE FROM cooking_recipe_steps WHERE recipe_id = ?').run(id);
          ctx.db.prepare('DELETE FROM cooking_recipes WHERE id = ?').run(id);
          unindexItem(ctx.db, 'recipe', id);
        })();
        return { deleted: r.title, id };
      },
    }),
    defineTool({
      name: 'cooking_log_meal',
      description:
        'Record a meal Ben cooked, and in the same call take what it used out of the pantry. ' +
        '"I cooked the chili tonight, 4 stars, used the last of the beans" -> {dish:"chili", rating:4, deduct_recipe_ingredients:true, used:[{name:"beans", finished:true}]}. ' +
        'A dish with no saved recipe is logged by name: {dish:"grilled cheese"}. With id it corrects an existing entry (only the fields passed), or deletes it with delete: true. ' +
        'Returns the entry and what changed in the pantry; ingredients it could not find or subtract are listed in pantry.not_applied and the meal is logged regardless.',
      input: z.object({
        id: z.number().int().optional().describe('cooking_log.id of an entry to correct or delete. Leave out to log a new meal.'),
        delete: z.boolean().optional().describe('With id: remove that entry.'),
        recipe_id: z.number().int().optional().describe('cooking_recipes.id when he cooked a saved recipe and you know its id.'),
        dish: z.string().min(1).max(200).optional().describe('What he cooked. A name that matches a saved recipe ("chili" for "Weeknight chili") links the entry to it, so recipe_id is not needed.'),
        cooked_on: day.optional().describe('YYYY-MM-DD. Defaults to today.'),
        rating: rating.nullable().optional().describe('1-5 stars for this meal. Also becomes the recipe\'s rating.'),
        notes: z.string().max(2000).nullable().optional().describe('How it went, what he changed, what to do differently.'),
        techniques: z.array(z.string().max(40)).max(12).optional().describe('Skills practised. Defaults to the recipe\'s techniques; give them for a dish with no saved recipe.'),
        deduct_recipe_ingredients: z.boolean().default(false).describe('Subtract every ingredient of the saved recipe (those with a numeric quantity) from the pantry.'),
        used: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              quantity: z.number().positive().optional(),
              unit: z.string().max(30).nullable().optional(),
              finished: z.boolean().optional().describe('true when he used the last of it: the item is marked out of stock.'),
            }),
          )
          .max(100)
          .optional()
          .describe('Pantry items this meal used, beyond or instead of the recipe\'s amounts. An item named here overrides the recipe\'s line for it.'),
      }),
      touches: ['cooking', 'pantry'],
      run: (input, ctx) => {
        const { db } = ctx;
        const now = nowIso();
        const wantsPantry = input.deduct_recipe_ingredients || !!input.used?.length;
        if (wantsPantry && !tableExists(db, 'pantry_items')) throw new ToolError('The pantry is not available, so nothing can be deducted. Log the meal without deduct_recipe_ingredients and used.');
        let entryId: number;
        let recipe: RecipeRow | null = null;
        let pantry: PantryOutcome | null = null;
        let saved: 'logged' | 'updated' = 'logged';

        if (input.id != null) {
          const e = db.prepare('SELECT * FROM cooking_log WHERE id = ?').get(input.id) as LogRow | undefined;
          if (!e) {
            const recent = (db.prepare('SELECT id, cooked_on, dish FROM cooking_log ORDER BY cooked_on DESC, id DESC LIMIT 8').all() as { id: number; cooked_on: string; dish: string }[]).map((r) => `${r.id} ${r.cooked_on} ${r.dish}`);
            throw new ToolError(`No cook log entry ${input.id}. ${recent.length ? `Recent: ${recent.join('; ')}.` : 'The cook log is empty.'}`);
          }
          if (input.delete) {
            db.prepare('DELETE FROM cooking_log WHERE id = ?').run(e.id);
            return { deleted: { id: e.id, cooked_on: e.cooked_on, dish: e.dish } };
          }
        } else if (input.delete) throw new ToolError('delete needs the id of the entry.');

        db.transaction(() => {
          if (input.recipe_id != null) recipe = requireRecipe(db, input.recipe_id);
          else if (input.dish) recipe = recipeByName(db, input.dish);

          if (input.id != null) {
            const e = db.prepare('SELECT * FROM cooking_log WHERE id = ?').get(input.id) as LogRow;
            const relinked = input.recipe_id != null || !!input.dish;
            if (!relinked && e.recipe_id != null) recipe = (db.prepare('SELECT * FROM cooking_recipes WHERE id = ?').get(e.recipe_id) as RecipeRow | undefined) ?? null;
            const linked = recipe as RecipeRow | null;
            db.prepare('UPDATE cooking_log SET cooked_on = ?, recipe_id = ?, dish = ?, rating = ?, notes = ?, techniques = ?, updated_at = ? WHERE id = ?').run(
              input.cooked_on ?? e.cooked_on,
              relinked ? linked?.id ?? null : e.recipe_id,
              relinked ? linked?.title ?? cleanName(input.dish!) : e.dish,
              input.rating === undefined ? e.rating : input.rating,
              input.notes === undefined ? e.notes : input.notes?.trim() || null,
              input.techniques ? JSON.stringify(labels(input.techniques)) : relinked && linked ? linked.techniques : e.techniques,
              now, e.id,
            );
            entryId = e.id;
            saved = 'updated';
          } else {
            const linked = recipe as RecipeRow | null;
            if (!linked && !input.dish) throw new ToolError('Say what was cooked: give dish, or recipe_id for a saved recipe.');
            entryId = Number(
              db.prepare('INSERT INTO cooking_log (cooked_on, recipe_id, dish, rating, notes, techniques, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
                input.cooked_on ?? localDay(), linked?.id ?? null, linked?.title ?? cleanName(input.dish!), input.rating ?? null, input.notes?.trim() || null,
                input.techniques ? JSON.stringify(labels(input.techniques)) : linked?.techniques ?? '[]', now, now,
              ).lastInsertRowid,
            );
          }
          const linked = recipe as RecipeRow | null;
          if (linked && input.rating != null) db.prepare('UPDATE cooking_recipes SET rating = ?, updated_at = ? WHERE id = ?').run(input.rating, now, linked.id);

          if (wantsPantry) {
            const changes: PantryChange[] = [];
            const named = new Set<string>();
            for (const u of input.used ?? []) {
              named.add(normalizeName(u.name));
              changes.push(u.finished ? { name: u.name, op: 'out' } : { name: u.name, op: 'use', ...(u.quantity != null ? { quantity: u.quantity } : {}), ...(u.unit !== undefined ? { unit: u.unit } : {}) });
            }
            if (input.deduct_recipe_ingredients && linked) {
              const ings = db.prepare('SELECT * FROM cooking_recipe_ingredients WHERE recipe_id = ? ORDER BY position').all(linked.id) as IngredientRow[];
              for (const i of ings) {
                if (i.quantity == null || ALWAYS_ON_HAND.test(i.name_key)) continue;
                if ([...named].some((k) => k === i.name_key || nameMatch(k, i.name_key) || nameMatch(i.name_key, k))) continue;
                changes.push({ name: i.name, op: 'use', quantity: i.quantity, unit: i.unit });
              }
            }
            pantry = changes.length ? applyPantryChanges(db, changes) : { changed: [], not_applied: [] };
            if (input.deduct_recipe_ingredients && !linked) pantry.not_applied.push({ name: input.dish ?? '', reason: 'No saved recipe matches this dish, so there were no recipe ingredients to deduct. Name what was used in `used`.' });
          }
        })();

        const e = db.prepare('SELECT * FROM cooking_log WHERE id = ?').get(entryId!) as LogRow;
        const timesCooked = e.recipe_id == null ? null : (db.prepare('SELECT COUNT(*) AS n FROM cooking_log WHERE recipe_id = ?').get(e.recipe_id) as { n: number }).n;
        const p = pantry as PantryOutcome | null;
        return {
          saved, entry: logView(e),
          ...(timesCooked != null ? { times_cooked: timesCooked } : {}),
          ...(p ? { pantry: { changed: p.changed.map((c) => ({ name: c.name, did: c.did, now: c.now, ...(c.note ? { note: c.note } : {}) })), ...(p.not_applied.length ? { not_applied: p.not_applied } : {}) } } : {}),
        };
      },
    }),
  ],
  views: {
    // Everything the Cooking page opens with, in one call. ?soon_days=3
    overview: (p, db) => {
      const recipes = summaries(db, intParam(p.soon_days, SOON_DAYS, 0, 60));
      return {
        today: localDay(),
        recipes,
        // Ids of recipes in "what can I make" order: fewest missing ingredients first.
        can_make_order: [...recipes].sort(byMakeable).map((r) => r.id),
        tags: [...new Set(recipes.flatMap((r) => r.tags))].sort(),
        techniques: [...new Set(recipes.flatMap((r) => r.techniques))].sort(),
        recent_meals: (db.prepare('SELECT * FROM cooking_log ORDER BY cooked_on DESC, id DESC LIMIT 10').all() as LogRow[]).map(logView),
        meals_logged: (db.prepare('SELECT COUNT(*) AS n FROM cooking_log').get() as { n: number }).n,
        skills: skills(db),
      };
    },
    // ?q=chili&tag=weeknight&technique=braising&favourite=1
    recipes: (p, db) => {
      const q = p.q ? normalizeName(p.q) : '';
      const ings = q ? ingredientsByRecipe(db) : null;
      return {
        recipes: summaries(db).filter(
          (r) =>
            (!p.tag || r.tags.includes(p.tag.toLowerCase())) &&
            (!p.technique || r.techniques.includes(p.technique.toLowerCase())) &&
            (p.favourite !== '1' || r.favourite) &&
            (!q || normalizeName(r.title).includes(q) || (ings!.get(r.id) ?? []).some((i) => i.name_key.includes(q))),
        ),
      };
    },
    // One recipe in full, for the recipe screen and the cooking mode. ?id=12
    recipe: (p, db) => {
      const id = Number(p.id);
      const summary = Number.isInteger(id) ? summaries(db).find((r) => r.id === id) : undefined;
      if (!summary) return { recipe: null };
      const fit = summary.pantry;
      const haveByName = new Map(fit.have.map((h) => [h.name, h]));
      const missingByName = new Map(fit.missing.map((m) => [m.name, m]));
      const ingredients = (db.prepare('SELECT * FROM cooking_recipe_ingredients WHERE recipe_id = ? ORDER BY position').all(id) as IngredientRow[]).map((i) => {
        const h = haveByName.get(i.name);
        return {
          position: i.position, name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, amount: formatAmount(i.quantity, i.unit),
          in_pantry: !!h, match: h?.match ?? null,
          pantry_item: h && h.pantry_item_id != null ? { id: h.pantry_item_id, name: h.pantry_name, amount: h.pantry_amount, location: h.location, expires_on: h.expires_on, days_left: h.days_left } : null,
          on_shopping_list: missingByName.get(i.name)?.on_shopping_list ?? false,
        };
      });
      const steps = (db.prepare('SELECT position, text, timer_seconds FROM cooking_recipe_steps WHERE recipe_id = ? ORDER BY position').all(id) as Pick<StepRow, 'position' | 'text' | 'timer_seconds'>[]);
      const log = (db.prepare('SELECT * FROM cooking_log WHERE recipe_id = ? ORDER BY cooked_on DESC, id DESC').all(id) as LogRow[]).map(logView);
      return { recipe: { ...summary, ingredients, steps, log } };
    },
    // "What can I make tonight": every recipe against the pantry, fewest missing first. ?max_missing=2&soon_days=3
    can_make: (p, db) => {
      const soonDays = intParam(p.soon_days, SOON_DAYS, 0, 60);
      const maxMissing = intParam(p.max_missing, 1000, 0, 1000);
      const recipes = summaries(db, soonDays)
        .filter((r) => r.ingredient_count > 0 && r.pantry.missing_count <= maxMissing)
        .sort(byMakeable)
        .map((r) => ({
          id: r.id, title: r.title, total_minutes: r.total_minutes, difficulty: r.difficulty, rating: r.rating, favourite: r.favourite,
          tags: r.tags, techniques: r.techniques, times_cooked: r.times_cooked, last_cooked_on: r.last_cooked_on, ...r.pantry,
        }));
      return { today: localDay(), soon_days: soonDays, pantry_item_count: inStockItems(db).length, recipes };
    },
    // The cook log, newest first. ?limit=50&recipe_id=12
    log: (p, db) => {
      const limit = intParam(p.limit, 50, 1, 500);
      const recipeId = Number(p.recipe_id);
      const rows = (p.recipe_id && Number.isInteger(recipeId)
        ? db.prepare('SELECT * FROM cooking_log WHERE recipe_id = ? ORDER BY cooked_on DESC, id DESC LIMIT ?').all(recipeId, limit)
        : db.prepare('SELECT * FROM cooking_log ORDER BY cooked_on DESC, id DESC LIMIT ?').all(limit)) as LogRow[];
      return { entries: rows.map(logView), total: (db.prepare('SELECT COUNT(*) AS n FROM cooking_log').get() as { n: number }).n };
    },
    skills: (_p, db) => skills(db),
    home: (_p, db) => {
      const cards: { title: string; lines: string[]; link: string }[] = [];
      const today = localDay();
      // Something saved that is fully makeable and uses up food about to expire.
      const useUp = summaries(db)
        .filter((r) => r.pantry.can_make && r.pantry.uses_expiring.some((u) => u.days_left >= 0))
        .sort(byMakeable)
        .slice(0, 3);
      if (useUp.length) {
        cards.push({
          title: 'Cook tonight',
          lines: useUp.map((r) => `${r.title} — uses ${r.pantry.uses_expiring.filter((u) => u.days_left >= 0).slice(0, 2).map((u) => u.name.toLowerCase()).join(', ')}`),
          link: '/cooking',
        });
      }
      // A meal from the last few days that Ben has not rated.
      const last = db.prepare('SELECT * FROM cooking_log ORDER BY cooked_on DESC, id DESC LIMIT 1').get() as LogRow | undefined;
      if (last && last.rating == null) {
        const ago = daysBetween(last.cooked_on, today);
        if (ago >= 0 && ago <= 3) {
          cards.push({ title: 'Rate your last meal', lines: [`${last.dish} — cooked ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}`], link: '/cooking' });
        }
      }
      return { cards };
    },
  },
});
