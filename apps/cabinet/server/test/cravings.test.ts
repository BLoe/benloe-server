import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  cravingsOn,
  e1Readout,
  logCraving,
  redirectRanking,
  resolveCraving,
} from '../src/domains/cravings.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-crav-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

function food(day: string, iso: string, kcal: number) {
  cabinet.db
    .prepare('INSERT INTO food_log (eaten_at, local_day, description, kcal) VALUES (?,?,?,?)')
    .run(iso, day, 'x', kcal);
}

describe('logCraving', () => {
  it('attributes a late-night event to the correct local day, not the UTC day', () => {
    // 2026-08-03T02:30Z is 10:30pm on Aug 2 in New York — the heart of the
    // craving window. Filing it under Aug 3 would move every late event onto
    // the following morning and destroy the E1 comparison.
    const res = logCraving(cabinet.db, { occurredAt: '2026-08-03T02:30:00Z', intensity: 7 });
    expect(res.local_day).toBe('2026-08-02');
    expect(res.hour).toBeCloseTo(22.5);
  });

  it('accepts an event with no outcome yet — the live damage-control path', () => {
    const { id } = logCraving(cabinet.db, {
      occurredAt: '2026-08-03T01:40:00Z',
      intensity: 8,
      trigger: 'boredom',
      redirect: 'seltzer + 15 min',
    });
    expect(cravingsOn(cabinet.db, '2026-08-02')[0]?.outcome).toBeNull();

    expect(resolveCraving(cabinet.db, id, { outcome: 'held', minutesToResolve: 18 })).toBe(true);
    const row = cravingsOn(cabinet.db, '2026-08-02')[0];
    expect(row?.outcome).toBe('held');
    expect(row?.minutes_to_resolve).toBe(18);
    // Resolving must not clobber the redirect recorded in the moment.
    expect(row?.redirect).toBe('seltzer + 15 min');
  });

  it('rejects an outcome outside the allowed set at the schema level', () => {
    expect(() =>
      cabinet.db
        .prepare('INSERT INTO craving_event (occurred_at, local_day, outcome) VALUES (?,?,?)')
        .run('2026-08-02T23:00:00Z', '2026-08-02', 'gave_up'),
    ).toThrow();
  });

  it('returns false when resolving with an empty patch', () => {
    const { id } = logCraving(cabinet.db, { occurredAt: '2026-08-02T23:00:00Z' });
    expect(resolveCraving(cabinet.db, id, {})).toBe(false);
  });
});

describe('redirectRanking', () => {
  it('counts planned_snack as a success alongside held', () => {
    // RHYTHM budgets an evening snack on purpose; scoring it as a failure
    // would teach Cabinet that eating on plan is a loss.
    logCraving(cabinet.db, {
      occurredAt: '2026-08-02T23:00:00Z',
      redirect: 'yogurt + granola',
      outcome: 'planned_snack',
    });
    const [top] = redirectRanking(cabinet.db, 30, '2026-08-02');
    expect(top?.held).toBe(1);
    expect(top?.success_rate).toBe(1);
  });

  it('ranks by success COUNT before rate, so a 1-for-1 fluke cannot top a proven move', () => {
    for (let i = 0; i < 6; i++) {
      logCraving(cabinet.db, {
        occurredAt: `2026-08-0${(i % 2) + 1}T23:0${i}:00Z`,
        redirect: 'seltzer + 15 min',
        outcome: i < 5 ? 'held' : 'ordered_out',
      });
    }
    logCraving(cabinet.db, {
      occurredAt: '2026-08-02T23:30:00Z',
      redirect: 'called Zach',
      outcome: 'held',
    });

    const ranked = redirectRanking(cabinet.db, 30, '2026-08-02');
    expect(ranked[0]?.redirect).toBe('seltzer + 15 min');
    expect(ranked[0]?.held).toBe(5);
    // The fluke has a perfect rate but ranks below it. (Labels are normalized
    // to lowercase so 'Seltzer' and 'seltzer' group as one move.)
    expect(ranked[1]?.redirect).toBe('called zach');
    expect(ranked[1]?.success_rate).toBe(1);
  });

  it('groups case- and whitespace-variant redirect labels together', () => {
    logCraving(cabinet.db, { occurredAt: '2026-08-02T23:00:00Z', redirect: 'Seltzer', outcome: 'held' });
    logCraving(cabinet.db, { occurredAt: '2026-08-02T23:10:00Z', redirect: ' seltzer ', outcome: 'held' });
    const ranked = redirectRanking(cabinet.db, 30, '2026-08-02');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.uses).toBe(2);
  });

  it('excludes unresolved events from the rate but still counts the use', () => {
    logCraving(cabinet.db, { occurredAt: '2026-08-02T23:00:00Z', redirect: 'walk', outcome: 'held' });
    logCraving(cabinet.db, { occurredAt: '2026-08-02T23:20:00Z', redirect: 'walk' });
    const [row] = redirectRanking(cabinet.db, 30, '2026-08-02');
    expect(row?.uses).toBe(2);
    expect(row?.success_rate).toBe(1); // 1 of 1 SCORED, not 1 of 2
  });
});

describe('e1Readout', () => {
  it('withholds a verdict until both arms have enough days', () => {
    food('2026-08-02', '2026-08-02T19:30:00Z', 300); // 3:30pm local — snack day
    const out = e1Readout(cabinet.db, 14, '2026-08-02');
    expect(out.snack_days.days).toBe(1);
    expect(out.verdict).toBeNull();
  });

  it('classifies a snack day by a 2:30-5:30pm local food entry', () => {
    food('2026-08-02', '2026-08-02T20:15:00Z', 200); // 4:15pm local
    food('2026-08-01', '2026-08-01T17:00:00Z', 600); // 1:00pm local — lunch only
    const out = e1Readout(cabinet.db, 14, '2026-08-02');
    expect(out.snack_days.days).toBe(1);
    expect(out.skip_days.days).toBe(1);
  });

  it('ignores days with no food logged at all rather than counting them as skips', () => {
    food('2026-08-02', '2026-08-02T20:15:00Z', 200);
    const out = e1Readout(cabinet.db, 14, '2026-08-02');
    expect(out.days_analyzed).toBe(1);
    expect(out.skip_days.days).toBe(0);
  });

  it('produces a directional verdict once both arms clear the minimum', () => {
    // Four snack days: afternoon protein, quiet evenings.
    for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']) {
      food(d, `${d}T20:00:00Z`, 200); // 4pm local
      food(d, `${d}T23:00:00Z`, 100); // 7pm local — before the late window
    }
    // Four skip days: no afternoon food, heavy late eating + cravings.
    // 9pm local is 01:00Z the FOLLOWING calendar day — the timestamp rolls
    // over but the local_day does not, which is the whole point of the split.
    for (const d of ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']) {
      const nextZ = new Date(new Date(`${d}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      food(d, `${d}T17:00:00Z`, 600); // 1pm local — lunch, no afternoon snack
      food(d, `${nextZ}T01:00:00Z`, 900); // 9pm local, filed to `d`
      logCraving(cabinet.db, { occurredAt: `${nextZ}T01:30:00Z`, outcome: 'ordered_out' });
    }

    const out = e1Readout(cabinet.db, 14, '2026-08-08');
    expect(out.snack_days.days).toBe(4);
    expect(out.skip_days.days).toBe(4);
    expect(out.skip_days.avg_late_kcal).toBe(900);
    expect(out.snack_days.avg_late_kcal).toBe(0);
    expect(out.skip_days.unplanned_rate).toBe(1);
    expect(out.verdict).toContain('fewer');
  });
});
