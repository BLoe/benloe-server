/**
 * Assembling the decision feed from everything the app knows.
 *
 * This is the one place where Sleeper, the value markets and nflverse usage all
 * meet. It is deliberately a plain function over already-loaded data rather
 * than a route: the route's job is to fetch, this one's job is to reason, and
 * keeping them apart is what makes the reasoning testable.
 */
import {
  deadWeight,
  injuryExposure,
  marketMoves,
  rankDecisions,
  rosterRules,
  unfilledSlots,
  type Decision,
  type MarketSignal,
  type RosterPlayer,
} from '../lib/analysis/decisions.js';
import { findDivergence, type PlayerUsageInput } from '../lib/analysis/divergence.js';
import { lineupShape } from '../lib/analysis/ledger.js';
import { orientationOf, readMismatch } from '../lib/analysis/orientation.js';
import type { Phase } from '../lib/analysis/cycle.js';
import type { Market } from './market.js';

export interface FeedInput {
  phase: Phase;
  /** The asking manager's roster, straight from Sleeper. */
  roster: any;
  /** Every roster, for league-wide context. */
  rosters: any[];
  league: any;
  players: Record<string, { id: string; name: string; pos: string | null; status: string | null }>;
  /** Season projections, indexed by player id. */
  projections: Record<string, { points: number; games: number | null }>;
  market: Market;
  /** Latest completed week, for the usage window. */
  throughWeek: number;
  /** How many weeks back to judge usage on. */
  usageWindow: number;
}

export interface Feed {
  decisions: Decision[];
  /** Coverage, so the UI never implies data it does not have. */
  sources: Market['health'];
}

/** Games one player can appear in. Sleeper's `gp` counts weeks, including byes. */
const NFL_GAMES = 17;

export function buildFeed(input: FeedInput): Feed {
  const { roster, league, players, projections, market, phase } = input;

  const starters = new Set<string>((roster.starters ?? []).filter((id: string) => id && id !== '0'));
  const taxi = new Set<string>(roster.taxi ?? []);
  const reserve = new Set<string>(roster.reserve ?? []);

  const mine: RosterPlayer[] = (roster.players ?? [])
    .map((id: string) => {
      const p = players[id];
      if (!p) return null;
      const proj = projections[id];
      const points = proj?.points ?? 0;
      const games = Math.min(NFL_GAMES, Math.max(1, proj?.games ?? NFL_GAMES));
      return {
        id,
        name: p.name,
        position: p.pos,
        projection: points,
        perWeek: points / games,
        status: p.status,
        onTaxi: taxi.has(id),
        onIr: reserve.has(id),
        isStarter: starters.has(id),
        value: market.crosswalk.bySleeperId.get(id)?.dynasty ?? null,
      } satisfies RosterPlayer;
    })
    .filter(Boolean) as RosterPlayer[];

  const { fixed, flex } = lineupShape(league.roster_positions ?? []);

  const decisions: Decision[] = [
    ...deadWeight(mine, fixed, flex.eligible, flex.count),
    ...injuryExposure(mine),
    ...unfilledSlots(lineupSlots(roster, league), replacementPerWeek(players, projections)),
    ...rosterRules({
      taxiUsed: taxi.size,
      taxiSlots: league.settings?.taxi_slots ?? 0,
      taxiDeadlineWeek: league.settings?.taxi_deadline ?? null,
      currentWeek: input.throughWeek || null,
      irUsed: reserve.size,
      irSlots: league.settings?.reserve_slots ?? 0,
      strandedInjured: mine
        .filter((p) => !p.onIr && (p.status === 'Out' || p.status === 'IR'))
        .sort((a, b) => a.perWeek - b.perWeek)
        .map((p) => ({ id: p.id, name: p.name, position: p.position, perWeek: p.perWeek })),
    }),
    ...marketMoves(buildSignals(input, new Set(mine.map((p) => p.id)))),
    ...orientationCards(mine, roster, market),
  ];

  return { decisions: rankDecisions(decisions, phase), sources: market.health };
}

/** Which lineup slots have somebody in them. */
function lineupSlots(roster: any, league: any): Array<{ slot: string; filled: boolean }> {
  const slots: string[] = (league.roster_positions ?? []).filter((s: string) => s !== 'BN');
  const starters: string[] = roster.starters ?? [];
  return slots.map((slot, i) => ({ slot, filled: !!starters[i] && starters[i] !== '0' }));
}

/**
 * Roughly what a freely available player is worth per week.
 *
 * Used only to price an empty lineup slot, so a coarse answer is fine: the
 * median projection among players good enough to be rostered somewhere.
 */
function replacementPerWeek(
  players: Record<string, { pos: string | null }>,
  projections: Record<string, { points: number; games: number | null }>
): number {
  const weekly = Object.entries(projections)
    .filter(([id]) => ['RB', 'WR', 'TE', 'QB'].includes(players[id]?.pos ?? ''))
    .map(([, p]) => p.points / Math.min(NFL_GAMES, Math.max(1, p.games ?? NFL_GAMES)))
    .sort((a, b) => b - a);
  if (!weekly.length) return 6;
  // Around the 120th best skill player is about where a 12-team league's
  // startable pool runs out.
  return weekly[Math.min(120, weekly.length - 1)];
}

/** Turn usage into ranked buy/sell signals over the whole league pool. */
function buildSignals(input: FeedInput, mineIds: Set<string>): MarketSignal[] {
  const { market, players, throughWeek } = input;

  const usageInputs: PlayerUsageInput[] = [];
  for (const [id, usage] of market.usage) {
    const p = players[id];
    if (!p) continue;
    usageInputs.push({
      playerId: id,
      position: p.pos,
      snaps: market.snaps.get(id)?.weeks ?? [],
      usage: usage.weeks,
    });
  }

  const rostered = new Set<string>(input.rosters.flatMap((r: any) => r.players ?? []));

  return findDivergence(usageInputs, throughWeek, input.usageWindow)
    .filter((d) => {
      // Only worth a card for players who are actually gettable: on your roster
      // (hold or sell), on someone else's (buy low), or free. All three are
      // covered, but a player nobody in the league has heard of is noise.
      const value = market.crosswalk.bySleeperId.get(d.playerId);
      return mineIds.has(d.playerId) || rostered.has(d.playerId) || (value?.dynasty ?? 0) > 800;
    })
    .map((d) => ({
      playerId: d.playerId,
      name: players[d.playerId]?.name ?? d.playerId,
      position: d.position,
      verdict: d.verdict,
      divergence: d.divergence,
      snapShare: d.snapShare,
      targetShare: d.targetShare,
      pointsPerGame: d.pointsPerGame,
      pointsGap: d.pointsGap,
      trend: null,
      mine: mineIds.has(d.playerId),
      value: market.crosswalk.bySleeperId.get(d.playerId)?.dynasty ?? null,
    }));
}

/** The strategic read, when the roster and the record disagree. */
function orientationCards(mine: RosterPlayer[], roster: any, market: Market): Decision[] {
  const o = orientationOf(
    mine.map((p) => {
      const v = market.crosswalk.bySleeperId.get(p.id);
      return { playerId: p.id, dynasty: v?.dynasty ?? null, redraft: v?.redraft ?? null };
    })
  );
  const wins = roster.settings?.wins ?? 0;
  const losses = roster.settings?.losses ?? 0;
  const mismatch = readMismatch(o, wins, losses);
  if (!mismatch.mismatched || !mismatch.advice) return [];

  return [
    {
      id: 'orientation',
      kind: 'orientation',
      claim:
        o.label === 'building'
          ? `You are ${wins}-${losses} with a roster built for later`
          : `You are ${wins}-${losses} with a roster built for now`,
      // Priced off the roster's total value rather than points: this is a
      // decision about assets, not about a lineup.
      stake: o.dynastyValue,
      stakeUnit: 'value',
      evidence: [mismatch.advice],
      clock: 'trade-deadline',
      players: [],
      horizon: 'horizon',
    },
  ];
}
