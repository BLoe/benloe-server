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
import { fitCounts, resample, type PriceCurve } from './history.js';

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
 * Games a starter at each position is actually available for across a
 * seventeen-game season.
 *
 * Injury and bye attrition is why a league CONSUMES more distinct players at a
 * position than it STARTS in any given week: twelve teams starting two running
 * backs burn through far more than twenty-four of them. These are round
 * approximations of published man-games figures, and they are the only numbers
 * in this file that are not derived from the league itself — a candidate for
 * measuring off nflverse later.
 */
export const GAMES_AVAILABLE: Record<Position, number> = {
  QB: 15.5,
  RB: 13.5,
  WR: 14.0,
  TE: 14.5,
  // Streamed weekly rather than rostered through injury, so no attrition.
  DEF: 17,
  K: 17,
};

/**
 * How deep the league's demand really runs, on a man-games footing.
 *
 * Setting replacement at the last starter ("VOLS") is the common choice and it
 * is measurably too shallow: it concentrates the budget at the top of the
 * board. Checked against two years of the Columbus league's own auctions, a
 * last-starter baseline priced the top back at $78 in a room that has never
 * paid more than $65 for anyone.
 *
 * The published guidance is to blend the two — a starter-weighted baseline for
 * the players who actually hold jobs, a man-games baseline for the depth a
 * season really consumes. The 40/60 split is the recommended default.
 */
export const VOLS_WEIGHT = 0.4;

export function beerDemand(
  players: PlayerProjection[],
  cfg: LeagueConfig
): Record<Position, number> {
  const starters = effectiveDemand(players, cfg);
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const manGames = starters[pos] * (17 / (GAMES_AVAILABLE[pos] ?? 17));
    out[pos] = VOLS_WEIGHT * starters[pos] + (1 - VOLS_WEIGHT) * manGames;
  }
  return out;
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
  const demand = beerDemand(players, cfg);
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const list = groups.get(pos) ?? [];
    const need = Math.round(demand[pos]);
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
export interface BoardOptions {
  /** This league's own auction history, if it has any. */
  curve?: PriceCurve | null;
  /**
   * How much of the price comes from history rather than from the model.
   *
   * Not 1.0, however tempting: history knows what this room paid for LAST
   * year's players, not who is good this year. The model supplies the ordering
   * and reacts to a changed player pool; history supplies the shape of the
   * spend. 0.6 leans on the room's own repeated behaviour while leaving the
   * model able to move a price when the talent genuinely differs.
   */
  historyWeight?: number;
}

/**
 * How many of each position this league will actually draft.
 *
 * With history, this is measured: the Columbus league drafts nine defences and
 * eighty receivers, every year, and a model that prices thirty-two defences is
 * inventing a market. Without it, fall back to whichever players clear
 * replacement, which is the best guess available.
 */
function poolCounts(
  withVor: Array<PlayerProjection & { vor: number }>,
  cfg: LeagueConfig,
  curve: PriceCurve | null | undefined
): Record<Position, number> {
  const target = draftablePlayers(cfg);

  // The model's own view: whoever clears replacement, by value.
  const modelled = {} as Record<Position, number>;
  for (const pos of POSITIONS) modelled[pos] = 0;
  for (const p of withVor.slice(0, target)) modelled[p.position] += 1;

  if (!curve) return modelled;

  // A calibration source that does not cover a position must not erase it.
  // FantasyCalc carries no defences at all — they are never traded — and taking
  // its counts literally priced ZERO defences in a league that starts one.
  const merged = {} as Record<Position, number>;
  const rostered = new Set<Position>(rosteredPositions(cfg));
  for (const pos of POSITIONS) {
    const fromCurve = curve.counts[pos] ?? 0;
    // The fallback is ROSTER DEMAND, not the model's own count. Reaching for
    // the model here re-imported the very error the calibration exists to fix:
    // it wanted thirty-two defences because their value-over-replacement looks
    // real on paper. A league that starts one of something drafts about one of
    // something per team, plus a couple of spares.
    const demand = Math.ceil(cfg.slots[pos as keyof typeof cfg.slots] * cfg.teams * 1.15);
    merged[pos] = fromCurve > 0 || !rostered.has(pos) ? fromCurve : Math.max(1, demand);
  }
  return fitCounts(merged, target);
}

/**
 * The full board: every player priced in dollars.
 *
 * The conversion clears the room's money exactly. Every drafted player costs at
 * least the minimum bid, so `teams x slots x minBid` is spoken for before any
 * bidding happens; what remains is discretionary and is split in proportion to
 * surplus value, then — where the league has a history — bent toward what this
 * particular room has actually paid at each rank.
 *
 * Prices SUM to the budget. That is not decoration: inflation is money left
 * over value left, and it is meaningless if the two sides are not commensurate.
 */
export function valueBoard(
  players: PlayerProjection[],
  cfg: LeagueConfig,
  options: BoardOptions = {}
): PlayerValue[] {
  const { curve = null, historyWeight = 0.6 } = options;

  // A position the league does not roster is not in the market at all. Kickers
  // in a no-kicker league would otherwise price above every wide receiver.
  const inMarket = new Set<Position>(rosteredPositions(cfg));
  const eligible = players.filter((p) => inMarket.has(p.position));

  const replacement = replacementLevels(eligible, cfg);

  const withVor = eligible
    .map((p) => ({ ...p, vor: p.points - (replacement[p.position] ?? 0) }))
    .sort((a, b) => b.vor - a.vor);

  // Who gets drafted, by position.
  const counts = poolCounts(withVor, cfg, curve);
  const groups = groupByPosition(eligible);
  const pool = new Set<string>();
  const rankInPool = new Map<string, number>();
  for (const pos of POSITIONS) {
    const list = groups.get(pos) ?? [];
    const take = Math.min(counts[pos] ?? 0, list.length);
    for (let i = 0; i < take; i++) {
      pool.add(list[i].id);
      rankInPool.set(list[i].id, i);
    }
  }

  const poolSize = pool.size;
  const discretionary = totalMoney(cfg) - poolSize * cfg.minBid;
  const surplus = withVor
    .filter((p) => pool.has(p.id))
    .reduce((sum, p) => sum + Math.max(0, p.vor), 0);

  // The model's own price: minimum bid plus a share of the discretionary money
  // proportional to surplus value.
  const modelPrice = new Map<string, number>();
  for (const p of withVor) {
    if (!pool.has(p.id)) {
      modelPrice.set(p.id, 0);
      continue;
    }
    const share = surplus > 0 ? Math.max(0, p.vor) / surplus : 0;
    modelPrice.set(p.id, cfg.minBid + share * discretionary);
  }

  // Bend it toward what this room actually pays at each rank.
  const blended = new Map<string, number>();
  for (const [id, price] of modelPrice) blended.set(id, price);

  if (curve) {
    for (const pos of POSITIONS) {
      const list = (groups.get(pos) ?? []).filter((p) => pool.has(p.id));
      if (list.length === 0) continue;
      const source = curve.prices[pos] ?? [];
      // No prices for this position in the calibration source: keep the model's,
      // rather than blending toward zero.
      if (source.length === 0) continue;

      // Take the SHAPE and the LEVEL from the curve; adjust the level only for
      // a difference in STARTING REQUIREMENT.
      //
      // An earlier version rescaled each position to the model's own spend,
      // reasoning that a 3-WR league should not inherit a 4-WR league's
      // receiver budget. True for receivers — and catastrophic for defences.
      // The model thinks defences are worth $58 a draft, because a good one
      // out-projects replacement by fifteen points. Real rooms have paid $10,
      // $12 and $18 for ALL of them, three years running. Rescaling to the
      // model threw away the one number history had exactly right, and put a
      // $17 price on a defence.
      //
      // What actually differs between leagues is how many of a position they
      // start. Both leagues start one defence, so that level transfers
      // untouched. One starts four receivers and the other three, so that one
      // scales. The model gets no vote on the level at all.
      const historical = resample(source, list.length);
      const from = curve.sourceStarters?.[pos] ?? 0;
      const to = startingDemand(cfg)[pos] ?? 0;
      const level = from > 0 && to > 0 ? to / from : 1;

      // Blend the two curves to get the SHAPE...
      const mixed = list.map((p, i) => {
        const model = modelPrice.get(p.id) ?? 0;
        return (1 - historyWeight) * model + historyWeight * (historical[i] ?? 0);
      });

      // ...then force the position's TOTAL back to what history says the
      // position costs. The model gets no say in the level at all, and this is
      // why: its defence valuation is not a weak signal, it is not a signal.
      // It is an artifact of applying value-over-replacement to a position
      // nobody bids on, and blending even 40% of it in still priced every
      // defence in a draft at $39 against a league that has never spent more
      // than $18 on all of them together.
      const target = historical.reduce((a, b) => a + b, 0) * level;
      const mixedSum = mixed.reduce((a, b) => a + b, 0);
      const fit = mixedSum > 0 ? target / mixedSum : 1;

      list.forEach((p, i) => blended.set(p.id, mixed[i] * fit));
    }
  }

  // Blending two curves does not preserve the total, so re-clear the room. Only
  // the surplus above the minimum is scaled; a dollar player stays a dollar
  // player.
  const above = [...blended.values()].reduce((sum, v) => sum + Math.max(0, v - cfg.minBid), 0);
  const scale = above > 0 ? discretionary / above : 0;

  // Positional rank runs over everyone; tiers run over the DRAFTED pool only.
  // Computing a gap threshold across two hundred running backs makes the mean
  // gap vanishingly small, and then every elite back lands in a tier of one —
  // which is precisely backwards, since the top of the board is where tiers
  // carry the most information.
  const tierById = new Map<string, number>();
  const posRankById = new Map<string, number>();
  for (const [, list] of groups) {
    list.forEach((p, i) => posRankById.set(p.id, i + 1));
    const drafted = list.filter((p) => pool.has(p.id));
    const tiers = assignTiers(drafted);
    drafted.forEach((p, i) => tierById.set(p.id, tiers[i] ?? 1));
    // Everyone outside the pool shares one bottom group, marked tier 0: it is
    // not a tier, it is the remainder, and counting it is meaningless.
    for (const p of list) if (!tierById.has(p.id)) tierById.set(p.id, 0);
  }

  return withVor.map((p, index) => {
    const raw = blended.get(p.id) ?? 0;
    const price = pool.has(p.id) ? cfg.minBid + Math.max(0, raw - cfg.minBid) * scale : 0;
    return {
      ...p,
      replacement: replacement[p.position] ?? 0,
      baseValue: Math.round(price * 10) / 10,
      posRank: posRankById.get(p.id) ?? 0,
      overallRank: index + 1,
      tier: tierById.get(p.id) ?? 0,
    };
  });
}

// Kept exported for the calibration harness.
export type { PriceCurve };
