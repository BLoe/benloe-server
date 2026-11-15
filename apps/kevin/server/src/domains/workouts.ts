// Workouts: a plan (the weekly schedule), sessions with their sets, and the
// progression read off them. Three write tools; Kevin reads with SQL, the page
// reads through the views at the bottom. Shared logic is in _workouts/lib.ts.
import { z } from 'zod';
import { type DB, nowIso } from '../db.js';
import { defineDomain } from '../domains.js';
import { localDay } from '../time.js';
import { defineTool, ToolError } from '../tools.js';
import {
  type DayItem, type ExerciseRow, type PlanDayRow, type PlanRow, type Prs, type SessionRow, type SessionStatus, type SetRow,
  WEEKDAY_KEYS, WEEKDAY_NAMES, activePlan, addDays, aliasesOf, dayInfo, ensureExercise, exerciseCards, exerciseOut, findExercise, fmtDuration, fmtNum,
  getExercise, getPlan, getPlanDay, getSession, governingPlan, isDate, isPending, mondayOf, nameKey, planExercises, planOut, previousPerformance, prs, renumber,
  series, sessionOut, suggest, targetText, weekAdherence, weekdayName, weekdayOf, workingSets,
} from './_workouts/lib.js';
import { migrations } from './_workouts/schema.js';

// ---- input pieces ----------------------------------------------------------------

const date = () => z.string().refine(isDate, 'must be a real date written YYYY-MM-DD');
const CATEGORY = z.enum(['strength', 'cardio', 'mobility', 'sport']);
const MUSCLE = z.enum(['chest', 'back', 'shoulders', 'arms', 'core', 'legs', 'glutes', 'full_body']);
const rpe = () => z.number().min(1).max(10);

const planExerciseInput = z.object({
  exercise: z.string().min(1).max(80).describe('Exercise name or alias, e.g. "Bench Press". A new name is added to the catalogue.'),
  sets: z.number().int().min(1).max(20).optional(),
  reps: z.union([z.number().int().min(1).max(500), z.string().regex(/^\d{1,3}(\s*-\s*\d{1,3})?$/)]).optional().describe('A fixed count (5) or a range ("8-12"). The top of the range is what earns a weight increase.'),
  weight_lbs: z.number().min(0).max(2000).optional().describe('Starting weight. Once the exercise has history, the last session sets the target.'),
  duration_seconds: z.number().int().min(1).max(86_400).optional().describe('Cardio and holds: target time.'),
  distance_miles: z.number().min(0).max(500).optional().describe('Cardio: target distance.'),
  rpe: rpe().optional().describe('Intended effort, 1-10.'),
  rest_seconds: z.number().int().min(0).max(3600).optional(),
  notes: z.string().max(500).optional(),
  category: CATEGORY.optional().describe('Used when the exercise is new to the catalogue.'),
  muscle_group: MUSCLE.optional().describe('Used when the exercise is new. legs and glutes progress in 10 lb steps, the rest in 5.'),
});

const logEntryInput = z.object({
  exercise: z.string().min(1).max(80).describe('Exercise name or alias as Ben said it: "bench", "Squat", "Run", "Kickball game".'),
  sets: z.number().int().min(1).max(30).optional().describe('How many identical sets this entry stands for (3 for "3x5"). Default 1.'),
  reps: z.union([z.number().int().min(0).max(1000), z.array(z.number().int().min(0).max(1000)).min(1).max(30)]).optional().describe('Reps per set: 5, or one number per set when they differ: [5, 5, 4].'),
  weight_lbs: z.number().min(0).max(2000).optional().describe('Weight on the bar or in hand, lbs. Leave out for bodyweight.'),
  duration_seconds: z.number().int().min(1).max(86_400).optional().describe('17:30 is 1050.'),
  distance_miles: z.number().min(0).max(500).optional(),
  rpe: rpe().optional().describe('Effort of the set, 1-10.'),
  warmup: z.boolean().optional().describe('true for warmup sets; they stay out of progression and records.'),
  notes: z.string().max(500).optional(),
});

const setPatchInput = z.object({
  set_id: z.number().int(),
  exercise: z.string().min(1).max(80).optional().describe('Move the set to another exercise.'),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  weight_lbs: z.number().min(0).max(2000).nullable().optional(),
  duration_seconds: z.number().int().min(1).max(86_400).nullable().optional(),
  distance_miles: z.number().min(0).max(500).nullable().optional(),
  rpe: rpe().nullable().optional(),
  warmup: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

// ---- plan helpers ------------------------------------------------------------------

function setActive(db: DB, planId: number, from: string): string | null {
  const prev = activePlan(db);
  const now = nowIso();
  if (prev?.id === planId) return null;
  if (prev) {
    db.prepare('UPDATE workouts_plans SET is_active = 0, active_until = ?, updated_at = ? WHERE id = ?').run(from, now, prev.id);
    db.prepare('UPDATE workouts_plan_periods SET until_date = ? WHERE plan_id = ? AND until_date IS NULL').run(from, prev.id);
  }
  // A new period each time: which plan governed an earlier date is history and must not move.
  db.prepare('INSERT INTO workouts_plan_periods (plan_id, from_date) VALUES (?, ?)').run(planId, from);
  db.prepare(
    `UPDATE workouts_plans SET active_from = CASE WHEN is_active = 1 THEN active_from ELSE ? END,
       is_active = 1, active_until = NULL, archived_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(from, now, planId);
  return prev ? prev.name : null;
}

function deactivate(db: DB, planId: number, on: string): void {
  db.prepare('UPDATE workouts_plans SET is_active = 0, active_until = ?, updated_at = ? WHERE id = ? AND is_active = 1').run(on, nowIso(), planId);
  db.prepare('UPDATE workouts_plan_periods SET until_date = ? WHERE plan_id = ? AND until_date IS NULL').run(on, planId);
}

function parseReps(reps: number | string | undefined): { min: number | null; max: number | null } {
  if (reps == null) return { min: null, max: null };
  if (typeof reps === 'number') return { min: reps, max: reps };
  const [a, b] = reps.split('-').map((x) => Number(x.trim()));
  const lo = a!;
  const hi = b ?? lo;
  if (hi < lo) throw new ToolError(`Rep range "${reps}" runs backwards; write it low-high, e.g. "8-12".`);
  return { min: lo, max: hi };
}

/** undefined: the caller did not say. null: explicitly unplanned. */
function resolvePlanDay(db: DB, ref: number | string | undefined, onDate: string): PlanDayRow | null | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === 'string' && /^(none|null|unplanned)$/i.test(ref.trim())) return null;
  if (typeof ref === 'number' || /^\d+$/.test(ref.trim())) {
    const d = getPlanDay(db, Number(ref));
    if (!d) throw new ToolError(`No plan day with id ${ref}.`);
    return d;
  }
  const plan = governingPlan(db, onDate) ?? activePlan(db);
  if (!plan) throw new ToolError('There is no active plan, so there are no plan days to link to. Pass plan_day: "none" or save a plan first.');
  const days = db.prepare('SELECT * FROM workouts_plan_days WHERE plan_id = ? ORDER BY (weekday + 6) % 7').all(plan.id) as PlanDayRow[];
  const key = nameKey(ref);
  const hit = days.find((d) => nameKey(d.name) === key) ?? days.find((d) => WEEKDAY_NAMES[d.weekday]!.toLowerCase() === key || WEEKDAY_KEYS[d.weekday] === key);
  if (!hit) throw new ToolError(`"${ref}" is not a day of the plan "${plan.name}". Its days: ${days.map((d) => `${d.name} (${WEEKDAY_NAMES[d.weekday]})`).join(', ') || 'none'}.`);
  return hit;
}

/**
 * A plan day done or planned off its weekday is a move within its week: the
 * usual date stops expecting it, unless that date already has its own session
 * for the day or another session already claimed the move.
 */
function inferMovedFrom(db: DB, pd: PlanDayRow, onDate: string, selfId: number | null): string | null {
  if (pd.weekday === weekdayOf(onDate)) return null;
  if (governingPlan(db, onDate)?.id !== pd.plan_id) return null;
  const usual = addDays(mondayOf(onDate), (pd.weekday + 6) % 7);
  const taken = db
    .prepare('SELECT 1 FROM workouts_sessions WHERE plan_day_id = ? AND id IS NOT ? AND (date = ? OR moved_from_date = ?)')
    .get(pd.id, selfId, usual, usual);
  return taken ? null : usual;
}

interface NewSet { exercise: string; reps: number | null; weight_lbs: number | null; duration_seconds: number | null; distance_miles: number | null; rpe: number | null; warmup: boolean; notes: string | null }

/** { sets: 3, reps: 5 } -> three rows; { reps: [5, 5, 4] } -> three rows. */
function expand(entries: z.infer<typeof logEntryInput>[]): NewSet[] {
  const out: NewSet[] = [];
  for (const e of entries) {
    if (e.reps == null && e.duration_seconds == null && e.distance_miles == null) {
      throw new ToolError(`"${e.exercise}" needs reps, duration_seconds or distance_miles.`);
    }
    const perSet: (number | null)[] = Array.isArray(e.reps) ? e.reps : Array.from({ length: e.sets ?? 1 }, () => (e.reps as number | undefined) ?? null);
    if (Array.isArray(e.reps) && e.sets != null && e.sets !== e.reps.length) {
      throw new ToolError(`"${e.exercise}": sets is ${e.sets} but reps lists ${e.reps.length} sets. Send one or the other.`);
    }
    for (const reps of perSet) {
      out.push({
        exercise: e.exercise, reps, weight_lbs: e.weight_lbs ?? null, duration_seconds: e.duration_seconds ?? null, distance_miles: e.distance_miles ?? null,
        rpe: e.rpe ?? null, warmup: !!e.warmup, notes: e.notes ?? null,
      });
    }
  }
  return out;
}

function newRecords(name: string, before: Prs | undefined, after: Prs): string[] {
  if (!before) return [];
  const out: string[] = [];
  if (before.weight && after.weight && after.weight.weight_lbs > before.weight.weight_lbs) {
    out.push(`${name}: weight PR, ${fmtNum(after.weight.weight_lbs)} lb x ${after.weight.reps} (was ${fmtNum(before.weight.weight_lbs)} lb)`);
  }
  if (before.e1rm && after.e1rm && after.e1rm.e1rm_lbs > before.e1rm.e1rm_lbs) {
    out.push(`${name}: estimated 1RM PR, ${fmtNum(after.e1rm.e1rm_lbs)} lb (was ${fmtNum(before.e1rm.e1rm_lbs)} lb)`);
  }
  if (before.distance && after.distance && after.distance.distance_miles > before.distance.distance_miles) {
    out.push(`${name}: longest distance, ${fmtNum(after.distance.distance_miles)} mi (was ${fmtNum(before.distance.distance_miles)} mi)`);
  }
  if (before.pace && after.pace && after.pace.pace_seconds_per_mile < before.pace.pace_seconds_per_mile) {
    out.push(`${name}: fastest pace, ${fmtDuration(after.pace.pace_seconds_per_mile)}/mi (was ${fmtDuration(before.pace.pace_seconds_per_mile)}/mi)`);
  }
  return out;
}

// ---- view helpers -------------------------------------------------------------------

function dateParam(p: Record<string, string>, key = 'date'): string {
  const v = p[key];
  if (!v) return localDay();
  if (!isDate(v)) throw new Error(`${key} must be a date written YYYY-MM-DD`);
  return v;
}
function intParam(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

/** One workout of a day, as the page lists it. */
const itemOut = (db: DB, i: DayItem) => ({
  title: i.title,
  status: i.status,
  expected: i.expected,
  plan_day: i.planDay
    ? { id: i.planDay.id, name: i.planDay.name, notes: i.planDay.notes, weekday: i.planDay.weekday, moved_from_date: i.movedFrom, exercises: planExercises(db, i.planDay.id).map((pe) => pe.exercise) }
    : null,
  session_ids: i.sessions.map((s) => s.id),
});

function todayView(db: DB, day: string) {
  const info = dayInfo(db, day, day);
  const primary = info.primary;
  const row = primary?.sessions.find((s) => s.status === 'in_progress') ?? primary?.sessions.at(-1);
  const session = row ? sessionOut(db, row) : null;
  let next: { date: string; weekday_name: string; name: string } | null = null;
  for (let i = 1; i <= 7 && !next; i++) {
    const d = dayInfo(db, addDays(day, i), day);
    const item = d.items.find((x) => x.expected && isPending(x));
    if (item) next = { date: d.date, weekday_name: weekdayName(d.date), name: item.title };
  }
  return {
    date: day,
    weekday_name: weekdayName(day),
    status: info.status,
    plan: info.plan ? { id: info.plan.id, name: info.plan.name } : null,
    plan_day: primary ? itemOut(db, primary).plan_day : null,
    session,
    exercises: exerciseCards(db, primary?.planDay, session, day),
    workouts: info.items.map((i) => itemOut(db, i)),
    other_sessions: info.sessions.filter((s) => s.id !== row?.id).map((s) => sessionOut(db, s, false)),
    next,
    week: weekAdherence(db, mondayOf(day), day),
  };
}

function weekView(db: DB, start: string, today: string) {
  const weekStart = mondayOf(start);
  const infos = Array.from({ length: 7 }, (_x, i) => dayInfo(db, addDays(weekStart, i), today));
  return {
    week_start: weekStart,
    week_end: addDays(weekStart, 6),
    prev_week_start: addDays(weekStart, -7),
    next_week_start: addDays(weekStart, 7),
    today,
    days: infos.map((d) => ({
      date: d.date,
      weekday: weekdayOf(d.date),
      weekday_name: weekdayName(d.date),
      is_today: d.date === today,
      status: d.status,
      plan_day: d.primary ? itemOut(db, d.primary).plan_day : null,
      workouts: d.items.map((i) => itemOut(db, i)),
      sessions: d.sessions.map((s) => sessionOut(db, s, false)),
    })),
    adherence: weekAdherence(db, weekStart, today, infos),
  };
}

function homeCards(db: DB, day: string) {
  const link = '/workouts';
  const info = dayInfo(db, day, day);
  const item = info.primary;
  const sets = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`;
  if (item && info.status === 'in_progress') {
    const s = sessionOut(db, item.sessions.find((x) => x.status === 'in_progress')!);
    const todo = exerciseCards(db, item.planDay, s, day).find((c) => c.planned && !c.done);
    return { cards: [{ title: 'Workout in progress', lines: [`${s.title} · ${sets(s.set_count)} logged`, ...(todo ? [`Next: ${todo.exercise} ${todo.planned!.target}`.trim()] : [])], link }] };
  }
  if (item && info.status === 'planned') {
    if (!item.planDay) return { cards: [{ title: "Today's workout", lines: [item.title], link }] };
    const planned = planExercises(db, item.planDay.id);
    return {
      cards: [{
        title: "Today's workout",
        lines: [
          `${item.planDay.name} · ${planned.length} ${planned.length === 1 ? 'exercise' : 'exercises'}`,
          ...planned.slice(0, 3).map((pe) => `${pe.exercise} ${targetText(pe, suggest(pe, previousPerformance(db, pe.exercise_id, day), pe).weight_lbs ?? pe.target_weight_lbs)}`.trim()),
          ...(planned.length > 3 ? [`+${planned.length - 3} more`] : []),
        ],
        link,
      }],
    };
  }
  if (info.status === 'completed') {
    const s = sessionOut(db, info.sessions.filter((x) => x.status === 'completed').at(-1)!, false);
    return {
      cards: [{
        title: 'Workout done',
        lines: [
          [s.title, sets(s.set_count), s.duration_minutes ? `${s.duration_minutes} min` : ''].filter(Boolean).join(' · '),
          ...s.exercises.slice(0, 3).map((e) => `${e.exercise} ${e.summary}`),
          ...(s.exercises.length > 3 ? [`+${s.exercises.length - 3} more`] : []),
        ],
        link,
      }],
    };
  }
  return { cards: [] };
}

// ---- the domain ----------------------------------------------------------------------

export default defineDomain({
  name: 'workouts',
  migrations,
  promptNote: `Ben's training: one active plan (plan days pinned to weekdays, each with target exercises), sessions made of sets, and an exercise catalogue with aliases. Weights are lbs, distances miles, durations seconds, dates YYYY-MM-DD.
Read with SQL. The view workouts_set_log has one row per logged set, already joined to its session and exercise: set_id, session_id, date, session_title, session_status, exercise_id, exercise, category, muscle_group, set_number, is_warmup, reps, weight_lbs, duration_seconds, distance_miles, rpe, notes, e1rm_lbs (Epley estimated 1RM: weight * (1 + reps / 30)). Progress on a lift is that view grouped by date with MAX(weight_lbs) and MAX(e1rm_lbs) WHERE is_warmup = 0; a personal record is the MAX over all dates.
The workout for a date is the active plan's workouts_plan_days row whose weekday equals strftime('%w', date), unless a workouts_sessions row says otherwise: one on that date (planned, skipped, done), or one elsewhere with moved_from_date equal to it.
Write with three tools. workout_plan_save takes the whole plan in one call. workout_log records training: when Ben reports a workout, send every set he gave in one call with status "completed" and tell him about any records in new_prs. workout_edit corrects and deletes, changes a plan's status, and manages exercise aliases.
The default progression adds 5 lb (10 for legs and glutes) once every set reaches the top of the plan's rep range and otherwise repeats the weight; when Ben asks what to lift, start from that and adjust for how the last sets went (RPE, missed reps).`,

  tools: [
    defineTool({
      name: 'workout_plan_save',
      description:
        'Create a training plan, or replace one, in a single call: the plan, its training days by weekday, and each day\'s exercises in order. Use it for "build me a 3-day plan" and for every structural change to an existing plan: pass plan_id with the complete plan as it should now be, since the days and exercises you send replace the ones stored. Weekdays you leave out are rest days. A new plan becomes the active one and the previous active plan is kept, inactive. Example: { name: "3-day strength", goal: "Bench 225 by March", days: [{ weekday: "mon", name: "Push", exercises: [{ exercise: "Bench Press", sets: 3, reps: 5, weight_lbs: 185, rest_seconds: 180 }, { exercise: "Incline Dumbbell Press", sets: 3, reps: "8-12" }] }, { weekday: "sat", name: "Run", exercises: [{ exercise: "Run", distance_miles: 2 }] }] }',
      input: z.object({
        plan_id: z.number().int().optional().describe('The plan to replace. Leave out to create a new plan.'),
        name: z.string().min(1).max(80),
        goal: z.string().max(300).optional().describe('What the plan is for, in Ben\'s words.'),
        notes: z.string().max(2000).optional(),
        activate: z.boolean().optional().describe('true makes this the active plan and deactivates the current one; false leaves it as a draft. Default: true for a new plan, unchanged for an existing one.'),
        start_date: date().optional().describe('The date the plan takes effect when activated. Default today.'),
        days: z.array(z.object({
          weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
          name: z.string().min(1).max(60).describe('What the day is called: "Push", "Legs", "Long run".'),
          notes: z.string().max(1000).optional(),
          exercises: z.array(planExerciseInput).max(30).default([]),
        })).min(1).max(7).describe('One entry per training day, each on its own weekday.'),
      }),
      touches: ['workouts'],
      run: (input, ctx) => {
        const db = ctx.db;
        const seen = new Set<string>();
        for (const d of input.days) {
          if (seen.has(d.weekday)) throw new ToolError(`Two days are on ${d.weekday}. Each weekday holds one plan day; merge them or move one.`);
          seen.add(d.weekday);
        }
        return db.transaction(() => {
          const now = nowIso();
          let planId: number;
          if (input.plan_id != null) {
            const existing = getPlan(db, input.plan_id);
            if (!existing) throw new ToolError(`No plan with id ${input.plan_id}. Leave plan_id out to create a new plan.`);
            planId = existing.id;
            db.prepare('UPDATE workouts_plans SET name = ?, goal = ?, notes = ?, updated_at = ? WHERE id = ?')
              .run(input.name, input.goal ?? existing.goal, input.notes ?? existing.notes, now, planId);
          } else {
            planId = Number(db.prepare('INSERT INTO workouts_plans (name, goal, notes, created_at, updated_at) VALUES (?,?,?,?,?)').run(input.name, input.goal ?? null, input.notes ?? null, now, now).lastInsertRowid);
          }
          // A day that stays on its weekday keeps its row, so sessions already linked to it stay linked.
          const old = db.prepare('SELECT * FROM workouts_plan_days WHERE plan_id = ?').all(planId) as PlanDayRow[];
          const keep = new Set<number>();
          const insertExercise = db.prepare(
            `INSERT INTO workouts_plan_exercises (plan_day_id, position, exercise_id, target_sets, target_reps_min, target_reps_max, target_weight_lbs,
               target_duration_seconds, target_distance_miles, target_rpe, rest_seconds, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          );
          for (const d of input.days) {
            const weekday = WEEKDAY_KEYS.indexOf(d.weekday);
            const row = old.find((o) => o.weekday === weekday);
            let dayId: number;
            if (row) {
              dayId = row.id;
              db.prepare('UPDATE workouts_plan_days SET name = ?, notes = ?, updated_at = ? WHERE id = ?').run(d.name, d.notes ?? null, now, dayId);
              db.prepare('DELETE FROM workouts_plan_exercises WHERE plan_day_id = ?').run(dayId);
            } else {
              dayId = Number(db.prepare('INSERT INTO workouts_plan_days (plan_id, weekday, name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(planId, weekday, d.name, d.notes ?? null, now, now).lastInsertRowid);
            }
            keep.add(dayId);
            d.exercises.forEach((x, i) => {
              const cardioShaped = x.reps == null && (x.duration_seconds != null || x.distance_miles != null);
              const ex = ensureExercise(db, x.exercise, { category: x.category, muscle_group: x.muscle_group, fallbackCategory: cardioShaped ? 'cardio' : 'strength' });
              const r = parseReps(x.reps);
              insertExercise.run(dayId, i + 1, ex.id, x.sets ?? null, r.min, r.max, x.weight_lbs ?? null, x.duration_seconds ?? null, x.distance_miles ?? null, x.rpe ?? null, x.rest_seconds ?? null, x.notes ?? null);
            });
          }
          for (const o of old) if (!keep.has(o.id)) db.prepare('DELETE FROM workouts_plan_days WHERE id = ?').run(o.id);

          const activate = input.activate ?? (input.plan_id == null ? true : undefined);
          const on = input.start_date ?? localDay();
          let replaced: string | null = null;
          if (activate === true) replaced = setActive(db, planId, on);
          else if (activate === false) deactivate(db, planId, on);
          return { plan: planOut(db, getPlan(db, planId)!), replaced_active_plan: replaced };
        })();
      },
    }),

    defineTool({
      name: 'workout_log',
      description:
        'Record training on a date: log sets, start or finish a session, skip a day, or plan a one-off session. One call carries a whole workout. Each entry in `exercises` is compact, { exercise: "Bench Press", sets: 3, reps: 5, weight_lbs: 185 } (three identical sets), or lists reps per set, { exercise: "Squat", reps: [5, 5, 4], weight_lbs: 225 }; give an exercise a second entry when the weight changes. Cardio and sport use time and distance: { exercise: "Run", distance_miles: 2, duration_seconds: 1050 }. Sets are appended to the date\'s open session (in progress, planned or skipped), and a new session linked to that date\'s plan day is created when there is none. When Ben reports a finished workout send it all with status "completed"; while he is mid-workout leave status out, then send { status: "completed" } when he is done. { status: "skipped" } skips the date\'s planned workout. To move a plan day for one week: { date: "2026-11-21", plan_day: "Legs", status: "planned", moved_from: "2026-11-20" }. Returns the session with its set ids, and new_prs: the personal records these sets broke.',
      input: z.object({
        date: date().optional().describe('The day of the workout, YYYY-MM-DD. Default today. With session_id, moves that session to this date.'),
        session_id: z.number().int().optional().describe('Write to this session instead of the date\'s open one: add sets to a finished session, or change its date, title, notes or status.'),
        new_session: z.boolean().optional().describe('true starts a separate session even though the date has one: a second workout that day.'),
        exercises: z.array(logEntryInput).max(60).optional().describe('The sets to record, in the order done.'),
        replace_sets: z.boolean().optional().describe('true replaces every set already in the session with `exercises`: a full re-log.'),
        status: z.enum(['planned', 'in_progress', 'completed', 'skipped']).optional().describe('completed: the workout is finished. in_progress: start or reopen it. skipped: Ben is not doing the planned workout. planned: schedule a session ahead with no sets. Default: in_progress for today, completed for a past date.'),
        plan_day: z.union([z.number().int(), z.string().max(60)]).optional().describe('The plan day this session fulfils, by name ("Legs") or id. Default: the plan day scheduled on the date. "none" for something outside the plan, like a kickball game on a lifting day.'),
        title: z.string().max(80).optional().describe('Default: the plan day\'s name, or the exercises logged.'),
        notes: z.string().max(2000).nullable().optional().describe('How it went, in Ben\'s words.'),
        duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
        perceived_effort: rpe().nullable().optional().describe('How hard the whole session felt, 1-10.'),
        moved_from: date().optional().describe('With plan_day: the date that plan day would normally fall on this week, which then shows as rest.'),
      }),
      touches: ['workouts'],
      run: (input, ctx) => {
        const db = ctx.db;
        const today = localDay();
        const rows = expand(input.exercises ?? []);
        const before = new Map<number, Prs>();
        for (const name of new Set(rows.map((r) => r.exercise))) {
          const e = findExercise(db, name);
          if (e && !before.has(e.id)) before.set(e.id, prs(workingSets(db, e.id)));
        }
        const touched = new Set<number>();

        const sessionId = db.transaction(() => {
          const now = nowIso();
          let s: SessionRow | undefined;
          if (input.session_id != null) {
            s = getSession(db, input.session_id);
            if (!s) throw new ToolError(`No session with id ${input.session_id}.`);
          }
          const day = input.date ?? s?.date ?? today;
          const requested = resolvePlanDay(db, input.plan_day, day);
          const fits = (x: SessionRow) => requested === undefined || (requested?.id ?? null) === x.plan_day_id;
          // The plan day a new session fulfils when the caller names none.
          let defaultPlanDay: PlanDayRow | null = null;
          if (input.session_id == null && !input.new_session) {
            const info = dayInfo(db, day, today);
            if (input.status === 'planned') s = info.sessions.find((x) => x.status === 'planned' && fits(x));
            else {
              s = info.sessions.find((x) => x.status === 'in_progress' && fits(x));
              if (!s) {
                // Workouts still open on the date. With several (a run and a moved
                // Legs day), the sets go to the one whose plan lists these exercises.
                const open = info.items.filter((i) => (isPending(i) || i.status === 'skipped') && (requested === undefined || (requested?.id ?? null) === (i.planDay?.id ?? null)));
                const ids = new Set(rows.map((r) => findExercise(db, r.exercise)?.id).filter((x): x is number => x != null));
                const score = (i: DayItem) => (i.planDay ? planExercises(db, i.planDay.id).filter((pe) => ids.has(pe.exercise_id)).length : 0);
                const pick = open.reduce<DayItem | undefined>((best, i) => (!best || score(i) > score(best) ? i : best), undefined);
                if (pick) {
                  s = pick.sessions.at(-1);
                  defaultPlanDay = pick.planDay ?? null;
                } else if (requested === undefined) {
                  const done = info.sessions.filter((x) => x.status === 'completed').at(-1);
                  if (done && rows.length) {
                    throw new ToolError(`${done.date} already has a finished session (#${done.id} "${done.title}"). Pass session_id: ${done.id} to add these sets to it, or new_session: true to record a separate session.`);
                  }
                  s = done;
                }
              }
            }
          }
          const hadSets = s && !input.replace_sets ? (db.prepare('SELECT COUNT(*) AS n FROM workouts_sets WHERE session_id = ?').get(s.id) as { n: number }).n : 0;

          let status: SessionStatus;
          if (input.status) status = input.status;
          else if (!s) {
            if (!rows.length) throw new ToolError('Nothing to record. Send exercises, or a status: "in_progress" to start a session, "completed", "skipped" or "planned".');
            status = day < today ? 'completed' : 'in_progress';
          } else status = rows.length && (s.status === 'planned' || s.status === 'skipped') ? (day < today ? 'completed' : 'in_progress') : s.status;

          if (day > today && (status === 'in_progress' || status === 'completed')) {
            throw new ToolError(`${day} is in the future (today is ${today}). Schedule it with status "planned" and no sets, or correct the date.`);
          }
          if ((status === 'planned' || status === 'skipped') && (rows.length || hadSets)) {
            throw new ToolError(
              rows.length
                ? `A ${status} session holds no sets. Leave status out to log these sets.`
                : `Session #${s!.id} "${s!.title}" has ${hadSets} sets logged, so it cannot become ${status}. Finish it with status "completed", or delete it with workout_edit.`,
            );
          }

          let id: number;
          if (!s) {
            const pd = requested !== undefined ? requested : defaultPlanDay;
            if (status === 'skipped' && !pd && !input.title) throw new ToolError(`Nothing is planned on ${day}, so there is nothing to skip.`);
            if (status === 'planned' && !pd && !input.title) throw new ToolError('Say what to plan: plan_day (a day of the active plan, e.g. "Legs") or a title for a one-off session.');
            const names = [...new Set(rows.map((r) => ensureExercise(db, r.exercise, { fallbackCategory: r.reps == null ? 'cardio' : 'strength' }).name))];
            const title = input.title ?? pd?.name ?? (names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'Workout');
            const moved = pd ? (input.moved_from ?? inferMovedFrom(db, pd, day, null)) : null;
            const began = status === 'in_progress' || status === 'completed' ? now : null;
            id = Number(
              db.prepare(
                `INSERT INTO workouts_sessions (date, plan_day_id, title, status, notes, duration_minutes, perceived_effort, moved_from_date, started_at, completed_at, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              ).run(day, pd?.id ?? null, title, status, input.notes ?? null, input.duration_minutes ?? null, input.perceived_effort ?? null,
                moved && moved !== day ? moved : null, began, status === 'completed' ? now : null, now, now).lastInsertRowid,
            );
          } else {
            id = s.id;
            const pd = requested === undefined ? (s.plan_day_id != null ? getPlanDay(db, s.plan_day_id) ?? null : null) : requested;
            const relocated = day !== s.date || (requested !== undefined && (requested?.id ?? null) !== s.plan_day_id);
            let moved = input.moved_from ?? s.moved_from_date;
            if (!pd) moved = null;
            else if (relocated && !input.moved_from) moved = s.moved_from_date ?? inferMovedFrom(db, pd, day, s.id);
            if (moved === day || (pd && pd.weekday === weekdayOf(day) && !input.moved_from)) moved = null;
            const title = input.title ?? (requested && s.title === (s.plan_day_id != null ? getPlanDay(db, s.plan_day_id)?.name : undefined) ? requested.name : s.title);
            const duration = input.duration_minutes !== undefined ? input.duration_minutes : s.duration_minutes ?? (() => {
              // A session logged live and then finished gets its length from the clock.
              if (s.status !== 'in_progress' || status !== 'completed' || !s.started_at) return null;
              const mins = Math.round((Date.parse(now) - Date.parse(s.started_at)) / 60_000);
              return mins >= 1 && mins <= 360 ? mins : null;
            })();
            const active = status === 'in_progress' || status === 'completed';
            db.prepare(
              `UPDATE workouts_sessions SET date = ?, plan_day_id = ?, title = ?, status = ?, notes = ?, duration_minutes = ?, perceived_effort = ?, moved_from_date = ?,
                 started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
            ).run(day, pd?.id ?? null, title, status, input.notes !== undefined ? input.notes : s.notes, duration,
              input.perceived_effort !== undefined ? input.perceived_effort : s.perceived_effort, moved ?? null,
              s.started_at ?? (active ? now : null), status === 'completed' ? (s.status === 'completed' ? s.completed_at : now) : null, now, id);
            if (input.replace_sets) {
              for (const r of db.prepare('SELECT DISTINCT exercise_id FROM workouts_sets WHERE session_id = ?').all(id) as { exercise_id: number }[]) touched.add(r.exercise_id);
              db.prepare('DELETE FROM workouts_sets WHERE session_id = ?').run(id);
            }
          }

          const nextNumber = new Map<number, number>();
          const insert = db.prepare(
            `INSERT INTO workouts_sets (session_id, exercise_id, set_number, reps, weight_lbs, duration_seconds, distance_miles, rpe, is_warmup, notes, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          );
          for (const r of rows) {
            const ex = ensureExercise(db, r.exercise, { fallbackCategory: r.reps == null ? 'cardio' : 'strength' });
            const n = nextNumber.get(ex.id) ?? (db.prepare('SELECT COALESCE(MAX(set_number), 0) AS n FROM workouts_sets WHERE session_id = ? AND exercise_id = ?').get(id, ex.id) as { n: number }).n + 1;
            nextNumber.set(ex.id, n + 1);
            insert.run(id, ex.id, n, r.reps, r.weight_lbs, r.duration_seconds, r.distance_miles, r.rpe, r.warmup ? 1 : 0, r.notes, now, now);
            touched.add(ex.id);
          }
          return id;
        })();

        const session = sessionOut(db, getSession(db, sessionId)!);
        const new_prs: string[] = [];
        for (const exId of touched) {
          const e = getExercise(db, exId);
          if (e) new_prs.push(...newRecords(e.name, before.get(exId), prs(workingSets(db, exId))));
        }
        return { session, new_prs };
      },
    }),

    defineTool({
      name: 'workout_edit',
      description:
        'Correct or remove what is already recorded, several changes per call. update_sets changes fields of logged sets by id; delete_set_ids removes sets; delete_session_id removes a session with all its sets; plan activates, deactivates, archives or deletes a plan; exercise edits the catalogue: rename, category, muscle group, notes, aliases (so "bench" means Bench Press), or merge_into, which folds a duplicate exercise and its whole history into another. Set and session ids come from workout_log results or from SQL on workouts_set_log. Example: { update_sets: [{ set_id: 41, reps: 4 }], delete_set_ids: [44] }. Example: { exercise: { exercise: "Bench Press", add_aliases: ["bench", "flat bench"] } }.',
      input: z.object({
        update_sets: z.array(setPatchInput).max(60).optional().describe('Only the fields you send change; null clears one.'),
        delete_set_ids: z.array(z.number().int()).max(100).optional(),
        delete_session_id: z.number().int().optional().describe('Ben is asked to confirm.'),
        plan: z.object({
          plan_id: z.number().int(),
          action: z.enum(['activate', 'deactivate', 'archive', 'delete']).describe('activate: make it the active plan (the current one is deactivated). archive: retire it, keeping it for history. delete: remove it and its days; logged sessions stay. Ben is asked to confirm a delete.'),
        }).optional(),
        exercise: z.object({
          exercise: z.string().min(1).max(80).describe('The exercise to change, by name or alias.'),
          rename: z.string().min(1).max(80).optional().describe('New display name; the old name keeps working as an alias.'),
          category: CATEGORY.optional(),
          muscle_group: MUSCLE.nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
          add_aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
          remove_aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
          merge_into: z.string().min(1).max(80).optional().describe('Another exercise that is really the same one: every set and plan entry moves to it and this name becomes its alias.'),
        }).optional(),
      }),
      touches: ['workouts'],
      run: async (input, ctx) => {
        const db = ctx.db;
        if (!input.update_sets?.length && !input.delete_set_ids?.length && input.delete_session_id == null && !input.plan && !input.exercise) {
          throw new ToolError('Nothing to change. Send update_sets, delete_set_ids, delete_session_id, plan or exercise.');
        }
        // Checks and confirmations first, so a declined delete changes nothing.
        if (input.delete_session_id != null) {
          const s = getSession(db, input.delete_session_id);
          if (!s) throw new ToolError(`No session with id ${input.delete_session_id}.`);
          const n = (db.prepare('SELECT COUNT(*) AS n FROM workouts_sets WHERE session_id = ?').get(s.id) as { n: number }).n;
          if (!(await ctx.confirm(`Delete the "${s.title}" session on ${s.date} (${n} ${n === 1 ? 'set' : 'sets'})?`))) throw new ToolError('Ben declined deleting the session. Nothing was changed.');
        }
        let plan: PlanRow | undefined;
        if (input.plan) {
          plan = getPlan(db, input.plan.plan_id);
          if (!plan) throw new ToolError(`No plan with id ${input.plan.plan_id}.`);
          if (input.plan.action === 'delete' && !(await ctx.confirm(`Delete the plan "${plan.name}"? Logged sessions are kept.`))) {
            throw new ToolError('Ben declined deleting the plan. Nothing was changed.');
          }
        }

        return db.transaction(() => {
          const now = nowIso();
          const today = localDay();
          const done: string[] = [];
          const affected = new Set<number>();
          const dirty = new Set<string>(); // "session:exercise" pairs to renumber

          for (const p of input.update_sets ?? []) {
            const row = db.prepare('SELECT * FROM workouts_sets WHERE id = ?').get(p.set_id) as SetRow | undefined;
            if (!row) throw new ToolError(`No set with id ${p.set_id}.`);
            const next = {
              exercise_id: p.exercise ? ensureExercise(db, p.exercise).id : row.exercise_id,
              reps: p.reps !== undefined ? p.reps : row.reps,
              weight_lbs: p.weight_lbs !== undefined ? p.weight_lbs : row.weight_lbs,
              duration_seconds: p.duration_seconds !== undefined ? p.duration_seconds : row.duration_seconds,
              distance_miles: p.distance_miles !== undefined ? p.distance_miles : row.distance_miles,
              rpe: p.rpe !== undefined ? p.rpe : row.rpe,
              is_warmup: p.warmup !== undefined ? (p.warmup ? 1 : 0) : row.is_warmup,
              notes: p.notes !== undefined ? p.notes : row.notes,
            };
            if (next.reps == null && next.duration_seconds == null && next.distance_miles == null) {
              throw new ToolError(`Set ${p.set_id} would be left with no reps, duration or distance. Delete it with delete_set_ids instead.`);
            }
            // A set that changes exercise goes to the end of its new exercise's sets.
            const setNumber = next.exercise_id === row.exercise_id ? row.set_number : 10_000 + row.id;
            db.prepare('UPDATE workouts_sets SET exercise_id = ?, set_number = ?, reps = ?, weight_lbs = ?, duration_seconds = ?, distance_miles = ?, rpe = ?, is_warmup = ?, notes = ?, updated_at = ? WHERE id = ?')
              .run(next.exercise_id, setNumber, next.reps, next.weight_lbs, next.duration_seconds, next.distance_miles, next.rpe, next.is_warmup, next.notes, now, row.id);
            if (next.exercise_id !== row.exercise_id) dirty.add(`${row.session_id}:${row.exercise_id}`).add(`${row.session_id}:${next.exercise_id}`);
            affected.add(row.session_id);
          }
          if (input.update_sets?.length) done.push(`updated ${input.update_sets.length} ${input.update_sets.length === 1 ? 'set' : 'sets'}`);

          for (const setId of input.delete_set_ids ?? []) {
            const row = db.prepare('SELECT * FROM workouts_sets WHERE id = ?').get(setId) as SetRow | undefined;
            if (!row) throw new ToolError(`No set with id ${setId}.`);
            db.prepare('DELETE FROM workouts_sets WHERE id = ?').run(setId);
            dirty.add(`${row.session_id}:${row.exercise_id}`);
            affected.add(row.session_id);
          }
          if (input.delete_set_ids?.length) done.push(`deleted ${input.delete_set_ids.length} ${input.delete_set_ids.length === 1 ? 'set' : 'sets'}`);

          if (input.delete_session_id != null) {
            db.prepare('DELETE FROM workouts_sessions WHERE id = ?').run(input.delete_session_id);
            affected.delete(input.delete_session_id);
            done.push(`deleted session ${input.delete_session_id}`);
          }

          if (plan && input.plan) {
            const a = input.plan.action;
            if (a === 'activate') {
              const replaced = setActive(db, plan.id, today);
              done.push(`"${plan.name}" is now the active plan${replaced ? ` (was "${replaced}")` : ''}`);
            } else if (a === 'deactivate') {
              deactivate(db, plan.id, today);
              done.push(`"${plan.name}" is no longer active`);
            } else if (a === 'archive') {
              deactivate(db, plan.id, today);
              db.prepare('UPDATE workouts_plans SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, plan.id);
              done.push(`archived the plan "${plan.name}"`);
            } else {
              db.prepare('DELETE FROM workouts_plans WHERE id = ?').run(plan.id);
              done.push(`deleted the plan "${plan.name}"`);
            }
          }

          let exercise: ExerciseRow | undefined;
          if (input.exercise) {
            const x = input.exercise;
            exercise = findExercise(db, x.exercise);
            if (!exercise) throw new ToolError(`No exercise called "${x.exercise}". Names in use: ${(db.prepare('SELECT name FROM workouts_exercises ORDER BY name LIMIT 60').all() as { name: string }[]).map((r) => r.name).join(', ') || 'none yet'}.`);
            const owner = (key: string, selfId: number) => {
              const o = findExercise(db, key);
              return o && o.id !== selfId ? o : undefined;
            };
            if (x.merge_into) {
              const into = findExercise(db, x.merge_into);
              if (!into) throw new ToolError(`No exercise called "${x.merge_into}" to merge into.`);
              if (into.id === exercise.id) throw new ToolError(`"${x.exercise}" and "${x.merge_into}" are already the same exercise.`);
              const sessions = db.prepare('SELECT DISTINCT session_id FROM workouts_sets WHERE exercise_id = ?').all(exercise.id) as { session_id: number }[];
              db.prepare('UPDATE workouts_sets SET exercise_id = ?, set_number = set_number + 10000, updated_at = ? WHERE exercise_id = ?').run(into.id, now, exercise.id);
              for (const s of sessions) {
                dirty.add(`${s.session_id}:${into.id}`);
                affected.add(s.session_id);
              }
              db.prepare('UPDATE workouts_plan_exercises SET exercise_id = ? WHERE exercise_id = ?').run(into.id, exercise.id);
              const merged = [...new Set([...aliasesOf(into), exercise.name_key, ...aliasesOf(exercise)])].filter((k) => k !== into.name_key);
              db.prepare('DELETE FROM workouts_exercises WHERE id = ?').run(exercise.id);
              db.prepare('UPDATE workouts_exercises SET aliases = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, into.id);
              done.push(`merged "${exercise.name}" into "${into.name}"`);
              exercise = getExercise(db, into.id)!;
            }
            let aliases = aliasesOf(exercise);
            let name = exercise.name;
            let key = exercise.name_key;
            if (x.rename) {
              const k = nameKey(x.rename);
              if (!k) throw new ToolError(`"${x.rename}" is not a usable exercise name.`);
              const o = owner(k, exercise.id);
              if (o) throw new ToolError(`"${x.rename}" already means "${o.name}". To combine the two, use merge_into: "${o.name}".`);
              if (k !== key) aliases.push(key);
              name = x.rename.trim().replace(/\s+/g, ' ');
              key = k;
              aliases = aliases.filter((a) => a !== key);
            }
            for (const a of x.add_aliases ?? []) {
              const k = nameKey(a);
              if (!k) throw new ToolError(`"${a}" is not a usable alias.`);
              const o = owner(k, exercise.id);
              if (o) throw new ToolError(`"${a}" already means "${o.name}". To combine the two exercises, use merge_into: "${o.name}".`);
              if (k !== key && !aliases.includes(k)) aliases.push(k);
            }
            const drop = new Set((x.remove_aliases ?? []).map(nameKey));
            aliases = [...new Set(aliases)].filter((a) => !drop.has(a));
            db.prepare('UPDATE workouts_exercises SET name = ?, name_key = ?, aliases = ?, category = ?, muscle_group = ?, notes = ?, updated_at = ? WHERE id = ?').run(
              name, key, JSON.stringify(aliases), x.category ?? exercise.category,
              x.muscle_group !== undefined ? x.muscle_group : exercise.muscle_group, x.notes !== undefined ? x.notes : exercise.notes, now, exercise.id,
            );
            exercise = getExercise(db, exercise.id)!;
            if (!x.merge_into || x.rename || x.category || x.muscle_group !== undefined || x.notes !== undefined || x.add_aliases || x.remove_aliases) done.push(`updated exercise "${exercise.name}"`);
          }

          for (const pair of dirty) {
            const [sid, eid] = pair.split(':').map(Number);
            renumber(db, sid!, eid!);
          }
          const stillThere = input.plan && input.plan.action !== 'delete' ? getPlan(db, input.plan.plan_id) : undefined;
          return {
            done,
            sessions: [...affected].slice(0, 5).map((sid) => getSession(db, sid)).filter((s): s is SessionRow => !!s).map((s) => sessionOut(db, s)),
            ...(stillThere ? { plan: planOut(db, stillThere) } : {}),
            ...(exercise ? { exercise: exerciseOut(exercise) } : {}),
          };
        })();
      },
    }),
  ],

  // Every view that depends on "today" takes ?date=YYYY-MM-DD to stand in for it.
  views: {
    /** Home page cards. ?date */
    home: (p, db) => homeCards(db, dateParam(p)),

    /** The active plan (or ?id=) with days and exercises, plus the list of plans. ?include_archived=1 */
    plan: (p, db) => {
      const row = p.id ? getPlan(db, intParam(p.id, 0, 0, Number.MAX_SAFE_INTEGER)) : activePlan(db);
      const plans = db
        .prepare(
          `SELECT pl.id, pl.name, pl.goal, pl.is_active, pl.active_from, pl.archived_at, pl.updated_at,
                  (SELECT COUNT(*) FROM workouts_plan_days d WHERE d.plan_id = pl.id) AS day_count
           FROM workouts_plans pl ${p.include_archived === '1' ? '' : 'WHERE pl.archived_at IS NULL'} ORDER BY pl.is_active DESC, pl.updated_at DESC, pl.id DESC`,
        )
        .all() as { id: number; name: string; goal: string | null; is_active: number; active_from: string | null; archived_at: string | null; updated_at: string; day_count: number }[];
      return {
        plan: row ? planOut(db, row) : null,
        plans: plans.map((x) => ({ id: x.id, name: x.name, goal: x.goal, is_active: !!x.is_active, archived: !!x.archived_at, active_from: x.active_from, day_count: x.day_count, updated_at: x.updated_at })),
      };
    },

    /** Everything the workout screen needs for one day. ?date */
    today: (p, db) => todayView(db, dateParam(p)),

    /** Last performance and suggested target for each exercise of a plan day. ?date or ?plan_day_id */
    suggestions: (p, db) => {
      const day = dateParam(p);
      const pd = p.plan_day_id ? getPlanDay(db, intParam(p.plan_day_id, 0, 0, Number.MAX_SAFE_INTEGER)) : dayInfo(db, day, day).primary?.planDay;
      return {
        date: day,
        plan_day: pd ? { id: pd.id, name: pd.name, weekday: pd.weekday } : null,
        exercises: exerciseCards(db, pd, null, day).map(({ logged_sets: _l, done: _d, ...rest }) => rest),
      };
    },

    /** Monday-to-Sunday calendar containing ?start (default: this week). ?date stands in for today. */
    week: (p, db) => {
      const today = dateParam(p);
      return weekView(db, p.start ? dateParam(p, 'start') : today, today);
    },

    /** Planned days against completed ones for the current week and the ?weeks-1 before it (default 6), newest first. ?date */
    adherence: (p, db) => {
      const today = dateParam(p);
      const n = intParam(p.weeks, 6, 1, 26);
      const weeks = Array.from({ length: n }, (_x, i) => weekAdherence(db, addDays(mondayOf(today), -7 * i), today));
      const planned = weeks.reduce((t, w) => t + w.planned, 0);
      const completed = weeks.reduce((t, w) => t + w.completed, 0);
      return { today, weeks, totals: { planned, completed, extra: weeks.reduce((t, w) => t + w.extra, 0), pct: planned ? Math.round((100 * completed) / planned) : null } };
    },

    /** Session history, newest first. ?limit ?offset ?status (default: all but planned; "all" for everything) ?exercise ?from ?to */
    sessions: (p, db) => {
      const limit = intParam(p.limit, 20, 1, 100);
      const offset = intParam(p.offset, 0, 0, 1_000_000);
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (!p.status) where.push("s.status <> 'planned'");
      else if (p.status !== 'all') {
        where.push('s.status = ?');
        args.push(p.status);
      }
      if (p.exercise) {
        const e = findExercise(db, p.exercise);
        where.push('EXISTS (SELECT 1 FROM workouts_sets st WHERE st.session_id = s.id AND st.exercise_id = ?)');
        args.push(e?.id ?? -1);
      }
      if (p.from) {
        where.push('s.date >= ?');
        args.push(dateParam(p, 'from'));
      }
      if (p.to) {
        where.push('s.date <= ?');
        args.push(dateParam(p, 'to'));
      }
      const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM workouts_sessions s ${sql}`).get(...args) as { n: number }).n;
      const rows = db.prepare(`SELECT s.* FROM workouts_sessions s ${sql} ORDER BY s.date DESC, s.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as SessionRow[];
      return { total, limit, offset, sessions: rows.map((s) => sessionOut(db, s, false)) };
    },

    /** One session with every set. ?id */
    session: (p, db) => {
      const s = getSession(db, intParam(p.id, 0, 0, Number.MAX_SAFE_INTEGER));
      return { session: s ? sessionOut(db, s) : null };
    },

    /** The exercise catalogue with usage. ?q (matches name or alias) ?category */
    exercises: (p, db) => {
      const rows = db
        .prepare(
          `SELECT e.*, COUNT(DISTINCT l.session_id) AS session_count, MAX(l.date) AS last_date, MAX(l.weight_lbs) AS best_weight_lbs, MAX(l.e1rm_lbs) AS best_e1rm_lbs
           FROM workouts_exercises e
           LEFT JOIN workouts_set_log l ON l.exercise_id = e.id AND l.is_warmup = 0 AND l.session_status IN ('in_progress', 'completed')
           GROUP BY e.id ORDER BY last_date IS NULL, last_date DESC, e.name`,
        )
        .all() as (ExerciseRow & { session_count: number; last_date: string | null; best_weight_lbs: number | null; best_e1rm_lbs: number | null })[];
      const q = p.q ? nameKey(p.q) : '';
      return {
        exercises: rows
          .filter((e) => (!p.category || e.category === p.category) && (!q || e.name_key.includes(q) || aliasesOf(e).some((a) => a.includes(q))))
          .map((e) => ({ ...exerciseOut(e), session_count: e.session_count, last_date: e.last_date, best_weight_lbs: e.best_weight_lbs, best_e1rm_lbs: e.best_e1rm_lbs })),
      };
    },

    /** Chart series and records for one exercise. ?exercise (name or alias) or ?exercise_id; ?limit = most recent N sessions (default 60) */
    progression: (p, db) => {
      const e = p.exercise_id ? getExercise(db, intParam(p.exercise_id, 0, 0, Number.MAX_SAFE_INTEGER)) : p.exercise ? findExercise(db, p.exercise) : undefined;
      if (!e) return { exercise: null, series: [], prs: null, last_session: null };
      const sets = workingSets(db, e.id);
      return { exercise: exerciseOut(e), series: series(sets).slice(-intParam(p.limit, 60, 1, 500)), prs: prs(sets), last_session: previousPerformance(db, e.id, '9999-12-31') };
    },

    /** Personal records for every exercise with logged sets, by name. */
    prs: (_p, db) => {
      const ids = db.prepare("SELECT DISTINCT exercise_id AS id FROM workouts_set_log WHERE is_warmup = 0 AND session_status IN ('in_progress', 'completed')").all() as { id: number }[];
      return {
        prs: ids
          .map(({ id }) => ({ e: getExercise(db, id)!, r: prs(workingSets(db, id)) }))
          .sort((a, b) => a.e.name.localeCompare(b.e.name))
          .map(({ e, r }) => ({ exercise_id: e.id, exercise: e.name, category: e.category, muscle_group: e.muscle_group, ...r })),
      };
    },
  },
});
