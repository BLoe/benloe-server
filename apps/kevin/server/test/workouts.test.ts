import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import workouts from '../src/domains/workouts.js';
import { e1rm, guessMeta, nameKey, setsSummary } from '../src/domains/_workouts/lib.js';
import type { Kevin } from '../src/kevin.js';
import { localDay } from '../src/time.js';
import { call, makeKevin, ok, view } from './helpers.js';

// "Now" is Wednesday 2026-11-11, noon Eastern. That week: Mon 9, Tue 10,
// Wed 11, Thu 12, Fri 13, Sat 14, Sun 15. The week before starts Mon 2.
const TODAY = '2026-11-11';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T17:00:00Z'));
});
afterEach(() => void vi.useRealTimers());

const PLAN = {
  name: '4-day',
  goal: 'Bench 225',
  start_date: '2026-10-26',
  days: [
    { weekday: 'mon', name: 'Push', exercises: [
      { exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185, rest_seconds: 180 },
      { exercise: 'Overhead Press', sets: 3, reps: '8-12', weight_lbs: 95 },
      { exercise: 'Dips', sets: 3, reps: 10 },
      { exercise: 'Tricep Pushdown', sets: 2, reps: '12-15' },
    ] },
    { weekday: 'wed', name: 'Pull', exercises: [
      { exercise: 'Barbell Row', sets: 3, reps: 8, weight_lbs: 135 },
      { exercise: 'Pull-ups', sets: 3, reps: '6-10' },
    ] },
    { weekday: 'fri', name: 'Legs', exercises: [
      { exercise: 'Squat', sets: 3, reps: 5, weight_lbs: 225 },
      { exercise: 'Leg Press', sets: 3, reps: '10-12', weight_lbs: 300 },
    ] },
    { weekday: 'sat', name: 'Run', exercises: [{ exercise: 'Run', distance_miles: 2 }] },
  ],
};

async function withPlan(): Promise<Kevin> {
  const kevin = await makeKevin([workouts]);
  await ok(kevin, 'workout_plan_save', PLAN);
  return kevin;
}
const rows = async (kevin: Kevin, sql: string) => (await ok<{ rows: any[] }>(kevin, 'query', { sql })).rows;

describe('workouts: pure helpers', () => {
  it('normalises exercise names', () => {
    expect(nameKey('Bench Press')).toBe('bench press');
    expect(nameKey('  bench   PRESS ')).toBe('bench press');
    expect(nameKey('Pull-Ups')).toBe('pull up');
    expect(nameKey('Squats')).toBe('squat');
    expect(nameKey('Leg Press')).toBe('leg press');
    expect(nameKey('Abs')).toBe('abs');
  });
  it('guesses category and muscle group for a new exercise', () => {
    expect(guessMeta('squat')).toEqual({ category: 'strength', muscle_group: 'legs' });
    expect(guessMeta('hanging leg raise')).toEqual({ category: 'strength', muscle_group: 'core' });
    expect(guessMeta('leg curl')).toEqual({ category: 'strength', muscle_group: 'legs' });
    expect(guessMeta('barbell row')).toEqual({ category: 'strength', muscle_group: 'back' });
    expect(guessMeta('lateral raise').muscle_group).toBe('shoulders');
    expect(guessMeta('run').category).toBe('cardio');
    expect(guessMeta('kickball game').category).toBe('sport');
    expect(guessMeta('farmer walk')).toEqual({ category: null, muscle_group: null });
  });
  it('computes Epley e1RM', () => {
    expect(e1rm(185, 5)).toBe(215.8); // 185 * (1 + 5/30) = 215.83
    expect(e1rm(225, 5)).toBe(262.5);
    expect(e1rm(190, 4)).toBe(215.3);
    expect(e1rm(300, 1)).toBe(300); // a single is its own max
    expect(e1rm(null, 10)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
  });
  it('summarises sets for a phone-width line', () => {
    const s = (reps: number | null, weight_lbs: number | null, extra = {}) => ({ reps, weight_lbs, duration_seconds: null, distance_miles: null, is_warmup: 0, ...extra });
    expect(setsSummary([s(5, 185), s(5, 185), s(5, 185)])).toBe('3x5 @ 185 lb');
    expect(setsSummary([s(5, 225), s(5, 225), s(4, 225)])).toBe('5/5/4 @ 225 lb');
    expect(setsSummary([s(5, 135, { is_warmup: 1 }), s(5, 185), s(3, 195)])).toBe('5 @ 185 lb, 3 @ 195 lb');
    expect(setsSummary([s(12, null), s(10, null)])).toBe('12/10');
    expect(setsSummary([s(null, null, { distance_miles: 2, duration_seconds: 1050 })])).toBe('2 mi in 17:30');
  });
});

describe('workouts: plans', () => {
  it('saves a whole plan in one call and makes it active', async () => {
    const kevin = await makeKevin([workouts]);
    const r = await ok(kevin, 'workout_plan_save', PLAN);
    expect(r.replaced_active_plan).toBeNull();
    expect(r.plan).toMatchObject({ name: '4-day', goal: 'Bench 225', is_active: true, active_from: '2026-10-26', active_until: null, archived: false });
    expect(r.plan.days.map((d: any) => [d.weekday_key, d.weekday, d.weekday_name, d.name, d.exercises.length])).toEqual([
      ['mon', 1, 'Monday', 'Push', 4], ['wed', 3, 'Wednesday', 'Pull', 2], ['fri', 5, 'Friday', 'Legs', 2], ['sat', 6, 'Saturday', 'Run', 1],
    ]);
    const push = r.plan.days[0].exercises;
    expect(push[0]).toMatchObject({ position: 1, exercise: 'Bench Press', category: 'strength', muscle_group: 'chest', target_sets: 3, target_reps_min: 5, target_reps_max: 5, target_weight_lbs: 185, rest_seconds: 180, target: '3x5 @ 185 lb' });
    expect(push[1]).toMatchObject({ exercise: 'Overhead Press', muscle_group: 'shoulders', target_reps_min: 8, target_reps_max: 12, target: '3x8-12 @ 95 lb' });
    expect(push[2].target).toBe('3x10');
    expect(r.plan.days[3].exercises[0]).toMatchObject({ exercise: 'Run', category: 'cardio', target_distance_miles: 2, target: '2 mi' });

    const v = await view(kevin, 'workouts/plan');
    expect(v.plan).toEqual(r.plan);
    expect(v.plans).toEqual([expect.objectContaining({ id: r.plan.id, name: '4-day', is_active: true, archived: false, day_count: 4 })]);
    const ex = await view(kevin, 'workouts/exercises');
    expect(ex.exercises.map((e: any) => e.name).sort()).toEqual(['Barbell Row', 'Bench Press', 'Dips', 'Leg Press', 'Overhead Press', 'Pull-ups', 'Run', 'Squat', 'Tricep Pushdown']);
    expect(ex.exercises.find((e: any) => e.name === 'Squat')).toMatchObject({ category: 'strength', muscle_group: 'legs', session_count: 0, last_date: null, aliases: [] });
  });

  it('replaces the structure wholesale on update, keeping the rows of days that stay', async () => {
    const kevin = await withPlan();
    const before = (await view(kevin, 'workouts/plan')).plan;
    const r = await ok(kevin, 'workout_plan_save', {
      plan_id: before.id, name: '3-day', days: [
        { weekday: 'mon', name: 'Upper', exercises: [{ exercise: 'bench press', sets: 4, reps: '6-8' }] },
        { weekday: 'thu', name: 'Lower', exercises: [{ exercise: 'Squats', sets: 3, reps: 5 }, { exercise: 'Romanian Deadlift', sets: 3, reps: 8, muscle_group: 'legs' }] },
      ],
    });
    expect(r.plan).toMatchObject({ id: before.id, name: '3-day', goal: 'Bench 225', is_active: true });
    expect(r.plan.days.map((d: any) => [d.weekday_key, d.name, d.exercises.map((x: any) => x.exercise)])).toEqual([
      ['mon', 'Upper', ['Bench Press']], ['thu', 'Lower', ['Squat', 'Romanian Deadlift']],
    ]);
    expect(r.plan.days[0].id).toBe(before.days[0].id);
    expect(r.plan.days[0].exercises[0]).toMatchObject({ target_sets: 4, target_reps_min: 6, target_reps_max: 8, target_weight_lbs: null, rest_seconds: null });
    // "bench press" and "Squats" resolved to the existing exercises: one new row only.
    expect(await rows(kevin, 'SELECT COUNT(*) AS n FROM workouts_exercises')).toEqual([{ n: 10 }]);
    expect(await rows(kevin, 'SELECT COUNT(*) AS n FROM workouts_plan_exercises')).toEqual([{ n: 3 }]);
  });

  it('keeps one active plan: a new plan deactivates the old, a draft does not', async () => {
    const kevin = await withPlan();
    const draft = await ok(kevin, 'workout_plan_save', { name: 'Draft', activate: false, days: [{ weekday: 'tue', name: 'Yoga', exercises: [{ exercise: 'Yoga', duration_seconds: 1800 }] }] });
    expect(draft.plan.is_active).toBe(false);
    expect((await view(kevin, 'workouts/plan')).plan.name).toBe('4-day');
    expect(draft.plan.days[0].exercises[0]).toMatchObject({ category: 'mobility', target: '30:00' });

    const next = await ok(kevin, 'workout_plan_save', { name: 'Winter', days: [{ weekday: 'tue', name: 'Full body', exercises: [] }] });
    expect(next.replaced_active_plan).toBe('4-day');
    const v = await view(kevin, 'workouts/plan');
    expect(v.plan.name).toBe('Winter');
    expect(v.plans.map((p: any) => [p.name, p.is_active])).toEqual([['Winter', true], ['Draft', false], ['4-day', false]]);
    expect(await rows(kevin, 'SELECT name, active_from, active_until FROM workouts_plans WHERE is_active = 0 AND active_from IS NOT NULL')).toEqual([
      { name: '4-day', active_from: '2026-10-26', active_until: TODAY },
    ]);
    // The old plan still governs the dates it was active on.
    expect((await view(kevin, 'workouts/today', { date: '2026-11-09' })).plan_day.name).toBe('Push');
    expect((await view(kevin, 'workouts/today', { date: '2026-11-17' })).plan_day.name).toBe('Full body');

    // Activate, archive and delete through workout_edit.
    const back = await ok(kevin, 'workout_edit', { plan: { plan_id: v.plans[2].id, action: 'activate' } });
    expect(back.done[0]).toMatch(/"4-day" is now the active plan \(was "Winter"\)/);
    await ok(kevin, 'workout_edit', { plan: { plan_id: draft.plan.id, action: 'archive' } });
    expect((await view(kevin, 'workouts/plan')).plans.map((p: any) => p.name)).toEqual(['4-day', 'Winter']);
    expect((await view(kevin, 'workouts/plan', { include_archived: '1' })).plans).toHaveLength(3);
    const declined = await call(kevin, 'workout_edit', { plan: { plan_id: next.plan.id, action: 'delete' } }, { confirm: false });
    expect(declined).toMatchObject({ ok: false, text: expect.stringMatching(/Ben declined/) });
    await ok(kevin, 'workout_edit', { plan: { plan_id: next.plan.id, action: 'delete' } });
    expect((await view(kevin, 'workouts/plan', { id: String(next.plan.id) })).plan).toBeNull();
  });

  it('rejects bad plans with a message the model can act on', async () => {
    const kevin = await makeKevin([workouts]);
    const dup = await call(kevin, 'workout_plan_save', { name: 'x', days: [{ weekday: 'mon', name: 'A' }, { weekday: 'mon', name: 'B' }] });
    expect(dup.text).toMatch(/Two days are on mon/);
    expect((await call(kevin, 'workout_plan_save', { name: 'x', days: [] })).ok).toBe(false);
    expect((await call(kevin, 'workout_plan_save', { name: 'x', days: [{ weekday: 'funday', name: 'A' }] })).text).toMatch(/days\.0\.weekday/);
    expect((await call(kevin, 'workout_plan_save', { name: 'x', days: [{ weekday: 'mon', name: 'A', exercises: [{ exercise: 'Curl', reps: '12-8' }] }] })).text).toMatch(/runs backwards/);
    expect((await call(kevin, 'workout_plan_save', { plan_id: 99, name: 'x', days: [{ weekday: 'mon', name: 'A' }] })).text).toMatch(/No plan with id 99/);
    expect((await call(kevin, 'workout_plan_save', { name: 'x', start_date: '2026-02-30', days: [{ weekday: 'mon', name: 'A' }] })).text).toMatch(/start_date/);
    expect(await rows(kevin, 'SELECT COUNT(*) AS n FROM workouts_plans')).toEqual([{ n: 0 }]);
  });
});

describe('workouts: today', () => {
  it('shows the plan day with targets on a training day', async () => {
    const kevin = await withPlan();
    expect(localDay()).toBe(TODAY);
    const t = await view(kevin, 'workouts/today');
    expect(t).toMatchObject({ date: TODAY, weekday_name: 'Wednesday', status: 'planned', plan: { name: '4-day' }, session: null, other_sessions: [], next: { date: '2026-11-13', weekday_name: 'Friday', name: 'Legs' } });
    expect(t.plan_day).toMatchObject({ name: 'Pull', weekday: 3, moved_from_date: null, exercises: ['Barbell Row', 'Pull-ups'] });
    expect(t.exercises).toHaveLength(2);
    expect(t.exercises[0]).toMatchObject({
      exercise: 'Barbell Row', muscle_group: 'back', logged_sets: [], previous: null, done: false,
      planned: { target_sets: 3, target_reps_min: 8, target_weight_lbs: 135, target: '3x8 @ 135 lb' },
      suggestion: { action: 'start', weight_lbs: 135, text: 'Start at 135 lb' },
    });
    expect(t.exercises[1].suggestion).toEqual({ action: 'start', weight_lbs: null, text: 'First time: pick a starting point' });
    expect(t.workouts).toEqual([expect.objectContaining({ title: 'Pull', status: 'planned', expected: true, session_ids: [] })]);
  });

  it('is empty on a rest day and points at the next workout', async () => {
    const kevin = await withPlan();
    const t = await view(kevin, 'workouts/today', { date: '2026-11-10' });
    expect(t).toMatchObject({ date: '2026-11-10', weekday_name: 'Tuesday', status: 'rest', plan_day: null, session: null, exercises: [], workouts: [], next: { date: TODAY, name: 'Pull' } });
    expect(await view(kevin, 'workouts/home', { date: '2026-11-10' })).toEqual({ cards: [] });
  });

  it('has nothing before any plan exists, and rejects a malformed date', async () => {
    const kevin = await makeKevin([workouts]);
    expect(await view(kevin, 'workouts/today')).toMatchObject({ status: 'rest', plan: null, plan_day: null, next: null });
    expect((await view(kevin, 'workouts/plan'))).toEqual({ plan: null, plans: [] });
    expect(await view(kevin, 'workouts/home')).toEqual({ cards: [] });
    await expect(view(kevin, 'workouts/today', { date: 'tomorrow' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('workouts: logging', () => {
  it('logs a whole reported workout in one call: compact, per-set and cardio entries', async () => {
    const kevin = await withPlan();
    await ok(kevin, 'workout_edit', { exercise: { exercise: 'Bench Press', add_aliases: ['bench'] } });
    // "log today: bench 3x5 at 185, squat 5/5/4 at 225, then a 2 mile run in 17:30"
    const r = await ok(kevin, 'workout_log', {
      status: 'completed',
      plan_day: 'none',
      exercises: [
        { exercise: 'bench', sets: 3, reps: 5, weight_lbs: 185 },
        { exercise: 'squat', reps: [5, 5, 4], weight_lbs: 225 },
        { exercise: 'run', distance_miles: 2, duration_seconds: 1050 },
      ],
    });
    expect(r.session).toMatchObject({ date: TODAY, weekday_name: 'Wednesday', title: 'Bench Press, Squat +1', status: 'completed', plan_day_id: null, set_count: 7, volume_lbs: 185 * 15 + 225 * 14 });
    expect(r.session.completed_at).toBeTruthy();
    expect(r.session.exercises.map((e: any) => [e.exercise, e.set_count, e.summary])).toEqual([
      ['Bench Press', 3, '3x5 @ 185 lb'], ['Squat', 3, '5/5/4 @ 225 lb'], ['Run', 1, '2 mi in 17:30'],
    ]);
    expect(r.session.exercises[0].sets.map((s: any) => [s.set_number, s.reps, s.weight_lbs, s.e1rm_lbs, s.is_warmup])).toEqual([[1, 5, 185, 215.8, false], [2, 5, 185, 215.8, false], [3, 5, 185, 215.8, false]]);
    expect(r.session.exercises[1].sets.map((s: any) => [s.set_number, s.reps, s.e1rm_lbs])).toEqual([[1, 5, 262.5], [2, 5, 262.5], [3, 4, 255]]);
    expect(r.session.exercises[2].sets[0]).toMatchObject({ reps: null, weight_lbs: null, distance_miles: 2, duration_seconds: 1050, e1rm_lbs: null });
    expect(r.new_prs).toEqual([]); // first time is not a record over anything

    // The page reads the same session by id and from history.
    expect((await view(kevin, 'workouts/session', { id: String(r.session.id) })).session).toEqual(r.session);
    const hist = await view(kevin, 'workouts/sessions');
    expect(hist).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(hist.sessions[0]).toMatchObject({ id: r.session.id, set_count: 7 });
    expect(hist.sessions[0].exercises[0]).toEqual({ exercise_id: expect.any(Number), exercise: 'Bench Press', category: 'strength', muscle_group: 'chest', set_count: 3, summary: '3x5 @ 185 lb' });
    // It was outside the plan, so Pull is still to do today.
    expect((await view(kevin, 'workouts/today')).status).toBe('planned');
  });

  it('builds a session set by set from the page, then finishes it', async () => {
    const kevin = await withPlan();
    const a = await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Barbell Row', reps: 8, weight_lbs: 135 }] });
    expect(a.session).toMatchObject({ date: TODAY, status: 'in_progress', title: 'Pull', plan_day_name: 'Pull', set_count: 1, completed_at: null });
    expect(a.session.started_at).toBeTruthy();
    const b = await ok(kevin, 'workout_log', { exercises: [{ exercise: 'barbell rows', reps: 8, weight_lbs: 135, rpe: 8 }, { exercise: 'Pull-ups', reps: 9, warmup: true }] });
    expect(b.session.id).toBe(a.session.id);
    expect(b.session.exercises[0].sets.map((s: any) => [s.set_number, s.rpe])).toEqual([[1, null], [2, 8]]);

    let t = await view(kevin, 'workouts/today');
    expect(t.status).toBe('in_progress');
    expect(t.session.id).toBe(a.session.id);
    expect(t.exercises.map((e: any) => [e.exercise, e.logged_sets.length, e.done])).toEqual([['Barbell Row', 2, false], ['Pull-ups', 1, false]]);
    expect(await view(kevin, 'workouts/home')).toEqual({ cards: [{ title: 'Workout in progress', lines: ['Pull · 3 sets logged', 'Next: Barbell Row 3x8 @ 135 lb'], link: '/workouts' }] });

    vi.setSystemTime(new Date('2026-11-11T17:47:00Z'));
    const c = await ok(kevin, 'workout_log', { status: 'completed', perceived_effort: 7, notes: 'Grip gave out' });
    expect(c.session).toMatchObject({ id: a.session.id, status: 'completed', duration_minutes: 47, perceived_effort: 7, notes: 'Grip gave out', set_count: 3 });
    t = await view(kevin, 'workouts/today');
    expect(t).toMatchObject({ status: 'completed', session: { id: a.session.id } });
    expect(await view(kevin, 'workouts/home')).toEqual({ cards: [{ title: 'Workout done', lines: ['Pull · 3 sets · 47 min', 'Barbell Row 2x8 @ 135 lb', 'Pull-ups 9 reps'], link: '/workouts' }] });

    // More sets after finishing: the tool asks which session rather than guessing.
    const more = await call(kevin, 'workout_log', { exercises: [{ exercise: 'Curl', reps: 12, weight_lbs: 30 }] });
    expect(more.ok).toBe(false);
    expect(more.text).toContain(`session_id: ${a.session.id}`);
    expect(more.text).toContain('new_session: true');
    const added = await ok(kevin, 'workout_log', { session_id: a.session.id, exercises: [{ exercise: 'Curl', sets: 2, reps: 12, weight_lbs: 30 }] });
    expect(added.session).toMatchObject({ status: 'completed', set_count: 5, duration_minutes: 47 });
    const second = await ok(kevin, 'workout_log', { new_session: true, title: 'Kickball game', plan_day: 'none', status: 'completed', exercises: [{ exercise: 'Kickball', duration_seconds: 3600 }] });
    expect(second.session).toMatchObject({ title: 'Kickball game', plan_day_id: null });
    expect(second.session.exercises[0]).toMatchObject({ exercise: 'Kickball', category: 'sport' });
    t = await view(kevin, 'workouts/today');
    expect(t.session.id).toBe(a.session.id);
    expect(t.other_sessions.map((s: any) => s.title)).toEqual(['Kickball game']);
    expect(t.workouts.map((w: any) => [w.title, w.status, w.expected])).toEqual([['Pull', 'completed', true], ['Kickball game', 'completed', false]]);
  });

  it('starts an empty session, replaces sets, and reopens', async () => {
    const kevin = await withPlan();
    const s = await ok(kevin, 'workout_log', { status: 'in_progress' });
    expect(s.session).toMatchObject({ status: 'in_progress', title: 'Pull', set_count: 0 });
    await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Barbell Row', sets: 3, reps: 8, weight_lbs: 135 }] });
    const re = await ok(kevin, 'workout_log', { replace_sets: true, status: 'completed', exercises: [{ exercise: 'Barbell Row', reps: [8, 7], weight_lbs: 140 }] });
    expect(re.session).toMatchObject({ id: s.session.id, status: 'completed', set_count: 2 });
    expect(re.session.exercises[0].summary).toBe('8/7 @ 140 lb');
    const reopened = await ok(kevin, 'workout_log', { session_id: s.session.id, status: 'in_progress' });
    expect(reopened.session).toMatchObject({ status: 'in_progress', completed_at: null });
  });

  it('defaults a past date to completed and links it to that date\'s plan day', async () => {
    const kevin = await withPlan();
    const r = await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }], duration_minutes: 50 });
    expect(r.session).toMatchObject({ date: '2026-11-09', status: 'completed', title: 'Push', plan_day_name: 'Push', duration_minutes: 50, moved_from_date: null });
  });

  it('skips a planned day, and un-skips it when sets arrive after all', async () => {
    const kevin = await withPlan();
    const s = await ok(kevin, 'workout_log', { status: 'skipped', notes: 'Sore shoulder' });
    expect(s.session).toMatchObject({ status: 'skipped', title: 'Pull', plan_day_name: 'Pull', set_count: 0 });
    expect(await view(kevin, 'workouts/today')).toMatchObject({ status: 'skipped', session: { id: s.session.id } });
    expect(await view(kevin, 'workouts/home')).toEqual({ cards: [] });
    expect((await view(kevin, 'workouts/sessions', { status: 'skipped' })).total).toBe(1);
    const r = await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Pull-ups', reps: 8 }] });
    expect(r.session).toMatchObject({ id: s.session.id, status: 'in_progress', set_count: 1 });
    expect((await call(kevin, 'workout_log', { date: '2026-11-10', status: 'skipped' })).text).toMatch(/Nothing is planned on 2026-11-10/);
    expect((await call(kevin, 'workout_log', { status: 'skipped' })).text).toMatch(/has 1 sets logged, so it cannot become skipped/);
  });

  it('rejects input it cannot record, saying why', async () => {
    const kevin = await withPlan();
    const t = async (input: unknown) => (await call(kevin, 'workout_log', input)).text;
    expect(await t({})).toMatch(/Nothing to record/);
    expect(await t({ exercises: [{ exercise: 'Bench Press', weight_lbs: 185 }] })).toMatch(/needs reps, duration_seconds or distance_miles/);
    expect(await t({ exercises: [{ exercise: 'Bench Press', sets: 2, reps: [5, 5, 5] }] })).toMatch(/sets is 2 but reps lists 3/);
    expect(await t({ date: '11/11/2026', exercises: [{ exercise: 'Run', distance_miles: 1 }] })).toMatch(/date: .*YYYY-MM-DD/);
    expect(await t({ date: '2026-11-20', exercises: [{ exercise: 'Run', distance_miles: 1 }] })).toMatch(/in the future \(today is 2026-11-11\)/);
    expect(await t({ status: 'planned', exercises: [{ exercise: 'Run', distance_miles: 1 }] })).toMatch(/planned session holds no sets/);
    expect(await t({ date: '2026-11-12', status: 'planned' })).toMatch(/Say what to plan/);
    expect(await t({ plan_day: 'Arms', exercises: [{ exercise: 'Curl', reps: 10 }] })).toMatch(/"Arms" is not a day of the plan "4-day". Its days: Push \(Monday\), Pull \(Wednesday\), Legs \(Friday\), Run \(Saturday\)/);
    expect(await t({ session_id: 404, status: 'completed' })).toMatch(/No session with id 404/);
    expect(await t({ exercises: [{ exercise: 'Bench Press', reps: 5, weight_lbs: -5 }] })).toMatch(/weight_lbs/);
    expect(await t({ exercises: [{ exercise: 'Bench Press', reps: 5, rpe: 11 }] })).toMatch(/rpe/);
    expect(await rows(kevin, 'SELECT COUNT(*) AS n FROM workouts_sessions')).toEqual([{ n: 0 }]);
  });
});

describe('workouts: exercise names and aliases', () => {
  it('resolves case, plurals and aliases to one exercise; merges duplicates', async () => {
    const kevin = await withPlan();
    await ok(kevin, 'workout_log', { date: '2026-11-02', exercises: [{ exercise: 'bench press', reps: 5, weight_lbs: 185 }, { exercise: 'BENCH  PRESS', reps: 5, weight_lbs: 185 }] });
    // "bench" is not yet an alias, so it lands as its own exercise...
    const stray = await ok(kevin, 'workout_log', { date: '2026-11-03', plan_day: 'none', exercises: [{ exercise: 'bench', reps: 3, weight_lbs: 195 }] });
    expect(stray.session.exercises[0].exercise).toBe('Bench');
    const clash = await call(kevin, 'workout_edit', { exercise: { exercise: 'Bench Press', add_aliases: ['bench'] } });
    expect(clash.text).toMatch(/"bench" already means "Bench". .*merge_into: "Bench"/);
    // ...until it is merged, which moves its history and leaves the name behind as an alias.
    const merged = await ok(kevin, 'workout_edit', { exercise: { exercise: 'bench', merge_into: 'Bench Press' } });
    expect(merged.done).toEqual(['merged "Bench" into "Bench Press"']);
    expect(merged.exercise).toMatchObject({ name: 'Bench Press', aliases: ['bench'] });
    expect(merged.sessions[0].exercises[0]).toMatchObject({ exercise: 'Bench Press', summary: '3 @ 195 lb' });
    const again = await ok(kevin, 'workout_log', { date: '2026-11-04', plan_day: 'none', exercises: [{ exercise: 'Bench', reps: 5, weight_lbs: 185 }] });
    expect(again.session.exercises[0].exercise).toBe('Bench Press');
    expect(await rows(kevin, "SELECT COUNT(DISTINCT exercise_id) AS n, COUNT(*) AS sets FROM workouts_set_log WHERE exercise LIKE 'Bench%'")).toEqual([{ n: 1, sets: 4 }]);

    // Rename keeps the old name working; metadata edits; alias removal.
    const renamed = await ok(kevin, 'workout_edit', { exercise: { exercise: 'bench', rename: 'Barbell Bench Press', notes: 'Pause on the chest', add_aliases: ['Flat Bench'], muscle_group: 'chest' } });
    expect(renamed.exercise).toEqual({ id: expect.any(Number), name: 'Barbell Bench Press', category: 'strength', muscle_group: 'chest', notes: 'Pause on the chest', aliases: ['bench', 'bench press', 'flat bench'] });
    const p = await view(kevin, 'workouts/progression', { exercise: 'Bench Press' });
    expect(p.exercise.name).toBe('Barbell Bench Press');
    expect(p.series).toHaveLength(3);
    const less = await ok(kevin, 'workout_edit', { exercise: { exercise: 'flat bench', remove_aliases: ['bench'] } });
    expect(less.exercise.aliases).toEqual(['bench press', 'flat bench']);
    expect((await view(kevin, 'workouts/exercises', { q: 'flat' })).exercises.map((e: any) => e.name)).toEqual(['Barbell Bench Press']);
    expect((await view(kevin, 'workouts/exercises', { category: 'cardio' })).exercises.map((e: any) => e.name)).toEqual(['Run']);
    expect((await call(kevin, 'workout_edit', { exercise: { exercise: 'Zercher Squat', notes: 'x' } })).text).toMatch(/No exercise called "Zercher Squat". Names in use: Barbell Bench Press, /);
    expect((await call(kevin, 'workout_edit', { exercise: { exercise: 'Squat', rename: 'Run' } })).text).toMatch(/already means "Run"/);
  });
});

describe('workouts: editing and deleting', () => {
  it('corrects sets, deletes sets with renumbering, and deletes a session after confirmation', async () => {
    const kevin = await withPlan();
    const r = await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }, { exercise: 'Dips', reps: [12, 10] }] });
    const [b1, b2, b3] = r.session.exercises[0].sets.map((s: any) => s.id);
    const [d1] = r.session.exercises[1].sets.map((s: any) => s.id);

    const e = await ok(kevin, 'workout_edit', { update_sets: [{ set_id: b3, reps: 4, rpe: 9.5, notes: 'Grinder' }, { set_id: b1, warmup: true, weight_lbs: 135 }], delete_set_ids: [b2] });
    expect(e.done).toEqual(['updated 2 sets', 'deleted 1 set']);
    expect(e.sessions).toHaveLength(1);
    expect(e.sessions[0].exercises[0].sets.map((s: any) => [s.id, s.set_number, s.reps, s.weight_lbs, s.is_warmup, s.rpe, s.notes])).toEqual([
      [b1, 1, 5, 135, true, null, null], [b3, 2, 4, 185, false, 9.5, 'Grinder'],
    ]);
    expect(e.sessions[0].exercises[0].summary).toBe('4 @ 185 lb');

    // Move a set to another exercise; clear a field with null.
    const m = await ok(kevin, 'workout_edit', { update_sets: [{ set_id: d1, exercise: 'Bench Press', weight_lbs: 185, rpe: null }] });
    expect(m.sessions[0].exercises.map((x: any) => [x.exercise, x.sets.map((s: any) => s.set_number)])).toEqual([['Bench Press', [1, 2, 3]], ['Dips', [1]]]);

    expect((await call(kevin, 'workout_edit', {})).text).toMatch(/Nothing to change/);
    expect((await call(kevin, 'workout_edit', { delete_set_ids: [9999] })).text).toMatch(/No set with id 9999/);
    expect((await call(kevin, 'workout_edit', { update_sets: [{ set_id: b3, reps: null }] })).text).toMatch(/would be left with no reps/);
    // A failed call changes nothing, even when an earlier part of it was valid.
    expect((await call(kevin, 'workout_edit', { update_sets: [{ set_id: b3, reps: 1 }], delete_set_ids: [9999] })).ok).toBe(false);
    expect(await rows(kevin, `SELECT reps FROM workouts_sets WHERE id = ${b3}`)).toEqual([{ reps: 4 }]);

    const no = await call(kevin, 'workout_edit', { delete_session_id: r.session.id }, { confirm: false });
    expect(no).toMatchObject({ ok: false, text: 'Ben declined deleting the session. Nothing was changed.' });
    expect((await view(kevin, 'workouts/sessions')).total).toBe(1);
    const yes = await ok(kevin, 'workout_edit', { delete_session_id: r.session.id });
    expect(yes.done).toEqual([`deleted session ${r.session.id}`]);
    expect((await view(kevin, 'workouts/sessions')).total).toBe(0);
    expect(await rows(kevin, 'SELECT COUNT(*) AS n FROM workouts_sets')).toEqual([{ n: 0 }]);
    expect((await view(kevin, 'workouts/session', { id: String(r.session.id) })).session).toBeNull();
    expect((await call(kevin, 'workout_edit', { delete_session_id: r.session.id })).text).toMatch(/No session with id/);
  });
});

describe('workouts: progression', () => {
  async function benchHistory(): Promise<Kevin> {
    const kevin = await withPlan();
    await ok(kevin, 'workout_log', { date: '2026-10-26', exercises: [{ exercise: 'Bench Press', reps: 5, weight_lbs: 135, warmup: true }, { exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 180 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-02', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }] });
    return kevin;
  }

  it('reports the series, records and the records a new session breaks', async () => {
    const kevin = await benchHistory();
    const r = await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', reps: [5, 5, 4], weight_lbs: 190 }, { exercise: 'Bench Press', reps: 12, weight_lbs: 155 }] });
    expect(r.new_prs).toEqual(['Bench Press: weight PR, 190 lb x 5 (was 185 lb)', 'Bench Press: estimated 1RM PR, 221.7 lb (was 215.8 lb)']);

    const p = await view(kevin, 'workouts/progression', { exercise: 'bench press' });
    expect(p.exercise).toMatchObject({ name: 'Bench Press', category: 'strength', muscle_group: 'chest' });
    expect(p.series).toEqual([
      { session_id: expect.any(Number), date: '2026-10-26', sets: 3, top_weight_lbs: 180, top_weight_reps: 5, e1rm_lbs: 210, best_set: { weight_lbs: 180, reps: 5 }, volume_lbs: 2700, total_reps: 15, duration_seconds: null, distance_miles: null, pace_seconds_per_mile: null, summary: '3x5 @ 180 lb' },
      { session_id: expect.any(Number), date: '2026-11-02', sets: 3, top_weight_lbs: 185, top_weight_reps: 5, e1rm_lbs: 215.8, best_set: { weight_lbs: 185, reps: 5 }, volume_lbs: 2775, total_reps: 15, duration_seconds: null, distance_miles: null, pace_seconds_per_mile: null, summary: '3x5 @ 185 lb' },
      // 190 x 5 -> 221.7; 155 x 12 -> 217.0. Volume 190*14 + 155*12 = 4520.
      { session_id: r.session.id, date: '2026-11-09', sets: 4, top_weight_lbs: 190, top_weight_reps: 5, e1rm_lbs: 221.7, best_set: { weight_lbs: 190, reps: 5 }, volume_lbs: 4520, total_reps: 26, duration_seconds: null, distance_miles: null, pace_seconds_per_mile: null, summary: '5/5/4 @ 190 lb, 12 @ 155 lb' },
    ]);
    expect(p.prs).toEqual({
      weight: { weight_lbs: 190, reps: 5, date: '2026-11-09', session_id: r.session.id },
      e1rm: { e1rm_lbs: 221.7, weight_lbs: 190, reps: 5, date: '2026-11-09', session_id: r.session.id },
      reps: { reps: 12, weight_lbs: 155, date: '2026-11-09', session_id: r.session.id },
      volume: { volume_lbs: 4520, date: '2026-11-09', session_id: r.session.id },
      distance: null, pace: null,
    });
    expect(p.last_session).toMatchObject({ date: '2026-11-09', summary: '5/5/4 @ 190 lb, 12 @ 155 lb' });
    expect((await view(kevin, 'workouts/progression', { exercise: 'bench press', limit: '1' })).series).toHaveLength(1);
    expect((await view(kevin, 'workouts/progression', { exercise_id: String(p.exercise.id) })).series).toHaveLength(3);
    expect(await view(kevin, 'workouts/progression', { exercise: 'unicycle' })).toEqual({ exercise: null, series: [], prs: null, last_session: null });

    // A record keeps the day it was first set; warmups never count.
    await ok(kevin, 'workout_log', { date: '2026-11-10', plan_day: 'none', exercises: [{ exercise: 'Bench Press', reps: 5, weight_lbs: 190 }, { exercise: 'Bench Press', reps: 1, weight_lbs: 300, warmup: true }] });
    expect((await view(kevin, 'workouts/progression', { exercise: 'bench press' })).prs.weight).toMatchObject({ weight_lbs: 190, date: '2026-11-09' });

    const ex = (await view(kevin, 'workouts/exercises')).exercises;
    expect(ex[0]).toMatchObject({ name: 'Bench Press', session_count: 4, last_date: '2026-11-10', best_weight_lbs: 190, best_e1rm_lbs: 221.7 });
  });

  it('tracks cardio by distance and pace, and lists all records', async () => {
    const kevin = await benchHistory();
    await ok(kevin, 'workout_log', { date: '2026-10-31', exercises: [{ exercise: 'Run', distance_miles: 2, duration_seconds: 1080 }] });
    const r = await ok(kevin, 'workout_log', { date: '2026-11-07', exercises: [{ exercise: 'Run', distance_miles: 3, duration_seconds: 1530 }] });
    expect(r.new_prs).toEqual(['Run: longest distance, 3 mi (was 2 mi)', 'Run: fastest pace, 8:30/mi (was 9:00/mi)']);
    const p = await view(kevin, 'workouts/progression', { exercise: 'run' });
    expect(p.series.map((x: any) => [x.date, x.distance_miles, x.duration_seconds, x.pace_seconds_per_mile, x.e1rm_lbs, x.summary])).toEqual([
      ['2026-10-31', 2, 1080, 540, null, '2 mi in 18:00'], ['2026-11-07', 3, 1530, 510, null, '3 mi in 25:30'],
    ]);
    expect(p.prs).toMatchObject({ weight: null, e1rm: null, distance: { distance_miles: 3, date: '2026-11-07' }, pace: { pace_seconds_per_mile: 510, date: '2026-11-07' } });
    const all = await view(kevin, 'workouts/prs');
    expect(all.prs.map((x: any) => [x.exercise, x.category, x.weight?.weight_lbs ?? null, x.e1rm?.e1rm_lbs ?? null, x.distance?.distance_miles ?? null])).toEqual([
      ['Bench Press', 'strength', 185, 215.8, null], ['Run', 'cardio', null, null, 3],
    ]);
  });

  it('suggests +5 upper / +10 lower when every set hit the top of the range, else a repeat', async () => {
    const kevin = await withPlan();
    // Monday Push the week before: bench hit 3x5; OHP short on the last set; dips are bodyweight.
    await ok(kevin, 'workout_log', { date: '2026-11-02', exercises: [
      { exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 },
      { exercise: 'Overhead Press', reps: [12, 12, 10], weight_lbs: 95 },
      { exercise: 'Dips', reps: [10, 10, 10] },
    ] });
    // Friday Legs: squat hit 3x5 at 225; leg press hit the top of 10-12 but only two of three sets.
    await ok(kevin, 'workout_log', { date: '2026-11-06', exercises: [
      { exercise: 'Squat', reps: 5, weight_lbs: 135, warmup: true },
      { exercise: 'Squat', sets: 3, reps: 5, weight_lbs: 225 },
      { exercise: 'Leg Press', sets: 2, reps: 12, weight_lbs: 300 },
    ] });
    await ok(kevin, 'workout_log', { date: '2026-11-07', exercises: [{ exercise: 'Run', distance_miles: 2, duration_seconds: 1050 }] });

    const push = await view(kevin, 'workouts/suggestions', { date: '2026-11-09' });
    expect(push.plan_day).toMatchObject({ name: 'Push', weekday: 1 });
    expect(push.exercises.map((e: any) => [e.exercise, e.previous?.summary ?? null, e.suggestion])).toEqual([
      ['Bench Press', '3x5 @ 185 lb', { action: 'increase', weight_lbs: 190, text: 'Go to 190 lb (+5): hit 3x5 @ 185 lb' }],
      ['Overhead Press', '12/12/10 @ 95 lb', { action: 'repeat', weight_lbs: 95, text: 'Repeat 95 lb: last was 12/12/10 @ 95 lb' }],
      ['Dips', '3x10', { action: 'repeat', weight_lbs: null, text: 'Match or beat 3x10' }],
      ['Tricep Pushdown', null, { action: 'start', weight_lbs: null, text: 'First time: pick a starting point' }],
    ]);
    expect(push.exercises[0].previous).toMatchObject({ date: '2026-11-02', sets: [{ reps: 5, weight_lbs: 185, duration_seconds: null, distance_miles: null, rpe: null }, expect.anything(), expect.anything()] });
    expect(push.exercises[0]).not.toHaveProperty('logged_sets');

    const legsDay = (await view(kevin, 'workouts/plan')).plan.days[2];
    const legs = await view(kevin, 'workouts/suggestions', { plan_day_id: String(legsDay.id) });
    expect(legs.exercises.map((e: any) => [e.exercise, e.suggestion.action, e.suggestion.weight_lbs])).toEqual([
      ['Squat', 'increase', 235], ['Leg Press', 'repeat', 300],
    ]);
    expect((await view(kevin, 'workouts/suggestions', { date: '2026-11-14' })).exercises[0].suggestion).toEqual({ action: 'repeat', weight_lbs: null, text: 'Match or beat 2 mi in 17:30' });

    // The same numbers ride along in `today` and on the Home card.
    const t = await view(kevin, 'workouts/today', { date: '2026-11-09' });
    expect(t.exercises[0]).toMatchObject({ exercise: 'Bench Press', previous: { summary: '3x5 @ 185 lb' }, suggestion: { weight_lbs: 190 } });
    expect(await view(kevin, 'workouts/home', { date: '2026-11-09' })).toEqual({
      cards: [{ title: "Today's workout", lines: ['Push · 4 exercises', 'Bench Press 3x5 @ 190 lb', 'Overhead Press 3x8-12 @ 95 lb', 'Dips 3x10', '+1 more'], link: '/workouts' }],
    });
    // "Previous" means before the day being viewed.
    expect((await view(kevin, 'workouts/today', { date: '2026-11-02' })).exercises[0].previous).toBeNull();
  });
});

describe('workouts: the week and adherence', () => {
  it('lays out the week from the plan and what was logged', async () => {
    const kevin = await withPlan();
    await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-10', title: 'Kickball game', exercises: [{ exercise: 'Kickball', duration_seconds: 3600 }] });
    const w = await view(kevin, 'workouts/week');
    expect(w).toMatchObject({ week_start: '2026-11-09', week_end: '2026-11-15', prev_week_start: '2026-11-02', next_week_start: '2026-11-16', today: TODAY });
    expect(w.days.map((d: any) => [d.date, d.weekday_name, d.status, d.plan_day?.name ?? null, d.sessions.length, d.is_today])).toEqual([
      ['2026-11-09', 'Monday', 'completed', 'Push', 1, false],
      ['2026-11-10', 'Tuesday', 'completed', null, 1, false],
      ['2026-11-11', 'Wednesday', 'planned', 'Pull', 0, true],
      ['2026-11-12', 'Thursday', 'rest', null, 0, false],
      ['2026-11-13', 'Friday', 'planned', 'Legs', 0, false],
      ['2026-11-14', 'Saturday', 'planned', 'Run', 0, false],
      ['2026-11-15', 'Sunday', 'rest', null, 0, false],
    ]);
    expect(w.days[0].plan_day.exercises).toEqual(['Bench Press', 'Overhead Press', 'Dips', 'Tricep Pushdown']);
    expect(w.days[0].sessions[0]).toMatchObject({ title: 'Push', status: 'completed', set_count: 3 });
    expect(w.adherence).toEqual({ week_start: '2026-11-09', week_end: '2026-11-15', is_current: true, planned: 4, completed: 1, skipped: 0, missed: 0, remaining: 3, extra: 1, pct: 25 });
    // Any date inside a week selects that week; unlogged days in the past are missed.
    const last = await view(kevin, 'workouts/week', { start: '2026-11-05' });
    expect(last.week_start).toBe('2026-11-02');
    expect(last.days.map((d: any) => d.status)).toEqual(['missed', 'rest', 'missed', 'rest', 'missed', 'missed', 'rest']);
    // Before the plan took effect there is nothing to miss.
    expect((await view(kevin, 'workouts/week', { start: '2026-10-19' })).days.every((d: any) => d.status === 'rest')).toBe(true);
  });

  it('moves a plan day for one week without touching the plan', async () => {
    const kevin = await withPlan();
    // "move legs to Sunday this week"
    const m = await ok(kevin, 'workout_log', { date: '2026-11-15', plan_day: 'Legs', status: 'planned', moved_from: '2026-11-13' });
    expect(m.session).toMatchObject({ date: '2026-11-15', status: 'planned', title: 'Legs', plan_day_name: 'Legs', moved_from_date: '2026-11-13', set_count: 0, started_at: null });
    let w = await view(kevin, 'workouts/week');
    expect(w.days.slice(4).map((d: any) => [d.weekday_name, d.status, d.plan_day?.name ?? null, d.plan_day?.moved_from_date ?? null])).toEqual([
      ['Friday', 'rest', null, null], ['Saturday', 'planned', 'Run', null], ['Sunday', 'planned', 'Legs', '2026-11-13'],
    ]);
    expect(w.adherence).toMatchObject({ planned: 4, remaining: 3, missed: 1 });
    // The plan and next week are untouched.
    expect((await view(kevin, 'workouts/plan')).plan.days.map((d: any) => d.weekday_key)).toEqual(['mon', 'wed', 'fri', 'sat']);
    expect((await view(kevin, 'workouts/week', { start: '2026-11-16' })).days[4]).toMatchObject({ status: 'planned', plan_day: { name: 'Legs', moved_from_date: null } });
    expect((await view(kevin, 'workouts/today', { date: '2026-11-13' })).next).toEqual({ date: '2026-11-14', weekday_name: 'Saturday', name: 'Run' });
    // Planned sessions stay out of history until they happen.
    expect((await view(kevin, 'workouts/sessions')).total).toBe(0);
    expect((await view(kevin, 'workouts/sessions', { status: 'all' })).total).toBe(1);

    // Changing his mind: the planned session moves to Saturday, alongside the run.
    const again = await ok(kevin, 'workout_log', { session_id: m.session.id, date: '2026-11-14' });
    expect(again.session).toMatchObject({ date: '2026-11-14', moved_from_date: '2026-11-13', status: 'planned' });
    w = await view(kevin, 'workouts/week');
    expect(w.days[5].workouts.map((x: any) => [x.title, x.status, x.plan_day.moved_from_date])).toEqual([['Run', 'planned', null], ['Legs', 'planned', '2026-11-13']]);
    expect(w.days[6].status).toBe('rest');

    // On the day, sets go to the workout whose plan lists the exercise.
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
    const squat = await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Squat', sets: 3, reps: 5, weight_lbs: 225 }], status: 'completed' });
    expect(squat.session).toMatchObject({ id: m.session.id, status: 'completed', title: 'Legs' });
    const t = await view(kevin, 'workouts/today');
    expect(t).toMatchObject({ status: 'planned', plan_day: { name: 'Run' }, session: null });
    expect(t.other_sessions.map((s: any) => s.title)).toEqual(['Legs']);
    const run = await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Run', distance_miles: 2, duration_seconds: 1050 }], status: 'completed' });
    expect(run.session).toMatchObject({ title: 'Run', plan_day_name: 'Run' });
    expect(run.session.id).not.toBe(m.session.id);
    expect((await view(kevin, 'workouts/today')).status).toBe('completed');
    // And putting it back on Friday clears the move.
    const back = await ok(kevin, 'workout_log', { session_id: m.session.id, date: '2026-11-13' });
    expect(back.session).toMatchObject({ date: '2026-11-13', moved_from_date: null });
  });

  it('treats a plan day done on another day of its week as moved, not missed plus extra', async () => {
    const kevin = await withPlan();
    // Monday's Push done on Tuesday.
    const r = await ok(kevin, 'workout_log', { date: '2026-11-10', plan_day: 'Push', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }] });
    expect(r.session).toMatchObject({ plan_day_name: 'Push', moved_from_date: '2026-11-09', status: 'completed' });
    const w = await view(kevin, 'workouts/week');
    expect(w.days.slice(0, 2).map((d: any) => [d.status, d.plan_day?.name ?? null])).toEqual([['rest', null], ['completed', 'Push']]);
    expect(w.adherence).toMatchObject({ planned: 4, completed: 1, missed: 0, extra: 0, remaining: 3 });
  });

  it('counts planned against completed across weeks', async () => {
    const kevin = await withPlan();
    // Week of Oct 26: all four done. Week of Nov 2: Push done, Pull skipped, Legs missed, Run done, plus a game.
    for (const [d, ex] of [['2026-10-26', 'Bench Press'], ['2026-10-28', 'Barbell Row'], ['2026-10-30', 'Squat'], ['2026-11-02', 'Bench Press']] as const) {
      await ok(kevin, 'workout_log', { date: d, exercises: [{ exercise: ex, sets: 3, reps: 5, weight_lbs: 135 }] });
    }
    await ok(kevin, 'workout_log', { date: '2026-10-31', exercises: [{ exercise: 'Run', distance_miles: 2 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-04', status: 'skipped' });
    await ok(kevin, 'workout_log', { date: '2026-11-07', exercises: [{ exercise: 'Run', distance_miles: 2 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-08', title: 'Kickball game', exercises: [{ exercise: 'Kickball', duration_seconds: 3600 }] });
    // This week so far: Monday's Push done; today's Pull under way.
    await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 140 }] });
    await ok(kevin, 'workout_log', { exercises: [{ exercise: 'Barbell Row', reps: 8, weight_lbs: 135 }] });

    const a = await view(kevin, 'workouts/adherence', { weeks: '4' });
    expect(a.today).toBe(TODAY);
    expect(a.weeks).toEqual([
      { week_start: '2026-11-09', week_end: '2026-11-15', is_current: true, planned: 4, completed: 1, skipped: 0, missed: 0, remaining: 3, extra: 0, pct: 25 },
      { week_start: '2026-11-02', week_end: '2026-11-08', is_current: false, planned: 4, completed: 2, skipped: 1, missed: 1, remaining: 0, extra: 1, pct: 50 },
      { week_start: '2026-10-26', week_end: '2026-11-01', is_current: false, planned: 4, completed: 4, skipped: 0, missed: 0, remaining: 0, extra: 0, pct: 100 },
      { week_start: '2026-10-19', week_end: '2026-10-25', is_current: false, planned: 0, completed: 0, skipped: 0, missed: 0, remaining: 0, extra: 0, pct: null },
    ]);
    expect(a.totals).toEqual({ planned: 12, completed: 7, extra: 1, pct: 58 });
    expect((await view(kevin, 'workouts/adherence')).weeks).toHaveLength(6);
    expect((await view(kevin, 'workouts/today')).week).toEqual(a.weeks[0]);

    // History pages newest first and filters by exercise and date.
    const page = await view(kevin, 'workouts/sessions', { limit: '3', offset: '3' });
    expect(page).toMatchObject({ total: 10, limit: 3, offset: 3 });
    expect(page.sessions.map((s: any) => s.date)).toEqual(['2026-11-07', '2026-11-04', '2026-11-02']);
    expect((await view(kevin, 'workouts/sessions', { exercise: 'bench press' })).sessions.map((s: any) => s.date)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
    expect((await view(kevin, 'workouts/sessions', { from: '2026-11-01', to: '2026-11-08' })).total).toBe(4);
  });
});

describe('workouts: what Kevin sees', () => {
  it('puts the schema and working notes in the system prompt, and offers three tools', async () => {
    const kevin = await withPlan();
    for (const t of ['workouts_exercises', 'workouts_plans', 'workouts_plan_days', 'workouts_plan_exercises', 'workouts_sessions', 'workouts_sets']) {
      expect(kevin.stableSystem).toContain(`CREATE TABLE ${t}`);
    }
    expect(kevin.stableSystem).toContain("0=Sunday ... 6=Saturday, the same number as strftime('%w', date)");
    expect(kevin.stableSystem).toContain('workouts_set_log');
    const mine = kevin.tools.apiTools().filter((t) => t.name.startsWith('workout'));
    expect(mine.map((t) => t.name)).toEqual(['workout_edit', 'workout_log', 'workout_plan_save']);
    const log = mine[1]!.input_schema as any;
    expect(Object.keys(log.properties.exercises.items.properties)).toEqual(['exercise', 'sets', 'reps', 'weight_lbs', 'duration_seconds', 'distance_miles', 'rpe', 'warmup', 'notes']);
    expect(log.required ?? []).toEqual([]);
  });

  it('answers the questions he would write SQL for', async () => {
    const kevin = await withPlan();
    await ok(kevin, 'workout_log', { date: '2026-10-30', exercises: [{ exercise: 'Squat', sets: 3, reps: 5, weight_lbs: 215 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-06', exercises: [{ exercise: 'Squat', reps: 5, weight_lbs: 135, warmup: true }, { exercise: 'Squat', reps: [5, 5, 4], weight_lbs: 225 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-09', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185 }] });
    await ok(kevin, 'workout_log', { date: '2026-11-04', status: 'skipped' });

    // "What did I squat last week?"
    expect(await rows(kevin, `
      SELECT date, set_number, reps, weight_lbs, e1rm_lbs FROM workouts_set_log
      WHERE exercise LIKE '%squat%' AND is_warmup = 0 AND date BETWEEN '2026-11-02' AND '2026-11-08' ORDER BY date, set_number`)).toEqual([
      { date: '2026-11-06', set_number: 2, reps: 5, weight_lbs: 225, e1rm_lbs: 262.5 },
      { date: '2026-11-06', set_number: 3, reps: 5, weight_lbs: 225, e1rm_lbs: 262.5 },
      { date: '2026-11-06', set_number: 4, reps: 4, weight_lbs: 225, e1rm_lbs: 255 },
    ]);
    // "How many sessions this month?"
    expect(await rows(kevin, "SELECT COUNT(*) AS sessions FROM workouts_sessions WHERE status = 'completed' AND date >= '2026-11-01' AND date < '2026-12-01'")).toEqual([{ sessions: 2 }]);
    // "How's my squat progressing?" straight from the base tables.
    expect(await rows(kevin, `
      SELECT se.date, MAX(st.weight_lbs) AS top_weight, ROUND(MAX(st.weight_lbs * (1 + st.reps / 30.0)), 1) AS e1rm
      FROM workouts_sets st JOIN workouts_sessions se ON se.id = st.session_id JOIN workouts_exercises e ON e.id = st.exercise_id
      WHERE e.name_key = 'squat' AND st.is_warmup = 0 GROUP BY se.date ORDER BY se.date`)).toEqual([
      { date: '2026-10-30', top_weight: 215, e1rm: 250.8 }, { date: '2026-11-06', top_weight: 225, e1rm: 262.5 },
    ]);
    // "What's on the plan for Friday?"
    expect(await rows(kevin, `
      SELECT d.name AS day, e.name AS exercise, pe.target_sets, pe.target_reps_min, pe.target_reps_max, pe.target_weight_lbs
      FROM workouts_plans p JOIN workouts_plan_days d ON d.plan_id = p.id JOIN workouts_plan_exercises pe ON pe.plan_day_id = d.id
      JOIN workouts_exercises e ON e.id = pe.exercise_id
      WHERE p.is_active = 1 AND d.weekday = CAST(strftime('%w', '2026-11-13') AS INTEGER) ORDER BY pe.position`)).toEqual([
      { day: 'Legs', exercise: 'Squat', target_sets: 3, target_reps_min: 5, target_reps_max: 5, target_weight_lbs: 225 },
      { day: 'Legs', exercise: 'Leg Press', target_sets: 3, target_reps_min: 10, target_reps_max: 12, target_weight_lbs: 300 },
    ]);
    // Writes stay out of the query tool.
    expect((await call(kevin, 'query', { sql: 'DELETE FROM workouts_sets' })).ok).toBe(false);
  });

  it('marks its writes for the audit log and page refresh, and is callable from the UI', async () => {
    const kevin = await withPlan();
    const r = await call(kevin, 'workout_log', { exercises: [{ exercise: 'Pull-ups', reps: 8 }] }, { source: 'ui' });
    expect(r.ok).toBe(true);
    expect(kevin.db.prepare("SELECT COUNT(*) AS n FROM tool_audit WHERE tool LIKE 'workout%' AND ok = 1").get()).toEqual({ n: 2 });
    expect(workouts.tools!.every((t) => t.touches?.includes('workouts'))).toBe(true);
  });

  it('switching to another plan and back leaves earlier dates governed by the plan that was active then', async () => {
    const kevin = await makeKevin([workouts]);
    const day = (weekday: string, name: string) => ({ weekday, name, exercises: [{ exercise: 'Squat', sets: 3, reps: 5 }] });
    const a = (await ok(kevin, 'workout_plan_save', { name: 'A', start_date: '2026-10-05', days: [day('mon', 'A-Monday')] })).plan;
    const b = (await ok(kevin, 'workout_plan_save', { name: 'B', start_date: '2026-10-19', days: [day('mon', 'B-Monday')] })).plan;
    await ok(kevin, 'workout_edit', { plan: { plan_id: a.id, action: 'activate' } });
    const on = async (date: string) => (await view(kevin, 'workouts/today', { date })).plan?.name ?? null;
    expect(await on('2026-10-12')).toBe('A'); // the first A period, before B existed
    expect(await on('2026-10-26')).toBe('B'); // B's period
    const periods = kevin.db.prepare('SELECT plan_id, from_date, until_date FROM workouts_plan_periods ORDER BY id').all() as any[];
    expect(periods.length).toBe(3);
    expect(periods[0]).toMatchObject({ plan_id: a.id, from_date: '2026-10-05', until_date: '2026-10-19' });
    expect(periods[2]).toMatchObject({ plan_id: a.id, until_date: null });
  });
});
