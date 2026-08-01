import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  ANKLE_AM,
  ANKLE_PM,
  ankleLoadResponse,
  ankleThreshold,
  logSymptom,
  symptomHistory,
  symptomsOn,
} from '../src/domains/symptoms.js';
import { ingestHealthDay } from '../src/domains/health.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-sym-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('logSymptom', () => {
  it('corrects rather than duplicates when a day is re-reported', () => {
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 3, localDay: '2026-08-02' });
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 6, localDay: '2026-08-02' });
    const rows = symptomsOn(cabinet.db, '2026-08-02');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe(6);
  });

  it('keeps morning and evening readings of the same joint as separate rows', () => {
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 2, localDay: '2026-08-02' });
    logSymptom(cabinet.db, { symptom: ANKLE_PM, severity: 7, localDay: '2026-08-02' });
    expect(symptomsOn(cabinet.db, '2026-08-02')).toHaveLength(2);
  });

  it('preserves existing notes when a later log omits them', () => {
    logSymptom(cabinet.db, {
      symptom: 'sore_throat',
      severity: 3,
      localDay: '2026-08-02',
      notes: 'since Mother’s Day',
    });
    logSymptom(cabinet.db, { symptom: 'sore_throat', severity: 4, localDay: '2026-08-02' });
    const row = symptomsOn(cabinet.db, '2026-08-02')[0];
    expect(row?.severity).toBe(4);
    expect(row?.notes).toBe('since Mother’s Day');
  });

  it('returns a symptom trend in day order', () => {
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 5, localDay: '2026-08-03' });
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 2, localDay: '2026-08-01' });
    const hist = symptomHistory(cabinet.db, ANKLE_AM, 10, '2026-08-03');
    expect(hist.map((r) => r.local_day)).toEqual(['2026-08-01', '2026-08-03']);
  });
});

describe('ankleLoadResponse', () => {
  it('pairs morning ache against the PREVIOUS day of steps', () => {
    // The flare lags the load by a day; joining same-day steps would
    // mis-attribute every flare by 24 hours.
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 14000 });
    ingestHealthDay(cabinet.db, { local_day: '2026-08-02', steps: 2000 });
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 7, localDay: '2026-08-02' });

    const rows = ankleLoadResponse(cabinet.db, 2, '2026-08-02');
    const aug2 = rows.find((r) => r.local_day === '2026-08-02');
    expect(aug2?.ache_am).toBe(7);
    expect(aug2?.steps).toBe(2000);
    expect(aug2?.steps_prev).toBe(14000);
  });

  it('returns a full contiguous window even where nothing was recorded', () => {
    const rows = ankleLoadResponse(cabinet.db, 5, '2026-08-02');
    expect(rows).toHaveLength(5);
    expect(rows[0]?.local_day).toBe('2026-07-29');
    expect(rows[4]?.local_day).toBe('2026-08-02');
    expect(rows[2]?.steps).toBeNull();
  });
});

describe('ankleThreshold', () => {
  it('withholds a read until three pairs sit on each side of the cut', () => {
    ingestHealthDay(cabinet.db, { local_day: '2026-08-01', steps: 15000 });
    logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: 8, localDay: '2026-08-02' });
    const out = ankleThreshold(cabinet.db, 14, '2026-08-02');
    expect(out.n_pairs).toBe(1);
    expect(out.read).toBeNull();
  });

  it('separates flare-day load from calm-day load once powered', () => {
    const days = [
      ['2026-08-01', 14000, 8],
      ['2026-08-02', 15000, 7],
      ['2026-08-03', 16000, 9],
      ['2026-08-04', 3000, 2],
      ['2026-08-05', 2000, 1],
      ['2026-08-06', 4000, 3],
    ] as const;
    // steps on day N, ache reported on day N+1.
    for (const [day, steps] of days) ingestHealthDay(cabinet.db, { local_day: day, steps });
    for (const [day, , ache] of days) {
      const next = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: ache, localDay: next });
    }

    const out = ankleThreshold(cabinet.db, 14, '2026-08-07');
    expect(out.n_pairs).toBe(6);
    expect(out.steps_before_flare).toBe(15000);
    expect(out.steps_before_calm).toBe(3000);
    expect(out.read).toContain('Working ceiling');
  });

  it('says so plainly when load does not explain the ache', () => {
    // Inverted data: the ache follows the QUIET days. The honest output is
    // "look for another driver," not a fabricated ceiling.
    const days = [
      ['2026-08-01', 2000, 8],
      ['2026-08-02', 1000, 7],
      ['2026-08-03', 3000, 9],
      ['2026-08-04', 15000, 2],
      ['2026-08-05', 14000, 1],
      ['2026-08-06', 16000, 3],
    ] as const;
    for (const [day, steps] of days) ingestHealthDay(cabinet.db, { local_day: day, steps });
    for (const [day, , ache] of days) {
      const next = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      logSymptom(cabinet.db, { symptom: ANKLE_AM, severity: ache, localDay: next });
    }
    expect(ankleThreshold(cabinet.db, 14, '2026-08-07').read).toContain('another driver');
  });
});
