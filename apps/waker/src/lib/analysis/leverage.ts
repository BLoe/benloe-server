/**
 * Leverage-aware start/sit.
 *
 * DECISION SERVED: "who do I actually start this week?" — and the answer is not
 * always the higher projection.
 *
 * Every fantasy app ranks by expected points. That is the right answer only if
 * your goal is to maximise points, and it is not: your goal is to win *this*
 * matchup. Those come apart at the edges, and the edges are where lineups are
 * decided.
 *
 * If you are projected to win by 30, you do not need upside — you need your
 * score not to collapse, so you play the steady player and take the win. If you
 * are projected to lose by 30, a steady player guarantees you lose by roughly
 * 30; your only path is the boom-or-bust one. This is a real, well-understood
 * effect that basic apps ignore because it requires modelling variance rather
 * than just adding up means.
 *
 * The maths: each player's week is treated as normal with a mean (his
 * projection) and a spread that scales with the mean and with his position.
 * Swapping player A for player B shifts your team's mean by (a-b) and its
 * variance by (varA - varB). Win probability is the normal CDF of your margin
 * over the combined spread, so the value of a swap is the change in that
 * probability — not the change in points.
 */

/**
 * How noisy a week is, by position, as a fraction of the projection.
 *
 * These are heuristics, not fitted values, and they are deliberately coarse:
 * quarterbacks are the steadiest fantasy position (volume is guaranteed, and
 * passing yards accumulate smoothly), receivers the swingiest (one deep ball
 * is a week), running backs in between, tight ends closer to receivers because
 * so much of the position's scoring is touchdown-dependent.
 *
 * The floor matters as much as the ratio: a player projected for 4 points is
 * not predictable to within one point, so the spread never goes below it.
 */
const POSITION_SIGMA: Record<string, number> = {
  QB: 0.28,
  RB: 0.42,
  WR: 0.52,
  TE: 0.55,
  K: 0.45,
  DEF: 0.55,
};

const SIGMA_FLOOR = 3;
const DEFAULT_SIGMA = 0.45;

/** Standard deviation of one player's week. */
export function playerSigma(projection: number, position: string | null): number {
  const ratio = POSITION_SIGMA[(position ?? '').toUpperCase()] ?? DEFAULT_SIGMA;
  return Math.max(SIGMA_FLOOR, projection * ratio);
}

/**
 * Normal CDF via a standard error-function approximation.
 *
 * Exact at zero by construction: the approximation is off by about 1e-5 there,
 * which is harmless as a probability but breaks the symmetry a caller expects
 * when two identical teams should be exactly even.
 */
export function normalCdf(z: number): number {
  if (z === 0) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t ** 2 - 0.356538 * t + 0.3193815);
  return z > 0 ? 1 - p : p;
}

export interface LineupCandidate {
  playerId: string;
  position: string | null;
  projection: number;
}

export interface SwapEvaluation {
  /** Difference in expected points. What every other app shows. */
  pointsDelta: number;
  /** Difference in win probability. What actually matters. */
  winProbabilityDelta: number;
  /** Win probability if you start the incumbent. */
  baseWinProbability: number;
  /**
   * True when the two answers disagree — the lower projection is the better
   * start. This is the case worth surfacing loudly; everything else is just
   * "start the better player".
   */
  contrarian: boolean;
}

/**
 * What happens to your chance of winning if you start `challenger` instead of
 * `incumbent`.
 *
 * `teamProjection` and `opponentProjection` are the totals *including* the
 * incumbent, which is how the caller naturally has them.
 *
 * Worth knowing how big this effect actually is, because it is easy to oversell.
 * Measured against a real lineup (spread ~25) it only flips the answer when the
 * two projections are within about a point AND you are a substantial underdog
 * or favourite:
 *
 *     opponent 110 (even)   -0.5 pts -> -0.77pp   points still win
 *     opponent 130 (21%)    -0.5 pts -> +0.03pp   crossover
 *     opponent 150 (6%)     -0.5 pts -> +0.24pp   variance wins
 *     opponent 145, -2 pts           -> -0.78pp   too big a gap to make up
 *
 * So this is a tie-breaker, not a revolution. It is worth having because those
 * near-ties are exactly the lineup decisions people agonise over — but the UI
 * should not imply it overturns a real projection gap, because it does not.
 */
export function evaluateSwap(
  incumbent: LineupCandidate,
  challenger: LineupCandidate,
  teamProjection: number,
  opponentProjection: number,
  /** Spread of the rest of your lineup and all of theirs, combined. */
  restSigma: number
): SwapEvaluation {
  const sigmaIn = playerSigma(incumbent.projection, incumbent.position);
  const sigmaCh = playerSigma(challenger.projection, challenger.position);

  const base = winProbability(
    teamProjection,
    opponentProjection,
    Math.sqrt(restSigma ** 2 + sigmaIn ** 2)
  );
  const swapped = winProbability(
    teamProjection - incumbent.projection + challenger.projection,
    opponentProjection,
    Math.sqrt(restSigma ** 2 + sigmaCh ** 2)
  );

  const pointsDelta = challenger.projection - incumbent.projection;
  const winProbabilityDelta = swapped - base;

  return {
    pointsDelta,
    winProbabilityDelta,
    baseWinProbability: base,
    // Only flag it when the disagreement is big enough to act on. A win
    // probability that moves by a quarter of a percent is not a disagreement,
    // it is arithmetic noise.
    contrarian: pointsDelta < 0 && winProbabilityDelta > 0.005,
  };
}

/** Probability the first score beats the second, given a combined spread. */
export function winProbability(mine: number, theirs: number, sigma: number): number {
  if (sigma <= 0) return mine === theirs ? 0.5 : mine > theirs ? 1 : 0;
  return normalCdf((mine - theirs) / sigma);
}

/**
 * The spread of a whole lineup, treating players as independent.
 *
 * Independence is not quite true — a quarterback and his own receiver rise and
 * fall together — but the correlation is modest across a nine-slot lineup and
 * assuming it away keeps this honest and simple rather than falsely precise.
 */
export function lineupSigma(players: LineupCandidate[]): number {
  return Math.sqrt(
    players.reduce((sum, p) => sum + playerSigma(p.projection, p.position) ** 2, 0)
  );
}

export type Posture = 'protect' | 'neutral' | 'gamble';

/**
 * What kind of week this is.
 *
 * Below 35% you cannot win by playing safe and should be reaching for upside.
 * Above 65% variance is the only thing that can beat you. In between, the
 * expected-points answer is the right one and the app should not pretend
 * otherwise.
 */
export function posture(winProb: number): Posture {
  if (winProb < 0.35) return 'gamble';
  if (winProb > 0.65) return 'protect';
  return 'neutral';
}

export function postureAdvice(p: Posture): string {
  switch (p) {
    case 'gamble':
      return 'You are a heavy underdog. A safe lineup loses this matchup by roughly the projection — play for the ceiling.';
    case 'protect':
      return 'You are a heavy favourite. Upside cannot help you much; a collapse can. Play the steadier lineup.';
    default:
      return 'This one is close. Start the higher projection.';
  }
}
