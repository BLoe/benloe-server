import { describe, expect, it } from 'vitest';
import { convert } from '../src/domains/units.js';

describe('units', () => {
  it('converts mass both directions through the gram base unit', () => {
    const toGrams = convert(1, 'lb', 'g');
    expect(toGrams.ok).toBe(true);
    if (toGrams.ok) expect(toGrams.value).toBeCloseTo(453.592, 3);

    const toLb = convert(453.592, 'g', 'lb');
    expect(toLb.ok).toBe(true);
    if (toLb.ok) expect(toLb.value).toBeCloseTo(1, 6);
  });

  it('converts volume both directions through the milliliter base unit', () => {
    const toMl = convert(1, 'cup', 'ml');
    expect(toMl.ok).toBe(true);
    if (toMl.ok) expect(toMl.value).toBeCloseTo(236.588, 3);

    const toCup = convert(236.588, 'ml', 'cup');
    expect(toCup.ok).toBe(true);
    if (toCup.ok) expect(toCup.value).toBeCloseTo(1, 6);
  });

  it('bridges volume->mass using ingredient density: 2 cups flour ≈ 250g', () => {
    const res = convert(2, 'cup', 'g', 'all-purpose flour');
    expect(res.ok).toBe(true);
    // 2 cups = 473.176 ml * 0.53 g/ml ≈ 250.8g (~125g per cup)
    if (res.ok) expect(res.value).toBeCloseTo(250.78, 1);
  });

  it('bridges mass->volume using ingredient density, and is the inverse of volume->mass', () => {
    const grams = convert(2, 'cup', 'g', 'flour');
    expect(grams.ok).toBe(true);
    if (!grams.ok) return;
    const backToCups = convert(grams.value, 'g', 'cup', 'flour');
    expect(backToCups.ok).toBe(true);
    if (backToCups.ok) expect(backToCups.value).toBeCloseTo(2, 6);
  });

  it('density lookup is substring-tolerant for compound ingredient names', () => {
    const res = convert(1, 'cup', 'g', 'sifted all-purpose flour');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBeCloseTo(125.39, 1); // same density as 'flour'
  });

  it('fails cross-dimension conversion for an unknown ingredient', () => {
    const res = convert(1, 'cup', 'g', 'unobtainium dust');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/need density for unobtainium dust/);
  });

  it('fails cross-dimension conversion when no ingredient is given at all', () => {
    const res = convert(1, 'cup', 'g');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/need density/);
  });

  it('count units only convert to themselves, never guessed', () => {
    const same = convert(3, 'egg', 'egg');
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.value).toBe(3);

    const crossCount = convert(3, 'egg', 'clove');
    expect(crossCount.ok).toBe(false);

    const countToMass = convert(2, 'each', 'g');
    expect(countToMass.ok).toBe(false);
    if (!countToMass.ok) expect(countToMass.reason).toMatch(/only converts to itself/);
  });

  it('rejects unknown units outright, on either side', () => {
    const badFrom = convert(1, 'smidgen', 'g');
    expect(badFrom.ok).toBe(false);
    if (!badFrom.ok) expect(badFrom.reason).toMatch(/unknown unit 'smidgen'/);

    const badTo = convert(1, 'g', 'smidgen');
    expect(badTo.ok).toBe(false);
    if (!badTo.ok) expect(badTo.reason).toMatch(/unknown unit 'smidgen'/);
  });

  it('normalizes common unit aliases case-insensitively before lookup', () => {
    const variants = [
      convert(1, 'Tablespoons', 'ml'),
      convert(1, 'TBSP', 'ml'),
      convert(1, 'tablespoon', 'ml'),
      convert(1, 'Tbsp', 'ml'),
    ];
    for (const v of variants) expect(v.ok).toBe(true);
    const values = variants.map((v) => (v.ok ? v.value : NaN));
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBe(1); // all identical

    const grams = convert(1, 'kilograms', 'g');
    expect(grams.ok).toBe(true);
    if (grams.ok) expect(grams.value).toBe(1000);
  });

  it('round-trips mass through a third unit without drift: g -> oz -> g', () => {
    const toOz = convert(500, 'g', 'oz');
    expect(toOz.ok).toBe(true);
    if (!toOz.ok) return;
    const backToG = convert(toOz.value, 'oz', 'g');
    expect(backToG.ok).toBe(true);
    if (backToG.ok) expect(backToG.value).toBeCloseTo(500, 6);
  });

  it('same-unit identity conversion is exact, no floating point drift', () => {
    const res = convert(3.25, 'cup', 'cups');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe(3.25);
  });
});
