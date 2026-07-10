import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { decrementPantryFor, updatePantry } from '../src/domains/food.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-decrement-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

function pantryRow(name: string): { quantity: number | null; unit: string | null } | undefined {
  return cabinet.db.prepare('SELECT quantity, unit FROM pantry_item WHERE lower(name) = lower(?)').get(name) as
    | { quantity: number | null; unit: string | null }
    | undefined;
}

describe('decrementPantryFor', () => {
  it('same-unit passthrough: no conversion needed', () => {
    updatePantry(cabinet.db, { name: 'eggs', quantity: 12, unit: 'each' });
    const result = decrementPantryFor(cabinet.db, { name: 'eggs', quantity: 3, unit: 'each' });

    expect(result).toEqual({ ok: true, pantryId: 1, name: 'eggs', amount: 3, unit: 'each', quantity: 9 });
    expect(pantryRow('eggs')?.quantity).toBe(9);
  });

  it('converts cross-unit within the same dimension: ml -> l', () => {
    updatePantry(cabinet.db, { name: 'milk', quantity: 2, unit: 'l' });
    const result = decrementPantryFor(cabinet.db, { name: 'milk', quantity: 200, unit: 'ml' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unit).toBe('l');
    expect(result.amount).toBeCloseTo(0.2, 6);
    expect(pantryRow('milk')?.quantity).toBeCloseTo(1.8, 6);
  });

  it('converts cross-unit within the same dimension: g <-> kg', () => {
    updatePantry(cabinet.db, { name: 'rice', quantity: 1, unit: 'kg' });
    const result = decrementPantryFor(cabinet.db, { name: 'rice', quantity: 250, unit: 'g' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unit).toBe('kg');
    expect(result.amount).toBeCloseTo(0.25, 6);
    expect(pantryRow('rice')?.quantity).toBeCloseTo(0.75, 6);
  });

  it('converts cross-dimension via ingredient density: cups -> grams for a known ingredient', () => {
    updatePantry(cabinet.db, { name: 'all-purpose flour', quantity: 1000, unit: 'g' });
    const result = decrementPantryFor(cabinet.db, { name: 'all-purpose flour', quantity: 2, unit: 'cup' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unit).toBe('g');
    expect(result.amount).toBeCloseTo(250.78, 1); // 2 cups of flour (density 0.53 g/ml) ~= 250.8g
    expect(pantryRow('all-purpose flour')?.quantity).toBeCloseTo(1000 - result.amount, 6);
  });

  it('clamps at 0 when the decrement exceeds what is on hand', () => {
    updatePantry(cabinet.db, { name: 'butter', quantity: 50, unit: 'g' });
    const result = decrementPantryFor(cabinet.db, { name: 'butter', quantity: 200, unit: 'g' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBe(200); // the requested amount, not clamped
    expect(pantryRow('butter')?.quantity).toBe(0); // but the pantry itself clamps at 0
  });

  it('never-guess: no matching pantry row returns a reason and does not create or mutate anything', () => {
    const result = decrementPantryFor(cabinet.db, { name: 'saffron', quantity: 1, unit: 'g' });

    expect(result).toEqual({ ok: false, reason: "'saffron' is not in the pantry" });
    expect(pantryRow('saffron')).toBeUndefined(); // definitely not silently created
  });

  it('never-guess: a pantry row with no recorded unit returns a reason and is left untouched', () => {
    // a bare stock entry — quantity known, unit never recorded
    updatePantry(cabinet.db, { name: 'salt', quantity: 100 });
    const result = decrementPantryFor(cabinet.db, { name: 'salt', quantity: 5, unit: 'g' });

    expect(result).toEqual({ ok: false, reason: "pantry stock for 'salt' has no recorded unit" });
    expect(pantryRow('salt')?.quantity).toBe(100); // untouched
  });

  it('never-guess: an unconvertible unit (no density, volume vs mass) returns a reason and does not mutate the row', () => {
    updatePantry(cabinet.db, { name: 'unobtainium', quantity: 500, unit: 'g' });
    const result = decrementPantryFor(cabinet.db, { name: 'unobtainium', quantity: 1, unit: 'cup' });

    expect(result).toEqual({ ok: false, reason: 'need density for unobtainium to convert volume↔mass' });
    expect(pantryRow('unobtainium')?.quantity).toBe(500); // untouched, not guessed at
  });

  it('never-guess: a count-unit mismatch returns a reason and does not mutate the row', () => {
    updatePantry(cabinet.db, { name: 'garlic', quantity: 10, unit: 'clove' });
    const result = decrementPantryFor(cabinet.db, { name: 'garlic', quantity: 1, unit: 'each' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/only converts to itself/);
    expect(pantryRow('garlic')?.quantity).toBe(10); // untouched
  });

  it('REGRESSION: updatePantry\'s plain unit-blind quantityDelta path is unchanged — no conversion applied', () => {
    // this is deliberately "wrong" if you mean 200ml against a litres-stocked row — updatePantry
    // has no unit awareness by design; decrementPantryFor exists precisely because of this gap
    updatePantry(cabinet.db, { name: 'milk', quantity: 2, unit: 'l' });
    const result = updatePantry(cabinet.db, { name: 'milk', quantityDelta: -0.5 });

    expect(result.quantity).toBe(1.5); // raw arithmetic, no convert() involved
    expect(pantryRow('milk')?.quantity).toBe(1.5);
    expect(pantryRow('milk')?.unit).toBe('l'); // unit column untouched by a delta-only call
  });
});
