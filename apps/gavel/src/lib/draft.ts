/**
 * Live draft state: what your money is doing, and who is gone.
 *
 * THE MODEL, and why it changed. Picks used to name the manager who bought the
 * player. That was the slowest thing in the app — finding a name in a list of
 * twelve, mid-nomination, while the auctioneer moved on — and after one live
 * draft it turned out to be information the board never used. Who else owns a
 * player changes nothing you can act on; the draft room shows it anyway.
 *
 * So a pick records ONE bit about ownership: `mine`. That is enough for every
 * number here. Your budget and roster come from your own picks; the room's
 * money and remaining slots come from the totals, which do not care who paid.
 *
 * Everything is pure and synchronous. This recomputes on every pick and has to
 * be instant on a second monitor while the real draft runs on the first.
 */
import { FLEX_ELIGIBLE, POSITIONS, slotsPerTeam, startingDemand, type LeagueConfig, type Position } from './league.js';
import type { PlayerValue } from './valuation.js';

export interface Pick {
  /** Monotonic, assigned by the server. Also the undo order. */
  seq: number;
  playerId: string;
  price: number;
  at: number;
  /** Whether YOU bought him. The only thing the board needs to know. */
  mine?: boolean;
  /**
   * A keeper is a pick made before the draft: a player and a price. Modelling
   * it as one keeps the money honest — a keeper's salary leaves the room and
   * its roster spot leaves the pool, and both fall out of the same fold.
   */
  keeper?: boolean;
}

export interface MyTeam {
  spent: number;
  /** Dollars still in the wallet. */
  remaining: number;
  filled: number;
  openSlots: number;
  /**
   * The most you could bid on the next player without being unable to fill the
   * roster at the minimum. Not the same as dollars remaining, and the
   * difference is how people overpay in the endgame.
   */
  maxBid: number;
  /** Starting jobs still unfilled, by position. */
  needs: Record<Position, number>;
  flexOpen: number;
  benchOpen: number;
  roster: Pick[];
}

export interface DraftState {
  picks: Pick[];
  /** Picks made before the draft. A subset of `picks`, never separate from it. */
  keepers: Pick[];
  me: MyTeam;
  /** Money still unspent across the whole room. */
  moneyLeft: number;
  /** Roster spots still to be filled across the whole room. */
  slotsLeft: number;
  /** Base value of every undrafted player still expected to be drafted. */
  valueLeft: number;
  /**
   * Money chasing value. Above 1 the room has cash left over and prices will
   * run hot; below 1 it overspent early and there are bargains coming.
   */
  inflation: number;
  drafted: Set<string>;
}

/** Per-team starting requirement, by position. */
function startingSlots(cfg: LeagueConfig): Record<Position, number> {
  const s = cfg.slots;
  return { QB: s.QB, RB: s.RB, WR: s.WR, TE: s.TE, DEF: s.DEF, K: s.K };
}

/**
 * Which of your slots a set of picks fills.
 *
 * Starters first, then flex from whatever spills over at a flex-eligible
 * position, then bench. Five running backs in a 2-RB league fills RB, takes the
 * flex, and benches two — and you still need a tight end. Getting this wrong
 * makes the needs row lie, and that row is the one you draft against.
 */
export function fillSlots(
  roster: Pick[],
  valuesById: Map<string, PlayerValue>,
  cfg: LeagueConfig
): { needs: Record<Position, number>; flexOpen: number; benchOpen: number } {
  const required = startingSlots(cfg);
  const counts = {} as Record<Position, number>;
  for (const pos of POSITIONS) counts[pos] = 0;

  for (const pick of roster) {
    const pos = valuesById.get(pick.playerId)?.position;
    if (pos) counts[pos] += 1;
  }

  const needs = {} as Record<Position, number>;
  let spill = 0;
  for (const pos of POSITIONS) {
    needs[pos] = Math.max(0, required[pos] - counts[pos]);
    if (FLEX_ELIGIBLE.includes(pos)) spill += Math.max(0, counts[pos] - required[pos]);
  }

  const flexOpen = Math.max(0, cfg.slots.FLEX - Math.min(cfg.slots.FLEX, spill));
  const starterSlots = Object.values(required).reduce((a, b) => a + b, 0) + cfg.slots.FLEX;
  const startersFilled =
    starterSlots - Object.values(needs).reduce((a, b) => a + b, 0) - flexOpen;
  const onBench = Math.max(0, roster.length - startersFilled);

  return { needs, flexOpen, benchOpen: Math.max(0, cfg.slots.BN - onBench) };
}

/**
 * Fold the pick list into league state.
 *
 * Picks are the single source of truth; every number here is derived. That is
 * what makes undo trivial and what makes a reload reproduce exactly the screen
 * you were looking at.
 */
export function deriveState(
  picks: Pick[],
  values: PlayerValue[],
  cfg: LeagueConfig
): DraftState {
  const valuesById = new Map(values.map((v) => [v.id, v]));
  const drafted = new Set(picks.map((p) => p.playerId));
  const roster = picks.filter((p) => p.mine);

  const capacity = slotsPerTeam(cfg.slots);
  const spent = roster.reduce((sum, p) => sum + p.price, 0);
  const filled = roster.length;
  const openSlots = Math.max(0, capacity - filled);
  const remaining = cfg.budget - spent;
  const { needs, flexOpen, benchOpen } = fillSlots(roster, valuesById, cfg);

  const me: MyTeam = {
    spent,
    remaining,
    filled,
    openSlots,
    // Hold back the minimum bid for every slot after this one.
    maxBid: openSlots <= 0 ? 0 : Math.max(0, remaining - (openSlots - 1) * cfg.minBid),
    needs,
    flexOpen,
    benchOpen,
    roster,
  };

  // The room's totals do not care who paid, which is exactly why one bit of
  // ownership is enough.
  const roomSpent = picks.reduce((sum, p) => sum + p.price, 0);
  const moneyLeft = cfg.teams * cfg.budget - roomSpent;
  const slotsLeft = Math.max(0, cfg.teams * capacity - picks.length);

  // Only players who will still be drafted carry value. Taking the top
  // `slotsLeft` undrafted keeps both sides of the ratio measuring the same thing.
  const undrafted = values
    .filter((v) => !drafted.has(v.id))
    .sort((a, b) => b.baseValue - a.baseValue)
    .slice(0, slotsLeft);
  const valueLeft = undrafted.reduce((sum, v) => sum + v.baseValue, 0);

  return {
    picks,
    keepers: picks.filter((p) => p.keeper),
    me,
    moneyLeft,
    slotsLeft,
    valueLeft,
    inflation: valueLeft > 0 ? moneyLeft / valueLeft : 1,
    drafted,
  };
}

/**
 * A player's price right now, adjusted for how the room has actually spent.
 *
 * The minimum bid is never inflated — a dollar player is a dollar player
 * however hot the room is. Only the surplus above it moves.
 */
export function adjustedValue(value: PlayerValue, state: DraftState, cfg: LeagueConfig): number {
  if (value.baseValue <= cfg.minBid) return cfg.minBid;
  const adjusted = cfg.minBid + (value.baseValue - cfg.minBid) * state.inflation;
  return Math.round(Math.max(cfg.minBid, adjusted) * 10) / 10;
}

/**
 * Remaining above-replacement players per position, against remaining demand.
 *
 * Demand is estimated league-wide rather than read off each roster: without
 * tracking who owns what, the honest assumption is that drafted players fill
 * starting jobs before bench ones. A ratio below 1 means there are not enough
 * starters left to go round, which is when a position's price spikes.
 */
export function scarcity(
  state: DraftState,
  values: PlayerValue[],
  cfg: LeagueConfig
): Record<Position, { supply: number; demand: number; ratio: number }> {
  const starters = startingDemand(cfg);
  const takenAt = {} as Record<Position, number>;
  for (const pos of POSITIONS) takenAt[pos] = 0;
  for (const v of values) if (state.drafted.has(v.id)) takenAt[v.position] += 1;

  const out = {} as Record<Position, { supply: number; demand: number; ratio: number }>;
  for (const pos of POSITIONS) {
    const supply = values.filter(
      (v) => v.position === pos && !state.drafted.has(v.id) && v.vor > 0
    ).length;
    const demand = Math.max(0, starters[pos] - takenAt[pos]);
    out[pos] = { supply, demand, ratio: demand > 0 ? supply / demand : Infinity };
  }
  return out;
}
