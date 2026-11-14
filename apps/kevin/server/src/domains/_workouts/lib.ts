// Workouts: everything the tools and views share. Dates, exercise-name
// resolution, the schedule (which plan day falls on which date), and the
// progression math.
import { type DB, nowIso } from '../../db.js';
import { ToolError } from '../../tools.js';

// ---- rows ----------------------------------------------------------------------

export interface ExerciseRow {
  id: number; name: string; name_key: string; aliases: string; category: string; muscle_group: string | null; notes: string | null;
  created_at: string; updated_at: string;
}
export interface PlanRow {
  id: number; name: string; goal: string | null; notes: string | null; is_active: number;
  active_from: string | null; active_until: string | null; archived_at: string | null; created_at: string; updated_at: string;
}
export interface PlanDayRow { id: number; plan_id: number; weekday: number; name: string; notes: string | null; created_at: string; updated_at: string }
export interface PlanExerciseRow {
  id: number; plan_day_id: number; position: number; exercise_id: number;
  target_sets: number | null; target_reps_min: number | null; target_reps_max: number | null; target_weight_lbs: number | null;
  target_duration_seconds: number | null; target_distance_miles: number | null; target_rpe: number | null; rest_seconds: number | null; notes: string | null;
}
export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';
export interface SessionRow {
  id: number; date: string; plan_day_id: number | null; title: string; status: SessionStatus; notes: string | null;
  duration_minutes: number | null; perceived_effort: number | null; moved_from_date: string | null;
  started_at: string | null; completed_at: string | null; created_at: string; updated_at: string;
}
export interface SetRow {
  id: number; session_id: number; exercise_id: number; set_number: number; reps: number | null; weight_lbs: number | null;
  duration_seconds: number | null; distance_miles: number | null; rpe: number | null; is_warmup: number; notes: string | null;
  created_at: string; updated_at: string;
}

// ---- dates (plain YYYY-MM-DD strings; arithmetic in UTC so DST never bites) --------

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0=Sunday ... 6=Saturday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const weekdayName = (date: string): string => WEEKDAY_NAMES[weekdayOf(date)]!;
/** Weeks start on Monday. */
export const mondayOf = (date: string): string => addDays(date, -((weekdayOf(date) + 6) % 7));

// ---- formatting ------------------------------------------------------------------

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const fmtNum = (n: number): string => String(Math.round(n * 100) / 100);
/** 1050 -> "17:30", 3725 -> "1:02:05". */
export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

type SetLike = Pick<SetRow, 'reps' | 'weight_lbs' | 'duration_seconds' | 'distance_miles' | 'is_warmup'>;

/** "3x5 @ 185 lb", "5/5/4 @ 225 lb", "12/10/8", "2 mi in 17:30". Warmups are left out unless that is all there is. */
export function setsSummary(sets: SetLike[]): string {
  const work = sets.filter((s) => !s.is_warmup);
  const use = work.length ? work : sets;
  const parts: string[] = [];
  for (let i = 0; i < use.length; ) {
    const s = use[i]!;
    if (s.reps != null) {
      const reps = [s.reps];
      let j = i + 1;
      while (j < use.length && use[j]!.reps != null && use[j]!.weight_lbs === s.weight_lbs) reps.push(use[j++]!.reps!);
      const r = reps.length > 1 && reps.every((x) => x === reps[0]) ? `${reps.length}x${reps[0]}` : reps.join('/');
      parts.push(s.weight_lbs ? `${r} @ ${fmtNum(s.weight_lbs)} lb` : reps.length === 1 ? `${r} reps` : r);
      i = j;
    } else {
      const dist = s.distance_miles != null ? `${fmtNum(s.distance_miles)} mi` : '';
      const dur = s.duration_seconds != null ? fmtDuration(s.duration_seconds) : '';
      parts.push(dist && dur ? `${dist} in ${dur}` : dist || dur || 'done');
      i++;
    }
  }
  return parts.join(', ');
}

/** "3x8-12 @ 135 lb", "3x5", "2 mi in 18:00", "20:00". `weight` overrides the plan's starting weight. */
export function targetText(pe: PlanExerciseRow, weight: number | null = pe.target_weight_lbs): string {
  const reps = pe.target_reps_min == null ? '' : pe.target_reps_max != null && pe.target_reps_max !== pe.target_reps_min ? `${pe.target_reps_min}-${pe.target_reps_max}` : String(pe.target_reps_min);
  let out: string;
  if (reps) out = pe.target_sets ? `${pe.target_sets}x${reps}` : `${reps} reps`;
  else {
    const dist = pe.target_distance_miles != null ? `${fmtNum(pe.target_distance_miles)} mi` : '';
    const dur = pe.target_duration_seconds != null ? fmtDuration(pe.target_duration_seconds) : '';
    const cardio = dist && dur ? `${dist} in ${dur}` : dist || dur;
    out = cardio ? (pe.target_sets && pe.target_sets > 1 ? `${pe.target_sets} x ${cardio}` : cardio) : pe.target_sets ? `${pe.target_sets} sets` : '';
  }
  if (weight) out += ` @ ${fmtNum(weight)} lb`;
  if (pe.target_rpe != null) out += ` RPE ${fmtNum(pe.target_rpe)}`;
  return out.trim();
}

// ---- exercises ---------------------------------------------------------------------

/** The lookup key: "Pull-Ups" -> "pull up", "Bench Press" -> "bench press". */
export function nameKey(text: string): string {
  const key = text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return key.length > 3 && key.endsWith('s') && !key.endsWith('ss') ? key.slice(0, -1) : key;
}

const CATEGORIES = ['strength', 'cardio', 'mobility', 'sport'] as const;
export type Category = (typeof CATEGORIES)[number];

// First-use guesses so a new exercise lands with a category and muscle group
// (the muscle group picks the progression step). Order matters: "leg raise" is
// core, "leg curl" is legs, "barbell row" is back and never cardio.
const GUESSES: [RegExp, Category, string | null][] = [
  [/\b(kickball|basketball|soccer|tennis|pickleball|softball|baseball|volleyball|golf|football|hockey|climbing|bouldering|game|match|scrimmage)\b/, 'sport', null],
  [/\b(stretch|stretching|yoga|mobility|foam roll)/, 'mobility', null],
  [/\b(run|running|jog|jogging|hike|hiking|bike|biking|cycling|swim|swimming|elliptical|stairmaster|treadmill|sprint|jump rope|rowing|rower|erg|cardio)\b/, 'cardio', null],
  [/^(walk|walking)\b/, 'cardio', null],
  [/\b(leg raise|plank|crunch|crunche|sit up|situp|ab wheel|russian twist|core|abs?)\b/, 'strength', 'core'],
  [/\b(squat|lunge|leg|calf|deadlift|rdl|step up|hamstring|quad)/, 'strength', 'legs'],
  [/\b(hip thrust|glute|bridge)/, 'strength', 'glutes'],
  [/\b(bench|chest|push up|pushup|pec|fly|flye|dip|incline|decline)/, 'strength', 'chest'],
  [/\b(row|pull up|pullup|chin up|chinup|pulldown|pull down|lat|shrug|back)\b/, 'strength', 'back'],
  [/\b(overhead|ohp|shoulder|lateral raise|military|face pull|arnold|front raise)/, 'strength', 'shoulders'],
  [/\b(curl|tricep|bicep|skull|pushdown|extension)/, 'strength', 'arms'],
];

export function guessMeta(key: string): { category: Category | null; muscle_group: string | null } {
  for (const [re, category, muscle] of GUESSES) if (re.test(key)) return { category, muscle_group: muscle };
  return { category: null, muscle_group: null };
}

export function findExercise(db: DB, text: string): ExerciseRow | undefined {
  const key = nameKey(text);
  if (!key) return undefined;
  return (db.prepare('SELECT * FROM workouts_exercises WHERE name_key = ?').get(key) ??
    db.prepare('SELECT e.* FROM workouts_exercises e, json_each(e.aliases) a WHERE a.value = ? LIMIT 1').get(key)) as ExerciseRow | undefined;
}

export const getExercise = (db: DB, id: number): ExerciseRow | undefined =>
  db.prepare('SELECT * FROM workouts_exercises WHERE id = ?').get(id) as ExerciseRow | undefined;

/** Finds an exercise by name or alias, creating it on first use. */
export function ensureExercise(db: DB, text: string, hint: { category?: string; muscle_group?: string; fallbackCategory?: Category } = {}): ExerciseRow {
  const found = findExercise(db, text);
  if (found) {
    // A plan that states what the catalogue did not know fills the gap.
    if (!found.muscle_group && hint.muscle_group) {
      db.prepare('UPDATE workouts_exercises SET muscle_group = ?, updated_at = ? WHERE id = ?').run(hint.muscle_group.toLowerCase(), nowIso(), found.id);
      found.muscle_group = hint.muscle_group.toLowerCase();
    }
    return found;
  }
  const key = nameKey(text);
  if (!key) throw new ToolError(`"${text}" is not a usable exercise name.`);
  const clean = text.trim().replace(/\s+/g, ' ');
  const name = clean === clean.toLowerCase() ? clean.replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : clean;
  const guess = guessMeta(key);
  const now = nowIso();
  const id = Number(
    db.prepare('INSERT INTO workouts_exercises (name, name_key, category, muscle_group, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(name, key, hint.category ?? guess.category ?? hint.fallbackCategory ?? 'strength', (hint.muscle_group ?? guess.muscle_group)?.toLowerCase() ?? null, now, now).lastInsertRowid,
  );
  return getExercise(db, id)!;
}

export const aliasesOf = (e: ExerciseRow): string[] => {
  try {
    return JSON.parse(e.aliases) as string[];
  } catch {
    return [];
  }
};
export const exerciseOut = (e: ExerciseRow) => ({ id: e.id, name: e.name, category: e.category, muscle_group: e.muscle_group, notes: e.notes, aliases: aliasesOf(e) });

// ---- progression math ------------------------------------------------------------------

/** Estimated one-rep max, Epley: weight * (1 + reps / 30). A single is its own max. */
export function e1rm(weight: number | null, reps: number | null): number | null {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return round1(reps === 1 ? weight : weight * (1 + reps / 30));
}

export interface WorkSet extends SetRow { date: string }

/** Working (non-warmup) sets of an exercise from sessions that happened, oldest first. */
export function workingSets(db: DB, exerciseId: number): WorkSet[] {
  return db
    .prepare(
      `SELECT st.*, se.date FROM workouts_sets st JOIN workouts_sessions se ON se.id = st.session_id
       WHERE st.exercise_id = ? AND st.is_warmup = 0 AND se.status IN ('in_progress', 'completed')
       ORDER BY se.date, se.id, st.set_number, st.id`,
    )
    .all(exerciseId) as WorkSet[];
}

export interface SeriesPoint {
  session_id: number; date: string; sets: number;
  top_weight_lbs: number | null; top_weight_reps: number | null;
  e1rm_lbs: number | null; best_set: { weight_lbs: number; reps: number } | null;
  volume_lbs: number; total_reps: number;
  duration_seconds: number | null; distance_miles: number | null; pace_seconds_per_mile: number | null;
  summary: string;
}

/** One point per session: the top weight, the best e1RM, volume; totals for cardio. */
export function series(sets: WorkSet[]): SeriesPoint[] {
  const bySession = new Map<number, WorkSet[]>();
  for (const s of sets) bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), s]);
  return [...bySession.entries()].map(([session_id, ss]) => {
    let top: WorkSet | null = null;
    let best: { e: number; s: WorkSet } | null = null;
    let volume = 0, reps = 0, dur = 0, dist = 0, paceDur = 0, paceDist = 0;
    for (const s of ss) {
      if (s.weight_lbs && s.reps && (!top || s.weight_lbs > top.weight_lbs! || (s.weight_lbs === top.weight_lbs && s.reps > top.reps!))) top = s;
      const e = e1rm(s.weight_lbs, s.reps);
      if (e != null && (!best || e > best.e)) best = { e, s };
      volume += (s.weight_lbs ?? 0) * (s.reps ?? 0);
      reps += s.reps ?? 0;
      dur += s.duration_seconds ?? 0;
      dist += s.distance_miles ?? 0;
      if (s.duration_seconds && s.distance_miles) {
        paceDur += s.duration_seconds;
        paceDist += s.distance_miles;
      }
    }
    return {
      session_id, date: ss[0]!.date, sets: ss.length,
      top_weight_lbs: top?.weight_lbs ?? null, top_weight_reps: top?.reps ?? null,
      e1rm_lbs: best?.e ?? null, best_set: best ? { weight_lbs: best.s.weight_lbs!, reps: best.s.reps! } : null,
      volume_lbs: round1(volume), total_reps: reps,
      duration_seconds: dur || null, distance_miles: dist ? Math.round(dist * 100) / 100 : null,
      pace_seconds_per_mile: paceDist ? Math.round(paceDur / paceDist) : null,
      summary: setsSummary(ss),
    };
  });
}

export interface Prs {
  weight: { weight_lbs: number; reps: number; date: string; session_id: number } | null;
  e1rm: { e1rm_lbs: number; weight_lbs: number; reps: number; date: string; session_id: number } | null;
  reps: { reps: number; weight_lbs: number | null; date: string; session_id: number } | null;
  volume: { volume_lbs: number; date: string; session_id: number } | null;
  distance: { distance_miles: number; duration_seconds: number | null; date: string; session_id: number } | null;
  pace: { pace_seconds_per_mile: number; distance_miles: number; duration_seconds: number; date: string; session_id: number } | null;
}

/** Personal records. Sets arrive oldest first and a tie keeps the earlier one: the day it was first done. */
export function prs(sets: WorkSet[]): Prs {
  const out: Prs = { weight: null, e1rm: null, reps: null, volume: null, distance: null, pace: null };
  for (const s of sets) {
    const at = { date: s.date, session_id: s.session_id };
    if (s.weight_lbs && s.reps) {
      if (!out.weight || s.weight_lbs > out.weight.weight_lbs) out.weight = { weight_lbs: s.weight_lbs, reps: s.reps, ...at };
      const e = e1rm(s.weight_lbs, s.reps)!;
      if (!out.e1rm || e > out.e1rm.e1rm_lbs) out.e1rm = { e1rm_lbs: e, weight_lbs: s.weight_lbs, reps: s.reps, ...at };
    }
    if (s.reps && (!out.reps || s.reps > out.reps.reps)) out.reps = { reps: s.reps, weight_lbs: s.weight_lbs, ...at };
    if (s.distance_miles && (!out.distance || s.distance_miles > out.distance.distance_miles)) out.distance = { distance_miles: s.distance_miles, duration_seconds: s.duration_seconds, ...at };
    if (s.distance_miles && s.duration_seconds) {
      const pace = Math.round(s.duration_seconds / s.distance_miles);
      if (!out.pace || pace < out.pace.pace_seconds_per_mile) out.pace = { pace_seconds_per_mile: pace, distance_miles: s.distance_miles, duration_seconds: s.duration_seconds, ...at };
    }
  }
  for (const p of series(sets)) if (p.volume_lbs > 0 && (!out.volume || p.volume_lbs > out.volume.volume_lbs)) out.volume = { volume_lbs: p.volume_lbs, date: p.date, session_id: p.session_id };
  return out;
}

export interface Previous {
  session_id: number; date: string; summary: string;
  sets: { reps: number | null; weight_lbs: number | null; duration_seconds: number | null; distance_miles: number | null; rpe: number | null }[];
}

/** The working sets of the last session before `date` that included the exercise. */
export function previousPerformance(db: DB, exerciseId: number, date: string): Previous | null {
  const last = db
    .prepare(
      `SELECT se.id, se.date FROM workouts_sets st JOIN workouts_sessions se ON se.id = st.session_id
       WHERE st.exercise_id = ? AND st.is_warmup = 0 AND se.status IN ('in_progress', 'completed') AND se.date < ?
       ORDER BY se.date DESC, se.id DESC LIMIT 1`,
    )
    .get(exerciseId, date) as { id: number; date: string } | undefined;
  if (!last) return null;
  const sets = db.prepare('SELECT * FROM workouts_sets WHERE session_id = ? AND exercise_id = ? AND is_warmup = 0 ORDER BY set_number, id').all(last.id, exerciseId) as SetRow[];
  return {
    session_id: last.id, date: last.date, summary: setsSummary(sets),
    sets: sets.map((s) => ({ reps: s.reps, weight_lbs: s.weight_lbs, duration_seconds: s.duration_seconds, distance_miles: s.distance_miles, rpe: s.rpe })),
  };
}

export interface Suggestion { action: 'start' | 'increase' | 'repeat'; weight_lbs: number | null; text: string }

const LOWER_BODY = new Set(['legs', 'glutes']);

// The progression rule, deliberately simple:
//   - no history: start at the plan's target weight;
//   - last time every working set reached the top of the target rep range (and
//     there were at least target_sets of them): add 10 lb for legs and glutes,
//     5 lb for everything else, to the heaviest weight used;
//   - otherwise: repeat the heaviest weight used last time.
// Bodyweight and cardio work repeat the last performance. Kevin can reason
// past this with SQL; this is the default shown beside each planned exercise.
export function suggest(pe: PlanExerciseRow, prev: Previous | null, exercise: Pick<ExerciseRow, 'category' | 'muscle_group'>): Suggestion {
  if (!prev) return { action: 'start', weight_lbs: pe.target_weight_lbs, text: pe.target_weight_lbs ? `Start at ${fmtNum(pe.target_weight_lbs)} lb` : 'First time: pick a starting point' };
  const weights = prev.sets.map((s) => s.weight_lbs ?? 0);
  const last = Math.max(0, ...weights);
  if (exercise.category !== 'strength' || !last) return { action: 'repeat', weight_lbs: null, text: `Match or beat ${prev.summary}` };
  const top = pe.target_reps_max ?? pe.target_reps_min;
  const hit = top != null && prev.sets.length >= (pe.target_sets ?? 1) && prev.sets.every((s) => (s.reps ?? 0) >= top);
  if (hit) {
    const step = LOWER_BODY.has(exercise.muscle_group ?? '') ? 10 : 5;
    return { action: 'increase', weight_lbs: last + step, text: `Go to ${fmtNum(last + step)} lb (+${step}): hit ${prev.summary}` };
  }
  return { action: 'repeat', weight_lbs: last, text: `Repeat ${fmtNum(last)} lb: last was ${prev.summary}` };
}

// ---- plans and the schedule ----------------------------------------------------------------

export const getPlan = (db: DB, id: number): PlanRow | undefined => db.prepare('SELECT * FROM workouts_plans WHERE id = ?').get(id) as PlanRow | undefined;
export const activePlan = (db: DB): PlanRow | undefined => db.prepare('SELECT * FROM workouts_plans WHERE is_active = 1').get() as PlanRow | undefined;
export const getPlanDay = (db: DB, id: number): PlanDayRow | undefined => db.prepare('SELECT * FROM workouts_plan_days WHERE id = ?').get(id) as PlanDayRow | undefined;
export const getSession = (db: DB, id: number): SessionRow | undefined => db.prepare('SELECT * FROM workouts_sessions WHERE id = ?').get(id) as SessionRow | undefined;

/** The plan whose schedule applies on a date: the one that was active then. */
export function governingPlan(db: DB, date: string): PlanRow | undefined {
  return db
    .prepare(
      `SELECT * FROM workouts_plans WHERE active_from IS NOT NULL AND active_from <= ? AND (active_until IS NULL OR active_until > ?)
       ORDER BY active_from DESC, id DESC LIMIT 1`,
    )
    .get(date, date) as PlanRow | undefined;
}

export type PlannedExercise = PlanExerciseRow & { exercise: string; category: string; muscle_group: string | null };
export function planExercises(db: DB, planDayId: number): PlannedExercise[] {
  return db
    .prepare(
      `SELECT pe.*, e.name AS exercise, e.category, e.muscle_group FROM workouts_plan_exercises pe
       JOIN workouts_exercises e ON e.id = pe.exercise_id WHERE pe.plan_day_id = ? ORDER BY pe.position, pe.id`,
    )
    .all(planDayId) as PlannedExercise[];
}

export const plannedOut = (pe: PlannedExercise) => ({
  id: pe.id, position: pe.position, exercise_id: pe.exercise_id, exercise: pe.exercise, category: pe.category, muscle_group: pe.muscle_group,
  target_sets: pe.target_sets, target_reps_min: pe.target_reps_min, target_reps_max: pe.target_reps_max, target_weight_lbs: pe.target_weight_lbs,
  target_duration_seconds: pe.target_duration_seconds, target_distance_miles: pe.target_distance_miles, target_rpe: pe.target_rpe,
  rest_seconds: pe.rest_seconds, notes: pe.notes, target: targetText(pe),
});

export function planOut(db: DB, p: PlanRow) {
  const days = db.prepare('SELECT * FROM workouts_plan_days WHERE plan_id = ? ORDER BY (weekday + 6) % 7').all(p.id) as PlanDayRow[];
  return {
    id: p.id, name: p.name, goal: p.goal, notes: p.notes, is_active: !!p.is_active, active_from: p.active_from, active_until: p.active_until,
    archived: !!p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
    days: days.map((d) => ({
      id: d.id, weekday: d.weekday, weekday_key: WEEKDAY_KEYS[d.weekday]!, weekday_name: WEEKDAY_NAMES[d.weekday]!, name: d.name, notes: d.notes,
      exercises: planExercises(db, d.id).map(plannedOut),
    })),
  };
}

export type DayStatus = 'rest' | 'planned' | 'in_progress' | 'completed' | 'skipped' | 'missed';
/** One workout on a date: a plan day (with the sessions that fulfil it) or a session outside the plan. */
export interface DayItem {
  planDay: PlanDayRow | undefined;
  title: string;
  sessions: SessionRow[];
  /** Set when the plan day is here by a one-off move. */
  movedFrom: string | null;
  status: Exclude<DayStatus, 'rest'>;
  /** Counts toward adherence: a plan day, or a one-off session that was planned or skipped. */
  expected: boolean;
}
export interface DayInfo {
  date: string; sessions: SessionRow[]; plan: PlanRow | undefined;
  /** The weekday's plan day first (unless moved away), then plan days moved here, then sessions outside the plan. */
  items: DayItem[];
  /** What the day is about right now: the workout under way, else the first one still to do, else the first expected. */
  primary: DayItem | undefined;
  status: DayStatus;
}

const PENDING = new Set<DayStatus>(['planned', 'missed']);
export const isPending = (i: DayItem): boolean => PENDING.has(i.status);

export function dayInfo(db: DB, date: string, today: string): DayInfo {
  const sessions = db.prepare('SELECT * FROM workouts_sessions WHERE date = ? ORDER BY id').all(date) as SessionRow[];
  const plan = governingPlan(db, date);
  let scheduled = plan ? (db.prepare('SELECT * FROM workouts_plan_days WHERE plan_id = ? AND weekday = ?').get(plan.id, weekdayOf(date)) as PlanDayRow | undefined) : undefined;
  if (scheduled && db.prepare('SELECT 1 FROM workouts_sessions WHERE plan_day_id = ? AND moved_from_date = ? AND date <> ?').get(scheduled.id, date, date)) scheduled = undefined;

  const items: DayItem[] = [];
  const add = (planDay: PlanDayRow | undefined, ss: SessionRow[]) => {
    const has = (st: SessionStatus) => ss.some((s) => s.status === st);
    const status = has('in_progress') ? 'in_progress' : has('completed') ? 'completed' : has('skipped') ? 'skipped' : date < today ? 'missed' : 'planned';
    items.push({
      planDay, sessions: ss, status,
      title: planDay?.name ?? ss[0]?.title ?? 'Workout',
      movedFrom: ss.find((s) => s.moved_from_date)?.moved_from_date ?? null,
      expected: !!planDay || status === 'planned' || status === 'missed' || status === 'skipped',
    });
  };
  if (scheduled) add(scheduled, sessions.filter((s) => s.plan_day_id === scheduled!.id));
  for (const id of new Set(sessions.filter((s) => s.plan_day_id != null && s.plan_day_id !== scheduled?.id).map((s) => s.plan_day_id!))) {
    add(getPlanDay(db, id), sessions.filter((s) => s.plan_day_id === id));
  }
  for (const s of sessions) if (s.plan_day_id == null) add(undefined, [s]);

  // The day is done only when everything expected of it is; a game logged
  // beside an unfinished Push day leaves the day open.
  const expected = items.filter((i) => i.expected);
  const pool = expected.length ? expected : items;
  const any = (st: DayStatus) => pool.some((i) => i.status === st);
  const status: DayStatus = !items.length ? 'rest'
    : items.some((i) => i.status === 'in_progress') ? 'in_progress'
    : any('planned') ? 'planned' : any('missed') ? 'missed' : any('completed') ? 'completed' : 'skipped';
  const primary = items.find((i) => i.status === 'in_progress') ?? expected.find(isPending) ?? expected[0] ?? items.at(-1);
  return { date, sessions, plan, items, primary, status };
}

export interface WeekAdherence {
  week_start: string; week_end: string; is_current: boolean;
  /** Workouts expected in the week: plan days, plus one-off sessions that were planned or skipped. */
  planned: number;
  /** Expected workouts that were done. */
  completed: number;
  skipped: number; missed: number;
  /** Expected workouts still ahead (today included) and not yet done. */
  remaining: number;
  /** Completed sessions outside the plan. */
  extra: number;
  /** completed / planned as a whole percent; null when nothing was planned. */
  pct: number | null;
}

export function weekAdherence(db: DB, weekStart: string, today: string, days?: DayInfo[]): WeekAdherence {
  const out: WeekAdherence = {
    week_start: weekStart, week_end: addDays(weekStart, 6), is_current: mondayOf(today) === weekStart,
    planned: 0, completed: 0, skipped: 0, missed: 0, remaining: 0, extra: 0, pct: null,
  };
  for (let i = 0; i < 7; i++) {
    for (const item of (days?.[i] ?? dayInfo(db, addDays(weekStart, i), today)).items) {
      if (!item.expected) {
        if (item.status === 'completed') out.extra++;
        continue;
      }
      out.planned++;
      if (item.status === 'completed') out.completed++;
      else if (item.status === 'skipped') out.skipped++;
      else if (item.status === 'missed') out.missed++;
      else out.remaining++;
    }
  }
  out.pct = out.planned ? Math.round((100 * out.completed) / out.planned) : null;
  return out;
}

// ---- sessions ------------------------------------------------------------------------------

export function sessionOut(db: DB, s: SessionRow, withSets = true) {
  const rows = db
    .prepare(
      `SELECT st.*, e.name AS exercise, e.category, e.muscle_group FROM workouts_sets st
       JOIN workouts_exercises e ON e.id = st.exercise_id WHERE st.session_id = ? ORDER BY st.id`,
    )
    .all(s.id) as (SetRow & { exercise: string; category: string; muscle_group: string | null })[];
  const groups = new Map<number, typeof rows>();
  for (const r of rows) groups.set(r.exercise_id, [...(groups.get(r.exercise_id) ?? []), r]);
  const planDay = s.plan_day_id != null ? getPlanDay(db, s.plan_day_id) : undefined;
  return {
    id: s.id, date: s.date, weekday_name: weekdayName(s.date), title: s.title, status: s.status,
    plan_day_id: s.plan_day_id, plan_day_name: planDay?.name ?? null, notes: s.notes,
    duration_minutes: s.duration_minutes, perceived_effort: s.perceived_effort, moved_from_date: s.moved_from_date,
    started_at: s.started_at, completed_at: s.completed_at, created_at: s.created_at, updated_at: s.updated_at,
    set_count: rows.length,
    volume_lbs: round1(rows.reduce((t, r) => t + (r.is_warmup ? 0 : (r.weight_lbs ?? 0) * (r.reps ?? 0)), 0)),
    exercises: [...groups.values()].map((g) => {
      const sorted = [...g].sort((a, b) => a.set_number - b.set_number || a.id - b.id);
      const first = sorted[0]!;
      return {
        exercise_id: first.exercise_id, exercise: first.exercise, category: first.category, muscle_group: first.muscle_group,
        set_count: sorted.length, summary: setsSummary(sorted),
        ...(withSets
          ? {
              sets: sorted.map((r) => ({
                id: r.id, set_number: r.set_number, reps: r.reps, weight_lbs: r.weight_lbs, duration_seconds: r.duration_seconds,
                distance_miles: r.distance_miles, rpe: r.rpe, is_warmup: !!r.is_warmup, notes: r.notes, e1rm_lbs: e1rm(r.weight_lbs, r.reps),
              })),
            }
          : {}),
      };
    }),
  };
}

/** Makes set_number 1..n again for one exercise in one session, keeping order. */
export function renumber(db: DB, sessionId: number, exerciseId: number): void {
  const ids = db.prepare('SELECT id FROM workouts_sets WHERE session_id = ? AND exercise_id = ? ORDER BY set_number, id').all(sessionId, exerciseId) as { id: number }[];
  const upd = db.prepare('UPDATE workouts_sets SET set_number = ? WHERE id = ?');
  ids.forEach((r, i) => upd.run(i + 1, r.id));
}

/** Planned exercises with what was logged, last time's sets and the suggested target; then anything logged off-plan. */
export function exerciseCards(db: DB, planDay: PlanDayRow | undefined, session: ReturnType<typeof sessionOut> | null, date: string) {
  const logged = session?.exercises ?? [];
  const planned = planDay ? planExercises(db, planDay.id) : [];
  const cards = planned.map((pe) => {
    const sets = logged.find((g) => g.exercise_id === pe.exercise_id)?.sets ?? [];
    const prev = previousPerformance(db, pe.exercise_id, date);
    return {
      exercise_id: pe.exercise_id, exercise: pe.exercise, category: pe.category, muscle_group: pe.muscle_group,
      planned: plannedOut(pe) as ReturnType<typeof plannedOut> | null,
      logged_sets: sets,
      previous: prev,
      suggestion: suggest(pe, prev, pe) as Suggestion | null,
      done: sets.filter((s) => !s.is_warmup).length >= (pe.target_sets ?? 1),
    };
  });
  for (const g of logged) {
    if (planned.some((pe) => pe.exercise_id === g.exercise_id)) continue;
    cards.push({
      exercise_id: g.exercise_id, exercise: g.exercise, category: g.category, muscle_group: g.muscle_group,
      planned: null, logged_sets: g.sets ?? [], previous: previousPerformance(db, g.exercise_id, date), suggestion: null, done: true,
    });
  }
  return cards;
}
