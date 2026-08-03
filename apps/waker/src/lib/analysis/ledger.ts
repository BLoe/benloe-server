/**
 * Surplus and need — turning "I have three quarterbacks" into a trade.
 *
 * DECISION SERVED: "who should I actually be talking to, and about what?"
 *
 * A roster with three startable quarterbacks and one quarterback slot is
 * carrying dead value: the third one scores nothing for you all season and is
 * worth real money to somebody starting a replacement-level quarterback. Every
 * fantasy manager knows this in the abstract and almost none of them act on it,
 * because finding the counterparty means opening eleven other rosters and doing
 * the comparison by hand.
 *
 * This does that comparison. Surplus is measured in *startable* players beyond
 * what a lineup can hold; need is measured in slots being filled by someone at
 * or below replacement level. A match is a surplus on one side meeting a need
 * on the other, ranked by how much both sides gain — because a trade only
 * happens if it is good for the other manager too.
 */
import type { ReplacementLevels } from './replacement.js';

export interface LedgerPlayer {
  playerId: string;
  name: string;
  position: string | null;
  /** Projection, in whatever period the caller is working in. */
  points: number;
  /** Market value, for pricing the trade. Null where unpriced. */
  value: number | null;
}

export interface RosterInput {
  rosterId: number;
  teamName: string;
  players: LedgerPlayer[];
}

export interface PositionStanding {
  position: string;
  /** How many startable players this roster has at the position. */
  startable: number;
  /** How many the lineup can actually use. */
  slots: number;
  /** startable - slots. Positive is surplus, negative is a hole. */
  depth: number;
  /** Points above replacement from the players who will actually start. */
  starterVor: number;
  /** Players beyond what the lineup can hold, best first. */
  surplus: LedgerPlayer[];
  /** True when a starting slot is being filled at or below replacement. */
  needy: boolean;
}

/**
 * How many of each position one roster starts.
 *
 * Flex slots are counted separately: a flex is not a slot at any one position,
 * it is the reason a fourth receiver is still startable. Treating it as
 * fractional demand (as the replacement-level maths does) is right for pricing
 * a whole league, but wrong here — for a single roster the question is whether
 * this specific player gets on the field, and a flex means one more does.
 */
export function lineupShape(rosterPositions: string[]): {
  fixed: Map<string, number>;
  flex: { count: number; eligible: Set<string> };
} {
  const fixed = new Map<string, number>();
  const eligible = new Set<string>();
  let count = 0;

  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'TAXI' || slot === 'IR') continue;
    if (slot === 'FLEX') {
      count++;
      ['RB', 'WR', 'TE'].forEach((p) => eligible.add(p));
    } else if (slot === 'SUPER_FLEX') {
      count++;
      ['QB', 'RB', 'WR', 'TE'].forEach((p) => eligible.add(p));
    } else if (slot === 'WRRB_FLEX') {
      count++;
      ['RB', 'WR'].forEach((p) => eligible.add(p));
    } else if (slot === 'REC_FLEX') {
      count++;
      ['WR', 'TE'].forEach((p) => eligible.add(p));
    } else {
      fixed.set(slot, (fixed.get(slot) ?? 0) + 1);
    }
  }
  return { fixed, flex: { count, eligible } };
}

/**
 * Where one roster is deep and where it is thin.
 *
 * "Startable" means above replacement level — a fourth receiver who projects
 * below the waiver wire is not surplus, he is a bench body, and offering him in
 * a trade is how you get ignored.
 */
export function standings(
  roster: RosterInput,
  rosterPositions: string[],
  levels: ReplacementLevels
): PositionStanding[] {
  const { fixed, flex } = lineupShape(rosterPositions);
  const positions = new Set([...fixed.keys(), ...flex.eligible]);
  const out: PositionStanding[] = [];

  // Everyone startable beyond the fixed slots at their own position. Flex
  // capacity is then spent out of this pool; whatever it does not absorb is
  // genuine surplus.
  //
  // This is computed for every position, not only flex-eligible ones. Doing it
  // only for the flex positions made a spare quarterback in a one-QB league
  // invisible — which is the textbook case of dead value and the entire reason
  // this module exists.
  const leftovers = new Map<string, LedgerPlayer[]>();

  for (const position of positions) {
    const level = levels.byPosition.get(position);
    const group = roster.players
      .filter((p) => (p.position ?? '').toUpperCase() === position)
      .sort((a, b) => b.points - a.points);

    const startable = level == null ? group.length : group.filter((p) => p.points > level).length;
    const slots = fixed.get(position) ?? 0;

    out.push({
      position,
      startable,
      slots,
      depth: startable - slots,
      starterVor:
        level == null
          ? 0
          : group.slice(0, slots).reduce((s, p) => s + Math.max(0, p.points - level), 0),
      surplus: [],
      // A hole is a slot the roster cannot fill with anyone above replacement.
      needy: slots > 0 && startable < slots,
    });

    if (startable > slots) leftovers.set(position, group.slice(slots, startable));
  }

  // Spend the flex slots on the best leftovers that a flex can actually hold.
  // A spare quarterback cannot fill a FLEX, so he stays surplus.
  const pool = [...leftovers.entries()]
    .filter(([position]) => flex.eligible.has(position))
    .flatMap(([position, players]) => players.map((p) => ({ position, player: p })))
    .sort((a, b) => b.player.points - a.player.points);

  const flexed = new Set(pool.slice(0, flex.count).map((x) => x.player.playerId));

  for (const row of out) {
    const left = leftovers.get(row.position) ?? [];
    row.surplus = left.filter((p) => !flexed.has(p.playerId));
    row.depth = row.surplus.length;
  }

  return out.sort((a, b) => b.depth - a.depth);
}

/**
 * How much a side must gain before the deal is worth naming.
 *
 * Half a point a week. Below that the projections are not precise enough to
 * distinguish the two players, and the "upgrade" is noise.
 */
export const MIN_GAIN = 0.5;

export interface TradeMatch {
  /** The other roster. */
  rosterId: number;
  teamName: string;
  position: string;
  /** Who you would send. */
  give: LedgerPlayer;
  /** What they have spare that you need, if anything. */
  getPosition: string | null;
  get: LedgerPlayer | null;
  /** Points per week they gain by starting your surplus player. */
  theirGain: number;
  /** Points per week you gain from theirs. Zero for a one-way fit. */
  yourGain: number;
  /** Market values, so the proposal is checkable rather than asserted. */
  giveValue: number | null;
  getValue: number | null;
}

/**
 * Find the trades that make both rosters better.
 *
 * A one-way fit — they need what you have spare, you need nothing of theirs —
 * is still reported, because it is the trade you make for a pick or for value.
 * Two-way fits sort first because they are the ones that actually get accepted.
 */
export function findTrades(
  mine: RosterInput,
  others: RosterInput[],
  rosterPositions: string[],
  levels: ReplacementLevels
): TradeMatch[] {
  const myStandings = standings(mine, rosterPositions, levels);
  const mySurplus = myStandings.filter((s) => s.surplus.length);
  const myNeeds = new Set(myStandings.filter((s) => s.needy).map((s) => s.position));

  const matches: TradeMatch[] = [];

  for (const other of others) {
    const theirs = standings(other, rosterPositions, levels);
    const theirNeeds = new Set(theirs.filter((s) => s.needy).map((s) => s.position));

    for (const row of mySurplus) {
      if (!theirNeeds.has(row.position)) continue;
      const give = row.surplus[0];
      const level = levels.byPosition.get(row.position) ?? 0;

      // What they gain is the upgrade over what they are starting now, which is
      // by definition at or below replacement.
      const theirCurrent = other.players
        .filter((p) => (p.position ?? '').toUpperCase() === row.position)
        .sort((a, b) => b.points - a.points)[0];
      const theirGain = give.points - Math.max(theirCurrent?.points ?? 0, level);

      // Do they have anything spare that fills one of my holes?
      const backFill = theirs.find((s) => s.surplus.length && myNeeds.has(s.position));
      const get = backFill?.surplus[0] ?? null;
      const myLevel = backFill ? (levels.byPosition.get(backFill.position) ?? 0) : 0;
      const myCurrent = backFill
        ? mine.players
            .filter((p) => (p.position ?? '').toUpperCase() === backFill.position)
            .sort((a, b) => b.points - a.points)[0]
        : null;

      matches.push({
        rosterId: other.rosterId,
        teamName: other.teamName,
        position: row.position,
        give,
        getPosition: backFill?.position ?? null,
        get,
        theirGain,
        yourGain: get ? get.points - Math.max(myCurrent?.points ?? 0, myLevel) : 0,
        giveValue: give.value,
        getValue: get?.value ?? null,
      });
    }
  }

  return (
    matches
      // A trade nobody gains from is not a trade. The surplus/need test can
      // pair a spare player against a slot the other manager already fills
      // just as well, which produces a proposal worth exactly zero to them —
      // and sending that is how you get ignored.
      .filter((m) => m.theirGain > MIN_GAIN || m.yourGain > MIN_GAIN)
      .sort((a, b) => {
        // Two-way fits first, then by how much the deal is worth in total.
        const twoWay = Number(!!b.get) - Number(!!a.get);
        if (twoWay) return twoWay;
        return b.yourGain + b.theirGain - (a.yourGain + a.theirGain);
      })
  );
}
