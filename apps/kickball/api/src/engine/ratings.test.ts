import { describe, it, expect } from 'vitest';
import { fitBradleyTerry, selectMatchup, pairKey, winProbability } from './ratings';
import type { Comparison, MatchupContext, PlayerRating } from './ratings';
import { Rng } from './rng';

const ROSTER = ['ana', 'ben', 'cat', 'dev'];

/** Records `times` comparisons where `winner` beats `loser`. */
function beats(winner: string, loser: string, times = 1): Comparison[] {
  return Array.from({ length: times }, () => ({ a: winner, b: loser, winner }));
}

function tie(a: string, b: string, times = 1): Comparison[] {
  return Array.from({ length: times }, () => ({ a, b, winner: null }));
}

describe('fitBradleyTerry', () => {
  it('rates everyone at exactly average with no data', () => {
    const fit = fitBradleyTerry(ROSTER, []);
    for (const id of ROSTER) {
      const r = fit.get(id)!;
      expect(r.rating).toBeCloseTo(50, 6);
      expect(r.theta).toBeCloseTo(0, 6);
      expect(r.comparisons).toBe(0);
      expect(r.confidence).toBeCloseTo(0, 6);
    }
  });

  it('returns an entry for every player, including ones never compared', () => {
    const fit = fitBradleyTerry(ROSTER, beats('ana', 'ben', 3));
    expect([...fit.keys()].sort()).toEqual([...ROSTER].sort());
    expect(fit.get('dev')!.comparisons).toBe(0);
  });

  it('ranks a clear winner above a clear loser', () => {
    const fit = fitBradleyTerry(ROSTER, beats('ana', 'ben', 5));
    expect(fit.get('ana')!.rating).toBeGreaterThan(fit.get('ben')!.rating);
    expect(fit.get('ana')!.theta).toBeGreaterThan(0);
    expect(fit.get('ben')!.theta).toBeLessThan(0);
  });

  it('recovers a transitive ordering', () => {
    const comparisons = [
      ...beats('ana', 'ben', 6),
      ...beats('ben', 'cat', 6),
      ...beats('cat', 'dev', 6),
      ...beats('ana', 'cat', 6),
      ...beats('ben', 'dev', 6),
      ...beats('ana', 'dev', 6),
    ];
    const fit = fitBradleyTerry(ROSTER, comparisons);
    const ranked = [...fit.values()].sort((x, y) => y.rating - x.rating).map((r) => r.playerId);
    expect(ranked).toEqual(['ana', 'ben', 'cat', 'dev']);
  });

  it('keeps an undefeated player finite instead of running to infinity', () => {
    const comparisons = [
      ...beats('ana', 'ben', 20),
      ...beats('ana', 'cat', 20),
      ...beats('ana', 'dev', 20),
    ];
    const fit = fitBradleyTerry(ROSTER, comparisons);
    const ana = fit.get('ana')!;
    expect(Number.isFinite(ana.theta)).toBe(true);
    expect(ana.rating).toBeGreaterThan(50);
    expect(ana.rating).toBeLessThanOrEqual(99);
  });

  it('shrinks thin evidence harder than thick evidence', () => {
    const thin = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 1));
    const thick = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 25));
    expect(thick.get('ana')!.rating).toBeGreaterThan(thin.get('ana')!.rating);
    expect(thick.get('ana')!.confidence).toBeGreaterThan(thin.get('ana')!.confidence);
    expect(thick.get('ana')!.stderr).toBeLessThan(thin.get('ana')!.stderr);
  });

  it('treats a tie as evidence of equality', () => {
    const fit = fitBradleyTerry(['ana', 'ben'], tie('ana', 'ben', 10));
    expect(fit.get('ana')!.rating).toBeCloseTo(50, 4);
    expect(fit.get('ben')!.rating).toBeCloseTo(50, 4);
    // Ties still count as evidence, so confidence must rise above zero.
    expect(fit.get('ana')!.confidence).toBeGreaterThan(0.4);
    expect(fit.get('ana')!.comparisons).toBe(10);
  });

  it('lets ties pull a lopsided record back toward even', () => {
    const withoutTies = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 5));
    const withTies = fitBradleyTerry(['ana', 'ben'], [...beats('ana', 'ben', 5), ...tie('ana', 'ben', 10)]);
    expect(withTies.get('ana')!.rating).toBeLessThan(withoutTies.get('ana')!.rating);
    expect(withTies.get('ana')!.rating).toBeGreaterThan(50);
  });

  it('centers the roster on 50', () => {
    const comparisons = [...beats('ana', 'ben', 4), ...beats('ana', 'cat', 4), ...beats('ben', 'dev', 2)];
    const fit = fitBradleyTerry(ROSTER, comparisons);
    const meanTheta = [...fit.values()].reduce((s, r) => s + r.theta, 0) / ROSTER.length;
    expect(meanTheta).toBeCloseTo(0, 8);
  });

  it('does not care which side of the comparison a player was shown on', () => {
    const asA = fitBradleyTerry(['ana', 'ben'], [{ a: 'ana', b: 'ben', winner: 'ana' }]);
    const asB = fitBradleyTerry(['ana', 'ben'], [{ a: 'ben', b: 'ana', winner: 'ana' }]);
    expect(asA.get('ana')!.theta).toBeCloseTo(asB.get('ana')!.theta, 10);
  });

  it('ignores comparisons naming players who are not on the roster', () => {
    const withGhost = fitBradleyTerry(ROSTER, [
      ...beats('ana', 'ben', 3),
      { a: 'ana', b: 'ghost', winner: 'ana' },
    ]);
    const without = fitBradleyTerry(ROSTER, beats('ana', 'ben', 3));
    expect(withGhost.get('ana')!.theta).toBeCloseTo(without.get('ana')!.theta, 10);
  });

  it('ignores self-comparisons', () => {
    const fit = fitBradleyTerry(ROSTER, [{ a: 'ana', b: 'ana', winner: 'ana' }]);
    expect(fit.get('ana')!.comparisons).toBe(0);
    expect(fit.get('ana')!.rating).toBeCloseTo(50, 6);
  });

  it('excludes zero-weighted comparisons entirely', () => {
    const fit = fitBradleyTerry(ROSTER, [
      ...beats('ana', 'ben', 3),
      { a: 'cat', b: 'dev', winner: 'cat', weight: 0 },
    ]);
    expect(fit.get('cat')!.comparisons).toBe(0);
    expect(fit.get('cat')!.rating).toBeCloseTo(fit.get('dev')!.rating, 6);
  });

  it('honours fractional weights', () => {
    const full = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 4));
    const half = fitBradleyTerry(['ana', 'ben'], [
      ...beats('ana', 'ben', 2),
      { a: 'ana', b: 'ben', winner: 'ana', weight: 0.5 },
    ]);
    expect(half.get('ana')!.rating).toBeLessThan(full.get('ana')!.rating);
  });

  it('respects a stronger prior by shrinking further', () => {
    const loose = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 5), { lambda: 0.2 });
    const tight = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 5), { lambda: 5 });
    expect(tight.get('ana')!.rating).toBeLessThan(loose.get('ana')!.rating);
    expect(tight.get('ana')!.rating).toBeGreaterThan(50);
  });

  it('recovers the true ordering from simulated comparisons', () => {
    // Simulate an actual roster with known strengths and check the fit finds
    // them. This is the end-to-end claim the whole rating game rests on.
    const truth: Record<string, number> = { ana: 1.6, ben: 0.7, cat: -0.2, dev: -0.9, eli: -1.5 };
    const ids = Object.keys(truth);
    const rng = new Rng('recovery');
    const comparisons: Comparison[] = [];
    for (let n = 0; n < 900; n++) {
      const a = rng.pick(ids);
      let b = rng.pick(ids);
      while (b === a) b = rng.pick(ids);
      const p = 1 / (1 + Math.exp(-(truth[a] - truth[b])));
      comparisons.push({ a, b, winner: rng.next() < p ? a : b });
    }

    const fit = fitBradleyTerry(ids, comparisons);
    const ranked = [...fit.values()].sort((x, y) => y.theta - x.theta).map((r) => r.playerId);
    expect(ranked).toEqual(['ana', 'ben', 'cat', 'dev', 'eli']);

    // With this much data the estimates should land near the truth, allowing
    // for the shrinkage the prior deliberately applies.
    const truthMean = ids.reduce((s, id) => s + truth[id], 0) / ids.length;
    for (const id of ids) {
      expect(Math.abs(fit.get(id)!.theta - (truth[id] - truthMean))).toBeLessThan(0.35);
      expect(fit.get(id)!.confidence).toBeGreaterThan(0.75);
    }
  });

  it('converges to a stable answer regardless of comparison order', () => {
    const comparisons = [
      ...beats('ana', 'ben', 4),
      ...beats('ben', 'cat', 3),
      ...beats('cat', 'dev', 5),
      ...tie('ana', 'cat', 2),
    ];
    const forward = fitBradleyTerry(ROSTER, comparisons);
    const backward = fitBradleyTerry(ROSTER, [...comparisons].reverse());
    for (const id of ROSTER) {
      expect(forward.get(id)!.theta).toBeCloseTo(backward.get(id)!.theta, 6);
    }
  });
});

describe('winProbability', () => {
  it('is 50% between equals and rises with the gap', () => {
    const fit = fitBradleyTerry(['ana', 'ben'], beats('ana', 'ben', 8));
    const ana = fit.get('ana')!;
    const ben = fit.get('ben')!;
    expect(winProbability(ana, ana)).toBeCloseTo(0.5, 10);
    expect(winProbability(ana, ben)).toBeGreaterThan(0.5);
    expect(winProbability(ana, ben) + winProbability(ben, ana)).toBeCloseTo(1, 10);
  });
});

describe('pairKey', () => {
  it('is order independent', () => {
    expect(pairKey('ana', 'ben')).toBe(pairKey('ben', 'ana'));
    expect(pairKey('ana', 'ben')).not.toBe(pairKey('ana', 'cat'));
  });
});

function contextFor(
  statKey: string,
  ratings: Record<string, Partial<PlayerRating>>,
  comparisonCount = 0,
  pairCounts: Record<string, number> = {}
): MatchupContext {
  const map = new Map<string, PlayerRating>();
  for (const [playerId, r] of Object.entries(ratings)) {
    map.set(playerId, {
      playerId,
      theta: 0,
      rating: 50,
      stderr: 1,
      comparisons: 0,
      confidence: 0,
      ...r,
    });
  }
  return { statKey, ratings: map, comparisonCount, pairCounts: new Map(Object.entries(pairCounts)) };
}

describe('selectMatchup', () => {
  it('returns null when there is nobody to compare', () => {
    expect(selectMatchup([], new Rng(1))).toBeNull();
    expect(selectMatchup([contextFor('power', { ana: {} })], new Rng(1))).toBeNull();
  });

  it('returns one of the roster pairs for the requested stat', () => {
    const m = selectMatchup([contextFor('power', { ana: {}, ben: {} })], new Rng(1))!;
    expect(m.statKey).toBe('power');
    expect([m.playerA, m.playerB].sort()).toEqual(['ana', 'ben']);
  });

  it('is deterministic for a given seed', () => {
    const build = () => [contextFor('power', { ana: {}, ben: {}, cat: {}, dev: {} })];
    const a = selectMatchup(build(), new Rng(77));
    const b = selectMatchup(build(), new Rng(77));
    expect(a).toEqual(b);
  });

  it('prefers evenly matched players over obvious mismatches', () => {
    // ana and ben are neck and neck; cat is far below both.
    const ctx = () =>
      contextFor('power', {
        ana: { theta: 0.05 },
        ben: { theta: -0.05 },
        cat: { theta: -4 },
      });
    let evenPairs = 0;
    for (let seed = 0; seed < 200; seed++) {
      const m = selectMatchup([ctx()], new Rng(seed))!;
      if (pairKey(m.playerA, m.playerB) === pairKey('ana', 'ben')) evenPairs++;
    }
    expect(evenPairs).toBeGreaterThan(120);
  });

  it('prefers players we know the least about', () => {
    // All four are equally matched, but cat and dev are barely established.
    // Any matchup touching cat or dev teaches us something; ana against ben
    // teaches us almost nothing, so it should almost never come up.
    const ctx = () =>
      contextFor('power', {
        ana: { stderr: 0.15 },
        ben: { stderr: 0.15 },
        cat: { stderr: 1.3 },
        dev: { stderr: 1.3 },
      });
    let touchesUnknown = 0;
    let settledPair = 0;
    for (let seed = 0; seed < 200; seed++) {
      const m = selectMatchup([ctx()], new Rng(seed))!;
      const key = pairKey(m.playerA, m.playerB);
      if (key === pairKey('ana', 'ben')) settledPair++;
      if (m.playerA === 'cat' || m.playerA === 'dev' || m.playerB === 'cat' || m.playerB === 'dev') {
        touchesUnknown++;
      }
    }
    expect(touchesUnknown).toBeGreaterThan(190);
    expect(settledPair).toBeLessThan(6);
  });

  it('never returns an excluded pair', () => {
    const exclude = new Set([pairKey('ana', 'ben')]);
    for (let seed = 0; seed < 100; seed++) {
      const m = selectMatchup([contextFor('power', { ana: {}, ben: {}, cat: {} })], new Rng(seed), {
        exclude,
      })!;
      expect(pairKey(m.playerA, m.playerB)).not.toBe(pairKey('ana', 'ben'));
    }
  });

  it('returns null when every pair is excluded', () => {
    const exclude = new Set([pairKey('ana', 'ben')]);
    const m = selectMatchup([contextFor('power', { ana: {}, ben: {} })], new Rng(1), { exclude });
    expect(m).toBeNull();
  });

  it('backs off a pair that has already been asked about', () => {
    const ctx = () =>
      contextFor('power', { ana: {}, ben: {}, cat: {}, dev: {} }, 0, {
        [pairKey('ana', 'ben')]: 4,
      });
    let repeats = 0;
    for (let seed = 0; seed < 200; seed++) {
      const m = selectMatchup([ctx()], new Rng(seed))!;
      if (pairKey(m.playerA, m.playerB) === pairKey('ana', 'ben')) repeats++;
    }
    // Five other pairs exist; a fair share would be ~33. Seen-once should be
    // well under that.
    expect(repeats).toBeLessThan(15);
  });

  it('steers toward stats that have less data', () => {
    const contexts = () => [
      contextFor('power', { ana: {}, ben: {} }, 80),
      contextFor('bunting', { ana: {}, ben: {} }, 0),
    ];
    let bunting = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (selectMatchup(contexts(), new Rng(seed))!.statKey === 'bunting') bunting++;
    }
    expect(bunting).toBeGreaterThan(140);
  });

  it('shows each player on either side of the screen', () => {
    const sides = { ana: 0, ben: 0 };
    for (let seed = 0; seed < 200; seed++) {
      const m = selectMatchup([contextFor('power', { ana: {}, ben: {} })], new Rng(seed))!;
      sides[m.playerA as 'ana' | 'ben']++;
    }
    expect(sides.ana).toBeGreaterThan(60);
    expect(sides.ben).toBeGreaterThan(60);
  });

  it('still covers every stat over a long session', () => {
    const statKeys = ['power', 'bunting', 'on_base', 'pitching'];
    const counts = new Map(statKeys.map((k) => [k, 0]));
    const pairCounts = new Map(statKeys.map((k) => [k, new Map<string, number>()]));
    const rng = new Rng('session');

    for (let i = 0; i < 200; i++) {
      const contexts = statKeys.map((k) =>
        contextFor('x', { ana: {}, ben: {}, cat: {}, dev: {} }, counts.get(k)!)
      );
      statKeys.forEach((k, idx) => {
        contexts[idx].statKey = k;
        contexts[idx].pairCounts = pairCounts.get(k)!;
      });
      const m = selectMatchup(contexts, rng)!;
      counts.set(m.statKey, counts.get(m.statKey)! + 1);
      const pc = pairCounts.get(m.statKey)!;
      const key = pairKey(m.playerA, m.playerB);
      pc.set(key, (pc.get(key) ?? 0) + 1);
    }

    for (const k of statKeys) {
      // Perfectly even would be 50 each. Nothing should be starved.
      expect(counts.get(k)!).toBeGreaterThan(30);
    }
    // And every pair within a stat should have been asked at least once.
    for (const k of statKeys) {
      expect(pairCounts.get(k)!.size).toBe(6);
    }
  });
});
