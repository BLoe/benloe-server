// Pantry: what food is in the house, when it expires, and the shopping list.
// The matching and arithmetic live in _pantry/store.ts so the cook log can
// deduct ingredients through the same code.
import { z } from 'zod';
import { defineDomain } from '../domains.js';
import type { DB } from '../db.js';
import { localDay } from '../time.js';
import { defineTool, ToolError } from '../tools.js';
import { expiryPhrase, formatAmount, isDay, normalizeName } from './_pantry/names.js';
import {
  LOCATIONS, OPS, type PantryItemView, type PantryRow, type ShoppingRow,
  addShoppingItems, applyPantryChanges, findShoppingRows, itemView, purchaseShoppingRows, shoppingKeys,
} from './_pantry/store.js';

const day = z.string().refine(isDay, 'must be a real date written YYYY-MM-DD');

const SOON_DAYS = 3;
const intParam = (v: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

function allItems(db: DB, soonDays = SOON_DAYS): PantryItemView[] {
  const today = localDay();
  const listed = shoppingKeys(db);
  const rows = db.prepare('SELECT * FROM pantry_items ORDER BY name COLLATE NOCASE, location').all() as PantryRow[];
  return rows.map((r) => itemView(r, today, soonDays, listed));
}

interface ShoppingItemView {
  id: number; name: string; quantity: number | null; unit: string | null; amount: string; note: string | null;
  checked: boolean; source: string; recipe_id: number | null; for_recipe: string | null; in_pantry: boolean;
  created_at: string; updated_at: string;
}

function shoppingList(db: DB): ShoppingItemView[] {
  const stocked = new Set((db.prepare('SELECT name_key FROM pantry_items WHERE in_stock = 1').all() as { name_key: string }[]).map((r) => r.name_key));
  const rows = db.prepare('SELECT * FROM pantry_shopping_list ORDER BY checked, id').all() as ShoppingRow[];
  return rows.map((r) => ({
    id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, amount: formatAmount(r.quantity, r.unit), note: r.note,
    checked: !!r.checked, source: r.source, recipe_id: r.recipe_id, for_recipe: r.for_recipe, in_pantry: stocked.has(r.name_key),
    created_at: r.created_at, updated_at: r.updated_at,
  }));
}

const byExpiry = (a: PantryItemView, b: PantryItemView): number => (a.days_left ?? 0) - (b.days_left ?? 0) || a.name.localeCompare(b.name);

const listCounts = (db: DB): { to_buy: number; checked: number } =>
  db.prepare('SELECT COALESCE(SUM(checked = 0), 0) AS to_buy, COALESCE(SUM(checked = 1), 0) AS checked FROM pantry_shopping_list').get() as { to_buy: number; checked: number };

const itemChange = z.object({
  name: z.string().min(1).max(120).optional().describe('The item as Ben says it: "eggs", "chicken thighs". Matched to an existing item ignoring case, plurals and spacing. Required unless id is given.'),
  id: z.number().int().optional().describe('pantry_items.id, to target one exact row instead of matching by name.'),
  op: z.enum(OPS).default('add').describe(
    'add: bought or found more; quantity is added to what is there, and the item is created if new. ' +
      'set: the amount is now exactly this (a count from a fridge photo, a correction); creates the item if new. ' +
      'use: subtract quantity; reaching zero marks it out of stock. ' +
      'out: ran out; the row stays with in_stock = 0 so it shows under "out of". ' +
      'remove: delete the row (a mistake, or something Ben will not keep again). ' +
      'edit: change unit, location, expiry, category, notes or name without touching the amount.',
  ),
  quantity: z.number().min(0).optional().describe('The numeric amount in `unit`: 2 for "2 lbs", 6 for "6 eggs". Leave out when the amount is not a number.'),
  unit: z.string().max(30).nullable().optional().describe('US unit or container, singular: lb, oz, cup, gallon, can, bag, bunch, dozen. Leave out for things counted singly (eggs, lemons). lb/oz, cup/tbsp/tsp/quart/gallon and dozen/each convert into the unit already on record.'),
  amount_note: z.string().max(80).nullable().optional().describe('The amount in words when it is not a number: "half a bag", "almost empty".'),
  location: z.enum(LOCATIONS).optional().describe('Where it is kept. Give it for new items. For an item kept in two places it picks which row.'),
  expires_on: day.nullable().optional().describe('Expiry or use-by date, YYYY-MM-DD. null clears it.'),
  category: z.string().max(30).nullable().optional().describe('produce, dairy, meat, seafood, grains, canned, baking, spices, condiments, snacks, drinks, frozen or other.'),
  notes: z.string().max(300).nullable().optional().describe('Anything else worth keeping: brand, "opened", "for Saturday".'),
  new_name: z.string().min(1).max(120).optional().describe('Rename the item.'),
  add_to_shopping_list: z.boolean().optional().describe('Also put this item on the shopping list, e.g. when it has just run out and Ben wants more.'),
});

const ref = z.union([z.string().min(1), z.number().int()]).describe('An item name, or a pantry_shopping_list.id.');

export default defineDomain({
  name: 'pantry',
  migrations: [
    {
      id: 'pantry-001',
      sql: `
      CREATE TABLE pantry_items (
        -- The food in the house. One row per item per location; (name_key, location) is unique.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,                        -- as Ben says it: 'Chicken thighs'
        name_key TEXT NOT NULL,                    -- name lowercased and singular for matching: 'chicken thigh'. Search with name_key LIKE '%egg%'
        location TEXT NOT NULL DEFAULT 'pantry',   -- fridge | freezer | pantry | counter | other
        category TEXT,                             -- produce | dairy | meat | seafood | grains | canned | baking | spices | condiments | snacks | drinks | frozen | other
        quantity REAL,                             -- how much, in unit; NULL when the amount is not a number (see amount_note); 0 when out of stock
        unit TEXT,                                 -- free text, US units: lb, oz, cup, gallon, can, bag, bunch; NULL = counted singly (6 eggs)
        amount_note TEXT,                          -- the amount in words when not numeric: 'half a bag'
        expires_on TEXT,                           -- YYYY-MM-DD in Ben's timezone; NULL = no date known
        notes TEXT,
        in_stock INTEGER NOT NULL DEFAULT 1,       -- 1 = in the house. 0 = ran out; the row is kept so "what am I out of" has an answer. Filter in_stock = 1 for what Ben has
        ran_out_on TEXT,                           -- YYYY-MM-DD it ran out; NULL while in stock
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX pantry_items_key ON pantry_items(name_key, location);
      CREATE INDEX pantry_items_expiry ON pantry_items(in_stock, expires_on);
      CREATE TABLE pantry_shopping_list (
        -- What to buy. A row leaves the list when it is purchased (moved into pantry_items) or removed.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,             -- same normalisation as pantry_items.name_key
        quantity REAL,                             -- how much to buy, in unit; NULL = unspecified
        unit TEXT,
        note TEXT,                                 -- 'the low-sodium kind'
        checked INTEGER NOT NULL DEFAULT 0,        -- 1 = ticked off in the store, not yet put away in the pantry
        source TEXT NOT NULL DEFAULT 'manual',     -- manual | recipe (a missing ingredient) | ran_out
        recipe_id INTEGER,                         -- cooking_recipes.id when source = 'recipe'
        for_recipe TEXT,                           -- that recipe's title
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      `,
    },
  ],
  promptNote: `What food is in the house (pantry_items) and what to buy (pantry_shopping_list). Page: /pantry.
- Every change goes through pantry_update, one call for the whole message: a receipt or fridge photo is one call with every item in it. Names match existing items whatever the case or plural ("Eggs" finds "egg"), so say the item the plain way Ben does and keep one name per thing: "milk", with the brand or kind in notes.
- op: add for groceries coming in, set when the amount is now known exactly (a fridge photo), use when Ben consumed some, out when it is gone, remove only for a mistaken row.
- For new items give location, category, and expires_on when Ben said it or the food is perishable enough that a date helps (estimate from the purchase date for meat, dairy and produce). Dates are YYYY-MM-DD; work them out from today's date in <context>.
- Reading: in_stock = 1 is what Ben has; in_stock = 0 is what he ran out of. Expiring this week, with the cutoff date worked out from today's date in <context>: SELECT name, location, quantity, unit, amount_note, expires_on FROM pantry_items WHERE in_stock = 1 AND expires_on <= '2026-11-21' ORDER BY expires_on. Rows already past their date come back too; say so.
- "I bought everything on the list" is pantry_shopping_list_update { purchase: "all" }: the items move into the pantry and leave the list.`,
  tools: [
    defineTool({
      name: 'pantry_update',
      description:
        'Change what is in Ben\'s pantry, fridge or freezer. Takes a list, so one call covers a whole receipt, a fridge photo, or a single remark. ' +
        'Examples: "I used 3 eggs" -> {items:[{name:"eggs",op:"use",quantity:3}]}. "We\'re out of milk" -> {items:[{name:"milk",op:"out"}]}. ' +
        '"Add chicken thighs, 2 lbs, expires Friday" -> {items:[{name:"chicken thighs",quantity:2,unit:"lb",location:"fridge",category:"meat",expires_on:"2026-11-20"}]}. ' +
        'Returns each item\'s resulting state in `changed` and, in `not_applied`, any item it could not match with the reason; the rest of the list is still applied.',
      input: z.object({ items: z.array(itemChange).min(1).max(200).describe('One entry per item changed.') }),
      touches: ['pantry'],
      run: ({ items }, ctx) => {
        const missing = items.findIndex((i) => !i.name?.trim() && i.id == null);
        if (missing >= 0) throw new ToolError(`items[${missing}] needs a name or an id.`);
        const out = applyPantryChanges(ctx.db, items);
        if (!out.changed.length) throw new ToolError(`Nothing was changed. ${out.not_applied.map((n) => n.reason).join(' ')}`);
        return { changed: out.changed, ...(out.not_applied.length ? { not_applied: out.not_applied } : {}) };
      },
    }),
    defineTool({
      name: 'pantry_shopping_list_update',
      description:
        'Change the shopping list. Any mix of actions in one call: add items, check or uncheck them, remove them, clear the list, or purchase them (move them into the pantry and off the list). ' +
        'Examples: "put eggs and 2 lbs of ground beef on the list" -> {add:[{name:"eggs"},{name:"ground beef",quantity:2,unit:"lb"}]}. ' +
        '"I bought everything on the list" -> {purchase:"all"}. "Got the milk and the eggs" -> {purchase:["milk","eggs"]}. ' +
        'Purchased items arrive in the pantry with the list\'s quantity; follow with pantry_update to set expiry dates when Ben gives them.',
      input: z.object({
        add: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              quantity: z.number().positive().optional(),
              unit: z.string().max(30).nullable().optional(),
              note: z.string().max(200).nullable().optional().describe('Which kind, which store, or why.'),
              recipe_id: z.number().int().optional().describe('cooking_recipes.id when this is a missing ingredient for a recipe.'),
            }),
          )
          .max(200)
          .optional()
          .describe('Items to put on the list. An item already listed is updated, not duplicated.'),
        check: z.array(ref).max(200).optional().describe('Tick items off (in the cart).'),
        uncheck: z.array(ref).max(200).optional(),
        remove: z.array(ref).max(200).optional().describe('Take items off the list without buying them.'),
        clear: z.enum(['checked', 'all']).optional().describe('Remove every checked item, or empty the list, without adding anything to the pantry.'),
        purchase: z
          .union([z.enum(['all', 'checked']), z.array(ref).min(1).max(200)])
          .optional()
          .describe('Ben bought these: move them into the pantry and off the list. "all", "checked", or a list of names/ids.'),
      }),
      touches: ['pantry'],
      run: (input, ctx) => {
        const { db } = ctx;
        const result: Record<string, unknown> = {};
        const notFound: string[] = [];
        let did = 0;
        db.transaction(() => {
          if (input.add?.length) {
            const r = addShoppingItems(db, input.add);
            if (r.added.length) result.added = r.added;
            if (r.already_listed.length) result.already_listed = r.already_listed;
            did += r.added.length + r.already_listed.length;
          }
          const mark = (refs: (string | number)[] | undefined, checked: 0 | 1, key: string): void => {
            if (!refs?.length) return;
            const { rows, notFound: nf } = findShoppingRows(db, refs);
            notFound.push(...nf);
            for (const r of rows) db.prepare('UPDATE pantry_shopping_list SET checked = ?, updated_at = ? WHERE id = ?').run(checked, new Date().toISOString(), r.id);
            if (rows.length) result[key] = rows.map((r) => r.name);
            did += rows.length;
          };
          mark(input.check, 1, 'checked');
          mark(input.uncheck, 0, 'unchecked');
          if (input.remove?.length) {
            const { rows, notFound: nf } = findShoppingRows(db, input.remove);
            notFound.push(...nf);
            for (const r of rows) db.prepare('DELETE FROM pantry_shopping_list WHERE id = ?').run(r.id);
            if (rows.length) result.removed = rows.map((r) => r.name);
            did += rows.length;
          }
          if (input.purchase) {
            let rows: ShoppingRow[];
            if (input.purchase === 'all') rows = db.prepare('SELECT * FROM pantry_shopping_list ORDER BY id').all() as ShoppingRow[];
            else if (input.purchase === 'checked') rows = db.prepare('SELECT * FROM pantry_shopping_list WHERE checked = 1 ORDER BY id').all() as ShoppingRow[];
            else {
              const f = findShoppingRows(db, input.purchase);
              rows = f.rows;
              notFound.push(...f.notFound);
            }
            if (!rows.length && typeof input.purchase === 'string') {
              throw new ToolError(input.purchase === 'checked' ? 'No items on the shopping list are checked. Use purchase: "all" or name the items.' : 'The shopping list is empty.');
            }
            const out = purchaseShoppingRows(db, rows);
            if (out.changed.length) result.purchased = out.changed.map((c) => ({ name: c.name, now: c.now, ...(c.note ? { note: c.note } : {}) }));
            if (out.not_applied.length) result.not_purchased = out.not_applied;
            did += out.changed.length;
          }
          if (input.clear) {
            const n = db.prepare(input.clear === 'all' ? 'DELETE FROM pantry_shopping_list' : 'DELETE FROM pantry_shopping_list WHERE checked = 1').run().changes;
            result.cleared = n;
            did += 1;
          }
          if (!did) {
            if (notFound.length) {
              const names = (db.prepare('SELECT name FROM pantry_shopping_list ORDER BY id').all() as { name: string }[]).map((r) => r.name);
              throw new ToolError(`Not on the shopping list: ${notFound.join(', ')}. ${names.length ? `On it: ${names.join(', ')}.` : 'The list is empty.'}`);
            }
            throw new ToolError('Nothing to do: give add, check, uncheck, remove, clear or purchase.');
          }
        })();
        if (notFound.length) result.not_found = notFound;
        result.list = listCounts(db);
        return result;
      },
    }),
  ],
  views: {
    // Everything the Pantry page shows, in one call. ?soon_days=3
    overview: (p, db) => {
      const soonDays = intParam(p.soon_days, SOON_DAYS, 0, 60);
      const all = allItems(db, soonDays);
      const items = all.filter((i) => i.in_stock);
      const shopping = shoppingList(db);
      const byLocation: Record<string, number> = {};
      for (const i of items) byLocation[i.location] = (byLocation[i.location] ?? 0) + 1;
      return {
        today: localDay(),
        soon_days: soonDays,
        items,
        out_of_stock: all.filter((i) => !i.in_stock).sort((a, b) => (b.ran_out_on ?? '').localeCompare(a.ran_out_on ?? '')),
        expiring: items.filter((i) => i.expiry === 'expired' || i.expiry === 'soon').sort(byExpiry),
        shopping_list: shopping,
        counts: {
          in_stock: items.length,
          out_of_stock: all.length - items.length,
          expired: items.filter((i) => i.expiry === 'expired').length,
          expiring_soon: items.filter((i) => i.expiry === 'soon').length,
          to_buy: shopping.filter((s) => !s.checked).length,
          checked: shopping.filter((s) => s.checked).length,
          by_location: byLocation,
        },
      };
    },
    // ?location=fridge&category=dairy&q=egg&include_out=1
    items: (p, db) => {
      const q = p.q ? normalizeName(p.q) : '';
      const items = allItems(db).filter(
        (i) =>
          (p.include_out === '1' || i.in_stock) &&
          (!p.location || i.location === p.location) &&
          (!p.category || i.category === p.category.toLowerCase()) &&
          (!q || normalizeName(i.name).includes(q)),
      );
      return { today: localDay(), items };
    },
    // In stock and expired, or expiring within ?days=7, soonest first.
    expiring: (p, db) => {
      const days = intParam(p.days, 7, 0, 365);
      return { today: localDay(), days, items: allItems(db, days).filter((i) => i.expiry === 'expired' || i.expiry === 'soon').sort(byExpiry) };
    },
    shopping_list: (_p, db) => ({ items: shoppingList(db), ...listCounts(db) }),
    home: (_p, db) => {
      const cards: { title: string; lines: string[]; link: string }[] = [];
      const soon = allItems(db).filter((i) => i.in_stock && (i.expiry === 'expired' || i.expiry === 'soon')).sort(byExpiry);
      if (soon.length) {
        const lines = soon.slice(0, 5).map((i) => `${i.name} — ${expiryPhrase(i.days_left!)}`);
        if (soon.length > 5) lines.push(`and ${soon.length - 5} more`);
        cards.push({ title: 'Use soon', lines, link: '/pantry' });
      }
      const list = shoppingList(db);
      const toBuy = list.filter((s) => !s.checked);
      if (toBuy.length) {
        const names = toBuy.slice(0, 4).map((s) => s.name).join(', ') + (toBuy.length > 4 ? ` +${toBuy.length - 4}` : '');
        cards.push({ title: 'Shopping list', lines: [`${toBuy.length} ${toBuy.length === 1 ? 'item' : 'items'} to buy`, names], link: '/pantry' });
      } else if (list.length) {
        cards.push({ title: 'Shopping list', lines: [`${list.length} checked off, not yet put away`], link: '/pantry' });
      }
      return { cards };
    },
  },
});
