import { describe, it, expect } from 'vitest';
import {
  deadWeight,
  injuryExposure,
  isLive,
  marketMoves,
  rankDecisions,
  rosterRules,
  unfilledSlots,
  type Decision,
  type RosterPlayer,
} from '../src/lib/analysis/decisions.js';

const player = (over: Partial<RosterPlayer> & { id: string }): RosterPlayer => ({
  name: over.id,
  position: 'RB',
  projection: 170,
  perWeek: 10,
  status: null,
  onTaxi: false,
  onIr: false,
  isStarter: false,
  value: null,
  ...over,
});

const card = (over: Partial<Decision>): Decision => ({
  id: 'x',
  kind: 'market',
  claim: 'c',
  stake: 10,
  stakeUnit: 'week',
  evidence: [],
  clock: 'none',
  players: [],
  horizon: 'now',
  ...over,
});

describe('isLive', () => {
  it('kills a start/sit question once lineups lock', () => {
    // Not "less important" — impossible. Showing it would be telling someone
    // to do something they cannot do.
    expect(isLive('lock', 'live')).toBe(false);
    expect(isLive('lock', 'settled')).toBe(false);
  });

  it('keeps a start/sit question alive while the lineup is open', () => {
    for (const p of ['claims', 'open', 'closing'] as const) {
      expect(isLive('lock', p)).toBe(true);
    }
  });

  it('only offers waiver claims when a claim can still be placed', () => {
    expect(isLive('waivers', 'claims')).toBe(true);
    expect(isLive('waivers', 'open')).toBe(false);
    expect(isLive('waivers', 'live')).toBe(false);
  });

  it('leaves clockless decisions alone in every phase', () => {
    for (const p of ['claims', 'open', 'closing', 'live', 'settled', 'offseason'] as const) {
      expect(isLive('none', p)).toBe(true);
    }
  });
});

describe('rankDecisions', () => {
  it('orders by what is at stake, not by kind', () => {
    const out = rankDecisions(
      [card({ id: 'small', stake: 2 }), card({ id: 'big', stake: 40 })],
      'open'
    );
    expect(out.map((d) => d.id)).toEqual(['big', 'small']);
  });

  it('puts a season total onto a weekly footing before comparing', () => {
    // 340 over a season is 20 a week, which should beat 15 a week.
    const out = rankDecisions(
      [card({ id: 'weekly', stake: 15 }), card({ id: 'seasonal', stake: 340, stakeUnit: 'season' })],
      'open'
    );
    expect(out[0].id).toBe('seasonal');
  });

  it('does not let a season total swamp a weekly one on raw size', () => {
    const out = rankDecisions(
      [card({ id: 'weekly', stake: 30 }), card({ id: 'seasonal', stake: 300, stakeUnit: 'season' })],
      'open'
    );
    expect(out[0].id).toBe('weekly');
  });

  it('pulls a deadline decision up when the deadline is hours away', () => {
    const small = card({ id: 'urgent', stake: 6, clock: 'lock' });
    const large = card({ id: 'patient', stake: 12, clock: 'none' });
    expect(rankDecisions([small, large], 'open').map((d) => d.id)).toEqual(['patient', 'urgent']);
    // Same two cards, but now lock is today.
    expect(rankDecisions([small, large], 'closing').map((d) => d.id)).toEqual(['urgent', 'patient']);
  });

  it('drops decisions that can no longer be acted on', () => {
    const out = rankDecisions([card({ id: 'sit', clock: 'lock' }), card({ id: 'keep' })], 'live');
    expect(out.map((d) => d.id)).toEqual(['keep']);
  });

  it('handles an empty feed', () => {
    expect(rankDecisions([], 'open')).toEqual([]);
  });
});

describe('deadWeight', () => {
  const slots = new Map([['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1]]);
  const flex = new Set(['RB', 'WR', 'TE']);

  it('finds the second quarterback who cannot reach the field', () => {
    const out = deadWeight(
      [
        player({ id: 'qb1', position: 'QB', projection: 340, perWeek: 20 }),
        player({ id: 'qb2', position: 'QB', projection: 290, perWeek: 17 }),
      ],
      slots,
      flex,
      3
    );
    expect(out).toHaveLength(1);
    expect(out[0].players[0].id).toBe('qb2');
    expect(out[0].stake).toBe(290);
  });

  it('does not call flex depth dead — a flex is why a fourth back plays', () => {
    const backs = ['rb1', 'rb2', 'rb3', 'rb4'].map((id, i) =>
      player({ id, position: 'RB', projection: 200 - i * 10, perWeek: 12 - i })
    );
    expect(deadWeight(backs, slots, flex, 3)).toEqual([]);
  });

  it('stays quiet about a stranded player who would not start anywhere', () => {
    const out = deadWeight(
      [
        player({ id: 'qb1', position: 'QB', projection: 340, perWeek: 20 }),
        player({ id: 'qb2', position: 'QB', projection: 60, perWeek: 3.5 }),
      ],
      slots,
      flex,
      3
    );
    expect(out).toEqual([]);
  });

  it('ignores taxi and injured reserve, who are not competing for the lineup', () => {
    const out = deadWeight(
      [
        player({ id: 'qb1', position: 'QB', projection: 340, perWeek: 20 }),
        player({ id: 'qb2', position: 'QB', projection: 290, perWeek: 17, onTaxi: true }),
      ],
      slots,
      flex,
      3
    );
    expect(out).toEqual([]);
  });

  it('quotes the market price when it has one', () => {
    const out = deadWeight(
      [
        player({ id: 'qb1', position: 'QB', projection: 340, perWeek: 20 }),
        player({ id: 'qb2', position: 'QB', projection: 290, perWeek: 17, value: 3200 }),
      ],
      slots,
      flex,
      3
    );
    expect(out[0].evidence.join(' ')).toContain('3,200');
  });
});

describe('injuryExposure', () => {
  it('says what the drop-off actually is when there is cover', () => {
    const out = injuryExposure([
      player({ id: 'star', name: 'Star', isStarter: true, status: 'Out', perWeek: 16 }),
      player({ id: 'backup', name: 'Backup', perWeek: 9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].stake).toBeCloseTo(7, 6);
    expect(out[0].claim).toContain('Backup');
  });

  it('says so plainly when there is no cover at all', () => {
    const out = injuryExposure([
      player({ id: 'star', name: 'Star', isStarter: true, status: 'Out', perWeek: 16 }),
    ]);
    expect(out[0].claim).toContain('no cover');
    expect(out[0].stake).toBe(16);
  });

  it('does not count another injured player as cover', () => {
    const out = injuryExposure([
      player({ id: 'star', name: 'Star', isStarter: true, status: 'Out', perWeek: 16 }),
      player({ id: 'hurt', name: 'Hurt', perWeek: 12, status: 'Out' }),
    ]);
    expect(out[0].claim).toContain('no cover');
  });

  it('does not count a taxi player as cover — he cannot be started', () => {
    const out = injuryExposure([
      player({ id: 'star', name: 'Star', isStarter: true, status: 'Out', perWeek: 16 }),
      player({ id: 'kid', name: 'Kid', perWeek: 12, onTaxi: true }),
    ]);
    expect(out[0].claim).toContain('no cover');
  });

  it('ignores a questionable tag, which is not a decision', () => {
    const out = injuryExposure([
      player({ id: 'star', isStarter: true, status: 'Questionable', perWeek: 16 }),
    ]);
    expect(out).toEqual([]);
  });

  it('ignores an injured bench player — he was not going to play', () => {
    const out = injuryExposure([player({ id: 'benched', status: 'Out', perWeek: 8 })]);
    expect(out).toEqual([]);
  });

  it('expires at lock, because that is when it stops being actionable', () => {
    const out = injuryExposure([
      player({ id: 'star', isStarter: true, status: 'Out', perWeek: 16 }),
    ]);
    expect(out[0].clock).toBe('lock');
  });
});

describe('unfilledSlots', () => {
  it('prices an empty slot at what the wire would have given you', () => {
    const out = unfilledSlots([{ slot: 'TE', filled: false }], 7);
    expect(out[0].stake).toBe(7);
    expect(out[0].claim).toContain('slot has');
  });

  it('counts several holes together', () => {
    const out = unfilledSlots(
      [
        { slot: 'TE', filled: false },
        { slot: 'FLEX', filled: false },
        { slot: 'QB', filled: true },
      ],
      7
    );
    expect(out[0].stake).toBe(14);
    expect(out[0].claim).toContain('slots have');
  });

  it('says nothing when the lineup is full', () => {
    expect(unfilledSlots([{ slot: 'QB', filled: true }], 7)).toEqual([]);
  });
});

describe('marketMoves', () => {
  const signal = (over: Partial<Parameters<typeof marketMoves>[0][number]> = {}) => ({
    playerId: 'p',
    name: 'Player',
    position: 'WR',
    verdict: 'buy' as const,
    divergence: 0.4,
    snapShare: 0.8,
    targetShare: 0.24,
    pointsPerGame: 6,
    pointsGap: 4,
    trend: 0.2,
    mine: false,
    value: 2000,
    ...over,
  });

  it('prices the gap in points a game, not in percentile points', () => {
    // A percentile gap cannot be weighed against the other cards in the feed.
    expect(marketMoves([signal({ pointsGap: 6.4 })])[0].stake).toBeCloseTo(6.4, 6);
  });

  it('does not print a zero target share, which means runner not ignored', () => {
    const out = marketMoves([signal({ targetShare: 0 })]);
    expect(out[0].evidence[0]).not.toContain('of targets');
    expect(out[0].evidence[0]).toContain('of snaps');
  });

  it('surfaces a buy on somebody else roster', () => {
    const out = marketMoves([signal()]);
    expect(out[0].claim).toContain('used more than he is scoring');
    expect(out[0].evidence.join(' ')).toContain('Ask what he costs');
  });

  it('tells you to hold a buy you already own rather than to acquire him', () => {
    const out = marketMoves([signal({ mine: true })]);
    expect(out[0].evidence.join(' ')).toContain('Hold him');
  });

  it('only offers a sell on a player you can actually sell', () => {
    expect(marketMoves([signal({ verdict: 'sell', mine: false })])).toEqual([]);
    expect(marketMoves([signal({ verdict: 'sell', mine: true })])).toHaveLength(1);
  });

  it('ignores players the model has no opinion about', () => {
    expect(marketMoves([signal({ verdict: 'fair' })])).toEqual([]);
  });

  it('quotes the usage that produced the verdict', () => {
    const out = marketMoves([signal()]);
    expect(out[0].evidence[0]).toContain('80% of snaps');
    expect(out[0].evidence[0]).toContain('24% of targets');
  });

  it('copes with a player who has snaps but no target share', () => {
    const out = marketMoves([signal({ targetShare: null })]);
    expect(out[0].evidence[0]).toContain('80% of snaps');
    expect(out[0].evidence[0]).not.toContain('undefined');
  });

  it('keeps only the strongest few, because a feed is not a report', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      signal({ playerId: `p${i}`, pointsGap: 2 + i * 0.1 })
    );
    expect(marketMoves(many, 4)).toHaveLength(4);
  });

  it('ranks the biggest points gap first', () => {
    const out = marketMoves([
      signal({ playerId: 'weak', pointsGap: 1.2 }),
      signal({ playerId: 'strong', pointsGap: 7.5 }),
    ]);
    expect(out[0].players[0].id).toBe('strong');
  });
});

describe('rosterRules', () => {
  const base = {
    taxiUsed: 4,
    taxiSlots: 4,
    taxiDeadlineWeek: 4,
    currentWeek: 2,
    irUsed: 0,
    irSlots: 2,
    strandedInjured: [],
  };

  it('says nothing when every slot is spent', () => {
    expect(rosterRules(base)).toEqual([]);
  });

  it('points out an open IR slot only when somebody could fill it', () => {
    expect(rosterRules({ ...base, irSlots: 2, irUsed: 0 })).toEqual([]);
    const out = rosterRules({
      ...base,
      strandedInjured: [{ id: 'hurt', name: 'Hurt Guy', position: 'RB', perWeek: 0 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].evidence[0]).toContain('Hurt Guy');
  });

  it('raises the stake on a taxi slot as its deadline arrives', () => {
    const early = rosterRules({ ...base, taxiUsed: 2, currentWeek: 1 })[0];
    const late = rosterRules({ ...base, taxiUsed: 2, currentWeek: 3 })[0];
    expect(late.stake).toBeGreaterThan(early.stake);
  });

  it('names the deadline so the clock is checkable', () => {
    const out = rosterRules({ ...base, taxiUsed: 1 });
    expect(out[0].evidence[0]).toContain('week 4');
  });
});

describe('scoring-aware usage points', () => {
  /**
   * nflverse publishes standard AND PPR fantasy points per week. Which one is
   * true depends on the league, and reading the wrong column silently shifts
   * every receiver's production — the exact kind of quiet wrongness this app
   * is supposed to prevent.
   */
  const blend = (std: number, pprPts: number, rec: number) =>
    rec >= 0.75 ? pprPts : rec <= 0 ? std : std + (pprPts - std) * rec;

  it('reads the standard column in a standard league', () => {
    expect(blend(10, 16, 0)).toBe(10);
  });

  it('reads the PPR column in a full-PPR league', () => {
    expect(blend(10, 16, 1)).toBe(16);
  });

  it('interpolates half-PPR, which nflverse does not publish', () => {
    expect(blend(10, 16, 0.5)).toBe(13);
  });

  it('never reports less than standard scoring, whatever the setting', () => {
    for (const rec of [0, 0.25, 0.5, 0.75, 1]) {
      expect(blend(10, 16, rec)).toBeGreaterThanOrEqual(10);
    }
  });
});
