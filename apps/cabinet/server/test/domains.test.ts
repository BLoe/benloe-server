import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { dailyTotals, logFood, updatePantry, addRecipe } from '../src/domains/food.js';
import { ewma, logBodyMetric, logWorkout, weightTrend } from '../src/domains/training.js';
import { accumulators, logClaim, logHsaContribution, logLab, logMedication, medicationsLow, seedInsurancePlan } from '../src/domains/healthcare.js';
import {
  addJournal, addPriceWatch, importTransactionsCsv, listConstraints, logMood,
  upsertConstraint, upsertContact, upsertGoal, upsertTask,
} from '../src/domains/misc.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-dom-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('food', () => {
  it('logFood accumulates daily macro totals', () => {
    const when = new Date('2026-07-07T12:00:00Z');
    logFood(cabinet.db, { description: 'eggs', kcal: 300, protein_g: 20, when });
    const { totals } = logFood(cabinet.db, { description: 'chicken bowl', kcal: 700, protein_g: 45, when });
    expect(totals.kcal).toBe(1000);
    expect(totals.protein_g).toBe(65);
    expect(totals.entries).toBe(2);
    // a different day is a different bucket
    expect(dailyTotals(cabinet.db, '2026-01-01').entries).toBe(0);
  });

  it('updatePantry deltas quantities and clamps at zero', () => {
    const a = updatePantry(cabinet.db, { name: 'Eggs', location: 'fridge', quantity: 12, unit: 'ct' });
    const b = updatePantry(cabinet.db, { name: 'eggs', location: 'fridge', quantityDelta: -3 });
    expect(b.id).toBe(a.id); // case-insensitive upsert
    expect(b.quantity).toBe(9);
    expect(updatePantry(cabinet.db, { name: 'eggs', location: 'fridge', quantityDelta: -99 }).quantity).toBe(0);
  });

  it('addRecipe stores ingredients transactionally', () => {
    const id = addRecipe(cabinet.db, { title: 'Chili', servings: 6, protein_g: 38, ingredients: [{ name: 'beef', quantity: 2, unit: 'lb' }, { name: 'beans' }] });
    const n = cabinet.db.prepare('SELECT COUNT(*) n FROM recipe_ingredient WHERE recipe_id = ?').get(id) as { n: number };
    expect(n.n).toBe(2);
  });
});

describe('training', () => {
  it('flags a PR only when weight exceeds all prior weight for the exercise', () => {
    const first = logWorkout(cabinet.db, { sets: [{ exercise: 'bench', reps: 5, weight_lb: 185 }] });
    expect(first.prs).toHaveLength(1); // first ever set is a PR by definition
    const heavier = logWorkout(cabinet.db, { sets: [{ exercise: 'bench', reps: 3, weight_lb: 205 }] });
    expect(heavier.prs).toEqual([{ exercise: 'bench', weight_lb: 205, previous: 185 }]);
    const lighter = logWorkout(cabinet.db, { sets: [{ exercise: 'bench', reps: 8, weight_lb: 165 }] });
    expect(lighter.prs).toHaveLength(0);
    // two heavy sets in one workout: only the first new max flags
    const double = logWorkout(cabinet.db, { sets: [{ exercise: 'bench', weight_lb: 225 }, { exercise: 'bench', weight_lb: 225 }] });
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
      logBodyMetric(cabinet.db, { metric: 'weight_lb', value: 180 - i * 0.3 + (i % 2 ? 0.8 : -0.8), when: new Date(`2026-06-${d}T12:00:00Z`) });
    });
    const t = weightTrend(cabinet.db);
    expect(t.latest).not.toBeNull();
    expect(t.trend).toBeLessThan(180); // trending down
    expect(t.weeklyDelta).toBeLessThan(0);
    expect(t.points).toHaveLength(10);
  });
});

describe('healthcare accumulators', () => {
  it('claims accumulate toward deductible and OOP; denied claims excluded', () => {
    // Accumulator math under test, not seedInsurancePlan's content (that's a
    // blank placeholder by design — see healthcare.ts) — insert a plan with
    // explicit test limits directly.
    const { lastInsertRowid: planId } = cabinet.db
      .prepare('INSERT INTO insurance_plan (plan_name, plan_year, deductible_individual, oop_max_individual) VALUES (?,?,?,?)')
      .run('Test Plan', 2026, 3300, 8500);
    logClaim(cabinet.db, { planId: Number(planId), applied_to_deductible: 900, applied_to_oop: 900 });
    logClaim(cabinet.db, { planId, applied_to_deductible: 1240, applied_to_oop: 1240 });
    logClaim(cabinet.db, { planId, applied_to_deductible: 5000, applied_to_oop: 5000, status: 'denied' });
    const acc = accumulators(cabinet.db, planId);
    expect(acc.deductible).toEqual({ applied: 2140, limit: 3300, remaining: 1160 });
    expect(acc.oop.applied).toBe(2140);
    expect(acc.oop.remaining).toBe(8500 - 2140);
  });

  it('HSA contributions compute YTD and 2026 headroom', () => {
    logHsaContribution(cabinet.db, { amount: 2900, taxYear: 2026 });
    const r = logHsaContribution(cabinet.db, { amount: 500, taxYear: 2026 });
    expect(r.ytd).toBe(3400);
    expect(r.limit).toBe(4400);
    expect(r.headroom).toBe(1000);
  });

  it('labs flag out-of-range values', () => {
    expect(logLab(cabinet.db, { drawn_on: '2026-06-01', analyte: 'LDL', value: 160, ref_low: 0, ref_high: 130 }).flag).toBe('H');
    expect(logLab(cabinet.db, { drawn_on: '2026-06-01', analyte: 'VitD', value: 12, ref_low: 30, ref_high: 100 }).flag).toBe('L');
    expect(logLab(cabinet.db, { drawn_on: '2026-06-01', analyte: 'A1c', value: 5.2, ref_low: 4, ref_high: 5.6 }).flag).toBeNull();
  });

  it('medicationsLow counts down days of supply', () => {
    logMedication(cabinet.db, { name: 'VitaminD', days_supply: 30, last_filled_on: '2026-06-10' });
    logMedication(cabinet.db, { name: 'Fresh', days_supply: 90, last_filled_on: '2026-07-01' });
    const low = medicationsLow(cabinet.db, 5, '2026-07-07');
    expect(low).toEqual([{ name: 'VitaminD', daysLeft: 3 }]);
  });
});

describe('money csv import', () => {
  const csv = `date,amount,merchant,category
2026-07-01,-42.50,"Trader Joe's",groceries
2026-07-02,-1200.00,"Rent, LLC",housing
2026-07-03,3000,Payroll,income`;

  it('parses quoted fields and imports rows', () => {
    const r = importTransactionsCsv(cabinet.db, csv);
    expect(r).toEqual({ inserted: 3, skipped: 0 });
    const rent = cabinet.db.prepare("SELECT amount, merchant FROM transaction_row WHERE category='housing'").get() as any;
    expect(rent).toEqual({ amount: -1200, merchant: 'Rent, LLC' });
  });

  it('is idempotent: re-import inserts nothing', () => {
    importTransactionsCsv(cabinet.db, csv);
    const again = importTransactionsCsv(cabinet.db, csv);
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(3);
    const n = cabinet.db.prepare('SELECT COUNT(*) n FROM transaction_row').get() as { n: number };
    expect(n.n).toBe(3);
  });

  it('skips malformed rows without aborting the batch', () => {
    const messy = 'date,amount,merchant\n2026-07-04,not-a-number,X\n2026-07-05,-10,Coffee';
    expect(importTransactionsCsv(cabinet.db, messy)).toEqual({ inserted: 1, skipped: 1 });
  });
});

describe('admin & social', () => {
  it('upsertTask inserts then updates in place', () => {
    const id = upsertTask(cabinet.db, { title: 'Replace HVAC filter', due_on: '2026-08-01', recur_rule: 'every-90d' });
    const same = upsertTask(cabinet.db, { id, title: 'Replace HVAC filter', status: 'done' });
    expect(same).toBe(id);
    const row = cabinet.db.prepare('SELECT status, recur_rule FROM task WHERE id=?').get(id) as any;
    expect(row).toEqual({ status: 'done', recur_rule: 'every-90d' });
  });

  it('upsertContact is case-insensitive on name', () => {
    const id = upsertContact(cabinet.db, { name: 'Dave', keep_in_touch_days: 42 });
    expect(upsertContact(cabinet.db, { name: 'dave', last_contacted_on: '2026-07-01' })).toBe(id);
  });

  it('mood, journal, price watch land in their tables', () => {
    logMood(cabinet.db, { mood: 4, energy: 3, stress: 2 });
    addJournal(cabinet.db, 'long day, good lift');
    addPriceWatch(cabinet.db, { item: 'OLED monitor', target_price: 600 });
    for (const t of ['mood_log', 'journal_entry', 'price_watch']) {
      expect((cabinet.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe(1);
    }
  });
});

describe('goals (bi-temporal supersede — mentorship item 4)', () => {
  it('creates a new goal with no prior to supersede', () => {
    const res = upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 165, unit: 'g' });
    expect(res.supersededPrevious).toBeNull();
    const row = cabinet.db.prepare('SELECT domain, title, target_value, unit, active FROM goal WHERE id=?').get(res.id);
    expect(row).toEqual({ domain: 'nutrition', title: 'protein', target_value: 165, unit: 'g', active: 1 });
  });

  it('supersedes an existing goal for the same (domain, normalized title): old row deactivated, new row active, old value returned', () => {
    const first = upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Protein', target_value: 165, unit: 'g' });
    const second = upsertGoal(cabinet.db, { domain: 'nutrition', title: '  protein  ', target_value: 185, unit: 'g' });
    expect(second.supersededPrevious).toEqual({ id: first.id, target_value: 165, unit: 'g', cadence: null });
    expect(second.id).not.toBe(first.id);

    const oldRow = cabinet.db.prepare('SELECT active FROM goal WHERE id=?').get(first.id) as { active: number };
    expect(oldRow.active).toBe(0);
    const newRow = cabinet.db.prepare('SELECT active, target_value FROM goal WHERE id=?').get(second.id) as { active: number; target_value: number };
    expect(newRow).toEqual({ active: 1, target_value: 185 });
  });

  it('an exact-normalized-title match does not cross domains or match a different title', () => {
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'protein', target_value: 165, unit: 'g' });
    const trainingProtein = upsertGoal(cabinet.db, { domain: 'training', title: 'protein', target_value: 200, unit: 'g' });
    expect(trainingProtein.supersededPrevious).toBeNull(); // different domain, not superseded

    const calories = upsertGoal(cabinet.db, { domain: 'nutrition', title: 'calories', target_value: 2200, unit: 'kcal' });
    expect(calories.supersededPrevious).toBeNull(); // different title, not superseded

    // both nutrition rows (protein, calories) still active — a fuzzy match would have wrongly touched one
    const activeNutrition = cabinet.db.prepare("SELECT COUNT(*) n FROM goal WHERE domain='nutrition' AND active=1").get() as { n: number };
    expect(activeNutrition.n).toBe(2);
  });

  it('history is preserved — both rows still exist after supersession, only `active` differs', () => {
    const first = upsertGoal(cabinet.db, { domain: 'training', title: 'squat 1RM', target_value: 225, unit: 'lb' });
    const second = upsertGoal(cabinet.db, { domain: 'training', title: 'squat 1RM', target_value: 245, unit: 'lb' });
    const rows = cabinet.db
      .prepare("SELECT id, target_value, active FROM goal WHERE domain='training' AND lower(title)='squat 1rm' ORDER BY created_at")
      .all();
    expect(rows).toEqual([
      { id: first.id, target_value: 225, active: 0 },
      { id: second.id, target_value: 245, active: 1 },
    ]);
  });

  it('accepts a cadence-only habit goal with no target_value', () => {
    const res = upsertGoal(cabinet.db, { domain: 'training', title: 'lifting sessions', cadence: '4x/week' });
    const row = cabinet.db.prepare('SELECT target_value, cadence FROM goal WHERE id=?').get(res.id);
    expect(row).toEqual({ target_value: null, cadence: '4x/week' });
  });

  it('rejects a goal with neither target_value nor cadence — an empty goal tracks nothing', () => {
    expect(() => upsertGoal(cabinet.db, { domain: 'training', title: 'vague intention' })).toThrow(/target_value or a cadence/);
    expect((cabinet.db.prepare("SELECT COUNT(*) n FROM goal WHERE title='vague intention'").get() as { n: number }).n).toBe(0);
  });
});

describe('hard_constraint (dietary + physical safety gates — mentorship Phase B)', () => {
  it('the DB-level CHECK rejects a real (non-none) row with a null subject, independent of any app-layer guard', () => {
    expect(() =>
      cabinet.db.prepare("INSERT INTO hard_constraint (kind, is_none_confirmation, subject) VALUES ('dietary', 0, NULL)").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('upsertConstraint also rejects a real constraint with no subject, before ever reaching SQL', () => {
    expect(() => upsertConstraint(cabinet.db, { kind: 'dietary' })).toThrow(/needs a subject/);
  });

  it('confirmedNone writes a distinguishable sentinel row (is_none_confirmation=1, subject=null)', () => {
    const res = upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true, source: 'onboarding-interview' });
    const row = cabinet.db.prepare('SELECT kind, subject, is_none_confirmation, active, source FROM hard_constraint WHERE id=?').get(res.id);
    expect(row).toEqual({ kind: 'dietary', subject: null, is_none_confirmation: 1, active: 1, source: 'onboarding-interview' });
  });

  it('three distinguishable states via listConstraints: never-asked (no rows), confirmed-none (sentinel), has-constraints (real rows)', () => {
    expect(listConstraints(cabinet.db, 'dietary')).toEqual([]); // never asked

    upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
    const confirmedNoneState = listConstraints(cabinet.db, 'dietary');
    expect(confirmedNoneState).toHaveLength(1);
    expect(confirmedNoneState[0]!.is_none_confirmation).toBe(1);

    // a real constraint for physical must not affect dietary's state
    upsertConstraint(cabinet.db, { kind: 'physical', subject: 'conventional deadlift', severity: 'contraindicated', note: 'L4/L5 — avoid axial loading' });
    expect(listConstraints(cabinet.db, 'dietary')).toHaveLength(1); // unchanged
    const physicalState = listConstraints(cabinet.db, 'physical');
    expect(physicalState).toHaveLength(1);
    expect(physicalState[0]!.is_none_confirmation).toBe(0);
    expect(physicalState[0]!.subject).toBe('conventional deadlift');
  });

  it('re-confirming none for the same kind is idempotent — no duplicate sentinel row', () => {
    const first = upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
    const second = upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
    expect(second.id).toBe(first.id);
    expect((cabinet.db.prepare("SELECT COUNT(*) n FROM hard_constraint WHERE kind='dietary'").get() as { n: number }).n).toBe(1);
  });

  it('confirmedNone refuses when real active constraints already exist for that kind — a contradictory signal, not silently papered over', () => {
    upsertConstraint(cabinet.db, { kind: 'dietary', subject: 'shellfish', severity: 'allergy' });
    expect(() => upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true })).toThrow(/already on file/);
    // the real constraint is untouched, and no sentinel was inserted
    expect(listConstraints(cabinet.db, 'dietary')).toHaveLength(1);
  });

  it('a real constraint deactivates a stale "confirmed none" sentinel for the same kind — the two states must never both be active', () => {
    upsertConstraint(cabinet.db, { kind: 'dietary', confirmedNone: true });
    upsertConstraint(cabinet.db, { kind: 'dietary', subject: 'gluten', severity: 'intolerance' });
    const rows = listConstraints(cabinet.db, 'dietary');
    expect(rows).toHaveLength(1); // sentinel retired, only the real constraint reads as active
    expect(rows[0]!.subject).toBe('gluten');
  });

  it('supersedes an existing real constraint for the same (kind, normalized subject): old row deactivated, new active, history preserved', () => {
    const first = upsertConstraint(cabinet.db, { kind: 'physical', subject: 'Overhead Press', severity: 'caution', note: 'shoulder — light only' });
    const second = upsertConstraint(cabinet.db, { kind: 'physical', subject: '  overhead press  ', severity: 'contraindicated', note: 'cleared to caution only after PT' });
    expect(second.supersededPrevious).toEqual({ id: first.id, subject: 'Overhead Press', severity: 'caution' });

    const rows = cabinet.db
      .prepare("SELECT id, active, severity FROM hard_constraint WHERE kind='physical' AND lower(subject)='overhead press' ORDER BY created_at")
      .all();
    expect(rows).toEqual([
      { id: first.id, active: 0, severity: 'caution' },
      { id: second.id, active: 1, severity: 'contraindicated' },
    ]);
  });

  it('active=0 retires a constraint without deleting it — direct deactivation stays queryable, just excluded from listConstraints', () => {
    const res = upsertConstraint(cabinet.db, { kind: 'dietary', subject: 'lactose', severity: 'intolerance' });
    cabinet.db.prepare('UPDATE hard_constraint SET active = 0 WHERE id = ?').run(res.id);
    expect(listConstraints(cabinet.db, 'dietary')).toEqual([]);
    const stillThere = cabinet.db.prepare('SELECT subject FROM hard_constraint WHERE id=?').get(res.id) as { subject: string };
    expect(stillThere.subject).toBe('lactose'); // retired, not deleted
  });

  it('both kinds round-trip real constraints correctly and independently', () => {
    upsertConstraint(cabinet.db, { kind: 'dietary', subject: 'peanuts', severity: 'allergy', note: 'carries an epipen' });
    upsertConstraint(cabinet.db, { kind: 'physical', subject: 'loaded spinal flexion', severity: 'contraindicated', note: 'L4/L5 — avoid entirely' });
    const all = listConstraints(cabinet.db);
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.kind).sort()).toEqual(['dietary', 'physical']);
  });
});
