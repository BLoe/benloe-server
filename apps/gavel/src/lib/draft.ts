/**
 * Live draft state: what every dollar in the room is doing right now.
 *
 * Everything here is pure and synchronous. That is a deliberate performance
 * decision, not a style one — this recomputes on every keystroke of the
 * nomination box, and it has to be instant on a second monitor while the real
 * draft runs on the first. There is no network call anywhere in this file.
 */
import { FLEX_ELIGIBLE, POSITIONS, slotsPerTeam, type LeagueConfig, type Position } from './league.js';
import type { PlayerValue } from './valuation.js';

export interface Pick {
  /** Monotonic, assigned by the server. Also the undo order. */
  seq: number;
  playerId: string;
  teamId: string;
  price: number;
  at: number;
  /**
   * A keeper is a pick made before the draft: a player, a price and a team,
   * exactly like every other pick. Modelling it as one is what keeps the money
   * honest — a keeper's salary comes out of that manager's budget and its
   * roster spot out of their slots, and both fall out of the same fold rather
   * than being a second set of numbers to keep in agreement.
   */
  keeper?: boolean;
}

export interface TeamState {
  teamId: string;
  name: string;
  spent: number;
  /** Dollars still in the wallet. */
  remaining: number;
  filled: number;
  openSlots: number;
  /**
   * The most this team could bid on the next player without being unable to
   * fill its roster at the minimum. This is the number that decides whether you
   * are actually in a bidding war or only imagine you are.
   */
  maxBid: number;
  /** Starting jobs still unfilled, by position, plus flex and bench. */
  needs: Record<Position, number>;
  flexOpen: number;
  benchOpen: number;
  roster: Pick[];
}

export interface DraftState {
  teams: TeamState[];
  picks: Pick[];
  /** Picks made before the draft. A subset of `picks`, never separate from it. */
  keepers: Pick[];
  /** Money still unspent across the league. */
  moneyLeft: number;
  /** Roster spots still to be filled across the league. */
  slotsLeft: number;
  /** Base value of every undrafted player still expected to be drafted. */
  valueLeft: number;
  /**
   * Money chasing value. Above 1.0 the room has money left over and prices will
   * run hot; below 1.0 the room overspent early and there are bargains coming.
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
 * Which of a team's slots a set of picks fills.
 *
 * Starters first, then flex from whatever spills over at a flex-eligible
 * position, then bench. A team that has drafted five running backs in a 2-RB
 * league has filled RB, taken the flex, and put two on the bench — and still
 * needs a tight end. Getting this wrong makes the needs column lie, which is
 * the column that drives every suggestion.
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
  const starterSlotsOpen = Object.values(needs).reduce((a, b) => a + b, 0) + flexOpen;
  const startersFilled = starterSlots - starterSlotsOpen;

  // Anyone drafted beyond the starting lineup is sitting on the bench. A team
  // can hold more bodies than it can start, and the bench is what the money
  // left over at the end actually buys.
  const onBench = Math.max(0, roster.length - startersFilled);
  const benchOpen = Math.max(0, cfg.slots.BN - onBench);

  return { needs, flexOpen, benchOpen };
}

export interface TeamMeta {
  teamId: string;
  name: string;
}

/**
 * Fold the pick list into full league state.
 *
 * Picks are the single source of truth; every number here is derived. That is
 * what makes undo trivial and what makes a reload from the database produce
 * exactly the screen you were looking at.
 */
export function deriveState(
  picks: Pick[],
  teams: TeamMeta[],
  values: PlayerValue[],
  cfg: LeagueConfig
): DraftState {
  const valuesById = new Map(values.map((v) => [v.id, v]));
  const drafted = new Set(picks.map((p) => p.playerId));
  const perTeam = new Map<string, Pick[]>();
  for (const t of teams) perTeam.set(t.teamId, []);
  for (const p of picks) {
    const list = perTeam.get(p.teamId);
    if (list) list.push(p);
  }

  const capacity = slotsPerTeam(cfg.slots);

  const teamStates: TeamState[] = teams.map((t) => {
    const roster = perTeam.get(t.teamId) ?? [];
    // Keepers are in this list too, so they are counted once, here, and nowhere
    // else.
    const spent = roster.reduce((sum, p) => sum + p.price, 0);
    const filled = roster.length;
    const openSlots = Math.max(0, capacity - filled);
    const remaining = cfg.budget - spent;
    const { needs, flexOpen, benchOpen } = fillSlots(roster, valuesById, cfg);
    return {
      teamId: t.teamId,
      name: t.name,
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
  });

  const moneyLeft = teamStates.reduce((sum, t) => sum + t.remaining, 0);
  const slotsLeft = teamStates.reduce((sum, t) => sum + t.openSlots, 0);

  // Only the players who will still be drafted carry value. Taking the top
  // `slotsLeft` undrafted by base value keeps the two sides of the ratio
  // measuring the same thing.
  const undrafted = values
    .filter((v) => !drafted.has(v.id))
    .sort((a, b) => b.baseValue - a.baseValue)
    .slice(0, slotsLeft);
  const valueLeft = undrafted.reduce((sum, v) => sum + v.baseValue, 0);

  return {
    teams: teamStates,
    picks,
    keepers: picks.filter((p) => p.keeper),
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
 * The minimum bid is never inflated — a dollar player is a dollar player no
 * matter how hot the room is. Only the surplus above the minimum moves.
 */
export function adjustedValue(value: PlayerValue, state: DraftState, cfg: LeagueConfig): number {
  if (value.baseValue <= cfg.minBid) return cfg.minBid;
  const adjusted = cfg.minBid + (value.baseValue - cfg.minBid) * state.inflation;
  return Math.round(Math.max(cfg.minBid, adjusted) * 10) / 10;
}

/**
 * How many teams could still outbid a given price.
 *
 * Late in an auction this collapses fast, and knowing it is the difference
 * between paying $3 and paying $18 for the same player. A team that cannot
 * afford the bid is not competition, however much it wants the player.
 */
export function contenders(state: DraftState, price: number): TeamState[] {
  return state.teams.filter((t) => t.openSlots > 0 && t.maxBid >= price);
}

/**
 * Remaining above-replacement players per position, against remaining demand.
 *
 * A ratio below 1 means there are literally not enough starters left to go
 * round, which is the moment a position's price spikes. This is the signal a
 * paper cheat sheet cannot give you.
 */
export function scarcity(
  state: DraftState,
  values: PlayerValue[]
): Record<Position, { supply: number; demand: number; ratio: number }> {
  const out = {} as Record<Position, { supply: number; demand: number; ratio: number }>;
  for (const pos of POSITIONS) {
    const supply = values.filter(
      (v) => v.position === pos && !state.drafted.has(v.id) && v.vor > 0
    ).length;
    const demand = state.teams.reduce((sum, t) => sum + t.needs[pos], 0);
    out[pos] = { supply, demand, ratio: demand > 0 ? supply / demand : Infinity };
  }
  return out;
}
