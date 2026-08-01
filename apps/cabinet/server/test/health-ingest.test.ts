import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ingestHealthDay, ingestHealthDays, num, recentHealth } from '../src/domains/health.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-health-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('num', () => {
  it('coerces the shapes Shortcuts actually sends', () => {
    expect(num(4200)).toBe(4200);
    expect(num('4200')).toBe(4200);
    expect(num('4,200')).toBe(4200);
    expect(num(' 62 ')).toBe(62);
  });

  it('maps absent and unparseable values to null, never 0', () => {
    // A 0 here would read as a genuine rest day and corrupt the ankle budget.
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('no data')).toBeNull();
    expect(num(NaN)).toBeNull();
  });
});

describe('ingestHealthDay', () => {
  it('inserts a day and reports which fields landed', () => {
    const r = ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 4200, sleep_minutes: 402 });
    expect(r.local_day).toBe('2026-08-01');
    expect(r.updated.sort()).toEqual(['sleep_minutes', 'steps']);
    const row = cabinet.db.prepare('SELECT * FROM health_daily WHERE local_day = ?').get('2026-08-01') as Record<string, unknown>;
    expect(row.steps).toBe(4200);
    expect(row.sleep_minutes).toBe(402);
    expect(row.source).toBe('apple_health');
  });

  it('does NOT blank existing fields when a later POST omits them', () => {
    // The Shortcut fires twice: sleep in the morning, steps at night.
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', sleep_minutes: 402 });
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 4200 });
    const row = cabinet.db.prepare('SELECT * FROM health_daily WHERE local_day = ?').get('2026-08-01') as Record<string, unknown>;
    expect(row.sleep_minutes).toBe(402);
    expect(row.steps).toBe(4200);
  });

  it('overwrites a field when a real new value arrives', () => {
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 1000 });
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 6500 });
    const row = cabinet.db.prepare('SELECT steps FROM health_daily WHERE local_day = ?').get('2026-08-01') as { steps: number };
    expect(row.steps).toBe(6500);
  });

  it('accepts string values from Shortcuts', () => {
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: '4,200' as never, resting_hr: '62' as never });
    const row = cabinet.db.prepare('SELECT steps, resting_hr FROM health_daily WHERE local_day = ?').get('2026-08-01') as Record<string, number>;
    expect(row.steps).toBe(4200);
    expect(row.resting_hr).toBe(62);
  });

  it('defaults local_day to today when omitted', () => {
    const r = ingestHealthDay(cabinet.db, { steps: 10 });
    expect(r.local_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ingestHealthDays', () => {
  it('backfills a batch in one transaction', () => {
    const r = ingestHealthDays(cabinet.db, [
      { local_day: '2026-07-30', steps: 3000 },
      { local_day: '2026-07-31', steps: 8000 },
      { local_day: '2026-08-01', steps: 4200 },
    ]);
    expect(r.days).toBe(3);
    const n = cabinet.db.prepare('SELECT COUNT(*) c FROM health_daily').get() as { c: number };
    expect(n.c).toBe(3);
  });
});

describe('recentHealth', () => {
  it('returns days ascending', () => {
    ingestHealthDays(cabinet.db, [
      { local_day: '2026-07-31', steps: 8000 },
      { local_day: '2026-07-30', steps: 3000 },
    ]);
    const rows = recentHealth(cabinet.db, 3650);
    expect(rows.map((r) => r.local_day)).toEqual(['2026-07-30', '2026-07-31']);
  });
});
