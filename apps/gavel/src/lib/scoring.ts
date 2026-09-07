/**
 * Projected stats -> fantasy points, under one league's own scoring.
 *
 * WHY THIS EXISTS AT ALL, rather than reading a points column:
 * Sleeper publishes `pts_std`, `pts_half_ppr` and `pts_ppr` alongside every
 * projection, and all three are computed with FOUR-point passing touchdowns.
 * The Columbus league pays SIX. Josh Allen projects 361.5 by Sleeper's column
 * and 405.5 under the league's actual rules — a 44-point error, applied to
 * every quarterback, in the same direction, at the position where a handful of
 * points is the difference between a $4 bid and a $22 one.
 *
 * So points are always recomputed from the raw stat line. The canned columns
 * are never read. This is also what lets the Yahoo league (half-PPR, 4-point
 * passing TDs) share this engine: it is the same function with a different map.
 */
import type { Scoring } from './league.js';

export type StatLine = Record<string, number>;

/**
 * Sum stat x weight over every scoring rule the league defines.
 *
 * A rule with no matching projected stat contributes nothing rather than NaN —
 * defensive scoring in particular is mostly buckets (`pts_allow_7_13`) that no
 * season projection carries, and a single NaN would silently void a whole
 * position's values.
 */
export function scoreStats(stats: StatLine | null | undefined, scoring: Scoring): number {
  if (!stats) return 0;
  let total = 0;
  for (const key in scoring) {
    const weight = scoring[key];
    const value = stats[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
    total += value * weight;
  }
  return total;
}

/** Rounded to a tenth. Projections are not precise enough to justify more. */
export function scoreStatsRounded(stats: StatLine | null | undefined, scoring: Scoring): number {
  return Math.round(scoreStats(stats, scoring) * 10) / 10;
}

/**
 * The NFL plays 17 games per team. Sleeper's projections report `gp: 18` for
 * every player without exception — that is the calendar including the bye, not
 * a health projection. Dividing a season total by 18 prices a bye week into
 * every player equally, which is both wrong and useless.
 */
export const NFL_GAMES = 17;

export function perGame(seasonPoints: number, gamesPlayed?: number | null): number {
  const games = Math.min(gamesPlayed ?? NFL_GAMES, NFL_GAMES);
  if (games <= 0) return 0;
  return Math.round((seasonPoints / games) * 10) / 10;
}
