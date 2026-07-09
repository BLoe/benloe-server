import type Database from 'better-sqlite3';
import { localDay } from '../db/index.js';

export interface SetInput {
  exercise: string;
  reps?: number;
  weight_lb?: number;
  rpe?: number;
}

export interface WorkoutResult {
  id: number;
  prs: { exercise: string; weight_lb: number; previous: number | null }[];
}

/** Insert a workout; a set is a PR when its weight exceeds all prior weight for that exercise. */
export function logWorkout(
  db: Database.Database,
  w: { name?: string; notes?: string; rpe_session?: number; sets: SetInput[]; when?: Date },
): WorkoutResult {
  const when = w.when ?? new Date();
  const prs: WorkoutResult['prs'] = [];
  const insert = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO workout (performed_at, local_day, name, notes, rpe_session) VALUES (?,?,?,?,?)')
      .run(when.toISOString(), localDay(when), w.name ?? null, w.notes ?? null, w.rpe_session ?? null);
    const workoutId = Number(lastInsertRowid);
    const prevMax = db.prepare(
      'SELECT MAX(weight_lb) m FROM workout_set WHERE exercise = ? AND workout_id != ?',
    );
    const insSet = db.prepare(
      'INSERT INTO workout_set (workout_id, exercise, set_number, reps, weight_lb, rpe, is_pr) VALUES (?,?,?,?,?,?,?)',
    );
    // Track the running max within this workout too, so only the top new set flags.
    const seenMax = new Map<string, number>();
    w.sets.forEach((s, i) => {
      const prior = (prevMax.get(s.exercise, workoutId) as { m: number | null }).m;
      const sessionPrior = seenMax.get(s.exercise) ?? -Infinity;
      const isPr = s.weight_lb !== undefined && s.weight_lb > Math.max(prior ?? -Infinity, sessionPrior);
      if (isPr) prs.push({ exercise: s.exercise, weight_lb: s.weight_lb!, previous: prior });
      if (s.weight_lb !== undefined) seenMax.set(s.exercise, Math.max(sessionPrior, s.weight_lb));
      insSet.run(workoutId, s.exercise, i + 1, s.reps ?? null, s.weight_lb ?? null, s.rpe ?? null, Number(isPr));
    });
    return workoutId;
  });
  return { id: insert(), prs };
}

/** EWMA over an ordered series — the weight-trend smoother (§3, v1 §2.2). */
export function ewma(values: number[], alpha = 0.2): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) {
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export interface WeightTrend {
  latest: number | null;
  trend: number | null;
  /** trend now minus trend 7 entries ago (≈ weekly drift) */
  weeklyDelta: number | null;
  points: { local_day: string; value: number; trend: number }[];
}

export function logBodyMetric(
  db: Database.Database,
  m: { metric: string; value: number; when?: Date; source?: string },
): { id: number; weightTrend?: WeightTrend } {
  const when = m.when ?? new Date();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO body_metric (measured_at, local_day, metric, value, source) VALUES (?,?,?,?,?)')
    .run(when.toISOString(), localDay(when), m.metric, m.value, m.source ?? 'manual');
  const res: { id: number; weightTrend?: WeightTrend } = { id: Number(lastInsertRowid) };
  if (m.metric === 'weight_lb') res.weightTrend = weightTrend(db);
  return res;
}

export function weightTrend(db: Database.Database, days = 90): WeightTrend {
  const rows = db
    .prepare(
      `SELECT local_day, value FROM body_metric WHERE metric = 'weight_lb'
       ORDER BY local_day DESC, id DESC LIMIT ?`,
    )
    .all(days) as { local_day: string; value: number }[];
  rows.reverse();
  if (rows.length === 0) return { latest: null, trend: null, weeklyDelta: null, points: [] };
  const smoothed = ewma(rows.map((r) => r.value));
  const points = rows.map((r, i) => ({ ...r, trend: Math.round(smoothed[i]! * 100) / 100 }));
  const trendNow = smoothed.at(-1)!;
  const trendWeekAgo = smoothed.length > 7 ? smoothed[smoothed.length - 8]! : null;
  return {
    latest: rows.at(-1)!.value,
    trend: Math.round(trendNow * 100) / 100,
    weeklyDelta: trendWeekAgo === null ? null : Math.round((trendNow - trendWeekAgo) * 100) / 100,
    points,
  };
}
