import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { adherence, deriveHabits, deriveHabitsRange, markHabit } from '../src/domains/adherence.js';

let dir: string;
let cabinet: CabinetDb;

/** Goal titles mirror the real Phase 0 rows — the derivers match on them. */
function seedGoals(db: CabinetDb['db']) {
  const ins = db.prepare('INSERT INTO goal (id, title, domain, target_value, unit, cadence) VALUES (?,?,?,?,?,?)');
  ins.run(1, 'Morning weigh-in logged (floor 1 — survives any week)', 'health', 1, 'log', 'daily');
  ins.run(2, 'Day carries at least one signal — weight, sentence, or photo (P9 metric)', 'health', 1, 'signal', 'daily');
  ins.run(3, 'Trainer sessions with Emanuel (floor 3 — the load-bearing wall)', 'training', 2, 'sessions', 'weekly');
  ins.run(4, 'Wind-down started by 10:30pm — screens off, stretch, book (floor 4)', 'health', 1, 'ritual', 'daily');
  ins.run(7, 'Phase 0 instrumentation complete — 14 days of intake, weed, alcohol, sleep, ankle ache, walking load', 'health', 14, 'days', 'once');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-adh-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  seedGoals(cabinet.db);
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('deriveHabits', () => {
  it('scores the weigh-in goal from a body_metric row with no explicit marking', () => {
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value, source) VALUES (?,?,?,?,?)')
      .run('2026-08-02T12:00:00Z', '2026-08-02', 'weight_lb', 279.2, 'manual');

    const res = deriveHabits(cabinet.db, '2026-08-02');
    expect(res.marked).toContain('Morning weigh-in logged (floor 1 — survives any week)');

    const row = adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 1);
    expect(row?.actual).toBe(1);
    expect(row?.streak).toBe(1);
    expect(row?.derived).toBe(true);
  });

  it('satisfies the P9 any-signal goal from ANY log table, not just weight', () => {
    // A mood note alone is a held day. This is the floor that must never be hard.
    cabinet.db
      .prepare('INSERT INTO mood_log (logged_at, local_day, mood, energy, stress, note) VALUES (?,?,?,?,?,?)')
      .run('2026-08-02T13:00:00Z', '2026-08-02', 3, 3, 2, 'flat but fine');

    const res = deriveHabits(cabinet.db, '2026-08-02');
    expect(res.marked.some((t) => t.includes('at least one signal'))).toBe(true);
    // ...and it did NOT accidentally satisfy the weigh-in goal.
    expect(res.marked.some((t) => t.includes('weigh-in'))).toBe(false);
  });

  it('matches the trainer goal on the trainer name in a workout', () => {
    cabinet.db
      .prepare('INSERT INTO workout (performed_at, local_day, name, notes) VALUES (?,?,?,?)')
      .run('2026-08-04T21:45:00Z', '2026-08-04', 'Session with Emanuel', 'lower body');
    expect(deriveHabits(cabinet.db, '2026-08-04').marked.some((t) => t.includes('Trainer'))).toBe(true);
  });

  it('requires all three streams for the Phase 0 instrumentation goal', () => {
    const day = '2026-08-03';
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
      .run(`${day}T12:00:00Z`, day, 'weight_lb', 279);
    // Weight alone is not an instrumented day.
    expect(deriveHabits(cabinet.db, day).marked.some((t) => t.includes('instrumentation'))).toBe(false);

    cabinet.db
      .prepare('INSERT INTO food_log (eaten_at, local_day, description) VALUES (?,?,?)')
      .run(`${day}T16:00:00Z`, day, 'eggs');
    expect(deriveHabits(cabinet.db, day).marked.some((t) => t.includes('instrumentation'))).toBe(false);

    cabinet.db
      .prepare('INSERT INTO substance_log (taken_at, local_day, substance) VALUES (?,?,?)')
      .run(`${day}T23:00:00Z`, day, 'cannabis');
    expect(deriveHabits(cabinet.db, day).marked.some((t) => t.includes('instrumentation'))).toBe(true);
  });

  it('is idempotent — deriving the same day repeatedly cannot inflate adherence', () => {
    cabinet.db
      .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
      .run('2026-08-02T12:00:00Z', '2026-08-02', 'weight_lb', 279);
    deriveHabits(cabinet.db, '2026-08-02');
    deriveHabits(cabinet.db, '2026-08-02');
    deriveHabits(cabinet.db, '2026-08-02');

    const n = cabinet.db.prepare('SELECT COUNT(*) c FROM habit_event WHERE goal_id = 1').get() as { c: number };
    expect(n.c).toBe(1);
    expect(adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 1)?.actual).toBe(1);
  });

  it('back-fills a range so a late-landing log still counts', () => {
    for (const d of ['2026-07-31', '2026-08-01', '2026-08-02']) {
      cabinet.db
        .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value) VALUES (?,?,?,?)')
        .run(`${d}T12:00:00Z`, d, 'weight_lb', 279);
    }
    deriveHabitsRange(cabinet.db, 5, '2026-08-02');
    expect(adherence(cabinet.db, 5, '2026-08-02').find((r) => r.goal_id === 1)?.actual).toBe(3);
  });
});

describe('markHabit', () => {
  it('upserts rather than duplicating, and can flip a day back to not-done', () => {
    markHabit(cabinet.db, { goalId: 4, localDay: '2026-08-02', done: true });
    markHabit(cabinet.db, { goalId: 4, localDay: '2026-08-02', done: true });
    const rows = cabinet.db.prepare('SELECT * FROM habit_event WHERE goal_id = 4').all();
    expect(rows).toHaveLength(1);

    markHabit(cabinet.db, { goalId: 4, localDay: '2026-08-02', done: false });
    expect(adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 4)?.actual).toBe(0);
  });
});

describe('adherence', () => {
  it('distinguishes an unmeasured goal from a failed one', () => {
    // Goal 4 (wind-down) has no deriver and no marks. That is not a zero.
    const row = adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 4);
    expect(row?.unmeasured).toBe(true);
    expect(row?.actual).toBe(0);

    // Goal 1 HAS a deriver, so silence there is a real (measurable) miss.
    expect(adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 1)?.unmeasured).toBe(false);
  });

  it('scores a weekly goal against target_value per 7 days, and never above 1', () => {
    markHabit(cabinet.db, { goalId: 3, localDay: '2026-08-04' });
    markHabit(cabinet.db, { goalId: 3, localDay: '2026-08-07' });
    const row = adherence(cabinet.db, 7, '2026-08-08').find((r) => r.goal_id === 3);
    expect(row?.expected).toBe(2);
    expect(row?.actual).toBe(2);
    expect(row?.rate).toBe(1);

    // A third session in the same week does not buy credit forward.
    markHabit(cabinet.db, { goalId: 3, localDay: '2026-08-08' });
    expect(adherence(cabinet.db, 7, '2026-08-08').find((r) => r.goal_id === 3)?.rate).toBe(1);
  });

  it('reports no streak for weekly goals', () => {
    markHabit(cabinet.db, { goalId: 3, localDay: '2026-08-08' });
    expect(adherence(cabinet.db, 7, '2026-08-08').find((r) => r.goal_id === 3)?.streak).toBe(0);
  });

  it('counts a once-cadence goal cumulatively, beyond the trailing window', () => {
    // Ten instrumented days, but a 7-day window. The Phase 0 counter must
    // still read 10/14 — not 7/7 — or day 15 reports progress forever.
    for (let i = 0; i < 10; i++) {
      const d = `2026-08-${String(i + 1).padStart(2, '0')}`;
      markHabit(cabinet.db, { goalId: 7, localDay: d });
    }
    const row = adherence(cabinet.db, 7, '2026-08-10').find((r) => r.goal_id === 7);
    expect(row?.expected).toBe(14);
    expect(row?.actual).toBe(10);
    expect(row?.rate).toBeCloseTo(10 / 14);
  });

  it('breaks a streak on a gap but keeps the trailing run', () => {
    for (const d of ['2026-07-30', '2026-08-01', '2026-08-02']) {
      markHabit(cabinet.db, { goalId: 1, localDay: d });
    }
    const row = adherence(cabinet.db, 7, '2026-08-02').find((r) => r.goal_id === 1);
    expect(row?.streak).toBe(2); // 08-01 and 08-02; 07-31 is missing
    expect(row?.actual).toBe(3);
  });

  it('survives a nonsense window without silently reporting zero adherence', () => {
    markHabit(cabinet.db, { goalId: 1, localDay: '2026-08-02' });
    const row = adherence(cabinet.db, 0, '2026-08-02').find((r) => r.goal_id === 1);
    expect(row?.expected).toBe(1);
    expect(row?.actual).toBe(1);
  });
});
