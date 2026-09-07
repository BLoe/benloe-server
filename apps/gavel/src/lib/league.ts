/**
 * League configuration — the shape of one league's rules.
 *
 * This is the ONLY place that knows a league's scoring and roster structure.
 * Everything downstream (points, replacement level, dollars, inflation) reads
 * it, which is what lets one engine serve a 6-point-passing-TD standard league
 * on Sleeper and a 4-point half-PPR keeper league on Yahoo without a branch.
 *
 * Stored as data, not code: a league record is a row in SQLite, seeded from the
 * platform's own settings so nobody transcribes a scoring table by hand.
 */

/** The positions this tool prices. IDP and kickers are deliberately absent. */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF', 'K'] as const;
export type Position = (typeof POSITIONS)[number];

/** Positions a FLEX slot will accept. Not configurable yet; neither league varies. */
export const FLEX_ELIGIBLE: Position[] = ['RB', 'WR', 'TE'];

/**
 * Scoring as a plain map from Sleeper's stat keys to points per unit.
 *
 * Sleeper's `scoring_settings` is already exactly this shape, so a Sleeper
 * league seeds itself. A Yahoo league is translated into these same keys once,
 * at seed time, so the scoring engine never learns there are two platforms.
 */
export type Scoring = Record<string, number>;

export interface RosterSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  DEF: number;
  K: number;
  FLEX: number;
  BN: number;
  /** Reserve/IR. Not draftable, so it is excluded from the money math. */
  IR: number;
}

export interface LeagueConfig {
  id: string;
  name: string;
  platform: 'sleeper' | 'yahoo';
  /** Platform's own league id, kept so a pre-draft refresh knows what to fetch. */
  platformLeagueId: string | null;
  season: string;
  teams: number;
  /** Auction budget per team, in whole dollars. */
  budget: number;
  /** Minimum bid. $1 in both of Ben's leagues; it is the floor under every price. */
  minBid: number;
  slots: RosterSlots;
  scoring: Scoring;
}

/** Draftable roster spots per team — starters plus bench, never IR. */
export function slotsPerTeam(slots: RosterSlots): number {
  return slots.QB + slots.RB + slots.WR + slots.TE + slots.DEF + slots.K + slots.FLEX + slots.BN;
}

/** Every player who will come off the board across the whole league. */
export function draftablePlayers(cfg: LeagueConfig): number {
  return cfg.teams * slotsPerTeam(cfg.slots);
}

/** Every dollar in the room. */
export function totalMoney(cfg: LeagueConfig): number {
  return cfg.teams * cfg.budget;
}

/**
 * How many of each position the league starts every week, before flex.
 *
 * This is the demand curve that sets replacement level. The flex slots are
 * deliberately NOT distributed here — which positions absorb them depends on
 * the projections, so `valuation.ts` resolves that against real players.
 */
export function startingDemand(cfg: LeagueConfig): Record<Position, number> {
  const s = cfg.slots;
  return {
    QB: s.QB * cfg.teams,
    RB: s.RB * cfg.teams,
    WR: s.WR * cfg.teams,
    TE: s.TE * cfg.teams,
    DEF: s.DEF * cfg.teams,
    K: s.K * cfg.teams,
  };
}

export function flexDemand(cfg: LeagueConfig): number {
  return cfg.slots.FLEX * cfg.teams;
}

/**
 * The positions this league actually rosters.
 *
 * A position with no starting slot and no flex eligibility is not merely
 * low-value, it is OUTSIDE the market — nobody will spend a dollar on it. Both
 * of Ben's leagues start no kicker, and pricing kickers anyway handed them
 * ~$700 of a $2,400 room, because a position with zero demand has a zero
 * replacement level and therefore counts every point a kicker scores as pure
 * surplus. Filtering here rather than at the edges keeps that impossible.
 */
export function rosteredPositions(cfg: LeagueConfig): Position[] {
  const s = cfg.slots;
  return POSITIONS.filter((pos) => {
    if (s[pos as keyof RosterSlots] > 0) return true;
    return s.FLEX > 0 && FLEX_ELIGIBLE.includes(pos);
  });
}
