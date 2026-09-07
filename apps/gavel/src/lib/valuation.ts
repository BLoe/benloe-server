/**
 * Projected points -> auction dollars.
 *
 * The chain is: league-scored season points, then value over replacement, then
 * a budget-clearing conversion of that surplus into dollars. Each step is
 * separate and separately tested, because the whole point of the structure is
 * that tonight's crude projections can be swapped for a better source later
 * WITHOUT any of this changing. The input contract is a points number per
 * player; everything below is league rules and arithmetic.
 *
 * Why not just import a dollar column from somewhere:
 *  - A published $ list is priced for a generic league. Neither of these two is
 *    generic (six-point passing TDs; four wide receivers; no kicker).
 *  - Inflation, max bid and "what is left at this position" all need a value
 *    that responds to the league's own demand curve. A static price cannot.
 */
import {
  FLEX_ELIGIBLE,
  POSITIONS,
  draftablePlayers,
  flexDemand,
  rosteredPositions,
  startingDemand,
  totalMoney,
  type LeagueConfig,
  type Position,
} from './league.js';

export interface PlayerProjection {
  /** Canonical id. Sleeper's player id today; the crosswalk key for Yahoo. */
  id: string;
  name: string;
  position: Position;
  team: string | null;
  /** Season points under THIS league's scoring. Never a canned points column. */
  points: number;
  byeWeek?: number | null;
  adp?: number | null;
  injury?: string | null;
}

export interface PlayerValue extends PlayerProjection {
  /** Points above this league's replacement level at the player's position. */
  vor: number;
  /** The replacement baseline used, in points. Kept so the UI can show its work. */
  replacement: number;
  /** Dollars at the opening nomination, before any inflation. */
  baseValue: number;
  /** 1-indexed rank within position, by points. */
  posRank: number;
  /** 1-indexed rank overall, by VOR. */
  overallRank: number;
  /** 1-indexed tier within position; 1 is the best. */
  tier: number;
}

const byPointsDesc = (a: PlayerProjection, b: PlayerProjection) => b.points - a.points;

/** Group players by position, each list sorted best-first. */
export function groupByPosition(players: PlayerProjection[]): Map<Position, PlayerProjection[]> {
  const groups = new Map<Position, PlayerProjection[]>();
  for (const pos of POSITIONS) groups.set(pos, []);
  for (const p of players) {
    const list = groups.get(p.position);
    if (list) list.push(p);
  }
  for (const list of groups.values()) list.sort(byPointsDesc);
  return groups;
}

/**
 * How many of each position the league actually starts, once flex is resolved.
 *
 * Flex is allocated greedily against the real projections rather than by a
 * fixed assumption: fill the base requirement at every position, then hand each
 * flex slot to whichever eligible position has the best player still unclaimed.
 * In a 4-WR league that pulls flex heavily toward receivers, which is exactly
 * the effect that should show up in replacement level — and would be missed by
 * a rule of thumb that always splits flex between running backs and receivers.
 */
export function effectiveDemand(
  players: PlayerProjection[],
  cfg: LeagueConfig
): Record<Position, number> {
  const groups = groupByPosition(players);
  const demand = { ...startingDemand(cfg) };

  let flexLeft = flexDemand(cfg);
  while (flexLeft > 0) {
    let bestPos: Position | null = null;
    let bestPoints = -Infinity;
    for (const pos of FLEX_ELIGIBLE) {
      const next = groups.get(pos)?.[demand[pos]];
      if (next && next.points > bestPoints) {
        bestPoints = next.points;
        bestPos = pos;
      }
    }
    // Ran out of eligible players entirely; leave the remaining flex unassigned
    // rather than looping forever.
    if (!bestPos) break;
    demand[bestPos] += 1;
    flexLeft -= 1;
  }
  return demand;
}

/**
 * Replacement level per position, in points.
 *
 * Replacement is the best player who does NOT hold a starting job league-wide —
 * index `demand` in a zero-based list of `demand` starters. That is the honest
 * marginal alternative in an auction: if you refuse to pay for the last starting
 * tight end, this is what you get instead.
 *
 * A position with fewer players than starting jobs (defenses in a thin
 * projection set) falls back to its worst projected player, and then to zero.
 */
export function replacementLevels(
  players: PlayerProjection[],
  cfg: LeagueConfig
): Record<Position, number> {
  const groups = groupByPosition(players);
  const demand = effectiveDemand(players, cfg);
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const list = groups.get(pos) ?? [];
    const need = demand[pos];
    if (need <= 0 || list.length === 0) {
      out[pos] = 0;
      continue;
    }
    out[pos] = (list[need] ?? list[list.length - 1]).points;
  }
  return out;
}

/**
 * Tiers, from gaps in projected points within a position.
 *
 * A tier break is a drop larger than the position's own typical drop — using a
 * fixed points threshold instead would put every quarterback in one tier and
 * every tight end in twelve, because the positions have completely different
 * spreads. Tiers are the thing a draft board is actually for: they say whether
 * waiting costs you nothing or costs you the last player of a kind.
 */
export function assignTiers(sorted: PlayerProjection[], breakAt = 0.85): number[] {
  if (sorted.length === 0) return [];
  if (sorted.length === 1) return [1];

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1].points - sorted[i].points);

  // A threshold taken from the MEAN gap is not scale-free: at the top of a
  // position the gaps are several times the average, so nearly every one of
  // them broke a tier and the best players each got a tier of one. A quantile
  // asks the right question instead — "is this drop unusually large FOR THIS
  // POSITION" — and yields a stable handful of tiers whatever the shape of the
  // curve.
  const threshold = quantile(gaps, breakAt);

  const tiers = [1];
  let tier = 1;
  for (const gap of gaps) {
    if (threshold > 0 && gap > threshold) tier += 1;
    tiers.push(tier);
  }
  return tiers;
}

/** Linear-interpolated quantile. Small samples make the exact method matter. */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The full board: every player priced in dollars.
 *
 * The conversion clears the room's money exactly. Every drafted player costs at
 * least the minimum bid, so `teams x slots x minBid` is spoken for before any
 * bidding happens; what remains is discretionary and is split in proportion to
 * surplus value. The consequence is a board whose prices SUM to the budget,
 * which is what makes inflation meaningful later: if the room overpays early,
 * the deficit has to come out of someone.
 */
export function valueBoard(players: PlayerProjection[], cfg: LeagueConfig): PlayerValue[] {
  // A position the league does not roster is not in the market at all. Kickers
  // in a no-kicker league would otherwise price above every wide receiver.
  const inMarket = new Set<Position>(rosteredPositions(cfg));
  const eligible = players.filter((p) => inMarket.has(p.position));

  const replacement = replacementLevels(eligible, cfg);

  const withVor = eligible
    .map((p) => ({ ...p, vor: p.points - (replacement[p.position] ?? 0) }))
    .sort((a, b) => b.vor - a.vor);

  // Only the players who will actually be drafted compete for the money.
  // Pricing the 400th receiver would dilute every real bid.
  const poolSize = draftablePlayers(cfg);
  const pool = withVor.slice(0, poolSize);
  const inPool = new Set(pool.map((p) => p.id));

  // Positional rank runs over everyone; tiers run over the DRAFTED pool only.
  // Computing a gap threshold across two hundred running backs makes the mean
  // gap vanishingly small, and then every elite back lands in a tier of one —
  // which is precisely backwards, since the top of the board is where tiers
  // carry the most information.
  const groups = groupByPosition(eligible);
  const tierById = new Map<string, number>();
  const posRankById = new Map<string, number>();
  for (const [, list] of groups) {
    list.forEach((p, i) => posRankById.set(p.id, i + 1));
    const drafted = list.filter((p) => inPool.has(p.id));
    const tiers = assignTiers(drafted);
    drafted.forEach((p, i) => tierById.set(p.id, tiers[i] ?? 1));
    // Everyone below the drafted pool shares one bottom group. It is marked
    // with tier 0 rather than a real tier number: it is not a tier, it is the
    // remainder, and counting how many players are "left" in it is meaningless.
    for (const p of list) if (!tierById.has(p.id)) tierById.set(p.id, 0);
  }

  const discretionary = totalMoney(cfg) - poolSize * cfg.minBid;
  const surplus = pool.reduce((sum, p) => sum + Math.max(0, p.vor), 0);

  return withVor.map((p, index) => {
    const drafted = index < poolSize;
    const share = surplus > 0 && drafted ? Math.max(0, p.vor) / surplus : 0;
    // Below-replacement players are worth the minimum and nothing more; there
    // is no such thing as a negative bid.
    const baseValue = drafted ? cfg.minBid + share * discretionary : 0;
    return {
      ...p,
      replacement: replacement[p.position] ?? 0,
      baseValue: Math.round(baseValue * 10) / 10,
      posRank: posRankById.get(p.id) ?? 0,
      overallRank: index + 1,
      tier: tierById.get(p.id) ?? 1,
    };
  });
}
