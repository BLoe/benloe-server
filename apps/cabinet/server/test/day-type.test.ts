import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { isTrainingDay, planActivity } from '../src/domains/activity.js';
import { logWorkout } from '../src/domains/training.js';
import { upsertGoal } from '../src/domains/misc.js';
import { goalTarget } from '../src/gateway/surfaces.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-daytype-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('isTrainingDay', () => {
  it('tier 1 — a strength plan entry makes it a training day', () => {
    planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'strength', title: 'Lower body — trainer' });
    expect(isTrainingDay(cabinet.db, '2026-07-14')).toBe(true);
  });

  it('tier 1 — a rest-only day is a rest day', () => {
    planActivity(cabinet.db, { localDay: '2026-07-15', kind: 'rest' });
    expect(isTrainingDay(cabinet.db, '2026-07-15')).toBe(false);
  });

  it('tier 1 — an all-skipped day is a rest day (skipped real sessions do not count)', () => {
    planActivity(cabinet.db, { localDay: '2026-07-16', kind: 'cardio', status: 'skipped' });
    planActivity(cabinet.db, { localDay: '2026-07-16', kind: 'strength', status: 'skipped' });
    expect(isTrainingDay(cabinet.db, '2026-07-16')).toBe(false);
  });

  it('tier 2 — no plan entry but a logged workout that day makes it a training day', () => {
    logWorkout(cabinet.db, { name: 'Unplanned run', when: new Date('2026-07-17T12:00:00Z'), sets: [] });
    expect(isTrainingDay(cabinet.db, '2026-07-17')).toBe(true);
  });

  it('tier 3 — no data at all: a Tuesday is a training day, a Wednesday is not', () => {
    // 2026-07-14 is a Tuesday, 2026-07-15 is a Wednesday
    expect(isTrainingDay(cabinet.db, '2026-07-14')).toBe(true);
    expect(isTrainingDay(cabinet.db, '2026-07-15')).toBe(false);
  });

  it('PRECEDENCE — a planned rest day with an incidental logged workout is still a rest day (tier 1 beats tier 2)', () => {
    planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'rest' }); // a Tuesday, so tier 3 would also say training — must not fall through to it
    logWorkout(cabinet.db, { name: 'Snuck in a session', when: new Date('2026-07-14T12:00:00Z'), sets: [] });
    expect(isTrainingDay(cabinet.db, '2026-07-14')).toBe(false);
  });
});

describe('goalTarget — day-type resolution', () => {
  function seedCalorieGoals() {
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Calories, training day', target_value: 2150, day_type: 'training' });
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Calories, rest day', target_value: 1950, day_type: 'rest' });
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Protein', target_value: 180 }); // no day_type — applies every day
  }

  it('resolves the training-day calorie goal on a training day', () => {
    seedCalorieGoals();
    expect(goalTarget(cabinet.db, 'nutrition', 'calor', 'training', 2200)).toBe(2150);
  });

  it('resolves the rest-day calorie goal on a rest day', () => {
    seedCalorieGoals();
    expect(goalTarget(cabinet.db, 'nutrition', 'calor', 'rest', 2200)).toBe(1950);
  });

  it('a NULL-day_type goal (protein) resolves regardless of which dayType is passed', () => {
    seedCalorieGoals();
    expect(goalTarget(cabinet.db, 'nutrition', 'protein', 'training', 165)).toBe(180);
    expect(goalTarget(cabinet.db, 'nutrition', 'protein', 'rest', 165)).toBe(180);
  });

  it('falls back to the provided default when no goal matches at all', () => {
    expect(goalTarget(cabinet.db, 'nutrition', 'calor', 'training', 2200)).toBe(2200);
  });
});

describe('upsertGoal', () => {
  it('persists day_type', () => {
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Calories, training day', target_value: 2150, day_type: 'training' });
    const row = cabinet.db.prepare("SELECT day_type FROM goal WHERE title = 'Calories, training day' AND active = 1").get() as { day_type: string | null };
    expect(row.day_type).toBe('training');
  });

  it('leaves day_type NULL when omitted', () => {
    upsertGoal(cabinet.db, { domain: 'nutrition', title: 'Protein', target_value: 180 });
    const row = cabinet.db.prepare("SELECT day_type FROM goal WHERE title = 'Protein' AND active = 1").get() as { day_type: string | null };
    expect(row.day_type).toBeNull();
  });
});
