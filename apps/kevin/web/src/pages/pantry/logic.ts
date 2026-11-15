// The Pantry page's pure parts: the shapes `pantry/overview` returns, how
// rows are searched, sorted and grouped, how a typed line becomes an item, and
// how an edit sheet's draft becomes a `pantry_update` change.

export const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter', 'other'] as const;
export type Location = (typeof LOCATIONS)[number];
export const CATEGORIES = ['produce', 'dairy', 'meat', 'seafood', 'grains', 'canned', 'baking', 'spices', 'condiments', 'snacks', 'drinks', 'frozen', 'other'] as const;

export const locationLabel = (l: string): string => (l ? l.charAt(0).toUpperCase() + l.slice(1) : 'Other');

/** Where something is, as words for a sentence: "in the fridge", "on the counter", "" when the place has no name worth saying. */
export const wherePhrase = (l: string | null | undefined): string => (!l || l === 'other' ? '' : l === 'counter' ? 'on the counter' : `in the ${l}`);

export interface PantryItem {
  id: number;
  name: string;
  location: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  amount_note: string | null;
  /** quantity + unit + amount_note in one string; '' when nothing is known. */
  amount: string;
  expires_on: string | null;
  /** 0 = today, negative = expired, null = no date. */
  days_left: number | null;
  expiry: 'expired' | 'soon' | 'ok' | null;
  notes: string | null;
  in_stock: boolean;
  ran_out_on: string | null;
  on_shopping_list: boolean;
}

export interface ShoppingItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  amount: string;
  note: string | null;
  checked: boolean;
  source: string;
  recipe_id: number | null;
  for_recipe: string | null;
  in_pantry: boolean;
}

export interface PantryOverview {
  today: string;
  soon_days: number;
  items: PantryItem[];
  out_of_stock: PantryItem[];
  expiring: PantryItem[];
  shopping_list: ShoppingItem[];
  counts: { in_stock: number; out_of_stock: number; expired: number; expiring_soon: number; to_buy: number; checked: number; by_location: Record<string, number> };
}

/** What `pantry_update` answers with. */
export interface PantryResult {
  changed: { id: number | null; name: string; did: string; now: string; in_stock: boolean; note?: string }[];
  not_applied?: { name: string; reason: string }[];
}

/** What `pantry_shopping_list_update` answers with. */
export interface ShoppingResult {
  added?: string[];
  already_listed?: string[];
  removed?: string[];
  purchased?: { name: string; now: string; note?: string }[];
  not_purchased?: { name: string; reason: string }[];
  cleared?: number;
  list: { to_buy: number; checked: number };
}

// ---- expiry ---------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Expired 2 days ago", "Expires today", "Expires tomorrow", "Expires in 5 days"; past two weeks out, the date. */
export function expiryLabel(daysLeft: number, expiresOn?: string | null): string {
  if (daysLeft < -1) return `Expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return 'Expired yesterday';
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  if (daysLeft <= 14 || !expiresOn) return `Expires in ${daysLeft} days`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresOn);
  if (!m) return `Expires in ${daysLeft} days`;
  return `Expires ${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}${daysLeft > 300 ? `, ${m[1]}` : ''}`;
}

/** A `calendarDay` label for the middle of a sentence: "today" and "yesterday" lose their capital, "Sun, Nov 8" keeps its. */
export const midSentence = (label: string): string => (/^(Today|Tomorrow|Yesterday)$/.test(label) ? label.toLowerCase() : label);

/** `day` plus n days, both YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ---- search, sort, group --------------------------------------------------------

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const stem = (w: string): string => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Every word of the query appears in the text, plurals aside ("eggs" finds "Egg noodles"). */
export function matchesText(text: string, q: string): boolean {
  const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return true;
  const plain = fold(text);
  const hay = `${plain} ${plain.split(/[^a-z0-9]+/).map(stem).join(' ')}`;
  return words.every((w) => hay.includes(w) || hay.includes(stem(w)));
}

export function filterItems<T extends Pick<PantryItem, 'name' | 'category' | 'notes' | 'location'>>(items: T[], f: { q?: string; location?: string }): T[] {
  return items.filter((i) => (!f.location || i.location === f.location) && (!f.q || matchesText(`${i.name} ${i.category ?? ''} ${i.notes ?? ''}`, f.q)));
}

export type ItemSort = 'name' | 'expiry';

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** 'expiry': expired first, then soonest date, then the undated by name. 'name': A to Z. */
export function sortItems<T extends Pick<PantryItem, 'name' | 'days_left'>>(items: T[], sort: ItemSort): T[] {
  const out = [...items];
  if (sort === 'name') return out.sort(byName);
  return out.sort((a, b) => {
    if (a.days_left == null || b.days_left == null) return Number(a.days_left == null) - Number(b.days_left == null) || byName(a, b);
    return a.days_left - b.days_left || byName(a, b);
  });
}

export interface LocationGroup<T> {
  location: string;
  items: T[];
  /** How many of them are expired or expiring soon. */
  attention: number;
}

/** Items by where they are kept, in fridge-freezer-pantry-counter-other order; a location nobody listed goes last. */
export function groupByLocation<T extends Pick<PantryItem, 'name' | 'days_left' | 'location' | 'expiry'>>(items: T[], sort: ItemSort): LocationGroup<T>[] {
  const order = (l: string): number => {
    const i = (LOCATIONS as readonly string[]).indexOf(l);
    return i < 0 ? LOCATIONS.length : i;
  };
  const by = new Map<string, T[]>();
  for (const i of items) by.set(i.location, [...(by.get(i.location) ?? []), i]);
  return [...by.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([location, list]) => ({ location, items: sortItems(list, sort), attention: list.filter((i) => i.expiry === 'expired' || i.expiry === 'soon').length }));
}

/** Unchecked first, each in the order they were added. */
export function sortShopping<T extends Pick<ShoppingItem, 'id' | 'checked'>>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(a.checked) - Number(b.checked) || a.id - b.id);
}

// ---- amounts --------------------------------------------------------------------

/** 2, 0.5, .5, 1/2, 1 1/2 -> a number. null when the text is not an amount. */
export function parseQuantity(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 0.30000000000000004 -> "0.3"; 2 -> "2". */
export const formatNumber = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * How much one tap of − or + changes an item: 1 for things counted singly or
 * held in whole numbers, a quarter or a half for a small measured amount.
 * null when the amount on record is not a number.
 */
export function stepFor(item: Pick<PantryItem, 'quantity' | 'unit' | 'in_stock'>): number | null {
  if (!item.in_stock || item.quantity == null) return null;
  if (!item.unit) return 1;
  if (Number.isInteger(item.quantity) && item.quantity > 1) return 1;
  return item.quantity <= 1 ? 0.25 : 0.5;
}

const UNIT_ALIASES: Record<string, string> = {
  lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', gal: 'gallon', gallons: 'gallon', qt: 'quart', quarts: 'quart', pt: 'pint', pints: 'pint',
  cups: 'cup', liters: 'liter', cans: 'can', bags: 'bag', boxes: 'box', bunches: 'bunch', jars: 'jar', bottles: 'bottle', packs: 'pack', packages: 'package',
  cartons: 'carton', loaves: 'loaf', sticks: 'stick', heads: 'head', cloves: 'clove', slices: 'slice', pieces: 'piece', containers: 'container', tubs: 'tub',
  blocks: 'block', rolls: 'roll', tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', grams: 'g', gram: 'g',
};
const UNITS = new Set([
  'lb', 'oz', 'g', 'kg', 'cup', 'tbsp', 'tsp', 'gallon', 'quart', 'pint', 'l', 'ml', 'liter', 'can', 'bag', 'box', 'bunch', 'dozen', 'jar', 'bottle', 'pack', 'package',
  'carton', 'loaf', 'stick', 'head', 'clove', 'slice', 'piece', 'container', 'tub', 'block', 'roll',
]);

/** "Lbs." -> "lb"; null when the word is not a unit the quick-add line knows. */
export function knownUnit(word: string): string | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  const u = UNIT_ALIASES[w] ?? w;
  return UNITS.has(u) ? u : null;
}

export interface QuickItem {
  name: string;
  quantity?: number;
  unit?: string;
}

const NUM = /^(\d+\.?\d*|\.\d+|\d+\/\d+)$/;

/** "kiwis" -> "Kiwis": a typed name gets the capital the rest of the pantry has. Anything already capitalised is left alone. */
export const capitalise = (name: string): string => (/^[a-z]/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name);

/**
 * One typed line to an item: "eggs 12", "2 lb chicken thighs", "milk, 1 gallon",
 * "3 lemons", "lemons x3", "olive oil". The amount may lead or trail; a word
 * is a unit only when it is one the pantry uses. null for an empty line.
 */
export function parseQuickAdd(text: string): QuickItem | null {
  const words = text.trim().replace(/\s+/g, ' ').replace(/,/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return null;
  const whole = (name: string[]): QuickItem => ({ name: capitalise(name.join(' ')) });
  const withAmount = (name: string[], quantity: number | null, unit: string | null): QuickItem | null =>
    name.length && quantity != null && quantity > 0 ? { name: capitalise(name.join(' ')), quantity, ...(unit ? { unit } : {}) } : null;

  // amount first: "2 lb chicken thighs", "1 1/2 cups flour", "3 lemons", "2lb beef", "2 cans of beans"
  {
    let rest = words;
    let qty: number | null = null;
    let unit: string | null = null;
    const glued = /^(\d+\.?\d*)([a-z]+)\.?$/i.exec(rest[0]!);
    if (NUM.test(rest[0]!)) {
      const mixed = rest[1] && /^\d+$/.test(rest[0]!) && /^\d+\/\d+$/.test(rest[1]) ? `${rest[0]} ${rest[1]}` : null;
      qty = parseQuantity(mixed ?? rest[0]!);
      rest = rest.slice(mixed ? 2 : 1);
      if (rest.length > 1 && knownUnit(rest[0]!)) {
        unit = knownUnit(rest[0]!);
        rest = rest.slice(1);
      }
    } else if (glued && knownUnit(glued[2]!)) {
      qty = Number(glued[1]);
      unit = knownUnit(glued[2]!);
      rest = rest.slice(1);
    }
    if (qty != null) {
      if (unit && rest[0]?.toLowerCase() === 'of' && rest.length > 1) rest = rest.slice(1);
      const item = withAmount(rest, qty, unit);
      if (item) return item;
    }
  }

  // amount last: "eggs 12", "milk 1 gallon", "lemons x3", "chicken thighs 2 lb"
  {
    const last = words[words.length - 1]!;
    const before = words[words.length - 2];
    const times = /^x(\d+)$/i.exec(last);
    if (times) return withAmount(words.slice(0, -1), Number(times[1]), null) ?? whole(words);
    if (NUM.test(last)) return withAmount(words.slice(0, -1), parseQuantity(last), null) ?? whole(words);
    if (before && NUM.test(before) && knownUnit(last)) return withAmount(words.slice(0, -2), parseQuantity(before), knownUnit(last)) ?? whole(words);
    const glued = /^(\d+\.?\d*)([a-z]+)\.?$/i.exec(last);
    if (glued && knownUnit(glued[2]!) && words.length > 1) return withAmount(words.slice(0, -1), Number(glued[1]), knownUnit(glued[2]!)) ?? whole(words);
  }
  return whole(words);
}

// ---- the edit sheet -------------------------------------------------------------

export interface ItemDraft {
  name: string;
  quantity: string;
  unit: string;
  amount_note: string;
  /** '' on a new item lets the server pick fridge, freezer or pantry from the name. */
  location: string;
  category: string;
  expires_on: string;
  notes: string;
}

export function draftOfItem(item: PantryItem | null, preset: Partial<ItemDraft> = {}): ItemDraft {
  if (!item) return { name: '', quantity: '', unit: '', amount_note: '', location: '', category: '', expires_on: '', notes: '', ...preset };
  return {
    name: item.name,
    quantity: item.in_stock && item.quantity != null ? formatNumber(item.quantity) : '',
    unit: item.unit ?? '',
    amount_note: item.amount_note ?? '',
    location: item.location,
    category: item.category ?? '',
    expires_on: item.in_stock ? (item.expires_on ?? '') : '',
    notes: item.notes ?? '',
  };
}

export type ItemChange = { change: Record<string, unknown> } | { change: null } | { error: string };

/**
 * The `pantry_update` item for a saved sheet. A new item is an `add`; an
 * existing one is an `edit` carrying only what changed (null when nothing
 * did). The server replaces the number and the words of an amount together,
 * so when either changes both are sent.
 */
export function itemChange(item: PantryItem | null, d: ItemDraft): ItemChange {
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Give it a name.' };
  const qtyText = d.quantity.trim();
  const qty = qtyText ? parseQuantity(qtyText) : null;
  if (qtyText && qty == null) return { error: 'The amount should be a number, like 2 or 1/2. Put anything else under “Amount in words”.' };
  const unit = d.unit.trim() || null;
  const note = d.amount_note.trim() || null;
  const category = d.category.trim().toLowerCase() || null;
  const expires = d.expires_on || null;
  const notes = d.notes.trim() || null;
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { error: 'The expiry date is not a date.' };

  if (!item) {
    return {
      change: {
        name, op: 'add',
        ...(qty != null ? { quantity: qty } : {}), ...(unit ? { unit } : {}), ...(note ? { amount_note: note } : {}),
        ...(d.location ? { location: d.location } : {}), ...(category ? { category } : {}), ...(expires ? { expires_on: expires } : {}), ...(notes ? { notes } : {}),
      },
    };
  }

  const change: Record<string, unknown> = {};
  if (name !== item.name) change.new_name = name;
  const wasQty = item.in_stock ? item.quantity : null;
  const wasNote = item.in_stock ? item.amount_note : null;
  if (qty !== wasQty || note !== wasNote) {
    if (qty == null && note == null) return { error: 'To drop the number, say how much is left in words (“about half”), or enter 0 if it’s gone.' };
    if (qty != null) change.quantity = qty;
    change.amount_note = note;
  }
  if (unit !== item.unit) change.unit = unit;
  if (d.location && d.location !== item.location) change.location = d.location;
  if (category !== item.category) change.category = category;
  if (expires !== (item.in_stock ? item.expires_on : null)) change.expires_on = expires;
  if (notes !== item.notes) change.notes = notes;
  if (!Object.keys(change).length) return { change: null };
  return { change: { id: item.id, op: 'edit', ...change } };
}

export interface ShoppingDraft {
  name: string;
  quantity: string;
  unit: string;
  note: string;
}

export type ShoppingSave =
  | { error: string }
  | { calls: Record<string, unknown>[] };

/**
 * The `pantry_shopping_list_update` calls for an edited list row. `add`
 * updates a listed item in place but cannot rename it or clear its amount,
 * so those two are a remove followed by an add.
 */
export function shoppingSave(item: ShoppingItem, d: ShoppingDraft): ShoppingSave {
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Give it a name.' };
  const qtyText = d.quantity.trim();
  const qty = qtyText ? parseQuantity(qtyText) : null;
  if (qtyText && (qty == null || qty <= 0)) return { error: 'The amount should be a number above zero, like 2 or 1/2.' };
  const unit = d.unit.trim() || null;
  const note = d.note.trim() || null;
  const add = { name, ...(qty != null ? { quantity: qty } : {}), unit, note, ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}) };
  const renamed = name !== item.name;
  const cleared = qty == null && item.quantity != null;
  if (!renamed && qty === item.quantity && unit === item.unit && note === item.note) return { calls: [] };
  if (renamed || cleared) return { calls: [{ remove: [item.id] }, { add: [add], ...(item.checked ? { check: [name] } : {}) }] };
  // An add un-ticks the row; tick it again in the same call when it was ticked.
  return { calls: [{ add: [add], ...(item.checked ? { check: [item.id] } : {}) }] };
}
