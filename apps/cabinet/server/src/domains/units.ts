/**
 * Unit conversion for recipe ingredients ↔ pantry stock.
 *
 * Pure, no DB, no MCP wiring — a library other Phase C pieces (shopping-list
 * generator, plan→pantry decrement) import. Recipes are commonly written in
 * volume (cups, tbsp); pantry stock is commonly tracked in mass (g, lb). No
 * JS unit library bridges that gap because it needs per-ingredient density —
 * that's the actual hard part, so we own a small density table rather than
 * pull a dependency that only solves the trivial dimensional half.
 *
 * Canonical base units: mass → grams (g), volume → milliliters (ml).
 * Every factor conversion routes through its base unit; volume↔mass routes
 * through the base units AND a density (g/ml) lookup keyed on ingredient name.
 */

export type Dimension = 'mass' | 'volume' | 'count';

export type ConvertResult = { ok: true; value: number } | { ok: false; reason: string };

// ---------- canonical units + factor tables (→ base unit) ----------

const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  cup: 236.588,
  fl_oz: 29.5735,
};

/** Opaque per-item units — only ever convertible to themselves; no guessed per-item weights. */
const COUNT_UNITS = new Set(['each', 'egg', 'clove', 'piece']);

// ---------- alias normalization (case-insensitive, plural-tolerant) ----------

const UNIT_ALIASES: Record<string, string> = {
  // mass
  gram: 'g', grams: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  // volume
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp',
  cup: 'cup', cups: 'cup',
  'fl oz': 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz', fl_oz: 'fl_oz', floz: 'fl_oz',
  // count
  each: 'each', ea: 'each',
  egg: 'egg', eggs: 'egg',
  clove: 'clove', cloves: 'clove',
  piece: 'piece', pieces: 'piece',
};

/** Fold a unit string to its canonical key. Unknown units pass through lowercased/trimmed. */
function normalizeUnit(unit: string): string {
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? key;
}

interface UnitInfo {
  dim: Dimension;
  /** factor to convert 1 of this unit into its dimension's base unit (g or ml); count units have no meaningful factor. */
  toBase: number;
}

/** Single source of truth for "what is this unit, and how does it convert to base" — avoids re-indexing the factor tables (and the noUncheckedIndexedAccess churn that causes) once a unit's validity is known. */
function unitInfo(unit: string): UnitInfo | null {
  const mass = MASS_TO_GRAMS[unit];
  if (mass !== undefined) return { dim: 'mass', toBase: mass };
  const volume = VOLUME_TO_ML[unit];
  if (volume !== undefined) return { dim: 'volume', toBase: volume };
  if (COUNT_UNITS.has(unit)) return { dim: 'count', toBase: 1 };
  return null;
}

// ---------- ingredient density table (g per ml), keyed on lowercased name ----------

/**
 * Seed set of published-ish densities. Extend by adding entries — one object
 * literal, no schema migration needed. Lookup is substring-tolerant (see
 * densityFor) so "all-purpose flour" and "flour, sifted" both hit "flour".
 */
export const INGREDIENT_DENSITY_G_PER_ML: Record<string, number> = {
  water: 1.0,
  'all-purpose flour': 0.53,
  flour: 0.53,
  'granulated sugar': 0.85,
  sugar: 0.85,
  'brown sugar': 0.93,
  butter: 0.911,
  milk: 1.03,
  'olive oil': 0.915,
  oil: 0.92,
  rice: 0.85,
  honey: 1.42,
  salt: 1.22,
  'baking powder': 0.9,
  'baking soda': 0.9,
  'cocoa powder': 0.41,
  'peanut butter': 1.09,
  yogurt: 1.03,
  'heavy cream': 1.0,
};

function densityFor(ingredientName: string | undefined): number | undefined {
  if (!ingredientName) return undefined;
  const key = ingredientName.trim().toLowerCase();
  if (key in INGREDIENT_DENSITY_G_PER_ML) return INGREDIENT_DENSITY_G_PER_ML[key];
  // substring match, longest key first, so "all-purpose flour" beats "flour"
  // when the input is e.g. "sifted all-purpose flour"
  const best = Object.keys(INGREDIENT_DENSITY_G_PER_ML)
    .filter((k) => key.includes(k))
    .reduce<string | undefined>((longest, k) => (longest === undefined || k.length > longest.length ? k : longest), undefined);
  return best === undefined ? undefined : INGREDIENT_DENSITY_G_PER_ML[best];
}

// ---------- the conversion function ----------

/**
 * Convert `quantity` from one unit to another. Never guesses:
 *  - same dimension (mass→mass or volume→volume): pure factor conversion.
 *  - cross dimension (volume↔mass): requires `ingredientName` + a density hit.
 *  - count units (each/egg/clove/piece): only convertible to themselves.
 */
export function convert(quantity: number, fromUnit: string, toUnit: string, ingredientName?: string): ConvertResult {
  if (!Number.isFinite(quantity)) return { ok: false, reason: `quantity must be a finite number, got ${quantity}` };

  const from = unitInfo(normalizeUnit(fromUnit));
  const to = unitInfo(normalizeUnit(toUnit));

  if (from === null) return { ok: false, reason: `unknown unit '${fromUnit}'` };
  if (to === null) return { ok: false, reason: `unknown unit '${toUnit}'` };

  if (from.dim === 'count' || to.dim === 'count') {
    if (from.dim === 'count' && to.dim === 'count' && normalizeUnit(fromUnit) === normalizeUnit(toUnit)) return { ok: true, value: quantity };
    return { ok: false, reason: `count unit '${from.dim === 'count' ? fromUnit : toUnit}' only converts to itself — no per-item weight guessing` };
  }

  if (from.dim === to.dim) {
    // same-dimension factor conversion, routed through the base unit
    return { ok: true, value: (quantity * from.toBase) / to.toBase };
  }

  // cross dimension: volume <-> mass, requires density
  const density = densityFor(ingredientName);
  if (density === undefined) {
    return { ok: false, reason: `need density for ${ingredientName ?? '(no ingredient given)'} to convert volume↔mass` };
  }
  if (from.dim === 'volume' && to.dim === 'mass') {
    const ml = quantity * from.toBase;
    const grams = ml * density;
    return { ok: true, value: grams / to.toBase };
  }
  // from.dim === 'mass' && to.dim === 'volume'
  const grams = quantity * from.toBase;
  const ml = grams / density;
  return { ok: true, value: ml / to.toBase };
}
