import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { logWorkout } from '../src/domains/training.js';
import { listActivityPlan, planActivity, removeActivityEntry, updateActivityEntry } from '../src/domains/activity.js';

let dir: string;
let cabinet: CabinetDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-activityplan-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('activityplan', () => {
  it('plans a strength entry and a rest entry', () => {
    const strengthId = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'strength', title: 'Lower body — trainer', isAnchor: true });
    const restId = planActivity(cabinet.db, { localDay: '2026-07-15', kind: 'rest', notes: 'full rest day' });

    expect(strengthId).toBeGreaterThan(0);
    expect(restId).toBeGreaterThan(0);
    expect(strengthId).not.toBe(restId);

    const entries = listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-15' });
    expect(entries).toHaveLength(2);
    const strength = entries.find((e) => e.id === strengthId)!;
    expect(strength.kind).toBe('strength');
    expect(strength.title).toBe('Lower body — trainer');
    expect(strength.is_anchor).toBe(1);
    expect(strength.status).toBe('planned'); // default

    const rest = entries.find((e) => e.id === restId)!;
    expect(rest.kind).toBe('rest'); // a legitimate planned entry, not an absence
    expect(rest.notes).toBe('full rest day');
    expect(rest.is_anchor).toBe(0); // default
  });

  it('listActivityPlan filters to the inclusive date range and orders by day then kind (strength<cardio<mobility<sport<rest)', () => {
    planActivity(cabinet.db, { localDay: '2026-07-20', kind: 'rest' });
    planActivity(cabinet.db, { localDay: '2026-07-20', kind: 'strength', title: 'Upper body' });
    planActivity(cabinet.db, { localDay: '2026-07-20', kind: 'sport', title: 'Pickup basketball' });
    planActivity(cabinet.db, { localDay: '2026-07-20', kind: 'mobility', title: 'Yoga' });
    planActivity(cabinet.db, { localDay: '2026-07-20', kind: 'cardio', title: 'Easy run' });
    // outside the queried range on either side
    planActivity(cabinet.db, { localDay: '2026-07-19', kind: 'strength', title: 'out of range before' });
    planActivity(cabinet.db, { localDay: '2026-07-21', kind: 'strength', title: 'out of range after' });

    const entries = listActivityPlan(cabinet.db, { fromDay: '2026-07-20', toDay: '2026-07-20' });
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.kind)).toEqual(['strength', 'cardio', 'mobility', 'sport', 'rest']);
  });

  it('a planned entry marked done with a workout_id attached reflects in the read, joined against the workout name', () => {
    const entryId = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'strength', title: 'Lower body — trainer', isAnchor: true });
    const { id: workoutId } = logWorkout(cabinet.db, {
      name: 'Lower body — trainer', when: new Date('2026-07-14T17:00:00Z'),
      sets: [{ exercise: 'Back Squat', reps: 5, weight_lb: 185 }],
    });

    const { changes } = updateActivityEntry(cabinet.db, entryId, { status: 'done', workoutId });
    expect(changes).toBe(1);

    const [entry] = listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entry.status).toBe('done');
    expect(entry.workout_id).toBe(workoutId);
    expect(entry.workout_name).toBe('Lower body — trainer'); // joined from workout.name
  });

  it('updateActivityEntry patches title and status independently, leaving other fields untouched', () => {
    const id = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'cardio', title: 'Easy run', notes: '5k zone 2' });
    updateActivityEntry(cabinet.db, id, { status: 'skipped' });

    let [entry] = listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entry.status).toBe('skipped');
    expect(entry.title).toBe('Easy run'); // untouched
    expect(entry.notes).toBe('5k zone 2'); // untouched

    updateActivityEntry(cabinet.db, id, { title: 'Easy run (rescheduled)' });
    [entry] = listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entry.title).toBe('Easy run (rescheduled)');
    expect(entry.status).toBe('skipped'); // untouched by the title-only patch
  });

  it('removeActivityEntry deletes the row outright', () => {
    const id = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'mobility', title: 'Yoga' });
    expect(listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' })).toHaveLength(1);

    const { deleted } = removeActivityEntry(cabinet.db, id);
    expect(deleted).toBe(true);
    expect(listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' })).toHaveLength(0);

    expect(removeActivityEntry(cabinet.db, id).deleted).toBe(false); // already gone
  });

  it('is_anchor round-trips true and false correctly', () => {
    const anchorId = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'strength', isAnchor: true });
    const nonAnchorId = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'cardio', isAnchor: false });
    const defaultId = planActivity(cabinet.db, { localDay: '2026-07-14', kind: 'mobility' }); // isAnchor omitted

    const entries = listActivityPlan(cabinet.db, { fromDay: '2026-07-14', toDay: '2026-07-14' });
    expect(entries.find((e) => e.id === anchorId)!.is_anchor).toBe(1);
    expect(entries.find((e) => e.id === nonAnchorId)!.is_anchor).toBe(0);
    expect(entries.find((e) => e.id === defaultId)!.is_anchor).toBe(0);
  });
});
