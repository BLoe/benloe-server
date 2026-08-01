import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { logFood } from '../src/domains/food.js';
import { localHour, logSubstance, substanceDay, substanceNights } from '../src/domains/substances.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-sub-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('localHour', () => {
  it('converts to Ben-local hours across both DST states', () => {
    // 2026-08-01T23:30Z is 7:30pm EDT (UTC-4).
    expect(localHour('2026-08-01T23:30:00Z')).toBeCloseTo(19.5);
    // 2026-01-15T23:30Z is 6:30pm EST (UTC-5).
    expect(localHour('2026-01-15T23:30:00Z')).toBeCloseTo(18.5);
  });

  it('reads past-midnight-UTC events as the prior evening in New York', () => {
    // 03:00Z on the 2nd is 11pm on the 1st — a late edible belongs to the
    // night it was taken, not to the next morning.
    expect(localHour('2026-08-02T03:00:00Z')).toBeCloseTo(23);
  });
});

describe('logSubstance', () => {
  it('stores route, dose and unit verbatim without normalizing', () => {
    logSubstance(cabinet.db, {
      substance: 'cannabis',
      route: 'edible',
      dose: 20,
      unit: 'mg',
      product: '20mg gummy',
      context: 'wake-up',
      when: new Date('2026-08-01T15:00:00Z'),
    });
    const rows = substanceDay(cabinet.db, '2026-08-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].route).toBe('edible');
    expect(rows[0].dose).toBe(20);
    expect(rows[0].unit).toBe('mg');
    expect(rows[0].context).toBe('wake-up');
  });

  it('assigns a late-night event to the day it was taken, not the next', () => {
    // 03:00Z Aug 2 === 11pm Aug 1 in New York.
    const { local_day } = logSubstance(cabinet.db, {
      substance: 'cannabis',
      route: 'smoked',
      when: new Date('2026-08-02T03:00:00Z'),
    });
    expect(local_day).toBe('2026-08-01');
  });

  it('orders a day chronologically', () => {
    logSubstance(cabinet.db, { substance: 'cannabis', dose: 10, unit: 'mg', when: new Date('2026-08-01T22:00:00Z') });
    logSubstance(cabinet.db, { substance: 'caffeine', dose: 95, unit: 'mg', when: new Date('2026-08-01T13:00:00Z') });
    const rows = substanceDay(cabinet.db, '2026-08-01');
    expect(rows.map((r) => r.substance)).toEqual(['caffeine', 'cannabis']);
  });
});

describe('substanceNights', () => {
  it('joins cannabis timing, late calories and sleep onto one row', () => {
    const day = '2026-08-01';
    // 11am edible, then a 10:30pm one — last_hour must be the later.
    logSubstance(cabinet.db, { substance: 'cannabis', route: 'edible', dose: 20, unit: 'mg', when: new Date('2026-08-01T15:00:00Z') });
    logSubstance(cabinet.db, { substance: 'cannabis', route: 'smoked', dose: 10, unit: 'mg', when: new Date('2026-08-02T02:30:00Z') });
    // 6pm dinner is not late; 9:30pm snack is.
    logFood(cabinet.db, { description: 'dinner', kcal: 700, when: new Date('2026-08-01T22:00:00Z') });
    logFood(cabinet.db, { description: 'chips', kcal: 400, when: new Date('2026-08-02T01:30:00Z') });
    cabinet.db.prepare('INSERT INTO health_daily (local_day, sleep_minutes) VALUES (?,?)').run(day, 402);

    const nights = substanceNights(cabinet.db, 3650);
    const row = nights.find((n) => n.local_day === day)!;
    expect(row.cannabis_events).toBe(2);
    expect(row.cannabis_mg).toBe(30);
    expect(row.cannabis_last_hour).toBeCloseTo(22.5);
    expect(row.cannabis_routes.sort()).toEqual(['edible', 'smoked']);
    expect(row.sleep_minutes).toBe(402);
    // Only the 9:30pm entry counts toward the grazing window.
    expect(row.late_kcal).toBe(400);
    expect(row.late_entries).toBe(1);
  });

  it('keeps grams out of the milligram total rather than silently summing', () => {
    logSubstance(cabinet.db, { substance: 'cannabis', route: 'edible', dose: 10, unit: 'mg', when: new Date('2026-08-01T20:00:00Z') });
    logSubstance(cabinet.db, { substance: 'cannabis', route: 'smoked', dose: 0.5, unit: 'g', when: new Date('2026-08-01T21:00:00Z') });
    const row = substanceNights(cabinet.db, 3650).find((n) => n.local_day === '2026-08-01')!;
    expect(row.cannabis_mg).toBe(10);
    expect(row.cannabis_events).toBe(2);
  });

  it('separates alcohol, nicotine and caffeine into their own columns', () => {
    const when = new Date('2026-08-01T20:00:00Z');
    logSubstance(cabinet.db, { substance: 'alcohol', route: 'drink', dose: 3, unit: 'drink', when });
    logSubstance(cabinet.db, { substance: 'nicotine', route: 'smoked', when });
    logSubstance(cabinet.db, { substance: 'caffeine', route: 'drink', dose: 190, unit: 'mg', when });
    const row = substanceNights(cabinet.db, 3650).find((n) => n.local_day === '2026-08-01')!;
    expect(row.alcohol_drinks).toBe(3);
    expect(row.nicotine_events).toBe(1);
    expect(row.caffeine_mg).toBe(190);
    expect(row.caffeine_last_hour).toBeCloseTo(16);
    expect(row.cannabis_events).toBe(0);
  });

  it('returns days ascending and includes food-only days', () => {
    logFood(cabinet.db, { description: 'late snack', kcal: 250, when: new Date('2026-07-30T01:00:00Z') });
    logSubstance(cabinet.db, { substance: 'cannabis', when: new Date('2026-08-01T20:00:00Z') });
    const days = substanceNights(cabinet.db, 3650).map((n) => n.local_day);
    expect(days).toEqual(['2026-07-29', '2026-08-01']);
  });
});
