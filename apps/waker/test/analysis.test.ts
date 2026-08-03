import { describe, it, expect } from 'vitest';
import {
  findDivergence,
  percentileRank,
  usageScore,
  usageTrend,
  type PlayerUsageInput,
} from '../src/lib/analysis/divergence.js';
import {
  evaluateSwap,
  lineupSigma,
  normalCdf,
  playerSigma,
  posture,
  winProbability,
} from '../src/lib/analysis/leverage.js';
import {
  positionalDemand,
  replacementLevels,
  valueOverReplacement,
} from '../src/lib/analysis/replacement.js';
import {
  orientationOf,
  playerOrientation,
  readMismatch,
} from '../src/lib/analysis/orientation.js';
import { findTrades, lineupShape, standings } from '../src/lib/analysis/ledger.js';
import { gameLeverage, makeRandom, simulateSeason, teamSigma } from '../src/lib/analysis/playoffs.js';

/** Ben's league: 1 QB, 2 RB, 2 WR, 1 TE, 3 FLEX, 8 bench. */
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'BN', 'BN', 'BN'];

/* ================================================================== *
 * Divergence
 * ================================================================== */

describe('percentileRank', () => {
  it('places a value in the middle of its tied band, not at the bottom', () => {
    // Ten players who all did nothing should all rank the same.
    expect(percentileRank(0, [0, 0, 0, 0])).toBe(0.5);
  });

  it('ranks a maximum near the top and a minimum near the bottom', () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentileRank(5, sorted)).toBeGreaterThan(0.8);
    expect(percentileRank(1, sorted)).toBeLessThan(0.2);
  });

  it('is 0.5 for a degenerate field', () => {
    expect(percentileRank(7, [7])).toBe(0.5);
    expect(percentileRank(7, [])).toBe(0.5);
  });

  it('rises monotonically with the value', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8];
    let last = -1;
    for (const v of sorted) {
      const r = percentileRank(v, sorted);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
  });
});

describe('usageScore', () => {
  it('falls back to snap share when there is no target share', () => {
    // A running back is not penalised for not being a receiver.
    expect(usageScore(0.8, null)).toBe(0.8);
  });

  it('rewards a player who both plays and is thrown to', () => {
    expect(usageScore(0.8, 0.25)).toBeGreaterThan(usageScore(0.8, 0.02));
  });

  it('scales target share so it is not swamped by snap share', () => {
    // An elite 30% target share should count for as much as a full snap share.
    expect(usageScore(0, 0.3)).toBeCloseTo(0.4, 6);
  });

  it('is zero when nothing is known', () => {
    expect(usageScore(null, null)).toBe(0);
  });

  it('never exceeds one', () => {
    expect(usageScore(1, 0.9)).toBeLessThanOrEqual(1);
  });
});

/** Build a player whose usage and points can be dialled independently. */
const mk = (
  playerId: string,
  position: string,
  snap: number,
  points: number,
  weeks = [1, 2, 3, 4],
  targetShare: number | null = null
): PlayerUsageInput => ({
  playerId,
  position,
  snaps: weeks.map((week) => ({ week, offensePct: snap })),
  usage: weeks.map((week) => ({
    week,
    targets: 0,
    carries: 0,
    targetShare,
    airYardsShare: null,
    points,
  })),
});

describe('findDivergence', () => {
  // Six receivers: usage descending, points deliberately reversed for one.
  const field: PlayerUsageInput[] = [
    mk('a', 'WR', 0.9, 4), // huge usage, no points -> buy
    mk('b', 'WR', 0.8, 8),
    mk('c', 'WR', 0.6, 10),
    mk('d', 'WR', 0.5, 12),
    mk('e', 'WR', 0.3, 14),
    mk('f', 'WR', 0.1, 20), // no usage, big points -> sell
  ];

  it('flags the heavily-used player who is not scoring as a buy', () => {
    const rows = findDivergence(field, 4);
    const a = rows.find((r) => r.playerId === 'a')!;
    expect(a.verdict).toBe('buy');
    expect(a.divergence).toBeGreaterThan(0);
  });

  it('flags the barely-used player who is scoring as a sell', () => {
    const rows = findDivergence(field, 4);
    const f = rows.find((r) => r.playerId === 'f')!;
    expect(f.verdict).toBe('sell');
    expect(f.divergence).toBeLessThan(0);
  });

  it('sorts by the strength of the signal, in either direction', () => {
    const rows = findDivergence(field, 4);
    const mags = rows.map((r) => Math.abs(r.divergence));
    expect([...mags].sort((x, y) => y - x)).toEqual(mags);
  });

  it('calls a player whose usage matches his scoring fair', () => {
    const aligned = [
      mk('p1', 'RB', 0.9, 18),
      mk('p2', 'RB', 0.7, 14),
      mk('p3', 'RB', 0.5, 10),
      mk('p4', 'RB', 0.3, 6),
      mk('p5', 'RB', 0.1, 2),
    ];
    const rows = findDivergence(aligned, 4);
    for (const r of rows) expect(r.verdict).toBe('fair');
  });

  it('ranks within position, never across', () => {
    // A tight end's 20% target share is elite; a receiver's is ordinary. If
    // these were pooled the tight ends would all read as low usage.
    const mixed = [
      ...['w1', 'w2', 'w3', 'w4'].map((id, i) => mk(id, 'WR', 0.9 - i * 0.1, 15 - i * 3)),
      ...['t1', 't2', 't3', 't4'].map((id, i) => mk(id, 'TE', 0.5 - i * 0.1, 8 - i * 2)),
    ];
    const rows = findDivergence(mixed, 4);
    const tes = rows.filter((r) => r.position === 'TE');
    expect(tes).toHaveLength(4);
    // The best tight end should rank high among tight ends despite low absolute usage.
    const best = rows.find((r) => r.playerId === 't1')!;
    expect(best.usageRank).toBeGreaterThan(0.7);
  });

  it('ignores a position with too few players to rank', () => {
    const thin = [mk('q1', 'QB', 0.9, 20), mk('q2', 'QB', 0.8, 18)];
    expect(findDivergence(thin, 4)).toEqual([]);
  });

  it('ignores players with too few games to judge', () => {
    const oneGame = [
      mk('x1', 'WR', 0.9, 4, [4]),
      mk('x2', 'WR', 0.8, 8, [1, 2, 3, 4]),
      mk('x3', 'WR', 0.6, 10, [1, 2, 3, 4]),
      mk('x4', 'WR', 0.4, 12, [1, 2, 3, 4]),
      mk('x5', 'WR', 0.2, 14, [1, 2, 3, 4]),
    ];
    const rows = findDivergence(oneGame, 4);
    expect(rows.find((r) => r.playerId === 'x1')).toBeUndefined();
  });

  it('only looks inside the window', () => {
    // Enormous usage in week 1 must not count when the window is weeks 5-8.
    const stale = [
      { ...mk('s1', 'WR', 0.9, 2, [1]), },
      mk('s2', 'WR', 0.5, 10, [5, 6, 7, 8]),
      mk('s3', 'WR', 0.4, 9, [5, 6, 7, 8]),
      mk('s4', 'WR', 0.3, 8, [5, 6, 7, 8]),
      mk('s5', 'WR', 0.2, 7, [5, 6, 7, 8]),
    ];
    const rows = findDivergence(stale, 8);
    expect(rows.find((r) => r.playerId === 's1')).toBeUndefined();
  });

  it('reports how many games it judged on, so thin samples are visible', () => {
    const rows = findDivergence(field, 4);
    for (const r of rows) expect(r.games).toBe(4);
  });

  it('is deterministic', () => {
    expect(findDivergence(field, 4)).toEqual(findDivergence(field, 4));
  });

  it('returns nothing for an empty league', () => {
    expect(findDivergence([], 4)).toEqual([]);
  });
});

describe('usageTrend', () => {
  it('is positive when snaps are climbing', () => {
    const snaps = [
      { week: 1, offensePct: 0.3 },
      { week: 2, offensePct: 0.35 },
      { week: 3, offensePct: 0.7 },
      { week: 4, offensePct: 0.75 },
    ];
    expect(usageTrend(snaps, 4)!).toBeGreaterThan(0.3);
  });

  it('is negative when a role is being taken away', () => {
    const snaps = [
      { week: 1, offensePct: 0.8 },
      { week: 2, offensePct: 0.75 },
      { week: 3, offensePct: 0.4 },
      { week: 4, offensePct: 0.3 },
    ];
    expect(usageTrend(snaps, 4)!).toBeLessThan(-0.3);
  });

  it('is about zero for a steady role', () => {
    const snaps = [1, 2, 3, 4].map((week) => ({ week, offensePct: 0.6 }));
    expect(usageTrend(snaps, 4)).toBeCloseTo(0, 6);
  });

  it('declines to guess from a single game', () => {
    expect(usageTrend([{ week: 4, offensePct: 0.9 }], 4)).toBeNull();
    expect(usageTrend([], 4)).toBeNull();
  });
});

/* ================================================================== *
 * Leverage
 * ================================================================== */

describe('normalCdf', () => {
  it('is a half at the mean', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
  });

  it('matches the standard normal at one and two sigma', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('is symmetric about zero', () => {
    for (const z of [0.3, 1.1, 2.4]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 4);
    }
  });
});

describe('playerSigma', () => {
  it('makes quarterbacks the steadiest position and receivers the swingiest', () => {
    expect(playerSigma(20, 'QB')).toBeLessThan(playerSigma(20, 'WR'));
    expect(playerSigma(20, 'RB')).toBeLessThan(playerSigma(20, 'WR'));
  });

  it('never claims a low projection is precisely predictable', () => {
    expect(playerSigma(2, 'WR')).toBeGreaterThanOrEqual(3);
  });

  it('falls back sensibly for an unknown position', () => {
    expect(playerSigma(10, null)).toBeGreaterThan(0);
    expect(playerSigma(10, 'IDP')).toBeGreaterThan(0);
  });
});

describe('winProbability', () => {
  it('is even between equal teams', () => {
    expect(winProbability(110, 110, 30)).toBeCloseTo(0.5, 6);
  });

  it('never reaches certainty with real spread', () => {
    expect(winProbability(200, 80, 30)).toBeLessThan(1);
  });

  it('is symmetric', () => {
    expect(winProbability(120, 100, 25) + winProbability(100, 120, 25)).toBeCloseTo(1, 6);
  });

  it('degenerates cleanly when there is no spread at all', () => {
    expect(winProbability(120, 100, 0)).toBe(1);
    expect(winProbability(100, 100, 0)).toBe(0.5);
  });
});

describe('posture', () => {
  it('says gamble when far behind and protect when far ahead', () => {
    expect(posture(0.2)).toBe('gamble');
    expect(posture(0.85)).toBe('protect');
  });

  it('stays neutral in the middle, where points are the right answer', () => {
    expect(posture(0.5)).toBe('neutral');
    expect(posture(0.4)).toBe('neutral');
    expect(posture(0.6)).toBe('neutral');
  });
});

describe('evaluateSwap', () => {
  const steady = { playerId: 'steady', position: 'QB', projection: 14 };
  const boom = { playerId: 'boom', position: 'WR', projection: 12 };

  it('reports the points difference every other app would show', () => {
    const e = evaluateSwap(steady, boom, 110, 110, 25);
    expect(e.pointsDelta).toBe(-2);
  });

  it('prefers the volatile player when you are a heavy underdog and it is close', () => {
    // A near-tie is where this operates: giving up 0.1 points to buy a much
    // wider distribution is worth it when only the tail can win the matchup.
    const nearTie = { playerId: 'boom', position: 'WR', projection: 13.9 };
    const e = evaluateSwap(steady, nearTie, 110, 145, 25);
    expect(e.winProbabilityDelta).toBeGreaterThan(0);
    expect(e.contrarian).toBe(true);
  });

  it('will not overturn a real projection gap, however big the deficit', () => {
    // The honest limit of this idea. Two points is more than the variance swap
    // can buy back, so the answer stays "start the better player".
    const e = evaluateSwap(steady, { playerId: 'x', position: 'WR', projection: 12 }, 110, 145, 25);
    expect(e.winProbabilityDelta).toBeLessThan(0);
    expect(e.contrarian).toBe(false);
  });

  it('crosses over as the deficit grows, rather than flipping all at once', () => {
    const near = { playerId: 'boom', position: 'WR', projection: 13.5 };
    const even = evaluateSwap(steady, near, 110, 110, 25).winProbabilityDelta;
    const behind = evaluateSwap(steady, near, 110, 150, 25).winProbabilityDelta;
    expect(even).toBeLessThan(0);
    expect(behind).toBeGreaterThan(0);
  });

  it('prefers the steady player when you are a heavy favourite', () => {
    const nearTie = { playerId: 'boom', position: 'WR', projection: 13.9 };
    const e = evaluateSwap(steady, nearTie, 135, 100, 25);
    expect(e.winProbabilityDelta).toBeLessThan(0);
    expect(e.contrarian).toBe(false);
  });

  it('does not call it contrarian when the higher projection also wins', () => {
    const better = { playerId: 'better', position: 'WR', projection: 20 };
    const e = evaluateSwap(steady, better, 110, 110, 25);
    expect(e.pointsDelta).toBeGreaterThan(0);
    expect(e.contrarian).toBe(false);
  });

  it('reports the base probability it was reasoning from', () => {
    const e = evaluateSwap(steady, boom, 135, 100, 25);
    expect(e.baseWinProbability).toBeGreaterThan(0.7);
  });

  it('does not flag a disagreement too small to act on', () => {
    // A near-identical swap in a near-even matchup is noise, not advice.
    const twin = { playerId: 'twin', position: 'QB', projection: 13.99 };
    const e = evaluateSwap(steady, twin, 110, 110, 40);
    expect(e.contrarian).toBe(false);
  });
});

describe('lineupSigma', () => {
  it('grows with the number of players but sublinearly', () => {
    const one = lineupSigma([{ playerId: 'a', position: 'WR', projection: 12 }]);
    const four = lineupSigma(
      ['a', 'b', 'c', 'd'].map((playerId) => ({ playerId, position: 'WR', projection: 12 }))
    );
    expect(four).toBeGreaterThan(one);
    // Independent variances add, so four identical players double the spread.
    expect(four).toBeCloseTo(one * 2, 6);
  });

  it('is zero for an empty lineup', () => {
    expect(lineupSigma([])).toBe(0);
  });
});

/* ================================================================== *
 * Replacement level
 * ================================================================== */

describe('positionalDemand', () => {
  it('counts fixed slots across the whole league', () => {
    const { demand } = positionalDemand(SLOTS, 12);
    expect(demand.get('QB')).toBe(12);
    expect(demand.get('TE')).toBeGreaterThanOrEqual(12);
  });

  it('spreads flex demand across its eligible positions', () => {
    const { demand, flexSlots } = positionalDemand(SLOTS, 12);
    expect(flexSlots).toBe(3);
    // 24 fixed RB slots plus a share of 36 flex slots.
    expect(demand.get('RB')!).toBeGreaterThan(24);
    expect(demand.get('WR')!).toBeGreaterThan(24);
  });

  it('makes a 3-flex league drain the pools harder than a 0-flex one', () => {
    const withFlex = positionalDemand(SLOTS, 12).demand;
    const without = positionalDemand(
      SLOTS.filter((s) => s !== 'FLEX'),
      12
    ).demand;
    expect(withFlex.get('RB')!).toBeGreaterThan(without.get('RB')!);
  });

  it('sends superflex demand overwhelmingly to quarterbacks', () => {
    const { demand } = positionalDemand([...SLOTS, 'SUPER_FLEX'], 12);
    expect(demand.get('QB')!).toBeGreaterThan(12);
    expect(demand.get('QB')!).toBeLessThan(24);
  });

  it('ignores bench, taxi and IR — they are not started', () => {
    const a = positionalDemand(['QB', 'RB'], 12).demand;
    const b = positionalDemand(['QB', 'RB', 'BN', 'BN', 'TAXI', 'IR'], 12).demand;
    expect(a).toEqual(b);
  });
});

describe('replacementLevels', () => {
  // 200 players per position, descending. Deep enough for real replacement maths.
  const pool = ['QB', 'RB', 'WR', 'TE'].flatMap((position) =>
    Array.from({ length: 200 }, (_, i) => ({
      playerId: `${position}${i}`,
      position,
      points: 300 - i,
    }))
  );

  it('sets replacement deeper for positions the league starts more of', () => {
    const levels = replacementLevels(pool, SLOTS, 12);
    // 12 quarterbacks started vs 24+ running backs, so the RB replacement is worse.
    expect(levels.byPosition.get('RB')!).toBeLessThan(levels.byPosition.get('QB')!);
  });

  it('makes a player worth more when his position is scarce', () => {
    const levels = replacementLevels(pool, SLOTS, 12);
    const qb = valueOverReplacement({ playerId: 'x', position: 'QB', points: 250 }, levels)!;
    const rb = valueOverReplacement({ playerId: 'y', position: 'RB', points: 250 }, levels)!;
    // Same raw projection; the RB is worth more because replacement is lower.
    expect(rb).toBeGreaterThan(qb);
  });

  it('answers with the worst available player when a pool is too shallow', () => {
    const thin = [
      { playerId: 'a', position: 'TE', points: 100 },
      { playerId: 'b', position: 'TE', points: 50 },
    ];
    const levels = replacementLevels(thin, SLOTS, 12);
    expect(levels.byPosition.get('TE')).toBe(50);
  });

  it('returns null for a position it knows nothing about', () => {
    const levels = replacementLevels(pool, SLOTS, 12);
    expect(valueOverReplacement({ playerId: 'k', position: 'K', points: 100 }, levels)).toBeNull();
  });

  it('survives an empty pool', () => {
    const levels = replacementLevels([], SLOTS, 12);
    expect(levels.byPosition.size).toBe(0);
  });
});

/* ================================================================== *
 * Orientation
 * ================================================================== */

describe('playerOrientation', () => {
  it('reads a player worth more in redraft than dynasty as win-now', () => {
    const o = playerOrientation({ playerId: 'vet', dynasty: 2000, redraft: 6000 })!;
    expect(o.index).toBeGreaterThan(0);
  });

  it('reads a young player worth more in dynasty as future', () => {
    const o = playerOrientation({ playerId: 'kid', dynasty: 6000, redraft: 2000 })!;
    expect(o.index).toBeLessThan(0);
  });

  it('puts a player worth the same in both at zero', () => {
    expect(playerOrientation({ playerId: 'even', dynasty: 5000, redraft: 5000 })!.index).toBe(0);
  });

  it('refuses to guess from a missing value', () => {
    // A missing number is no information, not zero future value.
    expect(playerOrientation({ playerId: 'x', dynasty: 5000, redraft: null })).toBeNull();
    expect(playerOrientation({ playerId: 'x', dynasty: null, redraft: 5000 })).toBeNull();
    expect(playerOrientation({ playerId: 'x', dynasty: 0, redraft: 0 })).toBeNull();
  });

  it('stays inside -1 and +1', () => {
    expect(playerOrientation({ playerId: 'a', dynasty: 1, redraft: 99999 })!.index).toBeLessThan(1);
    expect(playerOrientation({ playerId: 'b', dynasty: 99999, redraft: 1 })!.index).toBeGreaterThan(-1);
  });
});

describe('orientationOf', () => {
  const veterans = ['v1', 'v2', 'v3'].map((playerId) => ({ playerId, dynasty: 2000, redraft: 6000 }));
  const kids = ['k1', 'k2', 'k3'].map((playerId) => ({ playerId, dynasty: 6000, redraft: 2000 }));

  it('labels a veteran roster win-now and a young one building', () => {
    expect(orientationOf(veterans).label).toBe('win-now');
    expect(orientationOf(kids).label).toBe('building');
  });

  it('labels a mixed roster balanced rather than forcing a verdict', () => {
    expect(orientationOf([...veterans, ...kids]).label).toBe('balanced');
  });

  it('weights by value, so a bench of cheap stashes cannot outvote a star', () => {
    const roster = [
      { playerId: 'star', dynasty: 9000, redraft: 9000 },
      ...Array.from({ length: 15 }, (_, i) => ({
        playerId: `stash${i}`,
        dynasty: 200,
        redraft: 20,
      })),
    ];
    const o = orientationOf(roster);
    // Fifteen young stashes should nudge, not dominate.
    expect(o.index).toBeGreaterThan(-0.3);
  });

  it('counts unpriced players rather than silently dropping them', () => {
    const o = orientationOf([...veterans, { playerId: 'unknown', dynasty: null, redraft: null }]);
    expect(o.unpriced).toBe(1);
    expect(o.players).toHaveLength(3);
  });

  it('sorts players by value, best first', () => {
    const o = orientationOf([
      { playerId: 'small', dynasty: 100, redraft: 100 },
      { playerId: 'big', dynasty: 9000, redraft: 9000 },
    ]);
    expect(o.players[0].playerId).toBe('big');
  });

  it('survives a roster with no market coverage at all', () => {
    const o = orientationOf([{ playerId: 'a', dynasty: null, redraft: null }]);
    expect(o.index).toBe(0);
    expect(o.label).toBe('balanced');
    expect(o.unpriced).toBe(1);
  });
});

describe('readMismatch', () => {
  const building = orientationOf(['k1', 'k2'].map((playerId) => ({ playerId, dynasty: 6000, redraft: 2000 })));
  const winNow = orientationOf(['v1', 'v2'].map((playerId) => ({ playerId, dynasty: 2000, redraft: 6000 })));

  it('calls out a rebuild that is winning', () => {
    const m = readMismatch(building, 5, 1);
    expect(m.mismatched).toBe(true);
    expect(m.advice).toMatch(/sell the veterans|buy a piece/);
  });

  it('calls out a contender that is losing', () => {
    const m = readMismatch(winNow, 1, 5);
    expect(m.mismatched).toBe(true);
    expect(m.advice).toMatch(/window/);
  });

  it('stays quiet when the roster matches its record', () => {
    expect(readMismatch(winNow, 5, 1).mismatched).toBe(false);
    expect(readMismatch(building, 1, 5).mismatched).toBe(false);
  });

  it('refuses to read anything into one or two weeks', () => {
    const m = readMismatch(building, 2, 0);
    expect(m.mismatched).toBe(false);
    expect(m.advice).toBeNull();
  });

  it('stays quiet for a middling record either way', () => {
    expect(readMismatch(building, 3, 3).mismatched).toBe(false);
    expect(readMismatch(winNow, 3, 3).mismatched).toBe(false);
  });
});

/* ================================================================== *
 * The ledger
 * ================================================================== */

describe('lineupShape', () => {
  it('separates fixed slots from flex capacity', () => {
    const { fixed, flex } = lineupShape(SLOTS);
    expect(fixed.get('QB')).toBe(1);
    expect(fixed.get('RB')).toBe(2);
    expect(flex.count).toBe(3);
    expect([...flex.eligible].sort()).toEqual(['RB', 'TE', 'WR']);
  });

  it('treats superflex as making a quarterback startable', () => {
    const { flex } = lineupShape(['QB', 'SUPER_FLEX', 'BN']);
    expect(flex.eligible.has('QB')).toBe(true);
  });
});

const levelsFor = (pts: Record<string, number>) => ({
  byPosition: new Map(Object.entries(pts)),
  demand: new Map<string, number>(),
  flexSlots: 3,
});

describe('standings', () => {
  const levels = levelsFor({ QB: 10, RB: 8, WR: 8, TE: 5 });

  const p = (playerId: string, position: string, points: number, value: number | null = 1000) => ({
    playerId,
    name: playerId,
    position,
    points,
    value,
  });

  it('finds surplus beyond what the lineup and flex can hold', () => {
    const roster = {
      rosterId: 1,
      teamName: 'Deep',
      players: [
        p('qb1', 'QB', 20),
        p('qb2', 'QB', 18), // startable but only one QB slot and no superflex
        p('rb1', 'RB', 15),
        p('rb2', 'RB', 14),
        p('wr1', 'WR', 15),
        p('wr2', 'WR', 14),
        p('te1', 'TE', 10),
      ],
    };
    const rows = standings(roster, SLOTS, levels);
    const qb = rows.find((r) => r.position === 'QB')!;
    expect(qb.surplus.map((s) => s.playerId)).toEqual(['qb2']);
  });

  it('does not count a below-replacement player as surplus', () => {
    const roster = {
      rosterId: 2,
      teamName: 'Shallow',
      players: [p('qb1', 'QB', 20), p('qb2', 'QB', 4)],
    };
    const rows = standings(roster, SLOTS, levels);
    expect(rows.find((r) => r.position === 'QB')!.surplus).toEqual([]);
  });

  it('spends the flex before calling anyone surplus', () => {
    const roster = {
      rosterId: 3,
      teamName: 'Flexy',
      players: [
        p('rb1', 'RB', 15),
        p('rb2', 'RB', 14),
        p('rb3', 'RB', 13), // goes to a flex, not surplus
        p('wr1', 'WR', 15),
        p('wr2', 'WR', 14),
      ],
    };
    const rows = standings(roster, SLOTS, levels);
    expect(rows.find((r) => r.position === 'RB')!.surplus).toEqual([]);
  });

  it('marks a slot it cannot fill above replacement as needy', () => {
    const roster = { rosterId: 4, teamName: 'Hole', players: [p('qb1', 'QB', 20)] };
    const rows = standings(roster, SLOTS, levels);
    expect(rows.find((r) => r.position === 'TE')!.needy).toBe(true);
    expect(rows.find((r) => r.position === 'QB')!.needy).toBe(false);
  });
});

describe('findTrades', () => {
  const levels = levelsFor({ QB: 10, RB: 8, WR: 8, TE: 5 });
  const p = (playerId: string, position: string, points: number, value: number | null = 1000) => ({
    playerId,
    name: playerId,
    position,
    points,
    value,
  });

  /**
   * One flex rather than three, so the flex interaction stays legible. With
   * three flexes a roster needs a dozen startable players before anything is
   * genuinely spare — which is true of real rosters and is exactly why surplus
   * is rarer than managers assume, but it makes for an unreadable fixture.
   */
  const ONE_FLEX = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];

  const mine = {
    rosterId: 1,
    teamName: 'Mine',
    players: [
      p('qb1', 'QB', 22),
      p('qb2', 'QB', 19, 3000), // dead value: one QB slot, no superflex
      p('rb1', 'RB', 15),
      p('rb2', 'RB', 14),
      p('wr1', 'WR', 15),
      p('wr2', 'WR', 14),
      // no tight end at all
    ],
  };

  const theirs = {
    rosterId: 2,
    teamName: 'Theirs',
    players: [
      p('tqb', 'QB', 6), // below replacement -> they need a QB
      p('trb1', 'RB', 15),
      p('trb2', 'RB', 14),
      p('trb3', 'RB', 13), // takes their flex
      p('twr1', 'WR', 15),
      p('twr2', 'WR', 14),
      p('tte1', 'TE', 12),
      p('tte2', 'TE', 11, 2000), // genuinely spare, and my hole
    ],
  };

  it('finds the two-way fit: my spare QB for their spare TE', () => {
    const matches = findTrades(mine, [theirs], ONE_FLEX, levels);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.give.playerId).toBe('qb2');
    expect(top.get?.playerId).toBe('tte2');
  });

  it('shows what both sides gain, because a trade needs two yeses', () => {
    const top = findTrades(mine, [theirs], ONE_FLEX, levels)[0];
    expect(top.theirGain).toBeGreaterThan(0);
    expect(top.yourGain).toBeGreaterThan(0);
  });

  it('carries both market values so the proposal is checkable', () => {
    const top = findTrades(mine, [theirs], ONE_FLEX, levels)[0];
    expect(top.giveValue).toBe(3000);
    expect(top.getValue).toBe(2000);
  });

  it('sorts two-way fits above one-way ones', () => {
    const oneWay = {
      rosterId: 3,
      teamName: 'OneWay',
      players: [p('oqb', 'QB', 5), p('orb', 'RB', 15), p('ote', 'TE', 12)],
    };
    const matches = findTrades(mine, [oneWay, theirs], ONE_FLEX, levels);
    expect(matches[0].get).toBeTruthy();
  });

  it('will not offer a player the other roster cannot actually start better', () => {
    // The flex absorbs a spare tight end, so a thin roster has no surplus even
    // though it has two of them. Offering him would be offering their starter.
    const thin = {
      rosterId: 5,
      teamName: 'Thin',
      players: [p('nqb', 'QB', 6), p('nte1', 'TE', 12), p('nte2', 'TE', 11)],
    };
    const matches = findTrades(mine, [thin], ONE_FLEX, levels);
    expect(matches[0].get).toBeNull();
  });

  it('finds nothing when nobody needs what I have spare', () => {
    const stacked = {
      rosterId: 4,
      teamName: 'Stacked',
      players: [p('sqb', 'QB', 25), p('srb', 'RB', 20), p('swr', 'WR', 20), p('ste', 'TE', 15)],
    };
    expect(findTrades(mine, [stacked], ONE_FLEX, levels)).toEqual([]);
  });

  it('finds nothing in an empty league', () => {
    expect(findTrades(mine, [], ONE_FLEX, levels)).toEqual([]);
  });
});

/* ================================================================== *
 * Playoff odds
 * ================================================================== */

describe('makeRandom', () => {
  it('is deterministic for a seed', () => {
    const a = makeRandom(42);
    const b = makeRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces values in [0, 1)', () => {
    const r = makeRandom(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const r = makeRandom(99);
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += r();
    expect(sum / 5000).toBeCloseTo(0.5, 1);
  });

  it('gives different streams for different seeds', () => {
    expect(makeRandom(1)()).not.toBe(makeRandom(2)());
  });
});

describe('simulateSeason', () => {
  // Twelve teams, descending strength, a clean round-robin remaining.
  const teams = Array.from({ length: 12 }, (_, i) => ({
    rosterId: i + 1,
    weeklyPoints: 120 - i * 5,
    wins: 0,
    losses: 0,
    pointsFor: 0,
  }));

  const remaining: { week: number; homeRosterId: number; awayRosterId: number }[] = [];
  for (let week = 1; week <= 11; week++) {
    for (let i = 0; i < 6; i++) {
      remaining.push({
        week,
        homeRosterId: teams[i].rosterId,
        awayRosterId: teams[11 - i].rosterId,
      });
    }
  }

  const odds = simulateSeason(teams, remaining, { playoffTeams: 6, runs: 600 });

  it('gives every team odds', () => {
    expect(odds).toHaveLength(12);
  });

  it('makes the strongest team likelier than the weakest', () => {
    const best = odds.find((o) => o.rosterId === 1)!;
    const worst = odds.find((o) => o.rosterId === 12)!;
    expect(best.playoffs).toBeGreaterThan(worst.playoffs);
  });

  it('never claims certainty in either direction', () => {
    for (const o of odds) {
      expect(o.playoffs).toBeGreaterThanOrEqual(0);
      expect(o.playoffs).toBeLessThanOrEqual(1);
    }
  });

  it('fills exactly the playoff field across the league', () => {
    // Six of twelve make it every run, so the odds must sum to six.
    const total = odds.reduce((s, o) => s + o.playoffs, 0);
    expect(total).toBeCloseTo(6, 1);
  });

  it('has exactly one first seed and one last place per run', () => {
    expect(odds.reduce((s, o) => s + o.firstSeed, 0)).toBeCloseTo(1, 1);
    expect(odds.reduce((s, o) => s + o.lastPlace, 0)).toBeCloseTo(1, 1);
  });

  it('conserves wins — every game produces exactly one', () => {
    const totalWins = odds.reduce((s, o) => s + o.expectedWins, 0);
    expect(totalWins).toBeCloseTo(remaining.length, 0);
  });

  it('is deterministic, so a refresh does not change the number', () => {
    const a = simulateSeason(teams, remaining, { playoffTeams: 6, runs: 200 });
    const b = simulateSeason(teams, remaining, { playoffTeams: 6, runs: 200 });
    expect(a).toEqual(b);
  });

  it('honours an existing record', () => {
    const headStart = teams.map((t) => (t.rosterId === 12 ? { ...t, wins: 8, pointsFor: 900 } : t));
    const withStart = simulateSeason(headStart, remaining, { playoffTeams: 6, runs: 600 });
    const without = odds.find((o) => o.rosterId === 12)!;
    expect(withStart.find((o) => o.rosterId === 12)!.playoffs).toBeGreaterThan(without.playoffs);
  });

  it('handles a season with nothing left to play', () => {
    const done = teams.map((t, i) => ({ ...t, wins: 12 - i, losses: i, pointsFor: 1000 - i * 10 }));
    const final = simulateSeason(done, [], { playoffTeams: 6, runs: 50 });
    // With no games left the field is fixed, so the odds are 0 or 1.
    for (const o of final) expect([0, 1]).toContain(o.playoffs);
  });

  it('breaks ties on points for', () => {
    const tied = [
      { rosterId: 1, weeklyPoints: 100, wins: 5, losses: 5, pointsFor: 1200 },
      { rosterId: 2, weeklyPoints: 100, wins: 5, losses: 5, pointsFor: 900 },
    ];
    const out = simulateSeason(tied, [], { playoffTeams: 1, runs: 20 });
    expect(out.find((o) => o.rosterId === 1)!.playoffs).toBe(1);
  });
});

describe('teamSigma', () => {
  it('scales with the projection but never goes to nothing', () => {
    expect(teamSigma(120)).toBeGreaterThan(teamSigma(80));
    expect(teamSigma(0)).toBeGreaterThanOrEqual(12);
  });
});

describe('gameLeverage', () => {
  const teams = Array.from({ length: 8 }, (_, i) => ({
    rosterId: i + 1,
    weeklyPoints: 110 - i * 4,
    wins: 3,
    losses: 3,
    pointsFor: 700,
  }));
  const remaining = [
    { week: 7, homeRosterId: 1, awayRosterId: 2 },
    { week: 8, homeRosterId: 1, awayRosterId: 8 },
    { week: 9, homeRosterId: 3, awayRosterId: 4 },
  ];

  const rows = gameLeverage(1, teams, remaining, { playoffTeams: 4, runs: 200 });

  it('only reports games this roster actually plays', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.week)).toEqual([7, 8]);
  });

  it('names the opponent from whichever side of the fixture they are on', () => {
    expect(rows[0].opponentRosterId).toBe(2);
    expect(rows[1].opponentRosterId).toBe(8);
  });

  it('makes winning worth more than losing, every time', () => {
    for (const r of rows) {
      expect(r.ifWon).toBeGreaterThan(r.ifLost);
      expect(r.swing).toBeGreaterThan(0);
    }
  });

  it('orders by week, because that is how a schedule is read', () => {
    const weeks = rows.map((r) => r.week);
    expect([...weeks].sort((a, b) => a - b)).toEqual(weeks);
  });

  it('returns nothing when the roster has no games left', () => {
    expect(gameLeverage(99, teams, remaining, { playoffTeams: 4, runs: 50 })).toEqual([]);
  });
});
