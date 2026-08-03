/**
 * Value over replacement, computed for *this* league.
 *
 * DECISION SERVED: "is this player actually good, or just good at a position
 * where everyone is good?" — the question underneath every trade and every
 * waiver claim.
 *
 * A global ranking list cannot answer it. A tight end projected for 9 points a
 * week is a shrug in a league that starts one tight end from a deep pool and a
 * genuine asset in a league where the twelfth-best tight end projects for 4.
 * What matters is the gap to the player you could get for nothing — the
 * *replacement* — and that depends entirely on how many of each position this
 * league actually starts.
 *
 * Replacement level here is the projection of the last player who would be
 * rostered as a starter if every team filled its lineup optimally. Flex slots
 * are distributed across the positions eligible for them, because a 3-flex
 * league drains the running back and receiver pools far faster than a 0-flex
 * one and that is precisely what makes those positions scarce.
 */

export interface ReplacementLevels {
  /** Position -> the projection of the last startable player. */
  byPosition: Map<string, number>;
  /** How many of each position the league starts in total. */
  demand: Map<string, number>;
  /** Which flex slots existed and how they were distributed. */
  flexSlots: number;
}

/** Which positions each flex-type slot can be filled by. */
const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: [],
};

const REAL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * How many of each position this league starts every week.
 *
 * Flex slots are split across their eligible positions by how often each
 * actually fills one. That split is an assumption, so it is stated plainly
 * rather than hidden: in practice flexes go overwhelmingly to running backs and
 * receivers, with tight ends a distant third, and superflex is nearly always a
 * quarterback because a startable quarterback outscores a startable flex.
 */
const FLEX_WEIGHTS: Record<string, Record<string, number>> = {
  FLEX: { RB: 0.45, WR: 0.45, TE: 0.1 },
  WRRB_FLEX: { RB: 0.5, WR: 0.5 },
  REC_FLEX: { WR: 0.75, TE: 0.25 },
  SUPER_FLEX: { QB: 0.85, RB: 0.05, WR: 0.08, TE: 0.02 },
};

export function positionalDemand(
  rosterPositions: string[],
  numTeams: number
): { demand: Map<string, number>; flexSlots: number } {
  const demand = new Map<string, number>();
  let flexSlots = 0;

  const add = (pos: string, n: number) => demand.set(pos, (demand.get(pos) ?? 0) + n);

  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'TAXI' || slot === 'IR') continue;

    if (REAL_POSITIONS.has(slot)) {
      add(slot, numTeams);
      continue;
    }
    const weights = FLEX_WEIGHTS[slot];
    if (weights) {
      flexSlots++;
      for (const [pos, w] of Object.entries(weights)) add(pos, numTeams * w);
    }
  }
  return { demand, flexSlots };
}

export interface ProjectedPlayer {
  playerId: string;
  position: string | null;
  /** Projection over whatever period the caller is working in. */
  points: number;
}

/**
 * Replacement level per position, from the projections of everyone available.
 *
 * `players` should be the whole player pool the league draws on — rostered and
 * free agents alike. Passing only rostered players would set replacement level
 * at the worst rostered player, which is not replacement level at all.
 */
export function replacementLevels(
  players: ProjectedPlayer[],
  rosterPositions: string[],
  numTeams: number
): ReplacementLevels {
  const { demand, flexSlots } = positionalDemand(rosterPositions, numTeams);
  const byPosition = new Map<string, number>();

  const pools = new Map<string, number[]>();
  for (const p of players) {
    const pos = (p.position ?? '').toUpperCase();
    if (!REAL_POSITIONS.has(pos)) continue;
    const pool = pools.get(pos);
    if (pool) pool.push(p.points);
    else pools.set(pos, [p.points]);
  }

  for (const [pos, need] of demand) {
    const pool = pools.get(pos);
    if (!pool?.length) continue;
    pool.sort((a, b) => b - a);

    // The replacement is the next player *after* the last starter. Where the
    // pool is too shallow to reach that far, the worst player in it is the
    // honest answer rather than zero.
    const index = Math.min(Math.max(0, Math.round(need)), pool.length - 1);
    byPosition.set(pos, pool[index]);
  }

  return { byPosition, demand, flexSlots };
}

/** Points this player is worth above a freely available one at his position. */
export function valueOverReplacement(
  player: ProjectedPlayer,
  levels: ReplacementLevels
): number | null {
  const pos = (player.position ?? '').toUpperCase();
  const level = levels.byPosition.get(pos);
  if (level == null) return null;
  return player.points - level;
}
