import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { listActivityPlan, seedTrainerAnchors } from '../src/domains/activity.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-trainer-anchors-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('seedTrainerAnchors', () => {
  it('seeds 8 anchors over 4 weeks from a known Monday, all strength/is_anchor/planned, on the correct Tue/Thu dates', () => {
    // 2026-07-13 is a Monday
    const result = seedTrainerAnchors(cabinet.db, { fromDay: '2026-07-13', weeks: 4 });

    expect(result.alreadyPresent).toHaveLength(0);
    expect(result.created).toEqual([
      '2026-07-14', '2026-07-16', // week 1: Tue, Thu
      '2026-07-21', '2026-07-23', // week 2
      '2026-07-28', '2026-07-30', // week 3
      '2026-08-04', '2026-08-06', // week 4
    ]);

    const entries = listActivityPlan(cabinet.db, { fromDay: '2026-07-13', toDay: '2026-08-10' });
    expect(entries).toHaveLength(8);
    for (const e of entries) {
      expect(e.kind).toBe('strength');
      expect(e.is_anchor).toBe(1);
      expect(e.status).toBe('planned');
      expect(e.title).toBe('Strength — trainer');
    }
  });

  it('is idempotent: calling twice does not duplicate — second call returns everything in alreadyPresent, zero created, row count unchanged', () => {
    const first = seedTrainerAnchors(cabinet.db, { fromDay: '2026-07-13', weeks: 4 });
    expect(first.created).toHaveLength(8);

    const second = seedTrainerAnchors(cabinet.db, { fromDay: '2026-07-13', weeks: 4 });
    expect(second.created).toHaveLength(0);
    expect(second.alreadyPresent).toEqual(first.created);

    const entries = listActivityPlan(cabinet.db, { fromDay: '2026-07-13', toDay: '2026-08-10' });
    expect(entries).toHaveLength(8); // not 16
  });

  it('a custom weekdays param seeds the right days (Mon/Wed/Fri instead of the Tue/Thu default)', () => {
    // 2026-07-13 is a Monday; 1 week window
    const result = seedTrainerAnchors(cabinet.db, { fromDay: '2026-07-13', weeks: 1, weekdays: [1, 3, 5] });

    expect(result.created).toEqual(['2026-07-13', '2026-07-15', '2026-07-17', '2026-07-20']);
    // day 7 (2026-07-20) is also a Monday and within the inclusive [fromDay, fromDay+7] range
  });

  it('correct America/New_York weekday mapping: a known Tuesday as fromDay with weeks=0 seeds exactly that date, not shifted a day by a naive UTC-midnight anchor', () => {
    // 2026-07-14 is a Tuesday. weeks=0 means the loop only considers fromDay itself.
    // A midnight-UTC (instead of noon-UTC) anchor would, once run through the
    // America/New_York-aware localDay() formatter, silently shift this back to
    // 2026-07-13 (a Monday) — which either fails the weekday check (weekdays
    // default to [2,4], Monday=1 is not in it, so nothing would be created) or,
    // if the shift happened only in formatting, would create the WRONG date.
    const result = seedTrainerAnchors(cabinet.db, { fromDay: '2026-07-14', weeks: 0 });
    expect(result.created).toEqual(['2026-07-14']);
    expect(result.alreadyPresent).toHaveLength(0);
  });
});
