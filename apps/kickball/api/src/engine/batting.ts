/**
 * Batting order optimization.
 *
 * Rather than encoding a rule of thumb ("put the bunters ahead of the power
 * kickers"), this simulates the game. Ratings become per-plate-appearance
 * outcome probabilities, a Monte Carlo run plays out six innings thousands of
 * times, and a local search rearranges the order to maximize runs. The familiar
 * patterns fall out of the simulation on their own, and when they do not, the
 * simulation is describing this particular roster rather than kickball in
 * general.
 *
 * All rating inputs are on the Bradley-Terry theta scale, where 0 is the team
 * average and +/-1 is a substantial gap. That keeps the calibration constants
 * below interpretable: they are all expressed as league-average rates nudged by
 * how far above or below average a player is.
 */

import { Rng } from './rng';

export interface OffenseProfile {
  playerId: string;
  /** All on the theta scale, 0 = team average. */
  onBase: number;
  power: number;
  bunting: number;
  baserunning: number;
  iq: number;
  /**
   * The group used by the spread-out constraint. Gender in practice, bucketed
   * the same way the league's field minimum buckets it, so that a non-binary
   * player is never left as a group of one who can never satisfy alternation.
   */
  group?: string;
}

/** Longest stretch of consecutive kickers from the same group. */
export function longestSameGroupRun(order: readonly OffenseProfile[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < order.length; i++) {
    run = i > 0 && order[i].group === order[i - 1].group ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The tightest cap this roster can actually meet.
 *
 * Ten men and six women can never alternate strictly: six women only open seven
 * gaps, and ten men will not fit one to a gap. Asking for something impossible
 * has to become the closest achievable thing rather than an error, because it is
 * a normal Sunday when only four women turn up.
 */
export function smallestFeasibleRun(order: readonly OffenseProfile[]): number {
  const counts = new Map<string, number>();
  for (const p of order) counts.set(p.group ?? '', (counts.get(p.group ?? '') ?? 0) + 1);
  if (counts.size <= 1) return Math.max(1, order.length);
  const largest = Math.max(...counts.values());
  const rest = order.length - largest;
  return Math.max(1, Math.ceil(largest / (rest + 1)));
}

/**
 * Lays the groups out as evenly as the cap allows, keeping each group in the
 * order it was handed over so a quality ordering within a group survives.
 */
function interleaveGroups(order: readonly OffenseProfile[], cap: number): OffenseProfile[] {
  const remaining = new Map<string, OffenseProfile[]>();
  for (const p of order) {
    const key = p.group ?? '';
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key)!.push(p);
  }

  const out: OffenseProfile[] = [];
  let lastKey: string | null = null;
  let run = 0;

  while ([...remaining.values()].some((list) => list.length > 0)) {
    const available = [...remaining.entries()].filter(([, list]) => list.length > 0);
    // Prefer a group that will not break the cap; fall back only when the cap
    // cannot be met at all, which smallestFeasibleRun should have prevented.
    const allowed = available.filter(([key]) => !(key === lastKey && run >= cap));
    const pool = allowed.length > 0 ? allowed : available;
    // Whichever group has the most left to place goes next, which spreads the
    // larger group across the order instead of stacking it at one end.
    pool.sort((a, b) => b[1].length - a[1].length);
    const [key, list] = pool[0];
    out.push(list.shift()!);
    run = key === lastKey ? run + 1 : 1;
    lastKey = key;
  }
  return out;
}

export interface BattingCalibration {
  /** Team-average chance of reaching base in a plate appearance. */
  leagueOnBase: number;
  /** How strongly the on-base composite moves the reach rate, in log-odds. */
  onBaseSensitivity: number;
  /** Share of times reached that end as a single / double / triple / home run. */
  hitSplit: [number, number, number, number];
  /** How strongly power tilts the split toward extra bases. */
  powerTilt: [number, number, number, number];
  /** Innings played. */
  innings: number;
  outsPerInning: number;
  /**
   * Relative value of a run in each inning. Scoring early is worth more: it
   * forces the other team to play from behind and, in a six-inning game with a
   * time cap, a late inning may not happen at all.
   */
  inningWeights: number[];
}

export const DEFAULT_CALIBRATION: BattingCalibration = {
  leagueOnBase: 0.6,
  onBaseSensitivity: 0.55,
  hitSplit: [0.7, 0.2, 0.07, 0.03],
  powerTilt: [0, 0.45, 0.75, 1.05],
  innings: 6,
  outsPerInning: 3,
  inningWeights: [1.35, 1.2, 1.1, 0.95, 0.75, 0.65],
};

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

/**
 * Chance this player reaches base.
 *
 * Getting on base is the headline skill, but bunting is a second route to first
 * that a pure on-base rating does not fully capture, and decision making avoids
 * the self-inflicted outs.
 */
export function reachRate(p: OffenseProfile, cal: BattingCalibration): number {
  const composite = 0.65 * p.onBase + 0.2 * p.bunting + 0.15 * p.iq;
  return sigmoid(logit(cal.leagueOnBase) + cal.onBaseSensitivity * composite);
}

/**
 * How a reached base splits across single / double / triple / home run.
 * Power does most of the work; speed turns some singles into doubles.
 */
export function hitDistribution(p: OffenseProfile, cal: BattingCalibration): number[] {
  const drive = 0.75 * p.power + 0.25 * p.baserunning;
  const weights = cal.hitSplit.map((base, i) => base * Math.exp(cal.powerTilt[i] * drive));
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => w / total);
}

/** Chance a runner tries for the extra base on a hit. */
function attemptRate(runner: OffenseProfile, baseline: number): number {
  return sigmoid(baseline + 0.55 * runner.baserunning);
}

/** Chance the attempt works. Failing is an out on the bases. */
function attemptSuccess(runner: OffenseProfile): number {
  return sigmoid(1.25 + 0.5 * runner.baserunning + 0.45 * runner.iq);
}

/** Chance a deep out advances a runner from third with fewer than two outs. */
function sacrificeRate(kicker: OffenseProfile): number {
  return sigmoid(-0.55 + 0.5 * kicker.power + 0.25 * kicker.iq);
}

interface InningState {
  /** Bases 1, 2, 3. null means empty. */
  bases: (OffenseProfile | null)[];
  outs: number;
  runs: number;
}

/**
 * Plays one plate appearance. Mutates the state and returns nothing.
 * Exported for testing so the outcome distribution can be checked directly.
 */
export function playAtBat(
  kicker: OffenseProfile,
  state: InningState,
  rng: Rng,
  cal: BattingCalibration
): void {
  if (rng.next() >= reachRate(kicker, cal)) {
    // An out. With a runner on third and fewer than two away, a deep one can
    // still bring the run home.
    if (state.bases[2] && state.outs < cal.outsPerInning - 1 && rng.next() < sacrificeRate(kicker)) {
      state.runs++;
      state.bases[2] = null;
    }
    state.outs++;
    return;
  }

  const split = hitDistribution(kicker, cal);
  const kind = rng.weightedIndex(split); // 0 single, 1 double, 2 triple, 3 home run

  if (kind === 3) {
    // Everybody scores.
    for (let b = 0; b < 3; b++) {
      if (state.bases[b]) state.runs++;
      state.bases[b] = null;
    }
    state.runs++;
    return;
  }

  if (kind === 2) {
    for (let b = 0; b < 3; b++) {
      if (state.bases[b]) state.runs++;
      state.bases[b] = null;
    }
    state.bases[2] = kicker;
    return;
  }

  if (kind === 1) {
    // Double: second and third score, first is sent and usually makes it.
    if (state.bases[2]) {
      state.runs++;
      state.bases[2] = null;
    }
    if (state.bases[1]) {
      state.runs++;
      state.bases[1] = null;
    }
    const onFirst = state.bases[0];
    state.bases[0] = null;
    if (onFirst) {
      if (rng.next() < attemptRate(onFirst, 0.6)) {
        if (rng.next() < attemptSuccess(onFirst)) {
          state.runs++;
        } else {
          state.outs++;
        }
      } else {
        state.bases[2] = onFirst;
      }
    }
    state.bases[1] = kicker;
    return;
  }

  // Single.
  if (state.bases[2]) {
    state.runs++;
    state.bases[2] = null;
  }
  const onSecond = state.bases[1];
  const onFirst = state.bases[0];
  state.bases[1] = null;
  state.bases[0] = null;

  if (onSecond) {
    if (rng.next() < attemptRate(onSecond, 0.45)) {
      if (rng.next() < attemptSuccess(onSecond)) {
        state.runs++;
      } else {
        state.outs++;
      }
    } else {
      state.bases[2] = onSecond;
    }
  }

  if (onFirst) {
    // Only try for third if it is open.
    if (!state.bases[2] && rng.next() < attemptRate(onFirst, -0.45)) {
      if (rng.next() < attemptSuccess(onFirst)) {
        state.bases[2] = onFirst;
      } else {
        state.outs++;
      }
    } else {
      state.bases[1] = onFirst;
    }
  }

  state.bases[0] = kicker;
}

/**
 * Plays one full game with the given order and returns runs scored per inning.
 * The order carries over between innings, which is the whole reason order
 * matters at all.
 */
export function simulateGame(
  order: readonly OffenseProfile[],
  rng: Rng,
  cal: BattingCalibration = DEFAULT_CALIBRATION
): number[] {
  const perInning: number[] = [];
  let slot = 0;
  for (let inning = 0; inning < cal.innings; inning++) {
    const state: InningState = { bases: [null, null, null], outs: 0, runs: 0 };
    // Guard against an unreachable loop if calibration is ever set to a state
    // where outs cannot accumulate.
    let safety = 0;
    while (state.outs < cal.outsPerInning && safety < 200) {
      playAtBat(order[slot % order.length], state, rng, cal);
      slot++;
      safety++;
    }
    perInning.push(state.runs);
  }
  return perInning;
}

export interface OrderEvaluation {
  /** Mean total runs across the simulated games. */
  expectedRuns: number;
  /** Mean runs in each inning. */
  runsByInning: number[];
  /** The optimization objective: runs weighted toward the early innings. */
  score: number;
}

/**
 * Evaluates an order by simulating it many times.
 *
 * The seed is fixed per call so that two candidate orders are compared against
 * the same sequence of luck. Without that, the search spends its time chasing
 * simulation noise instead of real differences.
 */
export function evaluateOrder(
  order: readonly OffenseProfile[],
  options: { games?: number; seed?: number | string; calibration?: BattingCalibration } = {}
): OrderEvaluation {
  const cal = options.calibration ?? DEFAULT_CALIBRATION;
  const games = options.games ?? 1200;
  const rng = new Rng(options.seed ?? 'evaluate');

  const totals = new Array<number>(cal.innings).fill(0);
  let runTotal = 0;
  for (let g = 0; g < games; g++) {
    const perInning = simulateGame(order, rng, cal);
    for (let i = 0; i < cal.innings; i++) totals[i] += perInning[i];
    runTotal += perInning.reduce((s, r) => s + r, 0);
  }

  const runsByInning = totals.map((t) => t / games);
  const score = runsByInning.reduce((s, r, i) => s + r * (cal.inningWeights[i] ?? 1), 0);
  return { expectedRuns: runTotal / games, runsByInning, score };
}

/**
 * A sensible starting order, used to seed the search.
 *
 * Best on-base kicker leads off, the best all-round producer follows, then the
 * power alternates behind table setters. The search will improve on this, but
 * starting somewhere reasonable means fewer iterations to get there.
 */
export function heuristicOrder(players: readonly OffenseProfile[]): OffenseProfile[] {
  const setters = [...players].sort(
    (a, b) => b.onBase + 0.4 * b.bunting + 0.3 * b.baserunning - (a.onBase + 0.4 * a.bunting + 0.3 * a.baserunning)
  );
  const drivers = [...players].sort((a, b) => b.power - a.power);

  const out: OffenseProfile[] = [];
  const used = new Set<string>();
  const takeNext = (pool: OffenseProfile[]) => {
    for (const p of pool) {
      if (!used.has(p.playerId)) {
        used.add(p.playerId);
        out.push(p);
        return;
      }
    }
  };

  // Alternate: get someone on, then bring them in.
  while (out.length < players.length) {
    takeNext(setters);
    if (out.length < players.length) takeNext(drivers);
  }
  return out;
}

export interface BattingOrderResult {
  order: string[];
  expectedRuns: number;
  runsByInning: number[];
  score: number;
  /** Score of the heuristic starting point, measured the same way. */
  baselineScore: number;
  /** Candidate orders evaluated during the search. */
  iterations: number;
  /** Longest stretch of the same group in the returned order. */
  longestSameGroupRun: number;
  warnings: string[];
}

/**
 * Searches for the order that scores the most, weighted toward early innings.
 *
 * Two stages, because a single-stage search cheats. Simulation scores are
 * noisy, so a search that explores and reports at the same precision will
 * happily pick the order that got lucky on its particular random stream and
 * then report that luck as if it were skill. So: explore cheaply, then run the
 * finalists off against each other at high precision on a stream the search
 * never saw. Only the run-off numbers are reported.
 *
 * The exploration itself is steepest-descent over pairwise swaps with random
 * restarts. Twelve players is 479 million orders, but the objective is smooth
 * enough that swapping neighbours climbs to a strong answer quickly, and the
 * restarts keep it off any single local peak.
 */
export function optimizeBattingOrder(
  players: readonly OffenseProfile[],
  options: {
    /** Games per evaluation while exploring. Cheap and noisy is fine here. */
    searchGames?: number;
    /** Games for the final run-off between candidates. */
    finalGames?: number;
    seed?: number | string;
    calibration?: BattingCalibration;
    restarts?: number;
    maxPasses?: number;
    /**
     * Most consecutive kickers allowed from the same group. Omit for no
     * constraint. Raised automatically if the roster cannot meet it.
     */
    maxSameGroupRun?: number;
  } = {}
): BattingOrderResult {
  const cal = options.calibration ?? DEFAULT_CALIBRATION;
  const searchGames = options.searchGames ?? 200;
  const finalGames = options.finalGames ?? 6000;
  const seed = options.seed ?? 'batting';
  const restarts = options.restarts ?? 2;
  const maxPasses = options.maxPasses ?? 4;
  const searchRng = new Rng(seed);
  const warnings: string[] = [];

  // Spreading the groups out costs almost nothing in runs but stops the order
  // coming out as every man and then every woman, which is what a pure
  // run-maximizing search produces whenever ability happens to split that way.
  let cap = options.maxSameGroupRun ?? Infinity;
  if (Number.isFinite(cap) && players.length > 0) {
    const floor = smallestFeasibleRun(players);
    if (cap < floor) {
      warnings.push(
        `With this turnout the closest to spreading the order out is ${floor} in a row, not ${cap}.`
      );
      cap = floor;
    }
  }
  const respectsCap = (order: readonly OffenseProfile[]) =>
    !Number.isFinite(cap) || longestSameGroupRun(order) <= cap;

  // The run-off stream is deliberately unrelated to the search stream.
  const judge = (order: readonly OffenseProfile[]) =>
    evaluateOrder(order, { games: finalGames, seed: `${seed}:runoff`, calibration: cal });

  if (players.length === 0) {
    return {
      order: [],
      expectedRuns: 0,
      runsByInning: [],
      score: 0,
      baselineScore: 0,
      iterations: 0,
      longestSameGroupRun: 0,
      warnings,
    };
  }

  // The heuristic order, then spread out if a cap applies. Interleaving keeps
  // each group in the quality order the heuristic put them in.
  const heuristic = heuristicOrder(players);
  const seedOrder = Number.isFinite(cap) ? interleaveGroups(heuristic, cap) : heuristic;
  const baseline = judge(seedOrder);

  if (players.length < 3) {
    // Nothing meaningful to search over.
    const best = players.length === 1 ? players.slice() : seedOrder;
    const evaluation = judge(best);
    return {
      order: best.map((p) => p.playerId),
      ...evaluation,
      baselineScore: baseline.score,
      iterations: 0,
      longestSameGroupRun: longestSameGroupRun(best),
      warnings,
    };
  }

  // During exploration every candidate is judged against the same stream, so
  // two orders differ by their merits rather than by their luck.
  const explore = (order: readonly OffenseProfile[]) =>
    evaluateOrder(order, { games: searchGames, seed: `${seed}:search`, calibration: cal }).score;

  const finalists: OffenseProfile[][] = [seedOrder];
  let iterations = 0;

  for (let restart = 0; restart <= restarts; restart++) {
    const shuffled = searchRng.shuffle(players);
    let current =
      restart === 0 ? seedOrder : Number.isFinite(cap) ? interleaveGroups(shuffled, cap) : shuffled;
    let currentScore = explore(current);

    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (let i = 0; i < current.length; i++) {
        for (let j = i + 1; j < current.length; j++) {
          const candidate = current.slice();
          [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
          if (!respectsCap(candidate)) continue;
          const candidateScore = explore(candidate);
          iterations++;
          if (candidateScore > currentScore) {
            current = candidate;
            currentScore = candidateScore;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    finalists.push(current);
  }

  let best = finalists[0];
  let bestEval = baseline;
  for (const candidate of finalists.slice(1)) {
    const evaluation = judge(candidate);
    if (evaluation.score > bestEval.score) {
      best = candidate;
      bestEval = evaluation;
    }
  }

  return {
    order: best.map((p) => p.playerId),
    expectedRuns: bestEval.expectedRuns,
    runsByInning: bestEval.runsByInning,
    score: bestEval.score,
    baselineScore: baseline.score,
    iterations,
    longestSameGroupRun: longestSameGroupRun(best),
    warnings,
  };
}
