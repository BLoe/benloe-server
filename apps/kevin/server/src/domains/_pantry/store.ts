// Pantry and shopping-list writes. One place decides how a spoken item name
// finds its row and how an amount changes, so chat, the page, the shopping
// list's "purchase" and the cook log's deduction all behave the same.
import { type DB, nowIso } from '../../db.js';
import { localDay } from '../../time.js';
import { cleanName, convert, daysBetween, formatAmount, guessLocation, nameMatch, normalizeName, round } from './names.js';

export const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter', 'other'] as const;
export type Location = (typeof LOCATIONS)[number];
export const OPS = ['add', 'set', 'use', 'out', 'remove', 'edit'] as const;
export type Op = (typeof OPS)[number];

export interface PantryRow {
  id: number; name: string; name_key: string; location: string; category: string | null;
  quantity: number | null; unit: string | null; amount_note: string | null;
  expires_on: string | null; notes: string | null; in_stock: number; ran_out_on: string | null;
  created_at: string; updated_at: string;
}

export interface PantryChange {
  id?: number;
  name?: string;
  op?: Op;
  quantity?: number;
  unit?: string | null;
  amount_note?: string | null;
  location?: Location;
  expires_on?: string | null;
  category?: string | null;
  notes?: string | null;
  new_name?: string;
  add_to_shopping_list?: boolean;
}

export interface ChangeResult {
  id: number | null;
  name: string;
  did: 'added' | 'restocked' | 'increased' | 'set' | 'used' | 'ran_out' | 'removed' | 'edited' | 'unchanged';
  /** The item's state after the change, in words: "9 in fridge, expires 2026-11-20". */
  now: string;
  in_stock: boolean;
  note?: string;
}

export interface NotApplied { name: string; reason: string }
export interface PantryOutcome { changed: ChangeResult[]; not_applied: NotApplied[] }

export const tableExists = (db: DB, name: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

const getRow = (db: DB, id: number | bigint): PantryRow | undefined =>
  db.prepare('SELECT * FROM pantry_items WHERE id = ?').get(id) as PantryRow | undefined;

/** Everything on hand, soonest expiry first. Empty when the pantry domain is not loaded. */
export function inStockItems(db: DB): PantryRow[] {
  if (!tableExists(db, 'pantry_items')) return [];
  return db.prepare('SELECT * FROM pantry_items WHERE in_stock = 1 ORDER BY expires_on IS NULL, expires_on, name COLLATE NOCASE').all() as PantryRow[];
}

/** "9 in fridge, expires 2026-11-20" / "out of stock". */
export function describeItem(r: PantryRow): string {
  if (!r.in_stock) return 'out of stock';
  const amount = formatAmount(r.quantity, r.unit, r.amount_note) || 'some';
  return `${amount} in ${r.location}${r.expires_on ? `, expires ${r.expires_on}` : ''}`;
}

const bySoonestExpiry = (a: PantryRow, b: PantryRow): number =>
  (a.expires_on ?? '9999') < (b.expires_on ?? '9999') ? -1 : (a.expires_on ?? '9999') > (b.expires_on ?? '9999') ? 1 : a.id - b.id;

/** Finds the row a change is about. `null` row: nothing there, and the op may create it. */
function resolve(db: DB, c: PantryChange, op: Op): { row: PantryRow | null; problem?: string; alsoAt?: PantryRow[] } {
  if (c.id != null) {
    const row = getRow(db, c.id);
    return row ? { row } : { row: null, problem: `No pantry item with id ${c.id}.` };
  }
  const key = normalizeName(c.name ?? '');
  if (!key) return { row: null, problem: 'An item needs a name (or an id).' };
  const creating = op === 'add' || op === 'set';
  let rows = db.prepare('SELECT * FROM pantry_items WHERE name_key = ?').all(key) as PantryRow[];
  let similar = false;
  if (!rows.length && !creating) {
    const all = db.prepare('SELECT * FROM pantry_items').all() as PantryRow[];
    rows = all.filter((r) => nameMatch(key, r.name_key) === 'similar');
    similar = true;
    if (!rows.length) {
      const words = key.split(' ');
      const near = all.filter((r) => r.name_key.split(' ').some((w) => words.includes(w))).slice(0, 5).map((r) => r.name);
      return { row: null, problem: `No "${c.name}" in the pantry.${near.length ? ` Closest: ${near.join(', ')}.` : ''}` };
    }
  }
  if (!rows.length) return { row: null };

  if (c.location) {
    const there = rows.filter((r) => r.location === c.location);
    if (there.length) rows = there;
    else if (creating) {
      // New stock somewhere else. A lone ran-out row is reused (and moved); otherwise this is a second row.
      if (rows.length === 1 && !rows[0]!.in_stock) return { row: rows[0]! };
      return { row: null, alsoAt: rows.filter((r) => r.in_stock) };
    }
  }
  if (rows.length > 1) {
    const stocked = rows.filter((r) => r.in_stock);
    if (stocked.length) rows = stocked;
  }
  if (rows.length > 1) {
    if (similar && new Set(rows.map((r) => r.name_key)).size > 1) {
      return { row: null, problem: `"${c.name}" could be ${rows.map((r) => `${r.name} (${r.location})`).join(' or ')}. Use the exact name.` };
    }
    // The same item kept in several places. Using it takes from whichever expires first.
    if (op === 'use') return { row: [...rows].sort(bySoonestExpiry)[0]! };
    return { row: null, problem: `${rows[0]!.name} is in ${rows.map((r) => r.location).join(' and ')}. Give the location.` };
  }
  return { row: rows[0]! };
}

function applyOne(db: DB, c: PantryChange, out: PantryOutcome): void {
  const op: Op = c.op ?? 'add';
  const label = c.name ?? `#${c.id}`;
  const fail = (reason: string): void => void out.not_applied.push({ name: label, reason });
  const found = resolve(db, c, op);
  if (found.problem) return fail(found.problem);
  const today = localDay();
  const now = nowIso();
  const notes: string[] = [];
  const category = c.category === undefined ? undefined : c.category?.trim().toLowerCase() || null;

  // ---- a new row ----
  if (!found.row) {
    const name = cleanName(c.new_name ?? c.name!);
    const key = normalizeName(name);
    const location = c.location ?? guessLocation(key);
    if (db.prepare('SELECT 1 FROM pantry_items WHERE name_key = ? AND location = ?').get(key, location)) {
      return fail(`${name} is already in ${location}. Say which location this goes to.`);
    }
    const inStock = c.quantity === 0 ? 0 : 1;
    const id = db
      .prepare(
        `INSERT INTO pantry_items (name, name_key, location, category, quantity, unit, amount_note, expires_on, notes, in_stock, ran_out_on, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(name, key, location, category ?? null, c.quantity ?? null, c.unit?.trim() || null, inStock ? c.amount_note?.trim() || null : null,
        inStock ? c.expires_on ?? null : null, c.notes?.trim() || null, inStock, inStock ? null : today, now, now).lastInsertRowid;
    const row = getRow(db, id)!;
    if (found.alsoAt?.length) notes.push(`also ${found.alsoAt.map((r) => describeItem(r).replace(/, expires.*/, '')).join('; ')}`);
    if (c.add_to_shopping_list) {
      addShoppingItems(db, [{ name: row.name, source: inStock ? 'manual' : 'ran_out' }]);
      notes.push('on the shopping list');
    }
    out.changed.push({ id: row.id, name: row.name, did: 'added', now: describeItem(row), in_stock: !!row.in_stock, ...(notes.length ? { note: notes.join('; ') } : {}) });
    return;
  }

  // ---- an existing row ----
  const row = { ...found.row };
  let did = 'unchanged' as ChangeResult['did'];
  if (op === 'remove') {
    db.prepare('DELETE FROM pantry_items WHERE id = ?').run(row.id);
    out.changed.push({ id: null, name: row.name, did: 'removed', now: 'removed', in_stock: false });
    return;
  }
  const markOut = (): void => {
    row.in_stock = 0;
    row.quantity = 0;
    row.amount_note = null;
    row.expires_on = null;
    row.ran_out_on = today;
    did = 'ran_out';
  };
  const wasOut = !row.in_stock;
  const restock = (): void => {
    row.in_stock = 1;
    row.ran_out_on = null;
    row.quantity = null;
    row.amount_note = null;
    row.expires_on = null;
  };
  const setsAmount = c.quantity !== undefined || (c.amount_note !== undefined && c.amount_note !== null && c.amount_note.trim() !== '');

  if (op === 'out') {
    if (wasOut) notes.push('was already out');
    else markOut();
  } else if (op === 'use') {
    if (wasOut) notes.push('was already out');
    else if (c.quantity === undefined) notes.push('no amount given, so the amount on record is unchanged');
    else if (row.quantity == null) notes.push(`the amount on record is not a number${row.amount_note ? ` ("${row.amount_note}")` : ''}; set what is left`);
    else {
      const used = convert(c.quantity, c.unit === undefined ? row.unit : c.unit, row.unit, row.name_key);
      if (used == null) notes.push(`cannot subtract ${formatAmount(c.quantity, c.unit)} from ${formatAmount(row.quantity, row.unit)}; set what is left`);
      else {
        const left = round(row.quantity - used);
        if (left <= 0) {
          if (left < 0) notes.push(`only ${formatAmount(row.quantity, row.unit)} was on record`);
          markOut();
        } else {
          row.quantity = left;
          did = 'used';
        }
      }
    }
  } else if (op === 'add') {
    if (wasOut) {
      restock();
      row.quantity = c.quantity ?? null;
      if (c.unit !== undefined) row.unit = c.unit?.trim() || null;
      did = 'restocked';
    } else if (c.quantity !== undefined) {
      if (row.quantity == null) {
        row.quantity = c.quantity;
        if (c.unit !== undefined) row.unit = c.unit?.trim() || null;
        did = 'set';
      } else {
        const more = convert(c.quantity, c.unit === undefined ? row.unit : c.unit, row.unit, row.name_key);
        if (more == null) {
          const extra = formatAmount(c.quantity, c.unit);
          row.amount_note = [row.amount_note, `plus ${extra}`].filter(Boolean).join(', ');
          notes.push(`${formatAmount(row.quantity, row.unit)} and ${extra} do not add up, so the extra is in amount_note`);
        } else row.quantity = round(row.quantity + more);
        did = 'increased';
      }
    }
    if (c.amount_note !== undefined) row.amount_note = c.amount_note?.trim() || null;
    if (c.expires_on !== undefined) {
      // Older stock is still there: the date that matters is the earlier one.
      const keepOlder = !wasOut && did === 'increased' && row.expires_on && c.expires_on && row.expires_on < c.expires_on;
      if (keepOlder) notes.push(`kept the earlier expiry ${row.expires_on} for the older stock`);
      else {
        if (row.expires_on !== c.expires_on && did === 'unchanged') did = 'edited';
        row.expires_on = c.expires_on;
      }
    }
  } else {
    // set and edit
    if (c.quantity === 0) {
      if (wasOut) notes.push('was already out');
      else markOut();
    } else {
      if (setsAmount) {
        if (wasOut) restock();
        row.quantity = c.quantity ?? null;
        row.amount_note = c.amount_note?.trim() || null;
        did = wasOut ? 'restocked' : 'set';
      } else if (op === 'set' && wasOut) {
        restock();
        did = 'restocked';
      } else if (c.amount_note === null && row.amount_note) {
        row.amount_note = null;
        did = 'edited';
      }
      if (c.unit !== undefined && (c.unit?.trim() || null) !== row.unit) {
        row.unit = c.unit?.trim() || null;
        if (did === 'unchanged') did = 'edited';
      }
      if (c.expires_on !== undefined && c.expires_on !== row.expires_on && row.in_stock) {
        row.expires_on = c.expires_on;
        if (did === 'unchanged') did = 'edited';
      }
    }
  }

  // ---- fields any op may carry ----
  const edited = (): void => {
    if (did === 'unchanged') did = 'edited';
  };
  if (category !== undefined && category !== row.category) {
    row.category = category;
    edited();
  }
  if (c.notes !== undefined && (c.notes?.trim() || null) !== row.notes) {
    row.notes = c.notes?.trim() || null;
    edited();
  }
  let name = row.name;
  let key = row.name_key;
  if (c.new_name && cleanName(c.new_name) !== row.name) {
    name = cleanName(c.new_name);
    key = normalizeName(name);
    if (!key) return fail('The new name is empty.');
  }
  const location = c.location ?? row.location;
  if (key !== row.name_key || location !== row.location) {
    const clash = db.prepare('SELECT id FROM pantry_items WHERE name_key = ? AND location = ? AND id <> ?').get(key, location, row.id);
    if (clash) return fail(`There is already ${name} in ${location}. Change that one, or remove one of them.`);
    row.name = name;
    row.name_key = key;
    row.location = location;
    edited();
  } else if (name !== row.name) {
    row.name = name;
    edited();
  }

  if (did !== 'unchanged') {
    db.prepare(
      `UPDATE pantry_items SET name = ?, name_key = ?, location = ?, category = ?, quantity = ?, unit = ?, amount_note = ?, expires_on = ?, notes = ?,
         in_stock = ?, ran_out_on = ?, updated_at = ? WHERE id = ?`,
    ).run(row.name, row.name_key, row.location, row.category, row.quantity, row.unit, row.amount_note, row.expires_on, row.notes, row.in_stock, row.ran_out_on, now, row.id);
  }
  if (c.add_to_shopping_list) {
    addShoppingItems(db, [{ name: row.name, source: row.in_stock ? 'manual' : 'ran_out' }]);
    notes.push('on the shopping list');
  }
  out.changed.push({ id: row.id, name: row.name, did, now: describeItem(row), in_stock: !!row.in_stock, ...(notes.length ? { note: notes.join('; ') } : {}) });
}

/**
 * Applies a list of pantry changes in one transaction. A change that cannot
 * be applied (no such item, ambiguous name) is reported in `not_applied` and
 * the rest still go through.
 */
export function applyPantryChanges(db: DB, changes: PantryChange[]): PantryOutcome {
  const out: PantryOutcome = { changed: [], not_applied: [] };
  db.transaction(() => {
    for (const c of changes) applyOne(db, c, out);
  })();
  return out;
}

// ---- shopping list -----------------------------------------------------------

export interface ShoppingRow {
  id: number; name: string; name_key: string; quantity: number | null; unit: string | null; note: string | null;
  checked: number; source: string; recipe_id: number | null; for_recipe: string | null; created_at: string; updated_at: string;
}

export interface ShoppingAdd {
  name: string;
  quantity?: number;
  unit?: string | null;
  note?: string | null;
  recipe_id?: number;
  for_recipe?: string;
  source?: 'manual' | 'recipe' | 'ran_out';
}

/** Adds items to the list. An item already listed is updated in place, not duplicated. */
export function addShoppingItems(db: DB, items: ShoppingAdd[]): { added: string[]; already_listed: string[] } {
  const res = { added: [] as string[], already_listed: [] as string[] };
  const now = nowIso();
  for (const it of items) {
    const name = cleanName(it.name);
    const key = normalizeName(name);
    if (!key) continue;
    let forRecipe = it.for_recipe?.trim() || null;
    if (it.recipe_id != null && !forRecipe && tableExists(db, 'cooking_recipes')) {
      forRecipe = (db.prepare('SELECT title FROM cooking_recipes WHERE id = ?').get(it.recipe_id) as { title: string } | undefined)?.title ?? null;
    }
    const source = it.source ?? (it.recipe_id != null || forRecipe ? 'recipe' : 'manual');
    const existing = db.prepare('SELECT * FROM pantry_shopping_list WHERE name_key = ?').get(key) as ShoppingRow | undefined;
    if (existing) {
      db.prepare(
        'UPDATE pantry_shopping_list SET quantity = ?, unit = ?, note = ?, checked = 0, recipe_id = COALESCE(?, recipe_id), for_recipe = COALESCE(?, for_recipe), updated_at = ? WHERE id = ?',
      ).run(
        it.quantity ?? existing.quantity, it.unit === undefined ? existing.unit : it.unit?.trim() || null, it.note === undefined ? existing.note : it.note?.trim() || null,
        it.recipe_id ?? null, forRecipe, now, existing.id,
      );
      res.already_listed.push(existing.name);
    } else {
      db.prepare('INSERT INTO pantry_shopping_list (name, name_key, quantity, unit, note, checked, source, recipe_id, for_recipe, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?,?,?)')
        .run(name, key, it.quantity ?? null, it.unit?.trim() || null, it.note?.trim() || null, source, it.recipe_id ?? null, forRecipe, now, now);
      res.added.push(name);
    }
  }
  return res;
}

/** Resolves names and ids to list rows; what matched nothing comes back in `notFound`. */
export function findShoppingRows(db: DB, refs: (string | number)[]): { rows: ShoppingRow[]; notFound: string[] } {
  const all = db.prepare('SELECT * FROM pantry_shopping_list ORDER BY id').all() as ShoppingRow[];
  const rows = new Map<number, ShoppingRow>();
  const notFound: string[] = [];
  for (const ref of refs) {
    let hits: ShoppingRow[];
    if (typeof ref === 'number') hits = all.filter((r) => r.id === ref);
    else {
      const key = normalizeName(ref);
      hits = all.filter((r) => r.name_key === key);
      if (!hits.length) hits = all.filter((r) => nameMatch(key, r.name_key) === 'similar');
    }
    if (hits.length) hits.forEach((h) => rows.set(h.id, h));
    else notFound.push(String(ref));
  }
  return { rows: [...rows.values()], notFound };
}

/** Moves list rows into the pantry (as `add`) and takes them off the list. */
export function purchaseShoppingRows(db: DB, rows: ShoppingRow[]): PantryOutcome {
  const out: PantryOutcome = { changed: [], not_applied: [] };
  db.transaction(() => {
    for (const r of rows) {
      const before = out.changed.length;
      applyOne(db, { name: r.name, op: 'add', ...(r.quantity != null ? { quantity: r.quantity } : {}), ...(r.unit ? { unit: r.unit } : {}) }, out);
      if (out.changed.length > before) db.prepare('DELETE FROM pantry_shopping_list WHERE id = ?').run(r.id);
    }
  })();
  return out;
}

// ---- shapes the pages read ---------------------------------------------------

export interface PantryItemView {
  id: number; name: string; location: string; category: string | null;
  quantity: number | null; unit: string | null; amount_note: string | null;
  /** quantity + unit + amount_note as one string for display; '' when nothing is known. */
  amount: string;
  expires_on: string | null;
  /** Days until expires_on; 0 = today, negative = expired, null = no date. */
  days_left: number | null;
  expiry: 'expired' | 'soon' | 'ok' | null;
  notes: string | null; in_stock: boolean; ran_out_on: string | null; on_shopping_list: boolean;
  created_at: string; updated_at: string;
}

export function itemView(r: PantryRow, today: string, soonDays: number, listed: Set<string>): PantryItemView {
  const daysLeft = r.expires_on && r.in_stock ? daysBetween(today, r.expires_on) : null;
  return {
    id: r.id, name: r.name, location: r.location, category: r.category,
    quantity: r.quantity, unit: r.unit, amount_note: r.amount_note, amount: r.in_stock ? formatAmount(r.quantity, r.unit, r.amount_note) : '',
    expires_on: r.expires_on, days_left: daysLeft,
    expiry: daysLeft == null ? null : daysLeft < 0 ? 'expired' : daysLeft <= soonDays ? 'soon' : 'ok',
    notes: r.notes, in_stock: !!r.in_stock, ran_out_on: r.ran_out_on, on_shopping_list: listed.has(r.name_key),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

export const shoppingKeys = (db: DB): Set<string> =>
  new Set(tableExists(db, 'pantry_shopping_list') ? (db.prepare('SELECT name_key FROM pantry_shopping_list').all() as { name_key: string }[]).map((r) => r.name_key) : []);
