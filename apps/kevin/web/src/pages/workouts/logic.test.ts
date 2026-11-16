import { describe, expect, it } from 'vitest';
import {
  adjustRest, draftTarget, emptyExercise, exerciseDraft, fmtDuration, logEntry, logTarget, mondayOf, moveDay, moveInput, moveItem, moveTargets, parseDuration, parseNum,
  parseReps, planDraft, planInput, prefill, restSeconds, restState, searchExercises, isKnownExercise, setKind, setPatch, setText, shownStatus, startRest, step, stepDuration, weekLabel,
  type DayDraft, type PlanDraft,
} from './logic';
import type { ExerciseCard, LoggedSet, Plan, PlannedExercise } from './types';

const planned = (over: Partial<PlannedExercise> = {}): PlannedExercise => ({
  id: 1, position: 1, exercise_id: 1, exercise: 'Bench Press', category: 'strength', muscle_group: 'chest', target_sets: 3, target_reps_min: 5, target_reps_max: 5,
  target_weight_lbs: 185, target_duration_seconds: null, target_distance_miles: null, target_rpe: null, rest_seconds: 180, notes: null, target: '3x5 @ 185 lb', ...over,
});
const logged = (over: Partial<LoggedSet> = {}): LoggedSet => ({ id: 1, set_number: 1, reps: 5, weight_lbs: 185, duration_seconds: null, distance_miles: null, rpe: null, is_warmup: false, notes: null, e1rm_lbs: null, ...over });
const card = (over: Partial<ExerciseCard> = {}): ExerciseCard => ({
  exercise_id: 1, exercise: 'Bench Press', category: 'strength', muscle_group: 'chest', planned: planned(), logged_sets: [], previous: null, suggestion: null, done: false, ...over,
});
const prev = (sets: [number | null, number][]) => ({ session_id: 9, date: '2026-11-07', summary: '', sets: sets.map(([weight_lbs, reps]) => ({ reps, weight_lbs, duration_seconds: null, distance_miles: null, rpe: null })) });

describe('durations and numbers', () => {
  it('formats and parses times', () => {
    expect(fmtDuration(1050)).toBe('17:30');
    expect(fmtDuration(3725)).toBe('1:02:05');
    expect(parseDuration('17:30')).toBe(1050);
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration('45')).toBe(2700);
    expect(parseDuration('7:75')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
  it('parses typed numbers', () => {
    expect(parseNum('187.5')).toBe(187.5);
    expect(parseNum('2,5')).toBe(2.5);
    expect(parseNum(' 5 ')).toBe(5);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('-5')).toBeNull();
  });
  it('steps without going below the floor', () => {
    expect(step('185', 5)).toBe('190');
    expect(step('2.5', -5)).toBe('0');
    expect(step('', 5)).toBe('5');
    expect(step('1', -0.25)).toBe('0.75');
    expect(stepDuration('17:30', 60)).toBe('18:30');
    expect(stepDuration('0:30', -60)).toBe('0:00');
    expect(stepDuration('', 60)).toBe('1:00');
  });
  it('labels weeks', () => {
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(weekLabel('2026-11-09', '2026-11-15')).toBe('This week');
    expect(weekLabel('2026-11-02', '2026-11-15')).toBe('Last week');
    expect(weekLabel('2026-10-19', '2026-11-15')).toBe('3 weeks ago');
    expect(weekLabel('2026-11-16', '2026-11-15')).toBe('Next week');
  });
});

describe('prefill', () => {
  it('starts from the plan when there is no history', () => {
    expect(prefill(card({ suggestion: { action: 'start', weight_lbs: 185, text: '' } }))).toMatchObject({ weight: '185', reps: '5' });
  });
  it('uses the suggested weight and the bottom of the range after an increase', () => {
    const c = card({ planned: planned({ target_reps_min: 8, target_reps_max: 12 }), previous: prev([[135, 12], [135, 12], [135, 12]]), suggestion: { action: 'increase', weight_lbs: 140, text: '' } });
    expect(prefill(c)).toMatchObject({ weight: '140', reps: '8' });
  });
  it('matches last time set by set when repeating, never below the range', () => {
    const c = card({ planned: planned({ target_reps_min: 8, target_reps_max: 12 }), previous: prev([[135, 11], [135, 9], [135, 7]]), suggestion: { action: 'repeat', weight_lbs: 135, text: '' } });
    expect(prefill(c)).toMatchObject({ weight: '135', reps: '11' });
    const third = { ...c, logged_sets: [logged({ id: 1, reps: null, is_warmup: true, duration_seconds: 60, weight_lbs: null })] };
    expect(prefill(third, 'reps').reps).toBe('11'); // a warmup does not advance the set index
    expect(prefill({ ...c, previous: prev([[135, 7]]) }).reps).toBe('8');
  });
  it('repeats the last set logged today', () => {
    const c = card({ logged_sets: [logged({ weight_lbs: 190, reps: 4 })], suggestion: { action: 'increase', weight_lbs: 190, text: '' } });
    expect(prefill(c)).toMatchObject({ weight: '190', reps: '4' });
  });
  it('leaves weight empty for bodyweight work', () => {
    const c = card({ planned: planned({ target_weight_lbs: null, target_reps_min: 10, target_reps_max: 10 }), previous: prev([[null, 12]]), suggestion: { action: 'repeat', weight_lbs: null, text: '' } });
    expect(prefill(c)).toMatchObject({ weight: '', reps: '12' });
  });
  it('falls back to last time for an off-plan exercise', () => {
    expect(prefill(card({ planned: null, previous: prev([[40, 10], [45, 8]]) }))).toMatchObject({ weight: '45', reps: '10' });
  });
  it('fills time and distance from the plan, then from last time', () => {
    const run = planned({ category: 'cardio', target_sets: null, target_reps_min: null, target_reps_max: null, target_weight_lbs: null, target_distance_miles: 3, rest_seconds: null });
    const last = { session_id: 1, date: '2026-11-08', summary: '', sets: [{ reps: null, weight_lbs: null, duration_seconds: 1620, distance_miles: 3, rpe: null }] };
    const c = card({ category: 'cardio', planned: run, previous: last });
    expect(setKind(c)).toBe('time');
    expect(prefill(c)).toMatchObject({ distance: '3', duration: '', weight: '', reps: '' });
    expect(prefill({ ...c, planned: null })).toMatchObject({ distance: '3', duration: '27:00' });
  });
});

describe('setKind', () => {
  it('reads the data before the category', () => {
    expect(setKind(card())).toBe('reps');
    expect(setKind(card({ category: 'strength', planned: planned({ target_reps_min: null, target_reps_max: null, target_duration_seconds: 60 }) }))).toBe('time'); // a plank
    expect(setKind(card({ category: 'sport', planned: null }))).toBe('time');
    expect(setKind(card({ category: 'cardio', planned: null, logged_sets: [logged()] }))).toBe('reps');
    expect(setKind(card({ category: 'strength', planned: null, previous: { session_id: 1, date: '', summary: '', sets: [{ reps: null, weight_lbs: null, duration_seconds: 600, distance_miles: null, rpe: null }] } }))).toBe('time');
  });
});

describe('logEntry and setPatch', () => {
  it('builds a lift entry, leaving weight out for bodyweight', () => {
    expect(logEntry('Bench Press', 'reps', { weight: '190', reps: '5', duration: '', distance: '' })).toEqual({ entry: { exercise: 'Bench Press', reps: 5, weight_lbs: 190 } });
    expect(logEntry('Pull-Up', 'reps', { weight: '', reps: '8', duration: '', distance: '' })).toEqual({ entry: { exercise: 'Pull-Up', reps: 8 } });
    expect(logEntry('Bench', 'reps', { weight: '190', reps: '', duration: '', distance: '' })).toHaveProperty('error');
    expect(logEntry('Bench', 'reps', { weight: 'x', reps: '5', duration: '', distance: '' })).toHaveProperty('error');
    expect(logEntry('Bench', 'reps', { weight: '190', reps: '5.5', duration: '', distance: '' })).toHaveProperty('error');
  });
  it('builds a cardio entry from either box', () => {
    expect(logEntry('Run', 'time', { weight: '', reps: '', duration: '17:30', distance: '2' })).toEqual({ entry: { exercise: 'Run', duration_seconds: 1050, distance_miles: 2 } });
    expect(logEntry('Run', 'time', { weight: '', reps: '', duration: '', distance: '3.1' })).toEqual({ entry: { exercise: 'Run', distance_miles: 3.1 } });
    expect(logEntry('Run', 'time', { weight: '', reps: '', duration: '', distance: '' })).toHaveProperty('error');
    expect(logEntry('Run', 'time', { weight: '', reps: '', duration: 'fast', distance: '2' })).toHaveProperty('error');
  });
  it('patches a set, clearing what was emptied', () => {
    expect(setPatch(7, 'reps', { weight: '', reps: '6', duration: '', distance: '' }, { rpe: '', warmup: false })).toEqual({ patch: { set_id: 7, reps: 6, weight_lbs: null, rpe: null, warmup: false } });
    expect(setPatch(7, 'time', { weight: '', reps: '', duration: '20:00', distance: '' }, { rpe: '8', warmup: true })).toEqual({ patch: { set_id: 7, duration_seconds: 1200, distance_miles: null, rpe: 8, warmup: true } });
    expect(setPatch(7, 'reps', { weight: '100', reps: '5', duration: '', distance: '' }, { rpe: '11', warmup: false })).toHaveProperty('error');
  });
  it('puts a set in words', () => {
    expect(setText({ reps: 5, weight_lbs: 185, duration_seconds: null, distance_miles: null })).toBe('185 lb × 5');
    expect(setText({ reps: 12, weight_lbs: null, duration_seconds: null, distance_miles: null })).toBe('12 reps');
    expect(setText({ reps: null, weight_lbs: null, duration_seconds: 1050, distance_miles: 2 })).toBe('2 mi in 17:30');
  });
});

describe('logTarget', () => {
  const day = { date: '2026-11-15', session: null, plan_day: { id: 4 } };
  it('names the plan day until a session exists, then the session', () => {
    expect(logTarget(day)).toEqual({ date: '2026-11-15', plan_day: 4 });
    expect(logTarget({ ...day, session: { id: 12 } })).toEqual({ session_id: 12 });
    expect(logTarget({ ...day, plan_day: null })).toEqual({ date: '2026-11-15' });
  });
  it('starts a separate session on request', () => {
    expect(logTarget({ ...day, session: { id: 12 } }, true)).toEqual({ date: '2026-11-15', new_session: true });
  });
  it('calls a past planned day missed', () => {
    expect(shownStatus('planned', '2026-11-12', '2026-11-15')).toBe('missed');
    expect(shownStatus('planned', '2026-11-15', '2026-11-15')).toBe('planned');
    expect(shownStatus('completed', '2026-11-12', '2026-11-15')).toBe('completed');
  });
});

describe('rest timer', () => {
  it('counts down and finishes', () => {
    const r = startRest(1_000_000, 90, 'Bench');
    expect(restState(r, 1_000_000)).toEqual({ remaining: 90, fraction: 0, done: false });
    expect(restState(r, 1_045_000)).toMatchObject({ remaining: 45, fraction: 0.5, done: false });
    expect(restState(r, 1_089_100)).toMatchObject({ remaining: 1, done: false });
    expect(restState(r, 1_090_000)).toMatchObject({ remaining: 0, fraction: 1, done: true });
    expect(restState(r, 1_200_000)).toMatchObject({ remaining: 0, fraction: 1, done: true });
  });
  it('adds and removes time', () => {
    const r = startRest(0, 90, 'Bench');
    const more = adjustRest(r, 30, 30_000);
    expect(restState(more, 30_000).remaining).toBe(90);
    expect(more.total).toBe(120);
    const less = adjustRest(r, -30, 80_000);
    expect(restState(less, 80_000)).toMatchObject({ remaining: 0, done: true });
    const again = adjustRest(r, 30, 200_000); // after it ended
    expect(restState(again, 200_000).remaining).toBe(30);
  });
  it('takes the plan’s rest, a default for lifts, none for cardio', () => {
    expect(restSeconds(planned({ rest_seconds: 180 }), 'reps')).toBe(180);
    expect(restSeconds(planned({ rest_seconds: null }), 'reps')).toBe(90);
    expect(restSeconds(planned({ rest_seconds: 0 }), 'reps')).toBeNull();
    expect(restSeconds(null, 'time')).toBeNull();
    expect(restSeconds(null, 'reps')).toBe(90);
  });
});

describe('moving a workout', () => {
  const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  it('offers the rest of the week from today', () => {
    expect(moveTargets(week, '2026-11-13', '2026-11-12')).toEqual(['2026-11-12', '2026-11-14', '2026-11-15']);
    expect(moveTargets(week, '2026-11-10', '2026-11-14')).toEqual(['2026-11-14', '2026-11-15']);
    expect(moveTargets(week, '2026-11-15', '2026-11-15')).toEqual([]);
  });
  it('plans a session on the new date carrying moved_from', () => {
    const pd = { id: 3, name: 'Legs', notes: null, weekday: 5, moved_from_date: null, exercises: [] };
    expect(moveInput({ plan_day: pd, session_ids: [] }, '2026-11-13', '2026-11-14')).toEqual({ date: '2026-11-14', plan_day: 3, status: 'planned', moved_from: '2026-11-13' });
  });
  it('re-dates a session that already exists', () => {
    const pd = { id: 3, name: 'Legs', notes: null, weekday: 5, moved_from_date: '2026-11-13', exercises: [] };
    expect(moveInput({ plan_day: pd, session_ids: [21] }, '2026-11-14', '2026-11-15')).toEqual({ session_id: 21, date: '2026-11-15' });
    expect(moveInput({ plan_day: null, session_ids: [] }, '2026-11-14', '2026-11-15')).toBeNull();
  });
});

describe('plan editor', () => {
  const day = (weekday: DayDraft['weekday'], name: string, exercises = [{ ...emptyExercise(), exercise: 'Squat', sets: '3', reps: '5', weight: '225', rest: '180' }]): DayDraft => ({ weekday, name, notes: '', exercises });
  const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({ plan_id: null, name: '4-day', goal: '', notes: '', activate: true, days: [day('mon', 'Legs')], ...over });

  it('parses reps as a count or a range', () => {
    expect(parseReps('5')).toBe(5);
    expect(parseReps('8-12')).toBe('8-12');
    expect(parseReps('8 - 12')).toBe('8-12');
    expect(parseReps('8-8')).toBe(8);
    expect(parseReps('12-8')).toBeNull();
    expect(parseReps('0')).toBeNull();
    expect(parseReps('many')).toBeNull();
  });
  it('reorders and moves days', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    const days = [day('mon', 'Legs'), day('wed', 'Push')];
    expect(moveDay(days, 'wed', 'tue').map((d) => `${d.weekday}:${d.name}`)).toEqual(['mon:Legs', 'tue:Push']);
    expect(moveDay(days, 'wed', 'mon').map((d) => `${d.weekday}:${d.name}`)).toEqual(['mon:Push', 'wed:Legs']);
  });
  it('builds workout_plan_save input for a new plan', () => {
    const d = draft({
      goal: ' Squat 315 ',
      days: [
        day('sat', 'Run', [{ ...emptyExercise('time'), exercise: 'Run', distance: '3', duration: '27:00' }]),
        day('mon', 'Legs', [
          { ...emptyExercise(), exercise: ' Squat ', sets: '3', reps: '5', weight: '225', rest: '180', notes: 'belt' },
          { ...emptyExercise(), exercise: 'Leg Curl', sets: '3', reps: '8-12', weight: '', rest: '' },
        ]),
      ],
    });
    expect(planInput(d)).toEqual({
      input: {
        activate: true, name: '4-day', goal: 'Squat 315', notes: '',
        days: [
          { weekday: 'mon', name: 'Legs', exercises: [{ exercise: 'Squat', sets: 3, reps: 5, weight_lbs: 225, rest_seconds: 180, notes: 'belt' }, { exercise: 'Leg Curl', sets: 3, reps: '8-12' }] },
          { weekday: 'sat', name: 'Run', exercises: [{ exercise: 'Run', distance_miles: 3, duration_seconds: 1620 }] },
        ],
      },
    });
  });
  it('sends plan_id and no activate for an existing plan', () => {
    const r = planInput(draft({ plan_id: 7 }));
    expect('input' in r && r.input).toMatchObject({ plan_id: 7, name: '4-day', goal: '' });
    expect('input' in r && 'activate' in r.input).toBe(false);
  });
  it('says what is wrong', () => {
    expect(planInput(draft({ name: ' ' }))).toEqual({ error: 'Give the plan a name.' });
    expect(planInput(draft({ days: [] }))).toEqual({ error: 'Add at least one training day.' });
    expect(planInput(draft({ days: [day('mon', '')] }))).toHaveProperty('error');
    expect(planInput(draft({ days: [day('mon', 'A'), day('mon', 'B')] }))).toEqual({ error: 'Two days are on Monday.' });
    const bad = planInput(draft({ days: [day('tue', 'Push', [{ ...emptyExercise(), exercise: 'Bench', reps: '12-8' }])] }));
    expect('error' in bad && bad.error).toContain('Tuesday, Bench');
  });
  it('round-trips a stored plan', () => {
    const plan: Plan = {
      id: 2, name: 'PPL', goal: null, notes: null, is_active: true, active_from: '2026-10-01', active_until: null, archived: false,
      days: [
        { id: 1, weekday: 1, weekday_key: 'mon', weekday_name: 'Monday', name: 'Push', notes: 'heavy', exercises: [planned(), planned({ id: 2, exercise: 'Incline Press', target_reps_min: 8, target_reps_max: 12, target_weight_lbs: null, rest_seconds: null })] },
        { id: 2, weekday: 6, weekday_key: 'sat', weekday_name: 'Saturday', name: 'Run', notes: null, exercises: [planned({ id: 3, exercise: 'Run', category: 'cardio', target_sets: null, target_reps_min: null, target_reps_max: null, target_weight_lbs: null, target_distance_miles: 2, target_duration_seconds: 1080, rest_seconds: null })] },
      ],
    };
    const d = planDraft(plan);
    expect(d.days[0]!.exercises.map((x) => x.reps)).toEqual(['5', '8-12']);
    expect(d.days[1]!.exercises[0]).toMatchObject({ kind: 'time', distance: '2', duration: '18:00' });
    expect(planInput(d)).toEqual({
      input: {
        plan_id: 2, name: 'PPL', goal: '', notes: '',
        days: [
          { weekday: 'mon', name: 'Push', notes: 'heavy', exercises: [{ exercise: 'Bench Press', sets: 3, reps: 5, weight_lbs: 185, rest_seconds: 180 }, { exercise: 'Incline Press', sets: 3, reps: '8-12' }] },
          { weekday: 'sat', name: 'Run', exercises: [{ exercise: 'Run', duration_seconds: 1080, distance_miles: 2 }] },
        ],
      },
    });
  });
  it('describes a draft exercise', () => {
    expect(draftTarget(exerciseDraft(planned()))).toBe('3x5 @ 185 lb');
    expect(draftTarget({ ...emptyExercise('time'), distance: '2', duration: '18:00' })).toBe('2 mi in 18:00');
    expect(draftTarget({ ...emptyExercise(), sets: '', reps: '8-12' })).toBe('8-12 reps');
  });
});

describe('exercise search', () => {
  const all = [{ name: 'Incline Bench Press', aliases: [] }, { name: 'Bench Press', aliases: ['flat bench'] }, { name: 'Squat', aliases: [] }];
  it('matches names and aliases, prefix first', () => {
    expect(searchExercises(all, 'bench').map((e) => e.name)).toEqual(['Bench Press', 'Incline Bench Press']);
    expect(searchExercises(all, 'flat').map((e) => e.name)).toEqual(['Bench Press']);
    expect(searchExercises(all, '').length).toBe(3);
  });
  it('knows an existing name', () => {
    expect(isKnownExercise(all, 'bench press')).toBe(true);
    expect(isKnownExercise(all, 'Flat Bench')).toBe(true);
    expect(isKnownExercise(all, 'bench')).toBe(false);
  });
});

describe('IRON PR matching', async () => {
  const { liftKey, matchLift, recordLine, sameLift, shortDay, trainerLine } = await import('./logic');
  it('sets aside case, plural and a leading equipment word', () => {
    expect(liftKey('Barbell Squats')).toEqual({ equipment: 'barbell', base: 'squat' });
    expect(sameLift('Bench Press', 'Barbell Bench Press')).toBe(true);
    expect(sameLift('Squat', 'Barbell Squat')).toBe(true);
    expect(sameLift('squats', 'BARBELL SQUAT')).toBe(true);
    expect(sameLift('Dumbbell Curl', 'dumbbell curls')).toBe(true);
    expect(sameLift('Pull-Up', 'Pull Ups')).toBe(true);
    expect(sameLift('Overhead Press', 'Overhead Press')).toBe(true);
  });
  it('does not match different lifts', () => {
    expect(sameLift('Barbell Row', 'Cable Row')).toBe(false);
    expect(sameLift('Barbell bench - close grip', 'Bench Press')).toBe(false);
    expect(sameLift('Bench Press', 'Incline Bench Press')).toBe(false);
    expect(sameLift('Deadlift', 'Hex Bar Deadlift')).toBe(false);
    expect(sameLift('Barbell', 'Cable')).toBe(false);
    expect(sameLift('', '')).toBe(false);
  });
  it('picks the matching equipment when several fit', () => {
    const list = [{ name: 'Cable Row' }, { name: 'Barbell Row' }, { name: 'Barbell Squat' }];
    expect(matchLift('Barbell Row', list)?.name).toBe('Barbell Row');
    expect(matchLift('Row', list)?.name).toBe('Cable Row'); // no equipment said: the list's first (most recent)
    expect(matchLift('Squat', list)?.name).toBe('Barbell Squat');
    expect(matchLift('Lunge', list)).toBeUndefined();
  });
  it('writes the trainer and record lines', () => {
    const x = { entries: 4, best_weight_lbs: 215, best_reps: 1, best_date: '2026-11-03', last_weight_lbs: 215, last_reps: 1, last_date: '2026-11-03' };
    expect(trainerLine(x, '2026-11-14')).toBe('With trainer: 215 lb × 1 on Nov 3 (IRON PR)');
    expect(trainerLine({ ...x, last_weight_lbs: 205, last_reps: 3, last_date: '2026-11-10' }, '2026-11-14')).toBe('With trainer: 205 lb × 3 on Nov 10, best 215 lb (IRON PR)');
    expect(trainerLine({ ...x, last_weight_lbs: null, last_date: null }, '2026-11-14')).toBeNull();
    expect(shortDay('2025-09-03', '2026-11-14')).toBe('Sep 3, 2025');
    expect(recordLine({ exercise: 'Barbell Squat', date: '2026-11-03', weight_lbs: 215, previous_weight_lbs: 205 }, '2026-11-14')).toBe('Barbell Squat 215 lb, up from 205, Nov 3');
    expect(recordLine({ exercise: 'Hex Bar Deadlift', date: '2026-11-03', weight_lbs: 300, previous_weight_lbs: null }, '2026-11-14')).toBe('Hex Bar Deadlift 300 lb, first record, Nov 3');
  });
});
