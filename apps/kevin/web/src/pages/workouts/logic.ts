// The parts of the Workouts page that can be wrong: what a set row is
// pre-filled with, the rest timer, where a logged set is sent, and turning
// the plan editor's draft into workout_plan_save's input. Pure functions.
import type { DayStatus, DayWorkout, ExerciseCard, LoggedSet, Plan, PlannedExercise, WeekdayKey } from './types';

// ---- numbers, durations, dates ---------------------------------------------------

export const fmtNum = (n: number): string => String(Math.round(n * 100) / 100);

/** 1050 -> "17:30", 3725 -> "1:02:05". */
export function fmtDuration(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "17:30" -> 1050, "1:02:05" -> 3725, "45" -> 2700 (a bare number is minutes). null when it is not a time. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60) || null;
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2})$/.exec(t);
  if (!m) return null;
  const sec = Number(m[3]);
  if (sec > 59) return null;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + sec) || null;
}

/** A typed number, or null when the box is empty or not a number. */
export function parseNum(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "8:45/mi" */
export const fmtPace = (secondsPerMile: number): string => `${fmtDuration(secondsPerMile)}/mi`;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** "Nov 14" for a stored YYYY-MM-DD. */
export function monthDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Saturday" for a stored YYYY-MM-DD. */
export function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Weeks start on Monday. */
export function mondayOf(date: string): string {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

/** "This week", "Last week", "3 weeks ago", "Next week", "In 2 weeks". */
export function weekLabel(weekStart: string, today: string): string {
  const n = Math.round((Date.parse(`${mondayOf(weekStart)}T00:00:00Z`) - Date.parse(`${mondayOf(today)}T00:00:00Z`)) / (7 * 86_400_000));
  if (n === 0) return 'This week';
  if (n === -1) return 'Last week';
  if (n === 1) return 'Next week';
  return n < 0 ? `${-n} weeks ago` : `In ${n} weeks`;
}

/** A day mid-sentence: "today", "tomorrow", "yesterday" lose their capital; "Sat, Nov 7" keeps its own. */
export const dayPhrase = (label: string): string => (/^(Today|Tomorrow|Yesterday)$/.test(label) ? label.toLowerCase() : label);

export const WEEK: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL: Record<WeekdayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// ---- a set, in words ---------------------------------------------------------------

type SetLike = Pick<LoggedSet, 'reps' | 'weight_lbs' | 'duration_seconds' | 'distance_miles'>;

/** "185 lb × 5", "12 reps", "2 mi in 17:30". */
export function setText(s: SetLike): string {
  if (s.reps != null) return s.weight_lbs ? `${fmtNum(s.weight_lbs)} lb × ${s.reps}` : `${s.reps} ${s.reps === 1 ? 'rep' : 'reps'}`;
  const dist = s.distance_miles != null ? `${fmtNum(s.distance_miles)} mi` : '';
  const dur = s.duration_seconds != null ? fmtDuration(s.duration_seconds) : '';
  return dist && dur ? `${dist} in ${dur}` : dist || dur || 'Done';
}

// ---- logging a set -------------------------------------------------------------------

/** How a row is entered: weight and reps, or time and distance. */
export type SetKind = 'reps' | 'time';

type CardLike = Pick<ExerciseCard, 'category' | 'planned' | 'logged_sets' | 'previous' | 'suggestion'>;

/** What the exercise's own data says it is measured in; its category decides only when nothing else does. */
export function setKind(card: Pick<CardLike, 'category' | 'planned' | 'logged_sets' | 'previous'>): SetKind {
  if (card.logged_sets.length) return card.logged_sets.some((s) => s.reps != null) ? 'reps' : 'time';
  const p = card.planned;
  if (p) {
    if (p.target_reps_min != null) return 'reps';
    if (p.target_duration_seconds != null || p.target_distance_miles != null) return 'time';
  }
  if (card.previous?.sets.length) return card.previous.sets.some((s) => s.reps != null) ? 'reps' : 'time';
  return card.category === 'strength' ? 'reps' : 'time';
}

/** The text in the row's boxes. Empty means "not given": bodyweight, or no distance. */
export interface SetDraft {
  weight: string;
  reps: string;
  duration: string;
  distance: string;
}

const str = (n: number | null | undefined): string => (n == null ? '' : fmtNum(n));

/**
 * What the next set's row starts with, so logging is usually one tap:
 * - after a set today: the same again;
 * - first set: the suggested weight (else the plan's, else last time's heaviest),
 *   with last time's reps for that set when repeating a weight, never below
 *   the bottom of the rep range, and the bottom of the range after an increase;
 * - time and distance: the last bout today, else the plan's target, else last time's.
 */
export function prefill(card: CardLike, kind: SetKind = setKind(card)): SetDraft {
  const out: SetDraft = { weight: '', reps: '', duration: '', distance: '' };
  const p = card.planned;
  const working = card.logged_sets.filter((s) => !s.is_warmup);
  const last = working.at(-1) ?? card.logged_sets.at(-1);
  if (kind === 'time') {
    const planned = !last && p && (p.target_duration_seconds != null || p.target_distance_miles != null);
    const src = last ?? (planned ? { duration_seconds: p.target_duration_seconds, distance_miles: p.target_distance_miles } : card.previous?.sets[0]);
    out.duration = src?.duration_seconds != null ? fmtDuration(src.duration_seconds) : '';
    out.distance = str(src?.distance_miles);
    return out;
  }
  if (last && last.reps != null) {
    out.weight = str(last.weight_lbs);
    out.reps = String(last.reps);
    return out;
  }
  const prev = card.previous?.sets.filter((s) => s.reps != null) ?? [];
  const prevTop = Math.max(0, ...prev.map((s) => s.weight_lbs ?? 0));
  out.weight = str(card.suggestion?.weight_lbs ?? p?.target_weight_lbs ?? (prevTop || null));
  const prevReps = (prev[working.length] ?? prev.at(-1))?.reps ?? null;
  const min = p?.target_reps_min ?? null;
  const reps = card.suggestion?.action === 'increase' ? (min ?? prevReps) : prevReps != null ? Math.max(prevReps, min ?? 0) : min;
  out.reps = reps == null ? '' : String(reps);
  return out;
}

/** A stepper press: the box's number plus `delta`, never below `min`. An empty box counts from zero. */
export function step(text: string, delta: number, min = 0): string {
  const n = parseNum(text) ?? 0;
  return fmtNum(Math.max(min, n + delta));
}

/** A stepper press on a time box, in seconds. */
export function stepDuration(text: string, delta: number): string {
  return fmtDuration(Math.max(0, (parseDuration(text) ?? 0) + delta));
}

export interface LogEntry {
  exercise: string;
  reps?: number;
  weight_lbs?: number;
  duration_seconds?: number;
  distance_miles?: number;
}

/** The row as one workout_log entry, or why it cannot be logged yet. */
export function logEntry(exercise: string, kind: SetKind, d: SetDraft): { entry: LogEntry } | { error: string } {
  const name = exercise.trim();
  if (!name) return { error: 'Choose an exercise.' };
  if (kind === 'reps') {
    const reps = parseNum(d.reps);
    if (reps == null || !Number.isInteger(reps) || reps > 1000) return { error: 'Enter the reps.' };
    const weight = d.weight.trim() ? parseNum(d.weight) : 0;
    if (weight == null || weight > 2000) return { error: 'That weight doesn’t look right.' };
    return { entry: { exercise: name, reps, ...(weight > 0 ? { weight_lbs: weight } : {}) } };
  }
  const duration = d.duration.trim() ? parseDuration(d.duration) : undefined;
  const distance = d.distance.trim() ? parseNum(d.distance) : undefined;
  if (duration === null) return { error: 'Write the time as minutes:seconds, like 17:30.' };
  if (distance === null || (distance != null && distance > 500)) return { error: 'That distance doesn’t look right.' };
  if (!duration && !distance) return { error: 'Enter a time or a distance.' };
  return { entry: { exercise: name, ...(duration ? { duration_seconds: duration } : {}), ...(distance ? { distance_miles: distance } : {}) } };
}

/** The fields of a logged set as a workout_edit patch: an emptied box clears the value. */
export function setPatch(setId: number, kind: SetKind, d: SetDraft, extra: { rpe: string; warmup: boolean }): { patch: Record<string, unknown> } | { error: string } {
  const rpe = extra.rpe.trim() ? parseNum(extra.rpe) : undefined;
  if (rpe === null || (rpe != null && (rpe < 1 || rpe > 10))) return { error: 'Effort is a number from 1 to 10.' };
  const base = { set_id: setId, rpe: rpe ?? null, warmup: extra.warmup };
  if (kind === 'reps') {
    const r = logEntry('x', 'reps', d);
    if ('error' in r) return r;
    return { patch: { ...base, reps: r.entry.reps, weight_lbs: r.entry.weight_lbs ?? null } };
  }
  const r = logEntry('x', 'time', d);
  if ('error' in r) return r;
  return { patch: { ...base, duration_seconds: r.entry.duration_seconds ?? null, distance_miles: r.entry.distance_miles ?? null } };
}

/**
 * Where a logged set goes. The focused session when there is one (so sets
 * never land in a different workout of the same day, and a finished session
 * can be added to); otherwise the date and its plan day. `separate` starts a
 * second session on a date that already has a finished one.
 */
export function logTarget(day: { date: string; session: { id: number } | null; plan_day: { id: number } | null }, separate = false): Record<string, unknown> {
  if (separate) return { date: day.date, new_session: true };
  if (day.session) return { session_id: day.session.id };
  return day.plan_day ? { date: day.date, plan_day: day.plan_day.id } : { date: day.date };
}

/** The server takes the viewed date as "today", so a past date it calls planned is really missed. */
export function shownStatus(status: DayStatus, date: string, today: string): DayStatus {
  return status === 'planned' && date < today ? 'missed' : status;
}

// ---- rest timer -------------------------------------------------------------------------

export interface Rest {
  exercise: string;
  /** Seconds the rest was set for, including any time added. */
  total: number;
  /** Epoch ms when it ends. */
  endsAt: number;
}

export const DEFAULT_REST_SECONDS = 90;

/** The rest after a set: the plan's rest_seconds, a default for lifts that state none, nothing after a run. */
export function restSeconds(planned: Pick<PlannedExercise, 'rest_seconds'> | null, kind: SetKind): number | null {
  const s = planned?.rest_seconds;
  if (s != null) return s > 0 ? s : null;
  return kind === 'reps' ? DEFAULT_REST_SECONDS : null;
}

export const startRest = (now: number, seconds: number, exercise: string): Rest => ({ exercise, total: seconds, endsAt: now + seconds * 1000 });

/** +30 s / -30 s. Never ends in the past, and time added to a finished rest counts from now. */
export function adjustRest(rest: Rest, deltaSeconds: number, now: number): Rest {
  const left = Math.max(0, rest.endsAt - now);
  const next = Math.max(0, left + deltaSeconds * 1000);
  return { ...rest, endsAt: now + next, total: Math.max(1, rest.total + (next - left) / 1000) };
}

export function restState(rest: Rest, now: number): { remaining: number; fraction: number; done: boolean } {
  const ms = rest.endsAt - now;
  const remaining = Math.max(0, Math.ceil(ms / 1000));
  return { remaining, fraction: Math.min(1, Math.max(0, 1 - ms / (rest.total * 1000))), done: ms <= 0 };
}

// ---- moving a workout within its week ----------------------------------------------------

/** The days a pending workout can move to: the rest of its week from today on. */
export function moveTargets(weekDates: string[], from: string, today: string): string[] {
  return weekDates.filter((d) => d !== from && d >= today);
}

/**
 * workout_log input that moves a workout. A plan day with no session yet
 * gets a planned session on the new date carrying moved_from; one that is
 * already a planned session (moved before, or a one-off) is re-dated.
 */
export function moveInput(item: Pick<DayWorkout, 'plan_day' | 'session_ids'>, from: string, to: string): Record<string, unknown> | null {
  const sessionId = item.session_ids.at(-1);
  if (sessionId != null) return { session_id: sessionId, date: to };
  if (!item.plan_day) return null;
  return { date: to, plan_day: item.plan_day.id, status: 'planned', moved_from: item.plan_day.moved_from_date ?? from };
}

// ---- plan editor ---------------------------------------------------------------------------

export interface ExerciseDraft {
  key: number;
  exercise: string;
  kind: SetKind;
  sets: string;
  /** "5" or "8-12" */
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  /** Seconds, as text; '' for none. */
  rest: string;
  notes: string;
}

export interface DayDraft {
  weekday: WeekdayKey;
  name: string;
  notes: string;
  exercises: ExerciseDraft[];
}

export interface PlanDraft {
  /** null for a plan that does not exist yet. */
  plan_id: number | null;
  name: string;
  goal: string;
  notes: string;
  /** New plans only: make it the active plan on save. */
  activate: boolean;
  days: DayDraft[];
}

let nextKey = 1;
export const newKey = (): number => nextKey++;

export const emptyExercise = (kind: SetKind = 'reps'): ExerciseDraft => ({
  key: newKey(), exercise: '', kind, sets: kind === 'reps' ? '3' : '', reps: kind === 'reps' ? '8-12' : '', weight: '', duration: '', distance: '', rest: kind === 'reps' ? '90' : '', notes: '',
});

export const emptyPlan = (): PlanDraft => ({ plan_id: null, name: '', goal: '', notes: '', activate: true, days: [] });

export function exerciseDraft(pe: PlannedExercise): ExerciseDraft {
  const kind: SetKind = pe.target_reps_min != null ? 'reps' : pe.target_duration_seconds != null || pe.target_distance_miles != null ? 'time' : pe.category === 'strength' ? 'reps' : 'time';
  return {
    key: newKey(),
    exercise: pe.exercise,
    kind,
    sets: str(pe.target_sets),
    reps: pe.target_reps_min == null ? '' : pe.target_reps_max != null && pe.target_reps_max !== pe.target_reps_min ? `${pe.target_reps_min}-${pe.target_reps_max}` : String(pe.target_reps_min),
    weight: str(pe.target_weight_lbs),
    duration: pe.target_duration_seconds != null ? fmtDuration(pe.target_duration_seconds) : '',
    distance: str(pe.target_distance_miles),
    rest: str(pe.rest_seconds),
    notes: pe.notes ?? '',
  };
}

export function planDraft(plan: Plan): PlanDraft {
  return {
    plan_id: plan.id,
    name: plan.name,
    goal: plan.goal ?? '',
    notes: plan.notes ?? '',
    activate: plan.is_active,
    days: sortDays(plan.days.map((d) => ({ weekday: d.weekday_key, name: d.name, notes: d.notes ?? '', exercises: d.exercises.map(exerciseDraft) }))),
  };
}

export const sortDays = (days: DayDraft[]): DayDraft[] => [...days].sort((a, b) => WEEK.indexOf(a.weekday) - WEEK.indexOf(b.weekday));

/** Up/down reordering: the item at `index` trades places with its neighbour. Out of range leaves the list as it was. */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

/** Puts a day on another weekday. A day already there trades places with it. */
export function moveDay(days: DayDraft[], from: WeekdayKey, to: WeekdayKey): DayDraft[] {
  if (from === to) return days;
  return sortDays(days.map((d) => (d.weekday === from ? { ...d, weekday: to } : d.weekday === to ? { ...d, weekday: from } : d)));
}

/** "5" -> 5, "8-12" -> "8-12" (the tool's two spellings); null when it is neither or runs backwards. */
export function parseReps(text: string): number | string | null {
  const m = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  if (lo < 1) return null;
  if (m[2] == null) return lo;
  const hi = Number(m[2]);
  if (hi < lo) return null;
  return hi === lo ? lo : `${lo}-${hi}`;
}

/** "3x8-12 @ 135 lb", "2 mi in 18:00": an exercise draft the way the plan reads. */
export function draftTarget(x: ExerciseDraft): string {
  const sets = parseNum(x.sets);
  if (x.kind === 'reps') {
    const reps = parseReps(x.reps);
    const base = reps != null ? (sets ? `${sets}x${reps}` : `${reps} reps`) : sets ? `${sets} sets` : '';
    const w = parseNum(x.weight);
    return [base, w ? `@ ${fmtNum(w)} lb` : ''].filter(Boolean).join(' ');
  }
  const dur = parseDuration(x.duration);
  const dist = parseNum(x.distance);
  const cardio = [dist ? `${fmtNum(dist)} mi` : '', dur ? fmtDuration(dur) : ''].filter(Boolean).join(' in ');
  return sets && sets > 1 && cardio ? `${sets} x ${cardio}` : cardio;
}

/** Why one exercise of a plan cannot be saved, or null. */
export function exerciseError(x: ExerciseDraft): string | null {
  if (!x.exercise.trim()) return 'Name the exercise.';
  if (x.exercise.trim().length > 80) return 'That name is too long.';
  if (x.sets.trim()) {
    const n = parseNum(x.sets);
    if (n == null || !Number.isInteger(n) || n < 1 || n > 20) return 'Sets is a whole number from 1 to 20.';
  }
  if (x.kind === 'reps') {
    if (x.reps.trim() && parseReps(x.reps) == null) return 'Write reps as a number (5) or a range (8-12).';
    if (x.weight.trim()) {
      const w = parseNum(x.weight);
      if (w == null || w > 2000) return 'That weight doesn’t look right.';
    }
  } else {
    if (x.duration.trim() && parseDuration(x.duration) == null) return 'Write the time as minutes:seconds, like 30:00.';
    if (x.distance.trim()) {
      const d = parseNum(x.distance);
      if (d == null || d > 500) return 'That distance doesn’t look right.';
    }
  }
  if (x.rest.trim()) {
    const r = parseNum(x.rest);
    if (r == null || !Number.isInteger(r) || r > 3600) return 'Rest is in seconds, up to 3600.';
  }
  return null;
}

/** The whole draft as workout_plan_save's input (days and exercises replace what is stored), or the first thing wrong with it. */
export function planInput(d: PlanDraft): { input: Record<string, unknown> } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: 'Give the plan a name.' };
  if (!d.days.length) return { error: 'Add at least one training day.' };
  const seen = new Set<WeekdayKey>();
  const days: Record<string, unknown>[] = [];
  for (const day of sortDays(d.days)) {
    const label = WEEKDAY_LABEL[day.weekday];
    if (seen.has(day.weekday)) return { error: `Two days are on ${label}.` };
    seen.add(day.weekday);
    if (!day.name.trim()) return { error: `Name ${label}’s workout, like “Push” or “Run”.` };
    const exercises: Record<string, unknown>[] = [];
    for (const x of day.exercises) {
      const err = exerciseError(x);
      if (err) return { error: `${label}, ${x.exercise.trim() || 'an exercise'}: ${err}` };
      const sets = parseNum(x.sets);
      const rest = parseNum(x.rest);
      const out: Record<string, unknown> = { exercise: x.exercise.trim() };
      if (sets != null) out.sets = sets;
      if (x.kind === 'reps') {
        const reps = parseReps(x.reps);
        const weight = parseNum(x.weight);
        if (reps != null) out.reps = reps;
        if (weight) out.weight_lbs = weight;
      } else {
        const dur = parseDuration(x.duration);
        const dist = parseNum(x.distance);
        if (dur) out.duration_seconds = dur;
        if (dist) out.distance_miles = dist;
      }
      if (rest != null) out.rest_seconds = rest;
      if (x.notes.trim()) out.notes = x.notes.trim();
      exercises.push(out);
    }
    days.push({ weekday: day.weekday, name: day.name.trim(), ...(day.notes.trim() ? { notes: day.notes.trim() } : {}), exercises });
  }
  return {
    input: {
      ...(d.plan_id != null ? { plan_id: d.plan_id } : { activate: d.activate }),
      name,
      // Sent even when empty: an omitted goal keeps the stored one, so clearing it needs the empty string.
      goal: d.goal.trim(),
      notes: d.notes.trim(),
      days,
    },
  };
}

// ---- catalogue search -------------------------------------------------------------------------

const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Exercises whose name or an alias contains what was typed; names that start with it first. */
export function searchExercises<T extends { name: string; aliases: string[] }>(all: T[], q: string, limit = 30): T[] {
  const k = key(q);
  if (!k) return all.slice(0, limit);
  const hits = all.filter((e) => key(e.name).includes(k) || e.aliases.some((a) => a.includes(k)));
  const starts = (e: T) => (key(e.name).startsWith(k) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b)).slice(0, limit);
}

/** True when what was typed is already an exercise (by name or alias), so "Add new" is not offered. */
export function isKnownExercise(all: { name: string; aliases: string[] }[], q: string): boolean {
  const k = key(q);
  return all.some((e) => key(e.name) === k || e.aliases.includes(k));
}
