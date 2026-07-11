import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

/** IRS limits (verify against SPD / update yearly — Appendix A). */
export const HSA_LIMITS: Record<number, { selfOnly: number; catchUp55: number; minDeductible: number; oopMax: number }> = {
  2026: { selfOnly: 4400, catchUp55: 1000, minDeductible: 1700, oopMax: 8500 },
  2027: { selfOnly: 4500, catchUp55: 1000, minDeductible: 1750, oopMax: 8700 },
};

/**
 * Ensures a placeholder insurance_plan row exists for the given year so
 * callers that need a plan id (e.g. log_claim's fallback) never fail for
 * want of one — but seeds no real plan details. Ben's actual plan
 * (name/deductible/OOP max) gets filled in fresh via onboarding/an explicit
 * UPDATE, not baked into this code seed. Idempotent per plan_year, same as
 * before.
 */
export function seedInsurancePlan(db: Database.Database, planYear: number = new Date().getFullYear()): number {
  const existing = db.prepare('SELECT id FROM insurance_plan WHERE plan_year = ?').get(planYear) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO insurance_plan (plan_name, plan_year, deductible_individual, oop_max_individual) VALUES (?,?,?,?)',
    )
    .run('Unset — update via onboarding', planYear, null, null);
  return Number(lastInsertRowid);
}

export interface Accumulators {
  planYear: number;
  deductible: { applied: number; limit: number | null; remaining: number | null };
  oop: { applied: number; limit: number | null; remaining: number | null };
}

export function accumulators(db: Database.Database, planId: number): Accumulators {
  const plan = db
    .prepare('SELECT plan_year, deductible_individual, oop_max_individual FROM insurance_plan WHERE id = ?')
    .get(planId) as { plan_year: number; deductible_individual: number | null; oop_max_individual: number | null };
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(applied_to_deductible),0) d, COALESCE(SUM(applied_to_oop),0) o
       FROM claim WHERE plan_id = ? AND status != 'denied'`,
    )
    .get(planId) as { d: number; o: number };
  const rem = (limit: number | null, applied: number) => (limit === null ? null : Math.max(0, limit - applied));
  return {
    planYear: plan.plan_year,
    deductible: { applied: sums.d, limit: plan.deductible_individual, remaining: rem(plan.deductible_individual, sums.d) },
    oop: { applied: sums.o, limit: plan.oop_max_individual, remaining: rem(plan.oop_max_individual, sums.o) },
  };
}

export function logClaim(
  db: Database.Database,
  c: {
    planId: number; service_date?: string; provider?: string; description?: string;
    billed?: number; allowed?: number; plan_paid?: number; patient_owed?: number;
    applied_to_deductible?: number; applied_to_oop?: number;
    status?: 'submitted' | 'processed' | 'paid' | 'denied' | 'appeal';
  },
): { id: number; accumulators: Accumulators } {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO claim (plan_id, service_date, provider, description, billed, allowed, plan_paid, patient_owed, applied_to_deductible, applied_to_oop, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      c.planId, c.service_date ?? null, c.provider ?? null, c.description ?? null,
      c.billed ?? null, c.allowed ?? null, c.plan_paid ?? null, c.patient_owed ?? null,
      c.applied_to_deductible ?? 0, c.applied_to_oop ?? 0, c.status ?? 'processed',
    );
  return { id: Number(lastInsertRowid), accumulators: accumulators(db, c.planId) };
}

export function logHsaContribution(
  db: Database.Database,
  c: { amount: number; taxYear: number; source?: 'payroll' | 'manual'; when?: string },
): { id: number; ytd: number; limit: number | null; headroom: number | null } {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO hsa_contribution (contributed_on, tax_year, amount, source) VALUES (?,?,?,?)')
    .run(c.when ?? localDay(), c.taxYear, c.amount, c.source ?? 'manual');
  const ytd = (db.prepare('SELECT COALESCE(SUM(amount),0) s FROM hsa_contribution WHERE tax_year = ?').get(c.taxYear) as { s: number }).s;
  const limit = HSA_LIMITS[c.taxYear]?.selfOnly ?? null;
  return { id: Number(lastInsertRowid), ytd, limit, headroom: limit === null ? null : Math.max(0, limit - ytd) };
}

export function logLab(
  db: Database.Database,
  l: { drawn_on: string; panel?: string; analyte: string; value?: number; unit?: string; ref_low?: number; ref_high?: number },
): { id: number; flag: string | null } {
  const flag =
    l.value !== undefined && l.ref_high !== undefined && l.value > l.ref_high ? 'H'
    : l.value !== undefined && l.ref_low !== undefined && l.value < l.ref_low ? 'L'
    : null;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO lab_result (drawn_on, panel, analyte, value, unit, ref_low, ref_high, flag) VALUES (?,?,?,?,?,?,?,?)')
    .run(l.drawn_on, l.panel ?? null, l.analyte, l.value ?? null, l.unit ?? null, l.ref_low ?? null, l.ref_high ?? null, flag);
  return { id: Number(lastInsertRowid), flag };
}

export function logMedication(
  db: Database.Database,
  m: { name: string; dose?: string; schedule?: string; is_supplement?: boolean; days_supply?: number; last_filled_on?: string; refills_left?: number },
): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO medication (name, dose, schedule, is_supplement, days_supply, last_filled_on, refills_left) VALUES (?,?,?,?,?,?,?)')
    .run(m.name, m.dose ?? null, m.schedule ?? null, Number(m.is_supplement ?? 0), m.days_supply ?? null, m.last_filled_on ?? null, m.refills_left ?? null);
  return Number(lastInsertRowid);
}

/** Medications running low: days of supply remaining assuming daily use since last fill. */
export function medicationsLow(db: Database.Database, thresholdDays = 5, today = localDay()): { name: string; daysLeft: number }[] {
  const rows = db
    .prepare("SELECT name, days_supply, last_filled_on FROM medication WHERE active = 1 AND days_supply IS NOT NULL AND last_filled_on IS NOT NULL")
    .all() as { name: string; days_supply: number; last_filled_on: string }[];
  const out: { name: string; daysLeft: number }[] = [];
  for (const r of rows) {
    const elapsed = Math.floor((Date.parse(today) - Date.parse(r.last_filled_on)) / 86_400_000);
    const daysLeft = r.days_supply - elapsed;
    if (daysLeft <= thresholdDays) out.push({ name: r.name, daysLeft });
  }
  return out;
}
