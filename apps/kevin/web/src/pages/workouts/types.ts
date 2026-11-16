// The shapes the workouts views and tools return. The server is the source of
// truth: server/src/domains/workouts.ts and _workouts/lib.ts.

export type DayStatus = 'rest' | 'planned' | 'in_progress' | 'completed' | 'skipped' | 'missed';
export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';
export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface LoggedSet {
  id: number;
  set_number: number;
  reps: number | null;
  weight_lbs: number | null;
  duration_seconds: number | null;
  distance_miles: number | null;
  rpe: number | null;
  is_warmup: boolean;
  notes: string | null;
  e1rm_lbs: number | null;
}

export interface SessionExercise {
  exercise_id: number;
  exercise: string;
  category: string;
  muscle_group: string | null;
  set_count: number;
  summary: string;
  /** Present on a full session (`workouts/session`, `today.session`, tool results), absent in lists. */
  sets?: LoggedSet[];
}

export interface Session {
  id: number;
  date: string;
  weekday_name: string;
  title: string;
  status: SessionStatus;
  plan_day_id: number | null;
  plan_day_name: string | null;
  notes: string | null;
  duration_minutes: number | null;
  perceived_effort: number | null;
  moved_from_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  set_count: number;
  volume_lbs: number;
  exercises: SessionExercise[];
}

export interface PlannedExercise {
  id: number;
  position: number;
  exercise_id: number;
  exercise: string;
  category: string;
  muscle_group: string | null;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_weight_lbs: number | null;
  target_duration_seconds: number | null;
  target_distance_miles: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  notes: string | null;
  /** "3x8-12 @ 135 lb" */
  target: string;
}

export interface PreviousSet {
  reps: number | null;
  weight_lbs: number | null;
  duration_seconds: number | null;
  distance_miles: number | null;
  rpe: number | null;
}

export interface Previous {
  session_id: number;
  date: string;
  summary: string;
  sets: PreviousSet[];
}

export interface Suggestion {
  action: 'start' | 'increase' | 'repeat';
  weight_lbs: number | null;
  text: string;
}

export interface ExerciseCard {
  exercise_id: number;
  exercise: string;
  category: string;
  muscle_group: string | null;
  planned: PlannedExercise | null;
  logged_sets: LoggedSet[];
  previous: Previous | null;
  suggestion: Suggestion | null;
  done: boolean;
}

export interface DayPlanDay {
  id: number;
  name: string;
  notes: string | null;
  weekday: number;
  moved_from_date: string | null;
  exercises: string[];
}

/** One workout of a day: a plan day with the sessions that fulfil it, or a session outside the plan. */
export interface DayWorkout {
  title: string;
  status: Exclude<DayStatus, 'rest'>;
  expected: boolean;
  plan_day: DayPlanDay | null;
  session_ids: number[];
}

export interface WeekAdherence {
  week_start: string;
  week_end: string;
  is_current: boolean;
  planned: number;
  completed: number;
  skipped: number;
  missed: number;
  remaining: number;
  extra: number;
  pct: number | null;
}

export interface TodayView {
  date: string;
  weekday_name: string;
  status: DayStatus;
  plan: { id: number; name: string } | null;
  plan_day: DayPlanDay | null;
  session: Session | null;
  exercises: ExerciseCard[];
  workouts: DayWorkout[];
  other_sessions: Session[];
  next: { date: string; weekday_name: string; name: string } | null;
  week: WeekAdherence;
}

export interface WeekDay {
  date: string;
  weekday: number;
  weekday_name: string;
  is_today: boolean;
  status: DayStatus;
  plan_day: DayPlanDay | null;
  workouts: DayWorkout[];
  sessions: Session[];
}

export interface WeekView {
  week_start: string;
  week_end: string;
  prev_week_start: string;
  next_week_start: string;
  today: string;
  days: WeekDay[];
  adherence: WeekAdherence;
}

export interface PlanDay {
  id: number;
  weekday: number;
  weekday_key: WeekdayKey;
  weekday_name: string;
  name: string;
  notes: string | null;
  exercises: PlannedExercise[];
}

export interface Plan {
  id: number;
  name: string;
  goal: string | null;
  notes: string | null;
  is_active: boolean;
  active_from: string | null;
  active_until: string | null;
  archived: boolean;
  days: PlanDay[];
}

export interface PlanSummary {
  id: number;
  name: string;
  goal: string | null;
  is_active: boolean;
  archived: boolean;
  active_from: string | null;
  day_count: number;
  updated_at: string;
}

export interface PlanView {
  plan: Plan | null;
  plans: PlanSummary[];
}

export interface SessionsView {
  total: number;
  limit: number;
  offset: number;
  sessions: Session[];
}

export interface CatalogueExercise {
  id: number;
  name: string;
  category: string;
  muscle_group: string | null;
  notes: string | null;
  aliases: string[];
  session_count: number;
  last_date: string | null;
  best_weight_lbs: number | null;
  best_e1rm_lbs: number | null;
}

export interface SeriesPoint {
  session_id: number;
  date: string;
  sets: number;
  top_weight_lbs: number | null;
  top_weight_reps: number | null;
  e1rm_lbs: number | null;
  best_set: { weight_lbs: number; reps: number } | null;
  volume_lbs: number;
  total_reps: number;
  duration_seconds: number | null;
  distance_miles: number | null;
  pace_seconds_per_mile: number | null;
  summary: string;
}

export interface Prs {
  weight: { weight_lbs: number; reps: number; date: string } | null;
  e1rm: { e1rm_lbs: number; weight_lbs: number; reps: number; date: string } | null;
  reps: { reps: number; weight_lbs: number | null; date: string } | null;
  volume: { volume_lbs: number; date: string } | null;
  distance: { distance_miles: number; duration_seconds: number | null; date: string } | null;
  pace: { pace_seconds_per_mile: number; distance_miles: number; duration_seconds: number; date: string } | null;
}

export interface ProgressionView {
  exercise: { id: number; name: string; category: string; muscle_group: string | null } | null;
  series: SeriesPoint[];
  prs: Prs | null;
  last_session: Previous | null;
}

export interface PrRow extends Prs {
  exercise_id: number;
  exercise: string;
  category: string;
  muscle_group: string | null;
}

export interface AdherenceView {
  today: string;
  weeks: WeekAdherence[];
  totals: { planned: number; completed: number; extra: number; pct: number | null };
}

export interface LogResult {
  session: Session;
  new_prs: string[];
}
