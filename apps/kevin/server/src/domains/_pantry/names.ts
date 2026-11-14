// Pure helpers shared by the pantry and cooking domains: how item names are
// matched, how US units convert, and how amounts and dates read.

/** One word to its singular: "thighs" -> "thigh", "tomatoes" -> "tomato", "berries" -> "berry". */
function singular(w: string): string {
  let out = w;
  if (w.length > 3) {
    if (w.endsWith('ies')) out = w.slice(0, -3) + 'y';
    else if (/(oes|ches|shes|xes|sses)$/.test(w)) out = w.slice(0, -2);
    else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) out = w.slice(0, -1);
  }
  // "cookie" and "cookies" must land on the same key as each other.
  if (out.length > 4 && out.endsWith('ie')) out = out.slice(0, -2) + 'y';
  return out;
}

/**
 * The matching key for an item name: lowercase, punctuation dropped, each
 * word singular, single spaces. "  Chicken Thighs " -> "chicken thigh".
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

/** Tidies a name for display without changing how Ben wrote it. */
export const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * How a wanted name (what was said, or a recipe ingredient) relates to a
 * stored one. 'exact': same key. 'similar': the stored item is a more
 * specific kind of the wanted one ("beans" -> "black beans"), or the two
 * share their last word and one contains the other ("olive oil" -> "oil").
 */
export function nameMatch(wantedKey: string, storedKey: string): 'exact' | 'similar' | null {
  if (!wantedKey || !storedKey) return null;
  if (wantedKey === storedKey) return 'exact';
  const w = wantedKey.split(' ');
  const s = storedKey.split(' ');
  const wInS = w.every((x) => s.includes(x));
  const sInW = s.every((x) => w.includes(x));
  if (wInS) return 'similar';
  if (sInW && w[w.length - 1] === s[s.length - 1]) return 'similar';
  return null;
}

// ---- units -------------------------------------------------------------------

type Family = 'weight' | 'volume' | 'count';
const UNITS: Record<string, { family: Family; factor: number }> = {};
function unit(family: Family, factor: number, ...names: string[]): void {
  for (const n of names) UNITS[n] = { family, factor };
}
// weight in ounces
unit('weight', 1, 'oz', 'ounce');
unit('weight', 16, 'lb', 'lbs', 'pound');
unit('weight', 0.035274, 'g', 'gram');
unit('weight', 35.274, 'kg', 'kilogram');
// volume in teaspoons
unit('volume', 1, 'tsp', 'teaspoon');
unit('volume', 3, 'tbsp', 'tablespoon', 'tb');
unit('volume', 6, 'fl oz', 'fluid ounce', 'floz');
unit('volume', 48, 'cup', 'c');
unit('volume', 96, 'pt', 'pts', 'pint');
unit('volume', 192, 'qt', 'qts', 'quart');
unit('volume', 768, 'gal', 'gallon');
unit('volume', 0.202884, 'ml', 'milliliter');
unit('volume', 202.884, 'l', 'liter');
// count
unit('count', 1, '', 'each', 'ea', 'count', 'ct', 'piece', 'pc', 'pcs', 'whole', 'item', 'unit');
unit('count', 12, 'dozen', 'doz');

/** "Lbs." -> "lb", "Cups" -> "cup"; a unit that is just the item's own name ("eggs" of eggs) is a count. */
export function unitKey(u: string | null | undefined, itemKey = ''): string {
  if (!u) return '';
  const k = normalizeName(u.replace(/\./g, ''));
  const last = itemKey.split(' ').pop();
  if (k === itemKey || (last && k === last)) return '';
  return k;
}

/**
 * Converts a quantity between units of the same family (lb <-> oz, cup <->
 * tbsp, dozen <-> each). Identical units always convert. Null when the two
 * cannot be compared ("1 bag" against "2 lb").
 */
export function convert(quantity: number, from: string | null | undefined, to: string | null | undefined, itemKey = ''): number | null {
  const a = unitKey(from, itemKey);
  const b = unitKey(to, itemKey);
  if (a === b) return quantity;
  const ua = UNITS[a];
  const ub = UNITS[b];
  if (!ua || !ub || ua.family !== ub.family) return null;
  return (quantity * ua.factor) / ub.factor;
}

/** Trims float noise: 0.30000000000000004 -> 0.3. */
export const round = (n: number): number => Math.round(n * 1000) / 1000;

const fmtNumber = (n: number): string => String(Math.round(n * 100) / 100);

/** "2 lb", "6", "half a bag", "1 bag (about half left)", or "" when nothing is known. */
export function formatAmount(quantity: number | null | undefined, unitText: string | null | undefined, amountNote?: string | null): string {
  const numeric = quantity == null ? '' : [fmtNumber(quantity), unitText?.trim()].filter(Boolean).join(' ');
  const note = amountNote?.trim() ?? '';
  if (numeric && note) return `${numeric} (${note})`;
  return numeric || note;
}

// ---- dates -------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isDay(s: string): boolean {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const dayNumber = (s: string): number => {
  const m = DAY_RE.exec(s)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
};

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is in the past. */
export const daysBetween = (from: string, to: string): number => Math.round(dayNumber(to) - dayNumber(from));

/** `day` plus n days, as YYYY-MM-DD. */
export const addDays = (day: string, n: number): string => new Date((dayNumber(day) + n) * 86_400_000).toISOString().slice(0, 10);

/** "expired 2 days ago", "expires today", "expires tomorrow", "expires in 3 days". */
export function expiryPhrase(daysLeft: number): string {
  if (daysLeft < -1) return `expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return 'expired yesterday';
  if (daysLeft === 0) return 'expires today';
  if (daysLeft === 1) return 'expires tomorrow';
  return `expires in ${daysLeft} days`;
}

// ---- where a new item probably lives ------------------------------------------

const FREEZER = /\b(frozen|ice cream|popsicle|sorbet|ice)\b/;
const FRIDGE = new RegExp(
  '\\b(' +
    'milk|cream|half and half|butter|cheese|cheddar|mozzarella|parmesan|feta|yogurt|egg|' +
    'chicken|beef|pork|turkey|bacon|sausage|ham|steak|lamb|fish|salmon|shrimp|tuna steak|tofu|deli|' +
    'lettuce|spinach|kale|arugula|cilantro|parsley|basil|scallion|celery|carrot|cucumber|pepper|broccoli|cauliflower|' +
    'zucchini|mushroom|berry|strawberry|blueberry|raspberry|grape|juice|hummus|salsa|tortilla|leftover' +
    ')\\b',
);
const SHELF = /\b(powder|powdered|canned|can|dried|dry|evaporated|condensed|shelf|peanut butter|almond butter|nut butter|coconut milk|broth|stock|sauce|chip|cracker|black pepper|peppercorn|flake|extract|oil)\b/;

/** A first guess at where a new item is kept when nobody said: fridge, freezer or pantry. */
export function guessLocation(nameKey: string): 'fridge' | 'freezer' | 'pantry' {
  if (FREEZER.test(nameKey)) return 'freezer';
  if (SHELF.test(nameKey)) return 'pantry';
  if (FRIDGE.test(nameKey)) return 'fridge';
  return 'pantry';
}
