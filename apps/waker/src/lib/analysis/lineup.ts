/**
 * The best lineup a roster could actually field.
 *
 * DECISION SERVED: none directly — this is the measuring stick everything on the
 * SEASON horizon stands on. You cannot simulate a league until you can say what
 * each team scores in a normal week, and the honest answer is not "the sum of
 * its projections" (that counts the whole bench) nor "the sum of its current
 * starters" (that punishes a manager for not having set a lineup in August). It
 * is what the roster would score with its slots filled properly.
 *
 * Three rules do the real work here.
 *
 *   A taxi or injured-reserve player cannot be started, whatever he projects.
 *   Sleeper keeps them in `players` alongside everyone else, so a rookie parked
 *   on the taxi squad will happily walk into a flex slot if you let him, and the
 *   team's expected score comes out too high.
 *
 *   A flex must not steal the only player at a dedicated position. A superflex
 *   handed the best quarterback on a one-quarterback roster leaves the QB slot
 *   empty and loses more than the flex gained. Dedicated slots are therefore
 *   filled first, which is optimal because only that position can fill them.
 *
 *   Flex slots are solved together, not one at a time. Greedy fails whenever two
 *   flex types overlap without nesting — a WRRB_FLEX and a REC_FLEX over one
 *   receiver, one back and one tight end give 35 points assigned properly and 25
 *   assigned in the wrong order. There are never many flex slots, so the exact
 *   answer is cheap enough to just compute.
 */

/** Which positions each flex-type slot accepts. */
const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};

/** Slots nobody starts from. */
const NON_PLAYING = new Set(['BN', 'TAXI', 'IR']);

/**
 * Above this many flex slots the exact search is abandoned for a greedy pass.
 * Six flexes is already an unusual league and 5^6 is 15,625 branches; the cap
 * exists so a malformed roster_positions array cannot hang the server.
 */
const MAX_EXACT_FLEX = 6;

export interface LineupPlayer {
  playerId: string;
  position: string | null;
  /** Projection over whatever period the caller is working in — a week, here. */
  points: number;
  onTaxi?: boolean;
  onIr?: boolean;
}

export interface FilledSlot {
  /** The slot as it appears in the league's roster_positions. */
  slot: string;
  player: LineupPlayer | null;
}

export interface ProjectedLineup {
  /** Every starting slot, in the order the league lists them. */
  slots: FilledSlot[];
  /** What the filled slots project to in total. */
  points: number;
  /** Slots nobody on the roster can fill. An empty slot scores zero. */
  empty: string[];
  /** Everyone who did not make it, best first. */
  bench: LineupPlayer[];
}

/** Which positions a slot accepts. An unrecognised slot is treated as its own position. */
export function slotEligibility(slot: string): string[] {
  return FLEX_ELIGIBLE[slot] ?? [slot.toUpperCase()];
}

export const isFlexSlot = (slot: string): boolean => slot in FLEX_ELIGIBLE;

/**
 * Fill the league's starting slots with the best players who can legally fill
 * them.
 *
 * Ties are broken on player id rather than left to sort stability, because this
 * feeds a seeded simulation: the same roster must produce the same expected
 * score on every run or the "deterministic odds" promise is a lie.
 */
export function projectLineup(
  players: LineupPlayer[],
  rosterPositions: string[]
): ProjectedLineup {
  const startable = players.filter((p) => !p.onTaxi && !p.onIr && p.position);

  const pools = new Map<string, LineupPlayer[]>();
  for (const p of startable) {
    const pos = (p.position ?? '').toUpperCase();
    const pool = pools.get(pos);
    if (pool) pool.push(p);
    else pools.set(pos, [p]);
  }
  for (const pool of pools.values()) {
    pool.sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : 1));
  }

  /** How many of each position have been spent. */
  const used = new Map<string, number>();
  const nextAt = (pos: string): LineupPlayer | undefined =>
    pools.get(pos)?.[used.get(pos) ?? 0];
  const take = (pos: string): LineupPlayer | undefined => {
    const p = nextAt(pos);
    if (p) used.set(pos, (used.get(pos) ?? 0) + 1);
    return p;
  };

  const slots = rosterPositions.filter((s) => !NON_PLAYING.has(s));
  const filled: Array<LineupPlayer | null> = slots.map(() => null);

  // Dedicated slots first. Only one position can fill them, so taking the best
  // available at that position is optimal and nothing later can improve on it.
  slots.forEach((slot, i) => {
    if (isFlexSlot(slot)) return;
    filled[i] = take(slotEligibility(slot)[0]) ?? null;
  });

  // Then the flexes, solved as one problem.
  const flexIndexes = slots.map((s, i) => (isFlexSlot(s) ? i : -1)).filter((i) => i >= 0);
  if (flexIndexes.length) {
    const eligibility = flexIndexes.map((i) => slotEligibility(slots[i]));
    const picks =
      flexIndexes.length <= MAX_EXACT_FLEX
        ? bestFlexAssignment(eligibility, nextAt, used)
        : greedyFlexAssignment(eligibility, nextAt, used);
    picks.forEach((pos, n) => {
      filled[flexIndexes[n]] = pos ? take(pos) ?? null : null;
    });
  }

  const chosen = new Set(filled.filter(Boolean).map((p) => p!.playerId));
  return {
    slots: slots.map((slot, i) => ({ slot, player: filled[i] })),
    points: filled.reduce((sum, p) => sum + (p?.points ?? 0), 0),
    empty: slots.filter((_, i) => !filled[i]),
    bench: players
      .filter((p) => !chosen.has(p.playerId))
      .sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : 1)),
  };
}

/** Convenience: what this roster scores in a normal week. */
export const lineupPoints = (players: LineupPlayer[], rosterPositions: string[]): number =>
  projectLineup(players, rosterPositions).points;

/**
 * The exact best assignment of positions to flex slots.
 *
 * Only the top remaining player at each position is ever worth considering: two
 * players at the same position are interchangeable across every slot that
 * accepts them, so taking the lesser one can never help. That collapses the
 * search to "which position does each flex draw from", which is small.
 *
 * Leaving a flex empty stays on the table because a projection can be negative
 * (a defence can lose you points), and a slot you cannot fill is a real outcome
 * on a thin roster.
 */
function bestFlexAssignment(
  eligibility: string[][],
  nextAt: (pos: string) => LineupPlayer | undefined,
  used: Map<string, number>
): Array<string | null> {
  const spend = (pos: string) => used.set(pos, (used.get(pos) ?? 0) + 1);
  const refund = (pos: string) => used.set(pos, (used.get(pos) ?? 0) - 1);

  const search = (i: number): { points: number; picks: Array<string | null> } => {
    if (i === eligibility.length) return { points: 0, picks: [] };

    let best: { points: number; picks: Array<string | null> } | null = null;

    for (const pos of eligibility[i]) {
      const player = nextAt(pos);
      if (!player) continue;
      spend(pos);
      const rest = search(i + 1);
      refund(pos);
      const total = player.points + rest.points;
      if (!best || total > best.points) best = { points: total, picks: [pos, ...rest.picks] };
    }

    const skipped = search(i + 1);
    if (!best || skipped.points > best.points) {
      best = { points: skipped.points, picks: [null, ...skipped.picks] };
    }
    return best;
  };

  return search(0).picks;
}

/**
 * Fallback for absurd numbers of flex slots: narrowest slot first, best player
 * available. Not always optimal, but a league with seven flexes has bigger
 * problems and this at least never starves a restrictive slot.
 */
function greedyFlexAssignment(
  eligibility: string[][],
  nextAt: (pos: string) => LineupPlayer | undefined,
  used: Map<string, number>
): Array<string | null> {
  const order = eligibility
    .map((positions, index) => ({ positions, index }))
    .sort((a, b) => a.positions.length - b.positions.length);

  const picks: Array<string | null> = eligibility.map(() => null);
  for (const { positions, index } of order) {
    let bestPos: string | null = null;
    let bestPoints = -Infinity;
    for (const pos of positions) {
      const player = nextAt(pos);
      if (player && player.points > bestPoints) {
        bestPoints = player.points;
        bestPos = pos;
      }
    }
    if (bestPos) {
      picks[index] = bestPos;
      used.set(bestPos, (used.get(bestPos) ?? 0) + 1);
    }
  }
  // The caller spends the picks itself, so hand the cursors back untouched.
  for (const pos of picks) if (pos) used.set(pos, (used.get(pos) ?? 0) - 1);
  return picks;
}
