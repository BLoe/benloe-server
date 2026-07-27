/**
 * Defensive lineup optimization.
 *
 * Six innings, ten positions, and more players than spots. Three things pull
 * against each other:
 *
 *   - putting people where they are good,
 *   - giving everyone a fair share of innings, across the season and not just
 *     this game,
 *   - and keeping each person in roughly one spot, because being moved from
 *     left field to third base to catcher is miserable and it is how errors
 *     happen.
 *
 * The approach is simulated annealing over the full six-by-ten grid. Every move
 * the search makes preserves the hard constraints, so any lineup it can reach
 * is a legal lineup: ten distinct fielders per inning, the league minimum of
 * women on the field, nobody at a position they have opted out of, and any
 * assignment locked by hand left exactly where it was put.
 */

import { POSITIONS, FIELDERS_PER_INNING } from './domain';
import { Rng } from './rng';

export type Gender = 'woman' | 'man' | 'nonbinary';

export interface DefensePlayer {
  playerId: string;
  gender: Gender;
  /** Rating per stat key on the 0-100 display scale. Missing means average. */
  ratings: Record<string, number>;
  /** Positions this player will not play. */
  excludedPositions?: string[];
  /** Innings fielded in previous games this season. */
  priorPlayed?: number;
  /** Innings they could have fielded in previous games (6 per game attended). */
  priorPossible?: number;
}

export interface DefenseLock {
  inning: number;
  positionKey: string;
  playerId: string;
}

export interface DefenseOptions {
  innings?: number;
  minWomenInField?: number;
  seed?: number | string;
  locks?: DefenseLock[];
  iterations?: number;
  weights?: Partial<ObjectiveWeights>;
}

export interface ObjectiveWeights {
  /** Mean position fit, 0 to 1. */
  fit: number;
  /** Squared deviation from each player's fair share of innings. */
  fairness: number;
  /** Cost of moving a player between positions during the game. */
  consistency: number;
  /** Cost of making someone sit two innings in a row. */
  rest: number;
}

/**
 * Tuned so that, in order of strength:
 *
 *   1. playing time is very nearly non-negotiable (the penalty is squared, so
 *      a two-inning gap costs four times a one-inning gap),
 *   2. skill decides where the people who are playing get placed,
 *   3. consistency resists moving anyone whose position change is not forced
 *      by a substitution,
 *   4. rest breaks ties away from back-to-back benchings.
 *
 * The fit weight looks large next to the others because it multiplies a mean
 * over sixty slots, so a single placement moves it by a sixtieth of what the
 * weight suggests.
 */
export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  fit: 20,
  fairness: 2.0,
  consistency: 1.2,
  rest: 0.3,
};

export interface DefenseResult {
  /** assignment[inning][positionIndex] = playerId. Position order matches POSITIONS. */
  assignment: string[][];
  /** Innings fielded this game, by player id. */
  inningsPlayed: Record<string, number>;
  /** The fair share the optimizer was aiming at, before integer rounding. */
  fairShare: Record<string, number>;
  /** Distinct positions each player was given. */
  positionsPlayed: Record<string, string[]>;
  /** Mean fit across every assignment, 0 to 1. */
  meanFit: number;
  score: number;
  /** Anything the optimizer had to relax in order to produce a lineup. */
  warnings: string[];
}

export class DefenseInfeasibleError extends Error {}

/** Players who count toward the league's minimum. */
export function countsTowardMinimum(player: DefensePlayer): boolean {
  return player.gender === 'woman' || player.gender === 'nonbinary';
}

/**
 * How well a player suits a position, from 0 to 1.
 *
 * Each position carries a weighting over defensive stats; this is just the
 * weighted average of the player's ratings under it. A missing rating counts as
 * league average rather than zero, so an unrated player is treated as a
 * question mark rather than a liability.
 */
export function positionFit(player: DefensePlayer, positionKey: string): number {
  const position = POSITIONS.find((p) => p.key === positionKey);
  if (!position) return 0;
  let total = 0;
  for (const [statKey, weight] of Object.entries(position.weights)) {
    const rating = player.ratings[statKey];
    total += weight * (rating === undefined ? 50 : rating);
  }
  return total / 100;
}

/**
 * Each player's fair share of this game's innings.
 *
 * The starting point is an even split of today's sixty slots. From there each
 * player is nudged up or down by how far their season playing rate sits from
 * the team's, so whoever has been sitting the most gets the most time back.
 *
 * Fairness is tracked as a rate, innings played over innings they were
 * available for, rather than as a raw count. Otherwise missing a week would
 * quietly earn somebody extra innings on their return, which is backwards.
 *
 * The correction is deliberately relative to the team average rather than an
 * attempt to level everyone's cumulative rate in one game. Leveling cumulative
 * rates sounds fairer but is not: two players treated identically all season
 * would get different innings today purely because one of them has attended
 * fewer games, since a shorter history moves faster per inning. Correcting
 * against the team average gives equal history equal time, every time.
 */
export function fairShares(
  players: readonly DefensePlayer[],
  innings: number,
  slotsPerInning = FIELDERS_PER_INNING
): Map<string, number> {
  const shares = new Map<string, number>();
  if (players.length === 0) return shares;

  const totalSlots = innings * slotsPerInning;
  const baseShare = totalSlots / players.length;

  // Only players with history inform the team rate; newcomers are neutral
  // rather than counted as having been shorted everything.
  const withHistory = players.filter((p) => (p.priorPossible ?? 0) > 0);
  const rateOf = (p: DefensePlayer) => (p.priorPlayed ?? 0) / (p.priorPossible ?? 1);
  const teamRate =
    withHistory.length > 0
      ? withHistory.reduce((s, p) => s + rateOf(p), 0) / withHistory.length
      : 0;

  // A player a full game-rate behind the team gets about that much back.
  const correction = innings;
  const target = players.map((p) =>
    (p.priorPossible ?? 0) > 0 ? baseShare + correction * (teamRate - rateOf(p)) : baseShare
  );

  // Clamping to [0, innings] can break the total, so hand the difference back
  // to whoever is not already pinned at a bound.
  for (let pass = 0; pass < 50; pass++) {
    for (let i = 0; i < target.length; i++) {
      target[i] = Math.max(0, Math.min(innings, target[i]));
    }
    const sum = target.reduce((s, v) => s + v, 0);
    const residual = totalSlots - sum;
    if (Math.abs(residual) < 1e-9) break;

    const free = target
      .map((_, i) => i)
      .filter((i) => (residual > 0 ? target[i] < innings : target[i] > 0));
    if (free.length === 0) break;
    for (const i of free) target[i] += residual / free.length;
  }

  players.forEach((p, i) => shares.set(p.playerId, target[i]));
  return shares;
}

interface Context {
  players: DefensePlayer[];
  byId: Map<string, DefensePlayer>;
  innings: number;
  minWomen: number;
  weights: ObjectiveWeights;
  fitCache: Map<string, number>;
  shares: Map<string, number>;
  /** lockGrid[inning][positionIndex] = playerId that must sit there. */
  lockGrid: (string | null)[][];
  /** Player ids locked somewhere in this inning, so they cannot be benched. */
  lockedInInning: Set<string>[];
}

function fitOf(ctx: Context, playerId: string, positionIndex: number): number {
  const key = `${playerId}:${positionIndex}`;
  const cached = ctx.fitCache.get(key);
  if (cached !== undefined) return cached;
  const player = ctx.byId.get(playerId)!;
  const value = positionFit(player, POSITIONS[positionIndex].key);
  ctx.fitCache.set(key, value);
  return value;
}

function isExcluded(ctx: Context, playerId: string, positionIndex: number): boolean {
  const player = ctx.byId.get(playerId);
  if (!player?.excludedPositions) return false;
  return player.excludedPositions.includes(POSITIONS[positionIndex].key);
}

/** Counts players on the field this inning who satisfy the league minimum. */
function womenInInning(ctx: Context, row: readonly string[]): number {
  let count = 0;
  for (const id of row) {
    const player = ctx.byId.get(id);
    if (player && countsTowardMinimum(player)) count++;
  }
  return count;
}

/**
 * Scores a full lineup. Higher is better.
 *
 * Every term is divided through by the roster size or the slot count so the
 * weights stay comparable no matter how many people showed up.
 */
export function scoreAssignment(ctx: Context, assignment: readonly string[][]): { score: number; meanFit: number } {
  const slots = ctx.innings * FIELDERS_PER_INNING;

  let fitTotal = 0;
  for (let inning = 0; inning < ctx.innings; inning++) {
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) {
      fitTotal += fitOf(ctx, assignment[inning][pos], pos);
    }
  }
  const meanFit = fitTotal / slots;

  // Innings played and the set of positions each player saw.
  const played = new Map<string, number>();
  const positionsSeen = new Map<string, Set<number>>();
  for (let inning = 0; inning < ctx.innings; inning++) {
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) {
      const id = assignment[inning][pos];
      played.set(id, (played.get(id) ?? 0) + 1);
      let seen = positionsSeen.get(id);
      if (!seen) {
        seen = new Set<number>();
        positionsSeen.set(id, seen);
      }
      seen.add(pos);
    }
  }

  let fairness = 0;
  for (const player of ctx.players) {
    const target = ctx.shares.get(player.playerId) ?? 0;
    const actual = played.get(player.playerId) ?? 0;
    fairness += (actual - target) * (actual - target);
  }

  // Moving between two outfield spots is a much smaller ask than moving from
  // the outfield to catcher, so same-zone changes are discounted.
  let consistency = 0;
  for (const [, seen] of positionsSeen) {
    if (seen.size <= 1) continue;
    const indices = [...seen];
    const zones = new Set(indices.map((i) => POSITIONS[i].zone));
    const extras = indices.length - 1;
    const zoneChanges = zones.size - 1;
    consistency += zoneChanges * 1.0 + (extras - zoneChanges) * 0.4;
  }

  // Sitting two innings back to back means a long time on the sideline.
  let rest = 0;
  for (const player of ctx.players) {
    for (let inning = 0; inning + 1 < ctx.innings; inning++) {
      const satNow = !assignment[inning].includes(player.playerId);
      const satNext = !assignment[inning + 1].includes(player.playerId);
      if (satNow && satNext) rest++;
    }
  }

  const n = Math.max(1, ctx.players.length);
  const score =
    ctx.weights.fit * meanFit -
    ctx.weights.fairness * (fairness / n) -
    ctx.weights.consistency * (consistency / n) -
    ctx.weights.rest * (rest / n);

  return { score, meanFit };
}

/**
 * Builds a legal starting lineup.
 *
 * Who plays each inning comes from the fair-share targets: the players furthest
 * below their share take the field first, subject to the league minimum and to
 * anyone locked into this inning by hand. Positions are then filled greedily by
 * fit, scarcest position first, which gives the annealer somewhere sensible to
 * start rather than something random.
 */
function buildInitial(ctx: Context, rng: Rng, warnings: string[]): string[][] {
  const assignment: string[][] = [];
  const playedSoFar = new Map<string, number>(ctx.players.map((p) => [p.playerId, 0]));

  for (let inning = 0; inning < ctx.innings; inning++) {
    const locked = ctx.lockGrid[inning];
    const lockedIds = new Set(locked.filter((id): id is string => id !== null));

    // Rank everyone by how far behind their share they are, so the people who
    // have sat the most get the next inning.
    const remainingInnings = ctx.innings - inning;
    const candidates = ctx.players
      .filter((p) => !lockedIds.has(p.playerId))
      .map((p) => {
        const target = ctx.shares.get(p.playerId) ?? 0;
        const deficit = (target - (playedSoFar.get(p.playerId) ?? 0)) / remainingInnings;
        return { player: p, deficit, jitter: rng.next() * 1e-6 };
      })
      .sort((a, b) => b.deficit + b.jitter - (a.deficit + a.jitter));

    const onField: string[] = [...lockedIds];
    let women = onField.reduce((n, id) => n + (countsTowardMinimum(ctx.byId.get(id)!) ? 1 : 0), 0);

    // Take the neediest players, but reserve enough slots to satisfy the
    // league minimum before the field fills up with men.
    for (const c of candidates) {
      if (onField.length >= FIELDERS_PER_INNING) break;
      const isWoman = countsTowardMinimum(c.player);
      const slotsLeft = FIELDERS_PER_INNING - onField.length;
      const womenStillNeeded = ctx.minWomen - women;
      if (!isWoman && slotsLeft <= womenStillNeeded) continue;
      onField.push(c.player.playerId);
      if (isWoman) women++;
    }

    if (onField.length < FIELDERS_PER_INNING) {
      throw new DefenseInfeasibleError(
        `Only ${onField.length} players could be fielded in inning ${inning + 1}.`
      );
    }
    if (women < ctx.minWomen) {
      throw new DefenseInfeasibleError(
        `Inning ${inning + 1} could only field ${women} of the required ${ctx.minWomen}.`
      );
    }

    // Place the locked players, then fill the rest by fit.
    const row = new Array<string>(FIELDERS_PER_INNING).fill('');
    const unplaced = new Set(onField);
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) {
      if (locked[pos]) {
        row[pos] = locked[pos]!;
        unplaced.delete(locked[pos]!);
      }
    }

    const openPositions = [];
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) if (!row[pos]) openPositions.push(pos);

    // Fill the position with the fewest willing candidates first, otherwise a
    // specialist can get boxed out by a generalist taking their spot.
    openPositions.sort((a, b) => {
      const willing = (pos: number) => [...unplaced].filter((id) => !isExcluded(ctx, id, pos)).length;
      return willing(a) - willing(b);
    });

    for (const pos of openPositions) {
      const eligible = [...unplaced].filter((id) => !isExcluded(ctx, id, pos));
      const pool = eligible.length > 0 ? eligible : [...unplaced];
      if (eligible.length === 0) {
        warnings.push(
          `Nobody available for ${POSITIONS[pos].name} in inning ${inning + 1} without overriding a position opt-out.`
        );
      }
      let bestId = pool[0];
      let bestFit = -Infinity;
      for (const id of pool) {
        const f = fitOf(ctx, id, pos);
        if (f > bestFit) {
          bestFit = f;
          bestId = id;
        }
      }
      row[pos] = bestId;
      unplaced.delete(bestId);
    }

    assignment.push(row);
    for (const id of row) playedSoFar.set(id, (playedSoFar.get(id) ?? 0) + 1);
  }

  return assignment;
}

/** Players not on the field in this inning. */
function benchOf(ctx: Context, row: readonly string[]): string[] {
  const onField = new Set(row);
  return ctx.players.filter((p) => !onField.has(p.playerId)).map((p) => p.playerId);
}

/**
 * Generates the six-inning defensive lineup.
 *
 * Throws DefenseInfeasibleError when no legal lineup exists at all, for example
 * with fewer than ten players available. Constraints that can be met partially
 * are relaxed with a warning rather than failing outright, because a lineup
 * with a note attached is more useful on a Sunday morning than an error.
 */
export function optimizeDefense(
  players: readonly DefensePlayer[],
  options: DefenseOptions = {}
): DefenseResult {
  const innings = options.innings ?? 6;
  const seed = options.seed ?? 'defense';
  const iterations = options.iterations ?? 24000;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const warnings: string[] = [];

  if (players.length < FIELDERS_PER_INNING) {
    throw new DefenseInfeasibleError(
      `Need at least ${FIELDERS_PER_INNING} available players to field a defense; got ${players.length}.`
    );
  }

  const duplicates = players.length !== new Set(players.map((p) => p.playerId)).size;
  if (duplicates) throw new DefenseInfeasibleError('The same player appears twice in the availability list.');

  let minWomen = options.minWomenInField ?? 3;
  const womenAvailable = players.filter(countsTowardMinimum).length;
  if (womenAvailable < minWomen) {
    warnings.push(
      `League minimum is ${minWomen} but only ${womenAvailable} available, so every one of them is on the field each inning.`
    );
    minWomen = womenAvailable;
  }
  // Cannot require more women than there are spots.
  minWomen = Math.min(minWomen, FIELDERS_PER_INNING);

  const byId = new Map(players.map((p) => [p.playerId, p]));

  const lockGrid: (string | null)[][] = Array.from({ length: innings }, () =>
    new Array<string | null>(FIELDERS_PER_INNING).fill(null)
  );
  const lockedInInning: Set<string>[] = Array.from({ length: innings }, () => new Set<string>());
  for (const lock of options.locks ?? []) {
    const posIndex = POSITIONS.findIndex((p) => p.key === lock.positionKey);
    if (posIndex < 0 || lock.inning < 0 || lock.inning >= innings) continue;
    if (!byId.has(lock.playerId)) {
      warnings.push(`Ignored a locked assignment for a player who is not available.`);
      continue;
    }
    if (lockedInInning[lock.inning].has(lock.playerId)) {
      warnings.push(`Ignored a second locked position for the same player in inning ${lock.inning + 1}.`);
      continue;
    }
    lockGrid[lock.inning][posIndex] = lock.playerId;
    lockedInInning[lock.inning].add(lock.playerId);
  }

  const ctx: Context = {
    players: players.slice(),
    byId,
    innings,
    minWomen,
    weights,
    fitCache: new Map(),
    shares: fairShares(players, innings),
    lockGrid,
    lockedInInning,
  };

  const rng = new Rng(seed);
  let current = buildInitial(ctx, rng, warnings);
  let currentScore = scoreAssignment(ctx, current).score;
  let best = current.map((row) => row.slice());
  let bestScore = currentScore;

  // Simulated annealing. Both moves keep the lineup legal by construction, so
  // there is no repair step and no chance of returning something illegal.
  const startTemp = 0.06;
  const endTemp = 0.0009;

  for (let step = 0; step < iterations; step++) {
    const temp = startTemp * Math.pow(endTemp / startTemp, step / iterations);
    const inning = rng.int(innings);
    const row = current[inning];
    let candidate: string[] | null = null;

    if (rng.next() < 0.5) {
      // Swap two positions within the inning. The set of players on the field
      // is unchanged, so the gender count cannot break.
      const a = rng.int(FIELDERS_PER_INNING);
      const b = rng.int(FIELDERS_PER_INNING);
      if (a === b || lockGrid[inning][a] || lockGrid[inning][b]) continue;
      if (isExcluded(ctx, row[a], b) || isExcluded(ctx, row[b], a)) continue;
      candidate = row.slice();
      [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
    } else {
      // Bring someone off the bench in for a player currently on the field.
      const bench = benchOf(ctx, row);
      if (bench.length === 0) continue;
      const pos = rng.int(FIELDERS_PER_INNING);
      if (lockGrid[inning][pos]) continue;
      const incoming = rng.pick(bench);
      const outgoing = row[pos];
      if (isExcluded(ctx, incoming, pos)) continue;

      // Check the league minimum survives the substitution.
      const delta =
        (countsTowardMinimum(byId.get(incoming)!) ? 1 : 0) -
        (countsTowardMinimum(byId.get(outgoing)!) ? 1 : 0);
      if (womenInInning(ctx, row) + delta < minWomen) continue;

      candidate = row.slice();
      candidate[pos] = incoming;
    }

    const trial = current.map((r, i) => (i === inning ? candidate! : r));
    const trialScore = scoreAssignment(ctx, trial).score;
    const change = trialScore - currentScore;

    if (change > 0 || rng.next() < Math.exp(change / temp)) {
      current = trial;
      currentScore = trialScore;
      if (currentScore > bestScore) {
        bestScore = currentScore;
        best = current.map((r) => r.slice());
      }
    }
  }

  const final = scoreAssignment(ctx, best);

  const inningsPlayed: Record<string, number> = {};
  const positionsPlayed: Record<string, string[]> = {};
  for (const p of players) {
    inningsPlayed[p.playerId] = 0;
    positionsPlayed[p.playerId] = [];
  }
  for (let inning = 0; inning < innings; inning++) {
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) {
      const id = best[inning][pos];
      inningsPlayed[id]++;
      if (!positionsPlayed[id].includes(POSITIONS[pos].key)) positionsPlayed[id].push(POSITIONS[pos].key);
    }
  }

  const fairShare: Record<string, number> = {};
  for (const [id, share] of ctx.shares) fairShare[id] = share;

  return {
    assignment: best,
    inningsPlayed,
    fairShare,
    positionsPlayed,
    meanFit: final.meanFit,
    score: final.score,
    warnings,
  };
}
