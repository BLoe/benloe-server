import { describe, it, expect } from 'vitest';
import {
  DefenseInfeasibleError,
  countsTowardMinimum,
  fairShares,
  optimizeDefense,
  positionFit,
} from './defense';
import type { DefensePlayer, DefenseResult, Gender } from './defense';
import { DEFENSE_KEYS, FIELDERS_PER_INNING, POSITIONS, getPosition } from './domain';

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

describe('POSITIONS weighting', () => {
  const weightOf = (positionKey: string, statKey: string) =>
    getPosition(positionKey)!.weights[statKey] ?? 0;

  it('gives every position weights that sum to exactly 1', () => {
    for (const position of POSITIONS) {
      const sum = Object.values(position.weights).reduce((s, v) => s + v, 0);
      expect(sum, `${position.key} weights`).toBeCloseTo(1, 8);
    }
  });

  it('only weights defensive stats', () => {
    for (const position of POSITIONS) {
      for (const statKey of Object.keys(position.weights)) {
        expect(DEFENSE_KEYS, `${position.key} uses ${statKey}`).toContain(statKey);
      }
    }
  });

  it('never asks the catcher to catch a pop fly', () => {
    // There is no bat in kickball, so nothing pops up behind the plate. This
    // is a baseball assumption that does not survive contact with the sport.
    expect(weightOf('catcher', 'pop_flies')).toBe(0);
  });

  it('leaves bunt coverage overwhelmingly with the striker', () => {
    for (const position of POSITIONS) {
      if (position.key === 'third') continue;
      expect(weightOf('third', 'striking'), `vs ${position.key}`).toBeGreaterThan(
        weightOf(position.key, 'striking')
      );
    }
    // The pitcher and first baseman take the occasional one; nobody else.
    expect(weightOf('pitcher', 'striking')).toBeGreaterThan(0);
    expect(weightOf('first', 'striking')).toBeGreaterThan(0);
    expect(weightOf('catcher', 'striking')).toBe(0);
  });

  it('ranks positions by where the ball actually goes', () => {
    const importance = (key: string) => getPosition(key)!.importance;
    for (const position of POSITIONS) expect(position.importance).toBeGreaterThan(0);

    // Bunts go down the third-base line and roughly half the roster bunts, so
    // the striker trails only the pitcher, who is in every at-bat.
    expect(importance('pitcher')).toBeGreaterThan(importance('third'));
    expect(importance('third')).toBeGreaterThan(importance('first'));
    // First base takes the throw on every one of those bunt plays.
    expect(importance('first')).toBeGreaterThan(importance('second'));
    expect(importance('first')).toBeGreaterThan(importance('left_center'));

    // Long kicks land in the two centre spots, not the corners.
    for (const corner of ['left', 'right']) {
      expect(importance('left_center')).toBeGreaterThan(importance(corner));
      expect(importance('right_center')).toBeGreaterThan(importance(corner));
    }
    expect(importance('left')).toBeGreaterThan(importance('right'));

    // Shortstop is rarely kicked to — the pitcher and striker cover that ground
    // from closer in — so it sits below second base, not above it.
    expect(importance('shortstop')).toBeLessThan(importance('second'));

    // Catcher and right field are where a weaker fielder gets rested.
    const ranked = [...POSITIONS].sort((a, b) => a.importance - b.importance).map((p) => p.key);
    expect(ranked.slice(0, 2).sort()).toEqual(['catcher', 'right']);
  });

  it('has the middle infield catching more than fielding grounders', () => {
    // The striker-pitcher-first line across covers most of what is played on
    // the ground, leaving these two handling pop-ups to their areas.
    for (const key of ['second', 'shortstop']) {
      const weights = getPosition(key)!.weights;
      const top = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
      expect(top, `${key} should lean on catching`).toBe('pop_flies');
    }
  });

  it('puts the line across the front above the middle infield', () => {
    const importance = (key: string) => getPosition(key)!.importance;
    for (const front of ['third', 'pitcher', 'first']) {
      for (const middle of ['second', 'shortstop']) {
        expect(importance(front), `${front} vs ${middle}`).toBeGreaterThan(importance(middle));
      }
    }
  });

  it('groups left field with the centre spots, not with right field', () => {
    const importance = (key: string) => getPosition(key)!.importance;
    // Left field sees almost as many long fly balls as the two centre spots,
    // and a drop there is extra bases. Right field is where a weaker fielder
    // gets rested. So left field belongs at the top of the outfield, not the
    // bottom, and it must outrank the whole middle infield.
    expect(importance('left')).toBeGreaterThan(importance('second'));
    expect(importance('left')).toBeGreaterThan(importance('shortstop'));

    const gapToCentre = importance('left_center') - importance('left');
    const gapToRight = importance('left') - importance('right');
    expect(gapToRight).toBeGreaterThan(gapToCentre * 3);
  });

  it('leans the long-ball outfield spots on catching as much as range', () => {
    for (const key of ['left', 'left_center']) {
      const weights = getPosition(key)!.weights;
      expect(weights.pop_flies, `${key} catching`).toBeGreaterThanOrEqual(weights.outfielding);
    }
  });

  it('keeps first base on the foul-line pop-ups', () => {
    // A right-footed kicker shanking one off the outside of the foot pops it up
    // down the first-base line.
    expect(weightOf('first', 'pop_flies')).toBeGreaterThan(0);
  });

  it('makes covering the bag matter more at first than in the middle infield', () => {
    // "Has to know when to cover the base" — decision making carries far more
    // weight at first than at second or short.
    expect(weightOf('first', 'defense_iq')).toBeGreaterThan(weightOf('second', 'defense_iq'));
    expect(weightOf('first', 'defense_iq')).toBeGreaterThan(weightOf('shortstop', 'defense_iq'));
  });

  it('gives the roamer more range than the corner outfielders', () => {
    for (const key of ['left', 'left_center', 'right']) {
      expect(weightOf('right_center', 'outfielding')).toBeGreaterThan(weightOf(key, 'outfielding'));
    }
  });

  it('makes hands the biggest part of playing first base and catcher', () => {
    for (const key of ['first', 'catcher']) {
      const weights = getPosition(key)!.weights;
      const top = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
      expect(top, `${key} should lean on infielding`).toBe('infielding');
    }
  });
});

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

  it('never parks a poor fielder at first base', () => {
    // Reported from a real lineup: first base was drawing players ranked 13th
    // and 14th of 16 for that spot. The objective summed fit over all sixty
    // slots with every slot equal, so it would happily hand first base to the
    // worst hands on the roster to buy a fraction of fit in right field.
    //
    // A spread of ability, so the optimizer has a real choice to get wrong.
    const players = Array.from({ length: 15 }, (_, i) => {
      const level = 20 + i * 5; // 20 through 90
      return makePlayer(`p${i}`, i < 6 ? 'woman' : 'man', {
        infielding: level,
        defense_iq: level,
        throwing: level,
        pop_flies: level,
        outfielding: level,
        striking: level,
        pitching: level,
      });
    });

    const rankedForFirst = [...players]
      .sort((a, b) => positionFit(b, 'first') - positionFit(a, 'first'))
      .map((p) => p.playerId);
    const firstIndex = POSITIONS.findIndex((p) => p.key === 'first');

    for (const seed of ['one', 'two', 'three']) {
      const result = optimizeDefense(players, { seed, minWomenInField: 3 });
      expectLegalLineup(result, players, 3);

      const ranks = result.assignment.map(
        (row) => rankedForFirst.indexOf(row[firstIndex]) + 1
      );
      // Never from the bottom third. The reported defect was ranks 13 and 14 of
      // 16, so that is the floor this guards.
      //
      // Not tighter, and the reason is arithmetic rather than taste. Six
      // positions now rank above ordinary — pitcher, striker, first base, both
      // centre-field spots and left field — while fairness caps anyone at four
      // of six innings. The top six players can therefore supply 24 slots
      // against the 36 those positions need, so ranks 7 through 10 have to turn
      // up somewhere demanding. Before loosening this again, check the
      // comparative assertions below still hold; those are the real guarantee.
      const bottomThird = Math.ceil((players.length * 2) / 3);
      for (const [inning, rank] of ranks.entries()) {
        expect(rank, `seed ${seed}, inning ${inning + 1} first base`).toBeLessThanOrEqual(bottomThird);
      }
      // Stated without an arbitrary rank cutoff, which is the part I kept
      // fitting to whatever the optimizer happened to produce: the hands
      // actually used at first base should sit well up the range the roster
      // offers, not near the middle of it. Demanding the very best every inning
      // would be wrong — fairness caps anyone at four of six innings, and the
      // pitcher and striker both outrank first base for the same good hands.
      const byId = new Map(players.map((p) => [p.playerId, p]));
      const meanFitAt = (key: string) => {
        const index = POSITIONS.findIndex((p) => p.key === key);
        return (
          result.assignment.reduce((s, row) => s + positionFit(byId.get(row[index])!, key), 0) /
          result.assignment.length
        );
      };

      const offered = players.map((p) => positionFit(p, 'first'));
      const rosterMean = offered.reduce((s, v) => s + v, 0) / offered.length;
      const best = Math.max(...offered);
      expect(meanFitAt('first'), `seed ${seed} first-base fit`).toBeGreaterThan(
        rosterMean + 0.25 * (best - rosterMean)
      );

      // The structural claim, and the one that does not need a magnitude picked
      // by hand: first base outranks right field in importance, so it must draw
      // the better fielder of the two. These players are uniformly able across
      // every stat, so the only thing separating the two spots is that ordering.
      expect(meanFitAt('first'), `seed ${seed} first vs right`).toBeGreaterThan(meanFitAt('right'));
    }
  });

  it('protects the pitching circle the same way', () => {
    const players = Array.from({ length: 15 }, (_, i) =>
      makePlayer(`p${i}`, i < 6 ? 'woman' : 'man', {
        pitching: 20 + i * 5,
        defense_iq: 20 + i * 5,
        infielding: 50,
        throwing: 50,
        outfielding: 50,
        pop_flies: 50,
        striking: 50,
      })
    );
    const ranked = [...players]
      .sort((a, b) => positionFit(b, 'pitcher') - positionFit(a, 'pitcher'))
      .map((p) => p.playerId);
    const pitcherIndex = POSITIONS.findIndex((p) => p.key === 'pitcher');

    const result = optimizeDefense(players, { seed: 'circle', minWomenInField: 3 });
    for (let inning = 0; inning < INNINGS; inning++) {
      const rank = ranked.indexOf(result.assignment[inning][pitcherIndex]) + 1;
      expect(rank, `inning ${inning + 1} pitcher`).toBeLessThanOrEqual(6);
    }
  });

  it('still keeps playing time fair while protecting those spots', () => {
    const players = Array.from({ length: 15 }, (_, i) =>
      makePlayer(`p${i}`, i < 6 ? 'woman' : 'man', {
        infielding: 20 + i * 5,
        defense_iq: 20 + i * 5,
        throwing: 20 + i * 5,
      })
    );
    const result = optimizeDefense(players, { seed: 'fairstill', minWomenInField: 3 });
    const counts = Object.values(result.inningsPlayed);
    // Protecting first base must not become an excuse to bench the weak.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
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

    // Counting exact matches is the wrong test here, and increasingly so as the
    // weights get more realistic: several positions share the same set of
    // stats above the 0.2 cutoff, so their specialists are literally identical
    // players and which one lands where is arbitrary. Second base and shortstop
    // are indistinguishable under this construction.
    //
    // What the test name actually claims is testable: the optimizer's placement
    // should beat leaving everyone where they happened to be listed.
    const byId = new Map(players.map((p) => [p.playerId, p]));
    const weightedFit = (assignment: readonly string[][]) => {
      let total = 0;
      let importance = 0;
      for (const row of assignment) {
        row.forEach((id, pos) => {
          total += POSITIONS[pos].importance * positionFit(byId.get(id)!, POSITIONS[pos].key);
          importance += POSITIONS[pos].importance;
        });
      }
      return total / importance;
    };
    const shuffledBlind = Array.from({ length: INNINGS }, () =>
      players.map((_, i) => players[(i + 5) % players.length].playerId)
    );

    expect(weightedFit(result.assignment)).toBeGreaterThan(weightedFit(shuffledBlind) + 0.05);
    expect(result.meanFit).toBeGreaterThan(0.75);

    // The two positions whose dominant stat is unique must still be exact.
    const exact = (key: string) => {
      const index = POSITIONS.findIndex((p) => p.key === key);
      return result.assignment[0][index] === `spec${index}`;
    };
    expect(exact('pitcher'), 'pitching specialist should pitch').toBe(true);
    expect(exact('third'), 'striking specialist should play third').toBe(true);
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
