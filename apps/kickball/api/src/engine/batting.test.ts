import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CALIBRATION,
  longestSameGroupRun,
  smallestFeasibleRun,
  evaluateOrder,
  heuristicOrder,
  hitDistribution,
  optimizeBattingOrder,
  playAtBat,
  reachRate,
  simulateGame,
} from './batting';
import type { OffenseProfile } from './batting';
import { Rng } from './rng';

function player(playerId: string, overrides: Partial<OffenseProfile> = {}): OffenseProfile {
  return { playerId, onBase: 0, power: 0, bunting: 0, baserunning: 0, iq: 0, ...overrides };
}

/** A roster of n identical league-average players. */
function averageRoster(n: number): OffenseProfile[] {
  return Array.from({ length: n }, (_, i) => player(`p${i}`));
}

describe('reachRate', () => {
  it('puts an average kicker at the league rate', () => {
    expect(reachRate(player('x'), DEFAULT_CALIBRATION)).toBeCloseTo(
      DEFAULT_CALIBRATION.leagueOnBase,
      10
    );
  });

  it('rises with on-base skill and falls without it', () => {
    const good = reachRate(player('x', { onBase: 2 }), DEFAULT_CALIBRATION);
    const bad = reachRate(player('x', { onBase: -2 }), DEFAULT_CALIBRATION);
    expect(good).toBeGreaterThan(0.6);
    expect(bad).toBeLessThan(0.6);
    expect(good).toBeGreaterThan(bad);
  });

  it('credits bunting as a second route to first base', () => {
    const bunter = reachRate(player('x', { bunting: 2 }), DEFAULT_CALIBRATION);
    expect(bunter).toBeGreaterThan(0.6);
    // But less than an equivalent edge in the headline on-base skill.
    expect(bunter).toBeLessThan(reachRate(player('x', { onBase: 2 }), DEFAULT_CALIBRATION));
  });

  it('stays a probability at absurd inputs', () => {
    for (const v of [-50, -8, 0, 8, 50]) {
      const r = reachRate(player('x', { onBase: v, bunting: v, iq: v }), DEFAULT_CALIBRATION);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    }
  });
});

describe('hitDistribution', () => {
  it('is a probability distribution', () => {
    for (const power of [-3, 0, 3]) {
      const d = hitDistribution(player('x', { power }), DEFAULT_CALIBRATION);
      expect(d).toHaveLength(4);
      expect(d.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
      for (const v of d) expect(v).toBeGreaterThan(0);
    }
  });

  it('matches the league split for an average kicker', () => {
    const d = hitDistribution(player('x'), DEFAULT_CALIBRATION);
    expect(d[0]).toBeCloseTo(0.7, 10);
    expect(d[3]).toBeCloseTo(0.03, 10);
  });

  it('shifts toward extra bases as power rises', () => {
    const weak = hitDistribution(player('x', { power: -2 }), DEFAULT_CALIBRATION);
    const strong = hitDistribution(player('x', { power: 2 }), DEFAULT_CALIBRATION);
    expect(strong[3]).toBeGreaterThan(weak[3]);
    expect(strong[0]).toBeLessThan(weak[0]);
    // Singles share should fall monotonically with power.
    const shares = [-2, -1, 0, 1, 2].map((p) => hitDistribution(player('x', { power: p }), DEFAULT_CALIBRATION)[0]);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
  });
});

describe('playAtBat', () => {
  it('clears the bases and scores four on a grand slam', () => {
    const a = player('a');
    const state = { bases: [player('r1'), player('r2'), player('r3')], outs: 0, runs: 0 };
    // A kicker who always reaches and always homers.
    const monster = player('a', { onBase: 40, power: 40 });
    playAtBat(monster, state, new Rng(1), DEFAULT_CALIBRATION);
    expect(state.runs).toBe(4);
    expect(state.bases).toEqual([null, null, null]);
    expect(state.outs).toBe(0);
    expect(a.playerId).toBe('a');
  });

  it('records an out for a kicker who can never reach', () => {
    const state = { bases: [null, null, null], outs: 0, runs: 0 };
    playAtBat(player('a', { onBase: -40, bunting: -40, iq: -40, power: -40 }), state, new Rng(1), DEFAULT_CALIBRATION);
    expect(state.outs).toBe(1);
    expect(state.runs).toBe(0);
  });

  it('never leaves more than three runners on base', () => {
    const rng = new Rng('bases');
    const state = { bases: [null, null, null] as (OffenseProfile | null)[], outs: 0, runs: 0 };
    for (let i = 0; i < 5000; i++) {
      if (state.outs >= 3) {
        state.bases = [null, null, null];
        state.outs = 0;
      }
      playAtBat(player(`k${i}`), state, rng, DEFAULT_CALIBRATION);
      expect(state.bases).toHaveLength(3);
      expect(state.runs).toBeGreaterThanOrEqual(0);
    }
  });

  it('lets a deep out score a runner from third', () => {
    // Cannot reach base but has huge power, so the sacrifice is the only path
    // to a run here.
    const sacrificer = player('a', { onBase: -40, bunting: -40, power: 40, iq: 40 });
    const state = { bases: [null, null, player('r3')] as (OffenseProfile | null)[], outs: 0, runs: 0 };
    playAtBat(sacrificer, state, new Rng(2), DEFAULT_CALIBRATION);
    expect(state.runs).toBe(1);
    expect(state.outs).toBe(1);
    expect(state.bases[2]).toBeNull();
  });

  it('does not allow a sacrifice with two outs', () => {
    const sacrificer = player('a', { onBase: -40, bunting: -40, power: 40, iq: 40 });
    const state = { bases: [null, null, player('r3')] as (OffenseProfile | null)[], outs: 2, runs: 0 };
    playAtBat(sacrificer, state, new Rng(2), DEFAULT_CALIBRATION);
    expect(state.runs).toBe(0);
    expect(state.outs).toBe(3);
  });
});

describe('simulateGame', () => {
  it('returns one entry per inning', () => {
    const runs = simulateGame(averageRoster(10), new Rng(1));
    expect(runs).toHaveLength(DEFAULT_CALIBRATION.innings);
    for (const r of runs) expect(r).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a given seed', () => {
    const roster = averageRoster(10);
    expect(simulateGame(roster, new Rng(5))).toEqual(simulateGame(roster, new Rng(5)));
  });

  it('produces different games from different seeds', () => {
    const roster = averageRoster(10);
    const seen = new Set(Array.from({ length: 30 }, (_, s) => simulateGame(roster, new Rng(s)).join(',')));
    expect(seen.size).toBeGreaterThan(15);
  });

  it('scores in a plausible range for a rec league', () => {
    const evaluation = evaluateOrder(averageRoster(11), { games: 3000, seed: 'plausible' });
    // A six-inning adult kickball game is high scoring but not unbounded.
    expect(evaluation.expectedRuns).toBeGreaterThan(4);
    expect(evaluation.expectedRuns).toBeLessThan(30);
  });

  it('scores far more with a strong roster than a weak one', () => {
    const strong = Array.from({ length: 10 }, (_, i) =>
      player(`s${i}`, { onBase: 1.5, power: 1.5, baserunning: 1.5, iq: 1.5 })
    );
    const weak = Array.from({ length: 10 }, (_, i) =>
      player(`w${i}`, { onBase: -1.5, power: -1.5, baserunning: -1.5, iq: -1.5 })
    );
    const strongRuns = evaluateOrder(strong, { games: 1500, seed: 'x' }).expectedRuns;
    const weakRuns = evaluateOrder(weak, { games: 1500, seed: 'x' }).expectedRuns;
    expect(strongRuns).toBeGreaterThan(weakRuns * 2);
  });
});

describe('evaluateOrder', () => {
  it('is deterministic for a given seed', () => {
    const roster = averageRoster(10);
    const a = evaluateOrder(roster, { games: 200, seed: 'same' });
    const b = evaluateOrder(roster, { games: 200, seed: 'same' });
    expect(a).toEqual(b);
  });

  it('reports per-inning runs that sum to the total', () => {
    const evaluation = evaluateOrder(averageRoster(10), { games: 500, seed: 'sum' });
    const summed = evaluation.runsByInning.reduce((s, r) => s + r, 0);
    expect(summed).toBeCloseTo(evaluation.expectedRuns, 8);
  });

  it('weights early innings more heavily in the score', () => {
    // Same total runs weighted by a front-loaded curve must exceed the flat sum
    // only if runs actually land early; construct the check directly.
    const evaluation = evaluateOrder(averageRoster(10), { games: 800, seed: 'weights' });
    const flat = evaluation.runsByInning.reduce((s, r) => s + r, 0);
    const weighted = evaluation.runsByInning.reduce(
      (s, r, i) => s + r * DEFAULT_CALIBRATION.inningWeights[i],
      0
    );
    expect(weighted).not.toBeCloseTo(flat, 3);
    expect(evaluation.score).toBeCloseTo(weighted, 8);
  });

  it('rewards putting the best kickers at the top of the order', () => {
    const stars = Array.from({ length: 4 }, (_, i) =>
      player(`star${i}`, { onBase: 1.8, power: 1.8, baserunning: 1.5, iq: 1.5 })
    );
    const scrubs = Array.from({ length: 8 }, (_, i) =>
      player(`scrub${i}`, { onBase: -1.8, power: -1.8, baserunning: -1.5, iq: -1.5 })
    );
    const starsFirst = evaluateOrder([...stars, ...scrubs], { games: 4000, seed: 'order' });
    const starsLast = evaluateOrder([...scrubs, ...stars], { games: 4000, seed: 'order' });
    // The top of the order gets more plate appearances over six innings, so
    // this gap is the whole reason ordering is worth optimizing.
    expect(starsFirst.score).toBeGreaterThan(starsLast.score);
  });
});

describe('heuristicOrder', () => {
  it('keeps every player exactly once', () => {
    const roster = Array.from({ length: 11 }, (_, i) =>
      player(`p${i}`, { onBase: (i % 3) - 1, power: ((i + 1) % 3) - 1 })
    );
    const ordered = heuristicOrder(roster);
    expect(ordered).toHaveLength(roster.length);
    expect(new Set(ordered.map((p) => p.playerId)).size).toBe(roster.length);
  });

  it('leads off with a table setter, not the biggest leg', () => {
    const roster = [
      player('slugger', { power: 2.5, onBase: -0.5 }),
      player('tablesetter', { onBase: 2.5, bunting: 2, baserunning: 2, power: -1 }),
      player('filler1'),
      player('filler2'),
    ];
    const ordered = heuristicOrder(roster);
    expect(ordered[0].playerId).toBe('tablesetter');
    expect(ordered[1].playerId).toBe('slugger');
  });

  it('handles an odd roster size without dropping anyone', () => {
    for (const n of [1, 2, 3, 7, 12, 15]) {
      const ordered = heuristicOrder(averageRoster(n));
      expect(new Set(ordered.map((p) => p.playerId)).size).toBe(n);
    }
  });
});

describe('optimizeBattingOrder', () => {
  const roster = [
    player('ana', { onBase: 1.6, bunting: 1.4, baserunning: 1.5, power: -0.8, iq: 1.0 }),
    player('ben', { onBase: 0.2, power: 2.0, baserunning: -0.6, iq: 0.3 }),
    player('cat', { onBase: 1.1, bunting: 0.6, baserunning: 1.2, power: -0.2, iq: 0.8 }),
    player('dev', { onBase: -0.3, power: 1.5, baserunning: -0.4, iq: -0.2 }),
    player('eli', { onBase: -0.9, power: -0.7, baserunning: -0.5, iq: -0.6 }),
    player('fay', { onBase: 0.5, power: 0.4, baserunning: 0.6, iq: 0.5 }),
    player('gus', { onBase: -1.2, power: -1.0, baserunning: -1.1, iq: -0.9 }),
    player('hal', { onBase: 0.7, bunting: 1.1, baserunning: 0.9, power: -0.5, iq: 0.4 }),
    player('ivy', { onBase: -0.2, power: 0.9, baserunning: 0.1, iq: 0.2 }),
    player('jo', { onBase: 0.1, power: -0.3, baserunning: 0.4, iq: 0.0 }),
  ];

  const fast = { searchGames: 120, finalGames: 800, restarts: 1, maxPasses: 2 };

  it('returns a true permutation of the roster', () => {
    const result = optimizeBattingOrder(roster, { ...fast, seed: 'perm' });
    expect(result.order).toHaveLength(roster.length);
    expect(new Set(result.order).size).toBe(roster.length);
    for (const p of roster) expect(result.order).toContain(p.playerId);
  });

  it('never lands below its own starting point', () => {
    const result = optimizeBattingOrder(roster, { ...fast, seed: 'gain' });
    expect(result.score).toBeGreaterThanOrEqual(result.baselineScore);
  });

  it('beats a deliberately terrible order', () => {
    const result = optimizeBattingOrder(roster, { seed: 'batting' });
    const worst = [...roster].sort((a, b) => a.onBase + a.power - (b.onBase + b.power));
    const worstScore = evaluateOrder(worst, { games: 6000, seed: 'batting:runoff' }).score;
    expect(result.score).toBeGreaterThan(worstScore);
  });

  it('holds up on a simulation stream the search never saw', () => {
    // The real test of the two-stage design: judge the chosen order against a
    // completely fresh random stream. An order that only looked good because
    // of search noise would fail here.
    const result = optimizeBattingOrder(roster, { seed: 'honest' });
    const byId = new Map(roster.map((p) => [p.playerId, p]));
    const chosen = result.order.map((id) => byId.get(id)!);
    const worst = [...roster].sort((a, b) => a.onBase + a.power - (b.onBase + b.power));

    const fresh = { games: 8000, seed: 'independent-jury' };
    const chosenScore = evaluateOrder(chosen, fresh).score;
    const worstScore = evaluateOrder(worst, fresh).score;
    const heuristicScore = evaluateOrder(heuristicOrder(roster), fresh).score;

    expect(chosenScore).toBeGreaterThan(worstScore);
    // It should at least match the heuristic it started from, within the noise
    // still present at 8000 games.
    expect(chosenScore).toBeGreaterThan(heuristicScore - 0.15);
  });

  it('reports its score at run-off precision, not search precision', () => {
    const result = optimizeBattingOrder(roster, { seed: 'precision', finalGames: 6000 });
    const byId = new Map(roster.map((p) => [p.playerId, p]));
    const chosen = result.order.map((id) => byId.get(id)!);
    const recomputed = evaluateOrder(chosen, { games: 6000, seed: 'precision:runoff' });
    expect(result.score).toBeCloseTo(recomputed.score, 8);
    expect(result.expectedRuns).toBeCloseTo(recomputed.expectedRuns, 8);
  });

  it('is deterministic for a given seed', () => {
    const opts = { ...fast, seed: 'stable' };
    expect(optimizeBattingOrder(roster, opts).order).toEqual(optimizeBattingOrder(roster, opts).order);
  });

  it('handles an empty roster', () => {
    const result = optimizeBattingOrder([], fast);
    expect(result.order).toEqual([]);
    expect(result.expectedRuns).toBe(0);
  });

  it('handles a single player', () => {
    const result = optimizeBattingOrder([player('solo')], { ...fast, seed: 's' });
    expect(result.order).toEqual(['solo']);
  });

  it('handles two players', () => {
    const result = optimizeBattingOrder([player('a', { onBase: 2 }), player('b')], { ...fast, seed: 's' });
    expect(result.order.slice().sort()).toEqual(['a', 'b']);
  });

  it('finishes fast enough to run inside a request', () => {
    const started = Date.now();
    optimizeBattingOrder(roster, { seed: 'perf' });
    expect(Date.now() - started).toBeLessThan(10000);
  });
});

describe('spreading the order out', () => {
  /** `pattern` like 'MMMWW' builds a roster with matching groups and abilities. */
  function roster(pattern: string, abilityByIndex = (i: number) => 1 - i * 0.2): OffenseProfile[] {
    return [...pattern].map((ch, i) =>
      player(`${ch}${i}`, {
        group: ch === 'M' ? 'other' : 'counted',
        onBase: abilityByIndex(i),
        power: abilityByIndex(i),
        baserunning: abilityByIndex(i),
        iq: abilityByIndex(i),
      })
    );
  }
  const groupsOf = (ids: string[]) => ids.map((id) => id[0]).join('');

  describe('longestSameGroupRun', () => {
    it('counts the longest stretch', () => {
      expect(longestSameGroupRun(roster('MMMMWWWW'))).toBe(4);
      expect(longestSameGroupRun(roster('MWMWMWMW'))).toBe(1);
      expect(longestSameGroupRun(roster('MMWMMWMM'))).toBe(2);
    });

    it('handles trivial rosters', () => {
      expect(longestSameGroupRun([])).toBe(0);
      expect(longestSameGroupRun(roster('M'))).toBe(1);
    });
  });

  describe('smallestFeasibleRun', () => {
    it('is 1 when the groups are the same size', () => {
      expect(smallestFeasibleRun(roster('MMMWWW'))).toBe(1);
    });

    it('reports what a lopsided roster can actually manage', () => {
      // Ten men and six women: six women open seven gaps, so two men per gap.
      expect(smallestFeasibleRun(roster('MMMMMMMMMMWWWWWW'))).toBe(2);
      // Twelve men and two women can only manage four in a row.
      expect(smallestFeasibleRun(roster('MMMMMMMMMMMMWW'))).toBe(4);
    });

    it('gives up gracefully when everyone is in one group', () => {
      expect(smallestFeasibleRun(roster('MMMM'))).toBe(4);
    });
  });

  describe('optimizeBattingOrder with a cap', () => {
    // Ability descends with index, and every man precedes every woman, so an
    // unconstrained search sorts into all men then all women. This is the exact
    // shape that showed up on the real roster.
    const lopsided = roster('MMMMMMMMMMWWWWWW');
    const fast = { searchGames: 120, finalGames: 1500, restarts: 1, maxPasses: 2 };

    it('stacks the groups when nothing stops it', () => {
      const result = optimizeBattingOrder(lopsided, { ...fast, seed: 'stack' });
      expect(result.longestSameGroupRun).toBeGreaterThan(4);
    });

    it('honours the cap', () => {
      for (const seed of ['a', 'b', 'c']) {
        const result = optimizeBattingOrder(lopsided, { ...fast, seed, maxSameGroupRun: 2 });
        expect(result.longestSameGroupRun, `seed ${seed}`).toBeLessThanOrEqual(2);
        expect(result.order).toHaveLength(lopsided.length);
        expect(new Set(result.order).size).toBe(lopsided.length);
        expect(result.warnings).toEqual([]);
      }
    });

    it('raises an impossible cap to the closest achievable one, with a warning', () => {
      const result = optimizeBattingOrder(lopsided, { ...fast, seed: 'tight', maxSameGroupRun: 1 });
      // Strict alternation cannot be done with ten and six.
      expect(result.longestSameGroupRun).toBe(2);
      expect(result.warnings.join(' ')).toMatch(/2 in a row/);
    });

    it('does not fall apart when everyone is in the same group', () => {
      const oneGroup = roster('MMMMMMMMMMMM');
      const result = optimizeBattingOrder(oneGroup, { ...fast, seed: 'one', maxSameGroupRun: 2 });
      expect(new Set(result.order).size).toBe(oneGroup.length);
    });

    it('still keeps the stronger kickers near the top', () => {
      const result = optimizeBattingOrder(lopsided, { ...fast, seed: 'quality', maxSameGroupRun: 2 });
      const index = new Map(result.order.map((id, i) => [id, i]));
      // Ability descends with roster index, so within each group the ordering
      // should still broadly favour the better kickers.
      const menPositions = lopsided
        .filter((p) => p.group === 'other')
        .map((p) => index.get(p.playerId)!);
      const firstHalf = menPositions.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
      const secondHalf = menPositions.slice(5).reduce((s, v) => s + v, 0) / 5;
      expect(firstHalf).toBeLessThan(secondHalf);
    });

    it('costs very little in runs', () => {
      // The whole justification for having this on by default.
      //
      // This roster is a deliberately extreme case: ability descends straight
      // down the list and correlates perfectly with the group, so the cap is
      // fighting the run-maximizing order as hard as it ever could. It costs
      // about a third of a run here. Measured against the real roster, where
      // the correlation is real but far from perfect, the cost was 0.05 runs
      // out of roughly 16 — against about 1.1 runs of gain over a random order.
      const free = optimizeBattingOrder(lopsided, { seed: 'cost' });
      const capped = optimizeBattingOrder(lopsided, { seed: 'cost', maxSameGroupRun: 2 });
      expect(capped.expectedRuns).toBeGreaterThan(free.expectedRuns - 0.5);
      expect(longestSameGroupRun(lopsided)).toBeGreaterThan(2);
    });
  });
});
