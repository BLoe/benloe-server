import { describe, it, expect } from 'vitest';
import {
  DefenseInfeasibleError,
  countsTowardMinimum,
  fairShares,
  optimizeDefense,
  positionFit,
} from './defense';
import type { DefensePlayer, DefenseResult, Gender } from './defense';
import { FIELDERS_PER_INNING, POSITIONS } from './domain';

const INNINGS = 6;

function makePlayer(
  playerId: string,
  gender: Gender = 'man',
  ratings: Record<string, number> = {},
  extra: Partial<DefensePlayer> = {}
): DefensePlayer {
  return { playerId, gender, ratings, ...extra };
}

/** A roster of `n` players, alternating so that `women` of them count. */
function roster(n: number, women = 5): DefensePlayer[] {
  return Array.from({ length: n }, (_, i) =>
    makePlayer(`p${i}`, i < women ? 'woman' : 'man')
  );
}

// ---- Invariants every generated lineup must satisfy -------------------------

function expectLegalLineup(
  result: DefenseResult,
  players: readonly DefensePlayer[],
  minWomen: number,
  innings = INNINGS
) {
  const ids = new Set(players.map((p) => p.playerId));
  const byId = new Map(players.map((p) => [p.playerId, p]));

  expect(result.assignment).toHaveLength(innings);
  for (let inning = 0; inning < innings; inning++) {
    const row = result.assignment[inning];
    expect(row).toHaveLength(FIELDERS_PER_INNING);

    // Ten distinct, real players.
    expect(new Set(row).size).toBe(FIELDERS_PER_INNING);
    for (const id of row) expect(ids.has(id)).toBe(true);

    // League minimum met.
    const women = row.filter((id) => countsTowardMinimum(byId.get(id)!)).length;
    expect(women).toBeGreaterThanOrEqual(minWomen);

    // Nobody parked somewhere they opted out of.
    row.forEach((id, pos) => {
      const excluded = byId.get(id)!.excludedPositions ?? [];
      expect(excluded).not.toContain(POSITIONS[pos].key);
    });
  }

  // Innings played must add up.
  const total = Object.values(result.inningsPlayed).reduce((s, v) => s + v, 0);
  expect(total).toBe(innings * FIELDERS_PER_INNING);
}

describe('positionFit', () => {
  it('treats an unrated player as league average', () => {
    expect(positionFit(makePlayer('x'), 'pitcher')).toBeCloseTo(0.5, 10);
  });

  it('weights the stats that matter at the position', () => {
    const acePitcher = makePlayer('x', 'man', { pitching: 100 });
    // Pitching carries 0.45 of the pitcher weighting; the rest stay average.
    expect(positionFit(acePitcher, 'pitcher')).toBeCloseTo(0.45 * 1.0 + 0.55 * 0.5, 8);
    // The same rating does nothing in left field.
    expect(positionFit(acePitcher, 'left')).toBeCloseTo(0.5, 8);
  });

  it('leans on striking at third base and decision making in right-center', () => {
    const striker = makePlayer('s', 'man', { striking: 100 });
    expect(positionFit(striker, 'third')).toBeGreaterThan(positionFit(striker, 'second'));

    const smart = makePlayer('r', 'man', { defense_iq: 100 });
    const rcFit = positionFit(smart, 'right_center');
    for (const key of ['left', 'right', 'left_center']) {
      expect(rcFit).toBeGreaterThan(positionFit(smart, key));
    }
  });

  it('returns 0 for a position that does not exist', () => {
    expect(positionFit(makePlayer('x'), 'designated_kicker')).toBe(0);
  });

  it('stays within 0 and 1', () => {
    const best: Record<string, number> = {};
    const worst: Record<string, number> = {};
    for (const p of POSITIONS) for (const k of Object.keys(p.weights)) {
      best[k] = 100;
      worst[k] = 0;
    }
    for (const p of POSITIONS) {
      expect(positionFit(makePlayer('a', 'man', best), p.key)).toBeCloseTo(1, 8);
      expect(positionFit(makePlayer('b', 'man', worst), p.key)).toBeCloseTo(0, 8);
    }
  });
});

describe('fairShares', () => {
  it('hands out exactly the innings available', () => {
    for (const n of [10, 11, 12, 15, 20]) {
      const shares = fairShares(roster(n), INNINGS);
      const total = [...shares.values()].reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(INNINGS * FIELDERS_PER_INNING, 6);
    }
  });

  it('gives everyone every inning when exactly ten are available', () => {
    const shares = fairShares(roster(10), INNINGS);
    for (const v of shares.values()) expect(v).toBeCloseTo(6, 6);
  });

  it('splits evenly when nobody has history', () => {
    const shares = fairShares(roster(12), INNINGS);
    for (const v of shares.values()) expect(v).toBeCloseTo(5, 6);
  });

  it('never promises more innings than the game has', () => {
    const players = roster(11).map((p, i) =>
      i === 0 ? { ...p, priorPlayed: 0, priorPossible: 60 } : { ...p, priorPlayed: 30, priorPossible: 60 }
    );
    const shares = fairShares(players, INNINGS);
    for (const v of shares.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(INNINGS);
    }
  });

  it('owes innings to whoever has been sitting', () => {
    const players = roster(12).map((p, i) => ({
      ...p,
      priorPlayed: i === 0 ? 6 : 4,
      priorPossible: 6,
    }));
    const shares = fairShares(players, INNINGS);
    // p0 played every inning last week, so everyone else is ahead of them now.
    expect(shares.get('p0')!).toBeLessThan(shares.get('p1')!);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(60, 6);
  });

  it('does not reward missing a week', () => {
    // Both have played half their available innings; one simply attended less.
    const players = roster(12).map((p, i) => ({
      ...p,
      priorPlayed: i === 0 ? 3 : 6,
      priorPossible: i === 0 ? 6 : 12,
    }));
    const shares = fairShares(players, INNINGS);
    expect(shares.get('p0')!).toBeCloseTo(shares.get('p1')!, 6);
  });

  it('handles an empty roster', () => {
    expect(fairShares([], INNINGS).size).toBe(0);
  });
});

describe('optimizeDefense: hard constraints', () => {
  it('produces a legal lineup for a typical turnout', () => {
    const players = roster(13, 5);
    const result = optimizeDefense(players, { seed: 'legal', minWomenInField: 3 });
    expectLegalLineup(result, players, 3);
    expect(result.warnings).toEqual([]);
  });

  it('produces a legal lineup across a range of roster sizes', () => {
    for (let n = 10; n <= 18; n++) {
      const players = roster(n, Math.max(3, Math.floor(n / 2)));
      const result = optimizeDefense(players, { seed: `n${n}`, minWomenInField: 3, iterations: 6000 });
      expectLegalLineup(result, players, 3);
    }
  });

  it('plays everybody every inning when exactly ten show up', () => {
    const players = roster(10, 4);
    const result = optimizeDefense(players, { seed: 'ten', minWomenInField: 3 });
    expectLegalLineup(result, players, 3);
    for (const p of players) expect(result.inningsPlayed[p.playerId]).toBe(6);
  });

  it('refuses to invent a lineup from too few players', () => {
    expect(() => optimizeDefense(roster(9), { seed: 'few' })).toThrow(DefenseInfeasibleError);
    expect(() => optimizeDefense([], { seed: 'none' })).toThrow(DefenseInfeasibleError);
  });

  it('rejects a duplicated player', () => {
    const players = [...roster(10), makePlayer('p0', 'man')];
    expect(() => optimizeDefense(players, { seed: 'dupe' })).toThrow(DefenseInfeasibleError);
  });

  it('honours the league minimum when it is set higher', () => {
    const players = roster(14, 7);
    const result = optimizeDefense(players, { seed: 'five', minWomenInField: 5 });
    expectLegalLineup(result, players, 5);
  });

  it('relaxes the minimum with a warning when not enough women are available', () => {
    const players = roster(12, 2);
    const result = optimizeDefense(players, { seed: 'short', minWomenInField: 3 });
    expectLegalLineup(result, players, 2);
    expect(result.warnings.join(' ')).toMatch(/only 2 available/i);
    // Both of them have to be out there every inning.
    expect(result.inningsPlayed['p0']).toBe(6);
    expect(result.inningsPlayed['p1']).toBe(6);
  });

  it('never assigns a player to a position they opted out of', () => {
    const players = roster(13, 5).map((p, i) =>
      i < 6 ? { ...p, excludedPositions: ['pitcher', 'catcher'] } : p
    );
    const result = optimizeDefense(players, { seed: 'excl', minWomenInField: 3 });
    expectLegalLineup(result, players, 3);
  });

  it('keeps locked assignments exactly where they were put', () => {
    const players = roster(14, 6);
    const locks = [
      { inning: 0, positionKey: 'pitcher', playerId: 'p11' },
      { inning: 3, positionKey: 'catcher', playerId: 'p2' },
      { inning: 5, positionKey: 'right_center', playerId: 'p0' },
    ];
    const result = optimizeDefense(players, { seed: 'locks', minWomenInField: 3, locks });
    expectLegalLineup(result, players, 3);
    for (const lock of locks) {
      const posIndex = POSITIONS.findIndex((p) => p.key === lock.positionKey);
      expect(result.assignment[lock.inning][posIndex]).toBe(lock.playerId);
    }
  });

  it('ignores a lock naming somebody who is not available', () => {
    const players = roster(12, 5);
    const result = optimizeDefense(players, {
      seed: 'ghostlock',
      minWomenInField: 3,
      locks: [{ inning: 0, positionKey: 'pitcher', playerId: 'not-here' }],
    });
    expectLegalLineup(result, players, 3);
    expect(result.warnings.join(' ')).toMatch(/not available/i);
  });

  it('ignores a second lock for the same player in one inning', () => {
    const players = roster(12, 5);
    const result = optimizeDefense(players, {
      seed: 'doublelock',
      minWomenInField: 3,
      locks: [
        { inning: 1, positionKey: 'pitcher', playerId: 'p3' },
        { inning: 1, positionKey: 'catcher', playerId: 'p3' },
      ],
    });
    expectLegalLineup(result, players, 3);
    expect(result.warnings.join(' ')).toMatch(/second locked position/i);
  });

  it('supports a different number of innings', () => {
    const players = roster(13, 5);
    const result = optimizeDefense(players, { seed: 'seven', minWomenInField: 3, innings: 7 });
    expectLegalLineup(result, players, 3, 7);
  });
});

describe('optimizeDefense: fairness', () => {
  it('spreads innings evenly when nobody has history', () => {
    const players = roster(13, 6);
    const result = optimizeDefense(players, { seed: 'fair', minWomenInField: 3 });
    const counts = Object.values(result.inningsPlayed);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('holds up across many roster sizes', () => {
    for (const n of [11, 12, 14, 15]) {
      const players = roster(n, Math.max(3, Math.floor(n / 2)));
      const result = optimizeDefense(players, { seed: `fair${n}`, minWomenInField: 3 });
      const counts = Object.values(result.inningsPlayed);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it('gives more innings to whoever sat last week', () => {
    const players = roster(14, 6).map((p, i) => ({
      ...p,
      priorPossible: 6,
      priorPlayed: i < 4 ? 1 : 5,
    }));
    const result = optimizeDefense(players, { seed: 'carry', minWomenInField: 3 });
    expectLegalLineup(result, players, 3);
    const benched = [0, 1, 2, 3].map((i) => result.inningsPlayed[`p${i}`]);
    const regulars = [4, 5, 6, 7, 8].map((i) => result.inningsPlayed[`p${i}`]);
    expect(Math.min(...benched)).toBeGreaterThan(Math.max(...regulars));
  });

  it('does not let a strong player hoard innings', () => {
    // One player is excellent everywhere. Fairness should still cap them.
    const stacked: Record<string, number> = {};
    for (const p of POSITIONS) for (const k of Object.keys(p.weights)) stacked[k] = 100;
    const players = [
      makePlayer('star', 'man', stacked),
      ...roster(13, 6).map((p) => ({ ...p, playerId: `x${p.playerId}` })),
    ];
    const result = optimizeDefense(players, { seed: 'hoard', minWomenInField: 3 });
    const counts = Object.values(result.inningsPlayed);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('avoids sitting the same person two innings running', () => {
    const players = roster(12, 5);
    const result = optimizeDefense(players, { seed: 'rest', minWomenInField: 3 });
    let backToBack = 0;
    for (const p of players) {
      for (let i = 0; i + 1 < INNINGS; i++) {
        const satNow = !result.assignment[i].includes(p.playerId);
        const satNext = !result.assignment[i + 1].includes(p.playerId);
        if (satNow && satNext) backToBack++;
      }
    }
    // With 12 players there are 12 bench slots to place across 6 innings; a
    // good schedule needs none of them consecutive.
    expect(backToBack).toBe(0);
  });
});

describe('optimizeDefense: positions and consistency', () => {
  it('keeps people in one spot as far as substitutions allow', () => {
    const players = roster(13, 6);
    const result = optimizeDefense(players, { seed: 'consistent', minWomenInField: 3 });
    const distinct = Object.values(result.positionsPlayed).map((list) => list.length);
    const mean = distinct.reduce((s, v) => s + v, 0) / distinct.length;
    expect(mean).toBeLessThanOrEqual(1.7);
    // And nobody should be bounced around four different spots in one game.
    expect(Math.max(...distinct)).toBeLessThanOrEqual(3);
  });

  it('puts the specialist at their position', () => {
    const players = roster(13, 6);
    players[7] = makePlayer('ace', 'man', { pitching: 100, defense_iq: 90 });
    const result = optimizeDefense(players, { seed: 'ace', minWomenInField: 3 });
    const pitcherIndex = POSITIONS.findIndex((p) => p.key === 'pitcher');
    const inningsPitched = result.assignment.filter((row) => row[pitcherIndex] === 'ace').length;
    const inningsPlayed = result.inningsPlayed['ace'];
    expect(inningsPlayed).toBeGreaterThan(0);
    expect(inningsPitched / inningsPlayed).toBeGreaterThanOrEqual(0.7);
  });

  it('sends the striker to third base and the roamer to right-center', () => {
    const players = roster(13, 6);
    players[3] = makePlayer('striker', 'woman', { striking: 100, infielding: 85 });
    players[9] = makePlayer('roamer', 'man', { defense_iq: 100, outfielding: 85, striking: 80 });
    const result = optimizeDefense(players, { seed: 'specialists', minWomenInField: 3 });

    const thirdIndex = POSITIONS.findIndex((p) => p.key === 'third');
    const rcIndex = POSITIONS.findIndex((p) => p.key === 'right_center');
    const atThird = result.assignment.filter((row) => row[thirdIndex] === 'striker').length;
    const atRc = result.assignment.filter((row) => row[rcIndex] === 'roamer').length;

    expect(atThird / result.inningsPlayed['striker']).toBeGreaterThanOrEqual(0.7);
    expect(atRc / result.inningsPlayed['roamer']).toBeGreaterThanOrEqual(0.7);
  });

  it('beats a fit-blind lineup on skill placement', () => {
    // Give everyone a different specialty and check the optimizer finds them.
    const players: DefensePlayer[] = POSITIONS.map((pos, i) => {
      const ratings: Record<string, number> = {};
      for (const [stat, weight] of Object.entries(pos.weights)) {
        ratings[stat] = weight >= 0.2 ? 95 : 60;
      }
      return makePlayer(`spec${i}`, i < 4 ? 'woman' : 'man', ratings);
    });
    const result = optimizeDefense(players, { seed: 'match', minWomenInField: 3 });
    expectLegalLineup(result, players, 3);

    // With exactly ten players everyone plays every inning, so the only thing
    // left to optimize is placement. Each specialist should find their spot.
    let correct = 0;
    for (let pos = 0; pos < FIELDERS_PER_INNING; pos++) {
      if (result.assignment[0][pos] === `spec${pos}`) correct++;
    }
    expect(correct).toBeGreaterThanOrEqual(8);
    expect(result.meanFit).toBeGreaterThan(0.75);
  });

  it('reports the positions each player actually appeared at', () => {
    const players = roster(12, 5);
    const result = optimizeDefense(players, { seed: 'report', minWomenInField: 3 });
    for (const p of players) {
      const listed = new Set(result.positionsPlayed[p.playerId]);
      const actual = new Set<string>();
      result.assignment.forEach((row) =>
        row.forEach((id, pos) => {
          if (id === p.playerId) actual.add(POSITIONS[pos].key);
        })
      );
      expect([...listed].sort()).toEqual([...actual].sort());
    }
  });
});

describe('optimizeDefense: determinism and performance', () => {
  it('returns the same lineup for the same seed', () => {
    const players = roster(13, 6);
    const a = optimizeDefense(players, { seed: 'same', minWomenInField: 3 });
    const b = optimizeDefense(players, { seed: 'same', minWomenInField: 3 });
    expect(a.assignment).toEqual(b.assignment);
  });

  it('returns a different lineup for a different seed', () => {
    const players = roster(14, 6);
    const a = optimizeDefense(players, { seed: 'one', minWomenInField: 3 });
    const b = optimizeDefense(players, { seed: 'two', minWomenInField: 3 });
    expect(a.assignment).not.toEqual(b.assignment);
  });

  it('finishes fast enough to run inside a request', () => {
    const started = Date.now();
    optimizeDefense(roster(15, 7), { seed: 'perf', minWomenInField: 3 });
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
