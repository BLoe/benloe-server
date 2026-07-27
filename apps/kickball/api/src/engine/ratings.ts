/**
 * Turning pairwise comparisons into per-stat ratings.
 *
 * The model is Bradley-Terry: every player has a latent strength theta, and the
 * probability that i beats j on a given stat is sigmoid(theta_i - theta_j). We
 * fit all comparisons for a stat at once by maximum likelihood, with an L2
 * prior pulling everyone toward the team average.
 *
 * Why not Elo: Elo is an online approximation of this same model. It depends on
 * the order comparisons arrive in, needs far more data to settle, and has no
 * notion of how confident it is. Fitting the whole set at once is both more
 * accurate on small samples and gives us per-player uncertainty, which is what
 * drives the matchup picker.
 *
 * The L2 prior is doing real work. Without it a player who wins every
 * comparison has a likelihood that increases without bound, so their rating
 * runs off to infinity. With it, a player with two comparisons sits close to
 * average and only moves out as evidence accumulates.
 */

import { Rng } from './rng';

export interface Comparison {
  a: string;
  b: string;
  /** The winning player id, or null for "too close to call". */
  winner: string | null;
  /** Defaults to 1. Set to 0 to exclude a comparison without removing it. */
  weight?: number;
}

export interface PlayerRating {
  playerId: string;
  /** Latent strength on the log-odds scale, centered on the team at 0. */
  theta: number;
  /** Display rating, 0-100, centered at 50. */
  rating: number;
  /** Standard error of theta. Large means we barely know anything. */
  stderr: number;
  /** Comparisons this player appeared in, ties included. */
  comparisons: number;
  /** 0 = no information, approaching 1 = well established. */
  confidence: number;
}

export interface FitOptions {
  /**
   * Strength of the pull toward average. Roughly equivalent to 4 * lambda
   * comparisons worth of prior evidence, so 0.6 is worth about two and a half
   * comparisons.
   */
  lambda?: number;
  maxIterations?: number;
  tolerance?: number;
  /** Points of display rating per unit of theta. */
  scale?: number;
}

const DEFAULTS: Required<FitOptions> = {
  lambda: 0.6,
  maxIterations: 200,
  tolerance: 1e-9,
  scale: 12.5,
};

function sigmoid(x: number): number {
  // Branch to avoid overflow in exp for large magnitudes.
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Fits Bradley-Terry strengths for one stat.
 *
 * A tie counts as half a win each way, which is the standard reduction and
 * keeps the likelihood smooth. Comparisons referencing unknown players are
 * ignored rather than throwing, so a deleted player cannot break the fit.
 */
export function fitBradleyTerry(
  playerIds: readonly string[],
  comparisons: readonly Comparison[],
  options: FitOptions = {}
): Map<string, PlayerRating> {
  const opts = { ...DEFAULTS, ...options };
  const n = playerIds.length;
  const index = new Map<string, number>();
  playerIds.forEach((id, i) => index.set(id, i));

  // wins[i][j] = weighted wins of i over j. total[i][j] = weighted meetings.
  const wins: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const total: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const appearances = new Array<number>(n).fill(0);

  for (const c of comparisons) {
    const i = index.get(c.a);
    const j = index.get(c.b);
    if (i === undefined || j === undefined || i === j) continue;
    const w = c.weight ?? 1;
    if (w <= 0) continue;

    total[i][j] += w;
    total[j][i] += w;
    appearances[i] += w;
    appearances[j] += w;

    if (c.winner === c.a) {
      wins[i][j] += w;
    } else if (c.winner === c.b) {
      wins[j][i] += w;
    } else {
      // Too close to call: half a win each way.
      wins[i][j] += w / 2;
      wins[j][i] += w / 2;
    }
  }

  const theta = new Array<number>(n).fill(0);

  // Coordinate-wise Newton. The per-coordinate second derivative is strictly
  // negative because of the prior, so every step is an ascent step and we do
  // not need a line search. n is small (a roster, not a league), so the cost of
  // the full sweep is irrelevant.
  for (let iter = 0; iter < opts.maxIterations; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let gradient = -opts.lambda * theta[i];
      let curvature = -opts.lambda;
      for (let j = 0; j < n; j++) {
        if (i === j || total[i][j] === 0) continue;
        const p = sigmoid(theta[i] - theta[j]);
        gradient += wins[i][j] - total[i][j] * p;
        curvature -= total[i][j] * p * (1 - p);
      }
      // curvature is always <= -lambda < 0.
      let step = -gradient / curvature;
      // Cap the step so a near-separated player cannot leap somewhere absurd
      // on a single iteration.
      if (step > 1) step = 1;
      if (step < -1) step = -1;
      theta[i] += step;
      maxDelta = Math.max(maxDelta, Math.abs(step));
    }
    if (maxDelta < opts.tolerance) break;
  }

  // Center on the team so a rating of 50 always means "average for this team".
  const mean = n > 0 ? theta.reduce((s, t) => s + t, 0) / n : 0;
  for (let i = 0; i < n; i++) theta[i] -= mean;

  // Standard errors from the diagonal of the observed information. Ignoring the
  // off-diagonal terms understates correlated uncertainty a little, but it is
  // monotone in evidence, which is all the matchup picker needs.
  const priorStderr = 1 / Math.sqrt(opts.lambda);
  const out = new Map<string, PlayerRating>();
  for (let i = 0; i < n; i++) {
    let information = opts.lambda;
    for (let j = 0; j < n; j++) {
      if (i === j || total[i][j] === 0) continue;
      const p = sigmoid(theta[i] - theta[j]);
      information += total[i][j] * p * (1 - p);
    }
    const stderr = 1 / Math.sqrt(information);
    const rating = clamp(50 + opts.scale * theta[i], 1, 99);
    out.set(playerIds[i], {
      playerId: playerIds[i],
      theta: theta[i],
      rating,
      stderr,
      comparisons: appearances[i],
      confidence: clamp(1 - stderr / priorStderr, 0, 1),
    });
  }
  return out;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Probability that a beats b, given fitted ratings. */
export function winProbability(a: PlayerRating, b: PlayerRating): number {
  return sigmoid(a.theta - b.theta);
}

export interface Matchup {
  statKey: string;
  playerA: string;
  playerB: string;
  /** Expected information gain, for debugging and dashboard display. */
  score: number;
}

export interface MatchupContext {
  statKey: string;
  ratings: Map<string, PlayerRating>;
  /** Weighted count of comparisons already recorded for this stat. */
  comparisonCount: number;
  /** Key "a|b" with ids sorted, value = times that pair has been compared. */
  pairCounts: Map<string, number>;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Chooses the next comparison to show.
 *
 * A comparison is worth the most when the two players are genuinely close (an
 * obvious mismatch teaches nothing) and when at least one of them is poorly
 * established. That product is exactly the Fisher information the answer would
 * contribute, so the score below is the expected information gain, adjusted so
 * we do not keep asking about the same pair or grinding one stat while others
 * sit empty.
 *
 * The result is sampled from the strongest candidates rather than taken as the
 * single best, so the game does not feel like it is repeating itself.
 */
export function selectMatchup(
  contexts: readonly MatchupContext[],
  rng: Rng,
  options: {
    /** Pairs to avoid, usually what this rater just saw. Keys from pairKey. */
    exclude?: Set<string>;
    /** How many top candidates to sample from. */
    candidatePool?: number;
  } = {}
): Matchup | null {
  const exclude = options.exclude ?? new Set<string>();
  const poolSize = options.candidatePool ?? 12;

  // Stats with less data are worth more attention. Using the median as the
  // reference keeps one very sparse stat from monopolizing the whole game.
  const counts = contexts.map((c) => c.comparisonCount);
  const median = counts.length ? [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)] : 0;

  const candidates: Matchup[] = [];

  for (const ctx of contexts) {
    const players = [...ctx.ratings.values()];
    if (players.length < 2) continue;

    // Stats that are behind the median get a boost above 1, stats that are
    // ahead get pulled below it.
    const statFactor = (median + 3) / (ctx.comparisonCount + 3);

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        const key = pairKey(a.playerId, b.playerId);
        if (exclude.has(key)) continue;

        const p = sigmoid(a.theta - b.theta);
        const closeness = p * (1 - p); // peaks at 0.25 for an even matchup
        const uncertainty = a.stderr * a.stderr + b.stderr * b.stderr;
        const seen = ctx.pairCounts.get(key) ?? 0;
        const novelty = 1 / (1 + seen * seen); // falls off fast after one look

        const score = closeness * uncertainty * novelty * statFactor;
        if (score > 0) {
          candidates.push({ statKey: ctx.statKey, playerA: a.playerId, playerB: b.playerId, score });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((x, y) => y.score - x.score);
  const pool = candidates.slice(0, Math.min(poolSize, candidates.length));
  const chosen = pool[rng.weightedIndex(pool.map((c) => c.score))] ?? pool[0];

  // Randomize which side of the screen each player lands on, otherwise the
  // stronger player would drift to one side and raters would notice.
  if (rng.next() < 0.5) {
    return { ...chosen, playerA: chosen.playerB, playerB: chosen.playerA };
  }
  return chosen;
}
