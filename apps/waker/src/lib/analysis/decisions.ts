/**
 * The decision feed — the app's primary object.
 *
 * DECISION SERVED: "what needs me?" Everything else in Waker is evidence for
 * one of these.
 *
 * A decision is not a notification. Notifications are ordered by recency and
 * arrive whether or not they matter; a decision is ordered by *what is at
 * stake* and exists only while it can still be acted on. Two properties follow:
 *
 *   Everything is priced in points.  "Bo Nix is on your bench" is a shrug.
 *   "Bo Nix is 296 points you cannot score" is a decision. Every card carries a
 *   stake in fantasy points so the list can be honestly ranked, and so a card
 *   worth 2 points sits below one worth 40 rather than above it because it
 *   happened more recently.
 *
 *   Everything has a clock.  A start/sit question is dead the moment lineups
 *   lock; a waiver claim is dead when waivers run. Cards name the gate they
 *   expire at and are dropped once it passes, which is what stops the feed
 *   becoming a list of things you can no longer do.
 */
import type { Phase } from './cycle.js';

export type DecisionKind =
  /** A rostered player who cannot start and is worth real money elsewhere. */
  | 'dead-weight'
  /** A lineup slot with nobody startable in it. */
  | 'hole'
  /** A bench player outprojects a starter he is eligible to replace. */
  | 'start-sit'
  /** A starter is hurt and there is no cover behind him. */
  | 'injury'
  /** Usage says the market is wrong about a player, in either direction. */
  | 'market'
  /** A free agent whose usage is climbing. */
  | 'wire'
  /** Taxi or IR capacity that expires. */
  | 'roster-rule'
  /** The roster's shape disagrees with its record. */
  | 'orientation'
  /** A concrete trade that helps both sides. */
  | 'trade';

/** Which gate kills this decision. */
export type Clock = 'lock' | 'waivers' | 'taxi-deadline' | 'trade-deadline' | 'none';

export interface Decision {
  id: string;
  kind: DecisionKind;
  /** The claim, in one line. Written to be read on its own. */
  claim: string;
  /** Fantasy points at stake. Drives the ranking and is shown as the figure. */
  stake: number;
  /** How the stake should be read: per week, or over the rest of the season. */
  stakeUnit: 'week' | 'season' | 'value';
  /** One or two lines of evidence. Never more — this is a decision, not a report. */
  evidence: string[];
  clock: Clock;
  /** Players this is about, so the UI can link and colour them. */
  players: Array<{ id: string; name: string; position: string | null }>;
  /** Which horizon it belongs to. */
  horizon: 'now' | 'season' | 'horizon';
}

/**
 * Which decisions are still live in a given phase.
 *
 * This is the rule that keeps the feed honest. Once lineups lock, a start/sit
 * card is not "less important" — it is *impossible*, and showing it would be
 * telling someone to do something they cannot do.
 */
export function isLive(clock: Clock, phase: Phase): boolean {
  switch (clock) {
    case 'lock':
      // Dead from lock until the next week opens.
      return phase !== 'live' && phase !== 'settled';
    case 'waivers':
      // Claims can only be placed before the run.
      return phase === 'claims' || phase === 'settled' || phase === 'offseason';
    default:
      return true;
  }
}

/**
 * Order the feed.
 *
 * By stake, with two corrections. A decision that expires within hours is
 * pulled up regardless of size, because a small decision you can still make
 * beats a large one you have all week for. And season-long stakes are damped
 * against weekly ones — 300 points over a season is not thirty times more
 * urgent than 10 points this Sunday, it is just bigger.
 */
export const URGENT_CLOCKS: Clock[] = ['lock', 'waivers'];

export function rankDecisions(decisions: Decision[], phase: Phase): Decision[] {
  const weight = (d: Decision) => {
    // Put a season total onto a weekly footing so the two are comparable.
    const perWeek = d.stakeUnit === 'season' ? d.stake / 17 : d.stake;
    // Market value is not points at all; scale it into the same rough band.
    const scaled = d.stakeUnit === 'value' ? d.stake / 300 : perWeek;
    const urgent = URGENT_CLOCKS.includes(d.clock) && (phase === 'closing' || phase === 'claims');
    return urgent ? scaled * 2.5 : scaled;
  };

  return decisions
    .filter((d) => isLive(d.clock, phase))
    .sort((a, b) => weight(b) - weight(a));
}

/* ------------------------------------------------------------------ *
 * Builders
 *
 * Each takes already-analysed input and turns it into cards. They are separate
 * so a source going dark removes its cards rather than breaking the feed.
 * ------------------------------------------------------------------ */

export interface RosterPlayer {
  id: string;
  name: string;
  position: string | null;
  /** Season projection in this league's scoring. */
  projection: number;
  /** Per-week projection. */
  perWeek: number;
  status: string | null;
  onTaxi: boolean;
  onIr: boolean;
  isStarter: boolean;
  /** Market value, where the crosswalk covered them. */
  value: number | null;
}

/**
 * Players who project well but cannot reach the field.
 *
 * The classic case is a second quarterback in a one-quarterback league: he can
 * be the twelfth-best player on your roster and score you exactly zero. It is
 * the most common form of wasted value in dynasty and it is invisible in a
 * roster list, because a roster list shows him sitting there looking useful.
 */
export function deadWeight(
  players: RosterPlayer[],
  startableSlots: Map<string, number>,
  flexEligible: Set<string>,
  flexSlots: number
): Decision[] {
  const out: Decision[] = [];

  for (const [position, slots] of startableSlots) {
    // Flex-eligible positions get extra capacity, so depth there is not dead.
    const capacity = slots + (flexEligible.has(position) ? flexSlots : 0);
    const group = players
      .filter((p) => (p.position ?? '').toUpperCase() === position && !p.onTaxi && !p.onIr)
      .sort((a, b) => b.projection - a.projection);

    for (const stranded of group.slice(capacity)) {
      // Only worth saying when he would genuinely start somewhere else.
      if (stranded.perWeek < 8) continue;
      out.push({
        id: `dead-${stranded.id}`,
        kind: 'dead-weight',
        claim: `${stranded.name} cannot reach your lineup`,
        stake: stranded.projection,
        stakeUnit: 'season',
        evidence: [
          `${position} ${group.indexOf(stranded) + 1} on this roster, with ${capacity} startable ${position} ${capacity === 1 ? 'slot' : 'slots'}.`,
          stranded.value
            ? `He prices at ${stranded.value.toLocaleString()} on the trade market and scores you nothing where he is.`
            : 'He scores you nothing where he is.',
        ],
        clock: 'none',
        players: [{ id: stranded.id, name: stranded.name, position: stranded.position }],
        horizon: 'now',
      });
    }
  }
  return out;
}

/**
 * A starter who is hurt with nobody behind him.
 *
 * The injury alone is not the decision — every app shows a red chip. The
 * decision is whether you have cover, and that is a fact about your bench.
 */
export function injuryExposure(players: RosterPlayer[]): Decision[] {
  const CONCERNING = new Set(['Out', 'Doubtful', 'IR', 'PUP', 'Sus', 'DNR']);
  const out: Decision[] = [];

  for (const p of players) {
    if (!p.isStarter || !p.status || !CONCERNING.has(p.status)) continue;

    const cover = players
      .filter(
        (q) =>
          q.id !== p.id &&
          !q.isStarter &&
          !q.onTaxi &&
          !q.onIr &&
          (q.position ?? '') === (p.position ?? '') &&
          !CONCERNING.has(q.status ?? '')
      )
      .sort((a, b) => b.perWeek - a.perWeek)[0];

    const gap = cover ? p.perWeek - cover.perWeek : p.perWeek;

    out.push({
      id: `injury-${p.id}`,
      kind: 'injury',
      claim: cover
        ? `${p.name} is ${p.status.toLowerCase()} — ${cover.name} is the drop-off`
        : `${p.name} is ${p.status.toLowerCase()} and you have no cover`,
      stake: Math.max(0, gap),
      stakeUnit: 'week',
      evidence: cover
        ? [
            `${cover.name} is the best ${p.position} left on your bench at ${cover.perWeek.toFixed(1)} a week.`,
            `That is ${gap.toFixed(1)} a week less than ${p.name.split(' ').slice(-1)[0]}.`,
          ]
        : [`No other ${p.position} on your roster can start. The slot scores whatever the wire gives you.`],
      clock: 'lock',
      players: [
        { id: p.id, name: p.name, position: p.position },
        ...(cover ? [{ id: cover.id, name: cover.name, position: cover.position }] : []),
      ],
      horizon: 'now',
    });
  }
  return out;
}

/** A lineup slot with nobody in it at all. */
export function unfilledSlots(
  slots: Array<{ slot: string; filled: boolean }>,
  replacementPerWeek: number
): Decision[] {
  const empty = slots.filter((s) => !s.filled);
  if (!empty.length) return [];
  return [
    {
      id: 'hole-lineup',
      kind: 'hole',
      claim: `${empty.length} lineup ${empty.length === 1 ? 'slot has' : 'slots have'} nobody in ${empty.length === 1 ? 'it' : 'them'}`,
      stake: replacementPerWeek * empty.length,
      stakeUnit: 'week',
      evidence: [
        `${empty.map((s) => s.slot).join(', ')} — an empty slot scores zero, and the wire would give you about ${replacementPerWeek.toFixed(1)}.`,
      ],
      clock: 'lock',
      players: [],
      horizon: 'now',
    },
  ];
}

export interface MarketSignal {
  playerId: string;
  name: string;
  position: string | null;
  verdict: 'buy' | 'sell' | 'fair';
  divergence: number;
  snapShare: number | null;
  targetShare: number | null;
  pointsPerGame: number;
  /** Real points per game the divergence is worth. */
  pointsGap: number;
  trend: number | null;
  /** True when this player is on the asking manager's roster. */
  mine: boolean;
  value: number | null;
}

/**
 * Buy-low and sell-high, from usage against production.
 *
 * A sell only makes sense for a player you own; a buy is worth surfacing either
 * way, because the ones you already own are the ones not to trade away.
 */
export function marketMoves(signals: MarketSignal[], limit = 4): Decision[] {
  const out: Decision[] = [];

  for (const s of signals) {
    if (s.verdict === 'fair') continue;
    if (s.verdict === 'sell' && !s.mine) continue;

    const pct = (v: number | null) => (v == null ? null : `${Math.round(v * 100)}%`);
    const usage = [
      pct(s.snapShare) && `${pct(s.snapShare)} of snaps`,
      // A zero target share is not a fact worth printing — it means the player
      // is a runner, not that he is being ignored.
      s.targetShare && s.targetShare > 0.01 ? `${pct(s.targetShare)} of targets` : null,
    ].filter(Boolean);

    out.push({
      id: `market-${s.playerId}`,
      kind: 'market',
      claim:
        s.verdict === 'buy'
          ? `${s.name} is being used more than he is scoring`
          : `${s.name} is scoring more than his usage supports`,
      // Points per game, not a percentile. A percentile cannot be weighed
      // against the other cards in the feed; points can.
      stake: Math.abs(s.pointsGap),
      stakeUnit: 'week',
      evidence: [
        usage.length
          ? `${usage.join(', ')}, for ${s.pointsPerGame.toFixed(1)} a game — usage like that normally returns ${(s.pointsPerGame + s.pointsGap).toFixed(1)}.`
          : `${s.pointsPerGame.toFixed(1)} a game against an expected ${(s.pointsPerGame + s.pointsGap).toFixed(1)}.`,
        s.verdict === 'buy'
          ? s.mine
            ? 'Hold him. The scoring usually follows the usage.'
            : 'Ask what he costs before the scoring catches up.'
          : 'Sell while the box score is still flattering him.',
      ],
      clock: 'none',
      players: [{ id: s.playerId, name: s.name, position: s.position }],
      horizon: 'now',
    });
  }

  return out.sort((a, b) => b.stake - a.stake).slice(0, limit);
}

/** Taxi or IR capacity going unused before its deadline. */
export function rosterRules(o: {
  taxiUsed: number;
  taxiSlots: number;
  taxiDeadlineWeek: number | null;
  currentWeek: number | null;
  irUsed: number;
  irSlots: number;
  /** Rostered players who are Out but not on IR — free capacity being wasted. */
  strandedInjured: Array<{ id: string; name: string; position: string | null; perWeek: number }>;
}): Decision[] {
  const out: Decision[] = [];

  if (o.irSlots > o.irUsed && o.strandedInjured.length) {
    const best = o.strandedInjured[0];
    out.push({
      id: 'rule-ir',
      kind: 'roster-rule',
      claim: `${o.irSlots - o.irUsed} injured-reserve ${o.irSlots - o.irUsed === 1 ? 'slot is' : 'slots are'} open`,
      // Moving someone to IR frees an active roster spot, which is worth about
      // what a wire pickup gives you.
      stake: 6,
      stakeUnit: 'week',
      evidence: [
        `${best.name} is out and taking an active roster spot. Moving him to IR frees it for somebody who can play.`,
      ],
      clock: 'none',
      players: o.strandedInjured.slice(0, 3).map((p) => ({ id: p.id, name: p.name, position: p.position })),
      horizon: 'now',
    });
  }

  if (o.taxiSlots > o.taxiUsed) {
    const open = o.taxiSlots - o.taxiUsed;
    const closing =
      o.taxiDeadlineWeek != null && o.currentWeek != null && o.currentWeek >= o.taxiDeadlineWeek - 1;
    out.push({
      id: 'rule-taxi',
      kind: 'roster-rule',
      claim: `${open} taxi ${open === 1 ? 'slot is' : 'slots are'} open`,
      stake: closing ? 8 : 3,
      stakeUnit: 'week',
      evidence: [
        o.taxiDeadlineWeek
          ? `Placements close after week ${o.taxiDeadlineWeek}. A taxi slot holds a young player without spending an active roster spot.`
          : 'A taxi slot holds a young player without spending an active roster spot.',
      ],
      clock: 'taxi-deadline',
      players: [],
      horizon: 'now',
    });
  }

  return out;
}
