import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type PalsDb } from '../src/db/index.js';
import { dailyTotals, logFood, updatePantry, addRecipe } from '../src/domains/food.js';
import { ewma, logBodyMetric, logWorkout, weightTrend } from '../src/domains/training.js';
import { accumulators, logClaim, logHsaContribution, logLab, logMedication, medicationsLow, seedInsurancePlan } from '../src/domains/healthcare.js';
import { addJournal, addPriceWatch, importTransactionsCsv, logMood, upsertContact, upsertTask } from '../src/domains/misc.js';

let dir: string;
let pals: PalsDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pals-dom-'));
  pals = openDb(join(dir, 'pals.db'));
});

afterEach(() => {
  pals.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('food', () => {
  it('logFood accumulates daily macro totals', () => {
    const when = new Date('2026-07-07T12:00:00Z');
    logFood(pals.db, { description: 'eggs', kcal: 300, protein_g: 20, when });
    const { totals } = logFood(pals.db, { description: 'chicken bowl', kcal: 700, protein_g: 45, when });
    expect(totals.kcal).toBe(1000);
    expect(totals.protein_g).toBe(65);
    expect(totals.entries).toBe(2);
    // a different day is a different bucket
    expect(dailyTotals(pals.db, '2026-01-01').entries).toBe(0);
  });

  it('updatePantry deltas quantities and clamps at zero', () => {
    const a = updatePantry(pals.db, { name: 'Eggs', location: 'fridge', quantity: 12, unit: 'ct' });
    const b = updatePantry(pals.db, { name: 'eggs', location: 'fridge', quantityDelta: -3 });
    expect(b.id).toBe(a.id); // case-insensitive upsert
    expect(b.quantity).toBe(9);
    expect(updatePantry(pals.db, { name: 'eggs', location: 'fridge', quantityDelta: -99 }).quantity).toBe(0);
  });

  it('addRecipe stores ingredients transactionally', () => {
    const id = addRecipe(pals.db, { title: 'Chili', servings: 6, protein_g: 38, ingredients: [{ name: 'beef', quantity: 2, unit: 'lb' }, { name: 'beans' }] });
    const n = pals.db.prepare('SELECT COUNT(*) n FROM recipe_ingredient WHERE recipe_id = ?').get(id) as { n: number };
    expect(n.n).toBe(2);
  });
});

describe('training', () => {
  it('flags a PR only when weight exceeds all prior weight for the exercise', () => {
    const first = logWorkout(pals.db, { sets: [{ exercise: 'bench', reps: 5, weight_lb: 185 }] });
    expect(first.prs).toHaveLength(1); // first ever set is a PR by definition
    const heavier = logWorkout(pals.db, { sets: [{ exercise: 'bench', reps: 3, weight_lb: 205 }] });
    expect(heavier.prs).toEqual([{ exercise: 'bench', weight_lb: 205, previous: 185 }]);
    const lighter = logWorkout(pals.db, { sets: [{ exercise: 'bench', reps: 8, weight_lb: 165 }] });
    expect(lighter.prs).toHaveLength(0);
    // two heavy sets in one workout: only the first new max flags
    const double = logWorkout(pals.db, { sets: [{ exercise: 'bench', weight_lb: 225 }, { exercise: 'bench', weight_lb: 225 }] });
    expect(double.prs).toHaveLength(1);
  });

  it('ewma smooths noise: variance shrinks, mean is preserved-ish', () => {
    const noisy = [180, 183, 179, 184, 178, 183, 180, 184, 179, 182];
    const smooth = ewma(noisy);
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(smooth)).toBeLessThan(spread(noisy) / 2);
    expect(smooth.at(-1)!).toBeGreaterThan(178);
    expect(smooth.at(-1)!).toBeLessThan(184);
  });

  it('weightTrend reports latest, smoothed trend, and weekly delta', () => {
    const days = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
    days.forEach((d, i) => {
      logBodyMetric(pals.db, { metric: 'weight_lb', value: 180 - i * 0.3 + (i % 2 ? 0.8 : -0.8), when: new Date(`2026-06-${d}T12:00:00Z`) });
    });
    const t = weightTrend(pals.db);
    expect(t.latest).not.toBeNull();
    expect(t.trend).toBeLessThan(180); // trending down
    expect(t.weeklyDelta).toBeLessThan(0);
    expect(t.points).toHaveLength(10);
  });
});

describe('healthcare accumulators', () => {
  it('claims accumulate toward deductible and OOP; denied claims excluded', () => {
    const planId = seedInsurancePlan(pals.db);
    logClaim(pals.db, { planId, applied_to_deductible: 900, applied_to_oop: 900 });
    logClaim(pals.db, { planId, applied_to_deductible: 1240, applied_to_oop: 1240 });
    logClaim(pals.db, { planId, applied_to_deductible: 5000, applied_to_oop: 5000, status: 'denied' });
    const acc = accumulators(pals.db, planId);
    expect(acc.deductible).toEqual({ applied: 2140, limit: 3300, remaining: 1160 });
    expect(acc.oop.applied).toBe(2140);
    expect(acc.oop.remaining).toBe(8500 - 2140);
  });

  it('HSA contributions compute YTD and 2026 headroom', () => {
    logHsaContribution(pals.db, { amount: 2900, taxYear: 2026 });
    const r = logHsaContribution(pals.db, { amount: 500, taxYear: 2026 });
    expect(r.ytd).toBe(3400);
    expect(r.limit).toBe(4400);
    expect(r.headroom).toBe(1000);
  });

  it('labs flag out-of-range values', () => {
    expect(logLab(pals.db, { drawn_on: '2026-06-01', analyte: 'LDL', value: 160, ref_low: 0, ref_high: 130 }).flag).toBe('H');
    expect(logLab(pals.db, { drawn_on: '2026-06-01', analyte: 'VitD', value: 12, ref_low: 30, ref_high: 100 }).flag).toBe('L');
    expect(logLab(pals.db, { drawn_on: '2026-06-01', analyte: 'A1c', value: 5.2, ref_low: 4, ref_high: 5.6 }).flag).toBeNull();
  });

  it('medicationsLow counts down days of supply', () => {
    logMedication(pals.db, { name: 'VitaminD', days_supply: 30, last_filled_on: '2026-06-10' });
    logMedication(pals.db, { name: 'Fresh', days_supply: 90, last_filled_on: '2026-07-01' });
    const low = medicationsLow(pals.db, 5, '2026-07-07');
    expect(low).toEqual([{ name: 'VitaminD', daysLeft: 3 }]);
  });
});

describe('money csv import', () => {
  const csv = `date,amount,merchant,category
2026-07-01,-42.50,"Trader Joe's",groceries
2026-07-02,-1200.00,"Rent, LLC",housing
2026-07-03,3000,Payroll,income`;

  it('parses quoted fields and imports rows', () => {
    const r = importTransactionsCsv(pals.db, csv);
    expect(r).toEqual({ inserted: 3, skipped: 0 });
    const rent = pals.db.prepare("SELECT amount, merchant FROM transaction_row WHERE category='housing'").get() as any;
    expect(rent).toEqual({ amount: -1200, merchant: 'Rent, LLC' });
  });

  it('is idempotent: re-import inserts nothing', () => {
    importTransactionsCsv(pals.db, csv);
    const again = importTransactionsCsv(pals.db, csv);
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(3);
    const n = pals.db.prepare('SELECT COUNT(*) n FROM transaction_row').get() as { n: number };
    expect(n.n).toBe(3);
  });

  it('skips malformed rows without aborting the batch', () => {
    const messy = 'date,amount,merchant\n2026-07-04,not-a-number,X\n2026-07-05,-10,Coffee';
    expect(importTransactionsCsv(pals.db, messy)).toEqual({ inserted: 1, skipped: 1 });
  });
});

describe('admin & social', () => {
  it('upsertTask inserts then updates in place', () => {
    const id = upsertTask(pals.db, { title: 'Replace HVAC filter', due_on: '2026-08-01', recur_rule: 'every-90d' });
    const same = upsertTask(pals.db, { id, title: 'Replace HVAC filter', status: 'done' });
    expect(same).toBe(id);
    const row = pals.db.prepare('SELECT status, recur_rule FROM task WHERE id=?').get(id) as any;
    expect(row).toEqual({ status: 'done', recur_rule: 'every-90d' });
  });

  it('upsertContact is case-insensitive on name', () => {
    const id = upsertContact(pals.db, { name: 'Dave', keep_in_touch_days: 42 });
    expect(upsertContact(pals.db, { name: 'dave', last_contacted_on: '2026-07-01' })).toBe(id);
  });

  it('mood, journal, price watch land in their tables', () => {
    logMood(pals.db, { mood: 4, energy: 3, stress: 2 });
    addJournal(pals.db, 'long day, good lift');
    addPriceWatch(pals.db, { item: 'OLED monitor', target_price: 600 });
    for (const t of ['mood_log', 'journal_entry', 'price_watch']) {
      expect((pals.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe(1);
    }
  });
});
