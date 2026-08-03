import { describe, it, expect } from 'vitest';
import { projectLineup, slotEligibility, type LineupPlayer } from '../src/lib/analysis/lineup.js';
import {
  expectedLosses,
  pairMatchups,
  playoffFieldSize,
  playoffStartWeek,
  pointsFor,
  simKey,
  unprojectedStarters,
  weeksPlayed,
} from '../src/server/routes/season.js';
import type { SimGame, SimTeam } from '../src/lib/analysis/playoffs.js';

const p = (over: Partial<LineupPlayer> & { playerId: string }): LineupPlayer => ({
  position: 'RB',
  points: 10,
  ...over,
});

/** The shape this league actually uses, so the tests are about a real lineup. */
const STANDARD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'BN', 'BN', 'BN'];

describe('projectLineup', () => {
  it('fills every slot with the best eligible player', () => {
    const lineup = projectLineup(
      [
        p({ playerId: 'qb1', position: 'QB', points: 20 }),
        p({ playerId: 'rb1', position: 'RB', points: 18 }),
        p({ playerId: 'rb2', position: 'RB', points: 12 }),
        p({ playerId: 'wr1', position: 'WR', points: 16 }),
        p({ playerId: 'wr2', position: 'WR', points: 14 }),
        p({ playerId: 'te1', position: 'TE', points: 9 }),
        p({ playerId: 'rb3', position: 'RB', points: 11 }),
        p({ playerId: 'wr3', position: 'WR', points: 10 }),
        p({ playerId: 'wr4', position: 'WR', points: 8 }),
      ],
      STANDARD
    );
    expect(lineup.empty).toEqual([]);
    // 20 + 18 + 12 + 16 + 14 + 9 + (11 + 10 + 8)
    expect(lineup.points).toBeCloseTo(118, 6);
    expect(lineup.slots).toHaveLength(9);
  });

  it('will not start a taxi or injured-reserve player, however good he is', () => {
    // Sleeper keeps these in `players` alongside everyone else, so a rookie on
    // the taxi squad walks into a flex if nothing stops him — and the team's
    // expected score comes out too high.
    const lineup = projectLineup(
      [
        p({ playerId: 'stud', position: 'RB', points: 30, onTaxi: true }),
        p({ playerId: 'hurt', position: 'RB', points: 25, onIr: true }),
        p({ playerId: 'plodder', position: 'RB', points: 6 }),
      ],
      ['RB']
    );
    expect(lineup.slots[0].player?.playerId).toBe('plodder');
    expect(lineup.points).toBe(6);
  });

  it('does not let a superflex steal the only quarterback', () => {
    // The classic failure: SUPER_FLEX takes the best QB, the QB slot is left
    // empty, and the roster loses more than the flex gained.
    const lineup = projectLineup(
      [
        p({ playerId: 'qb1', position: 'QB', points: 22 }),
        p({ playerId: 'rb1', position: 'RB', points: 14 }),
      ],
      ['QB', 'SUPER_FLEX']
    );
    expect(lineup.slots[0].player?.playerId).toBe('qb1');
    expect(lineup.slots[1].player?.playerId).toBe('rb1');
    expect(lineup.points).toBe(36);
  });

  it('gives a superflex the second quarterback when there is one', () => {
    const lineup = projectLineup(
      [
        p({ playerId: 'qb1', position: 'QB', points: 22 }),
        p({ playerId: 'qb2', position: 'QB', points: 19 }),
        p({ playerId: 'rb1', position: 'RB', points: 14 }),
      ],
      ['QB', 'SUPER_FLEX']
    );
    expect(lineup.slots[1].player?.playerId).toBe('qb2');
    expect(lineup.points).toBe(41);
  });

  it('solves overlapping flex types together rather than in order', () => {
    // WRRB_FLEX takes RB or WR, REC_FLEX takes WR or TE. Filling them left to
    // right gives the receiver to the first slot and 25 points; the right answer
    // is the back in the first and the receiver in the second, for 35.
    const lineup = projectLineup(
      [
        p({ playerId: 'wr', position: 'WR', points: 20 }),
        p({ playerId: 'rb', position: 'RB', points: 15 }),
        p({ playerId: 'te', position: 'TE', points: 5 }),
      ],
      ['WRRB_FLEX', 'REC_FLEX']
    );
    expect(lineup.points).toBe(35);
    expect(lineup.slots[0].player?.playerId).toBe('rb');
    expect(lineup.slots[1].player?.playerId).toBe('wr');
  });

  it('reports the slots nobody can fill instead of quietly scoring them', () => {
    // An empty slot scores zero, and a team with one is genuinely weaker. The
    // caller needs to be able to say so rather than the shortfall vanishing.
    const lineup = projectLineup([p({ playerId: 'rb1', position: 'RB', points: 12 })], [
      'QB',
      'RB',
      'TE',
    ]);
    expect(lineup.empty).toEqual(['QB', 'TE']);
    expect(lineup.points).toBe(12);
    expect(lineup.slots.map((s) => s.player?.playerId ?? null)).toEqual([null, 'rb1', null]);
  });

  it('renders an empty roster as an empty lineup, not as a crash', () => {
    const lineup = projectLineup([], STANDARD);
    expect(lineup.points).toBe(0);
    expect(lineup.empty).toHaveLength(9);
    expect(lineup.bench).toEqual([]);
  });

  it('ignores bench, taxi and IR slots — they are not started from', () => {
    const lineup = projectLineup([p({ playerId: 'rb1', points: 10 })], ['RB', 'BN', 'TAXI', 'IR']);
    expect(lineup.slots.map((s) => s.slot)).toEqual(['RB']);
  });

  it('is deterministic when two players are level, because the sim is seeded', () => {
    // A tie resolved by sort stability would make the same roster score
    // differently between runs, which would quietly break the promise that the
    // odds do not move on a refresh.
    const players = [
      p({ playerId: 'bravo', position: 'WR', points: 12 }),
      p({ playerId: 'alpha', position: 'WR', points: 12 }),
    ];
    const first = projectLineup(players, ['WR']);
    const second = projectLineup([...players].reverse(), ['WR']);
    expect(first.slots[0].player?.playerId).toBe('alpha');
    expect(second.slots[0].player?.playerId).toBe('alpha');
  });

  it('leaves everyone who did not start on the bench, best first', () => {
    const lineup = projectLineup(
      [
        p({ playerId: 'rb1', points: 18 }),
        p({ playerId: 'rb2', points: 14 }),
        p({ playerId: 'rb3', points: 9 }),
        p({ playerId: 'taxi', points: 30, onTaxi: true }),
      ],
      ['RB']
    );
    expect(lineup.bench.map((b) => b.playerId)).toEqual(['taxi', 'rb2', 'rb3']);
  });

  it('does not start a player with no position at all', () => {
    // Sleeper's player dump carries entries with a null position; they cannot
    // legally fill anything and must not be counted towards a score.
    const lineup = projectLineup(
      [p({ playerId: 'ghost', position: null, points: 40 }), p({ playerId: 'rb1', points: 8 })],
      ['FLEX']
    );
    expect(lineup.slots[0].player?.playerId).toBe('rb1');
    expect(lineup.points).toBe(8);
  });

  it('copes with a league that starts nobody', () => {
    const lineup = projectLineup([p({ playerId: 'rb1' })], ['BN', 'BN']);
    expect(lineup.slots).toEqual([]);
    expect(lineup.points).toBe(0);
  });
});

describe('slotEligibility', () => {
  it('knows the flex families', () => {
    expect(slotEligibility('FLEX')).toEqual(['RB', 'WR', 'TE']);
    expect(slotEligibility('SUPER_FLEX')).toContain('QB');
  });

  it('treats an unknown slot as its own position, so IDP leagues still fill', () => {
    expect(slotEligibility('LB')).toEqual(['LB']);
  });
});

describe('pairMatchups', () => {
  it('pairs the two rows that share a matchup id', () => {
    const games = pairMatchups(3, [
      { roster_id: 4, matchup_id: 1 },
      { roster_id: 2, matchup_id: 2 },
      { roster_id: 1, matchup_id: 1 },
      { roster_id: 7, matchup_id: 2 },
    ]);
    expect(games).toEqual([
      { week: 3, homeRosterId: 1, awayRosterId: 4 },
      { week: 3, homeRosterId: 2, awayRosterId: 7 },
    ]);
  });

  it('is order-independent, because the simulation must be reproducible', () => {
    const rows = [
      { roster_id: 9, matchup_id: 5 },
      { roster_id: 3, matchup_id: 5 },
    ];
    expect(pairMatchups(1, rows)).toEqual(pairMatchups(1, [...rows].reverse()));
  });

  it('drops a team with no opponent rather than inventing a game', () => {
    // Happens before a schedule is generated, and in leagues with an odd number
    // of teams. A guessed fixture would be simulated as if it were real.
    expect(pairMatchups(1, [{ roster_id: 1, matchup_id: null }])).toEqual([]);
  });

  it('ignores a group that is not a clean pair', () => {
    // Median-scoring and multi-team formats land here; we cannot simulate them
    // honestly, so they are left out.
    const games = pairMatchups(1, [
      { roster_id: 1, matchup_id: 1 },
      { roster_id: 2, matchup_id: 1 },
      { roster_id: 3, matchup_id: 1 },
    ]);
    expect(games).toEqual([]);
  });

  it('handles a week Sleeper answered with nothing', () => {
    expect(pairMatchups(9, [])).toEqual([]);
  });

  it('leaves a week short when only some of its groups pair', () => {
    // Four teams, one clean pair and one three-team group. The route compares
    // the games returned against floor(rows / 2) to notice, because a week that
    // half-paired still looks scheduled and would otherwise be simulated with a
    // game silently missing from it.
    const rows = [
      { roster_id: 1, matchup_id: 1 },
      { roster_id: 2, matchup_id: 1 },
      { roster_id: 3, matchup_id: 2 },
      { roster_id: 4, matchup_id: 2 },
      { roster_id: 5, matchup_id: 2 },
      { roster_id: 6, matchup_id: 3 },
    ];
    expect(pairMatchups(4, rows)).toHaveLength(1);
    expect(pairMatchups(4, rows).length).toBeLessThan(Math.floor(rows.length / 2));
  });
});

describe('weeksPlayed', () => {
  it('reads the records rather than the calendar', () => {
    expect(
      weeksPlayed([
        { settings: { wins: 4, losses: 3 } },
        { settings: { wins: 2, losses: 5 } },
      ])
    ).toBe(7);
  });

  it('counts ties, which are games played too', () => {
    expect(weeksPlayed([{ settings: { wins: 3, losses: 3, ties: 1 } }])).toBe(7);
  });

  it('takes the most-played team, so one team on a bye does not drag the league back', () => {
    expect(
      weeksPlayed([{ settings: { wins: 5, losses: 2 } }, { settings: { wins: 3, losses: 3 } }])
    ).toBe(7);
  });

  it('says zero in the preseason, where every game is still to come', () => {
    expect(weeksPlayed([{ settings: { wins: 0, losses: 0 } }, {}])).toBe(0);
    expect(weeksPlayed([])).toBe(0);
  });
});

describe('simKey', () => {
  const team = (over: Partial<SimTeam> & { rosterId: number }): SimTeam => ({
    weeklyPoints: 100,
    wins: 2,
    losses: 1,
    pointsFor: 300,
    ...over,
  });
  const games: SimGame[] = [{ week: 4, homeRosterId: 1, awayRosterId: 2 }];

  it('is the same key for the same inputs, so a cached run is reused', () => {
    const a = simKey('L', [team({ rosterId: 1 })], games, 6, 1);
    const b = simKey('L', [team({ rosterId: 1 })], games, 6, 1);
    expect(a).toBe(b);
  });

  it('changes the moment a result comes in', () => {
    // The whole safety of caching a simulation rests on this: the key is a
    // fingerprint of the inputs, so a hit can never be a stale number.
    const before = simKey('L', [team({ rosterId: 1, wins: 2 })], games, 6, 1);
    const after = simKey('L', [team({ rosterId: 1, wins: 3 })], games, 6, 1);
    expect(after).not.toBe(before);
  });

  it('separates leagues, playoff formats and askers', () => {
    const base = simKey('L', [team({ rosterId: 1 })], games, 6, 1);
    expect(simKey('OTHER', [team({ rosterId: 1 })], games, 6, 1)).not.toBe(base);
    expect(simKey('L', [team({ rosterId: 1 })], games, 4, 1)).not.toBe(base);
    // Leverage is computed for one roster, so two managers must not share a run.
    expect(simKey('L', [team({ rosterId: 1 })], games, 6, 2)).not.toBe(base);
  });

  it('changes when a game is played and drops out of the remaining list', () => {
    expect(simKey('L', [team({ rosterId: 1 })], [], 6, 1)).not.toBe(
      simKey('L', [team({ rosterId: 1 })], games, 6, 1)
    );
  });
});

describe('playoffStartWeek', () => {
  it('takes the league at its word when the setting is real', () => {
    expect(playoffStartWeek(15)).toBe(15);
    expect(playoffStartWeek(14)).toBe(14);
  });

  it('treats zero as unset rather than as week zero', () => {
    // Sleeper reports 0 for a league whose playoff schedule has not been set,
    // which is most leagues in the preseason. Believed, it makes the regular
    // season minus one weeks long: no schedule, no simulation, and copy that
    // reads "-1 weeks".
    expect(playoffStartWeek(0)).toBe(15);
    expect(playoffStartWeek(undefined)).toBe(15);
    expect(playoffStartWeek(null)).toBe(15);
    expect(playoffStartWeek('nonsense')).toBe(15);
    expect(playoffStartWeek(-4)).toBe(15);
  });

  it('will not send us fetching thirty weeks of matchups', () => {
    expect(playoffStartWeek(40)).toBe(19);
  });
});

describe('playoffFieldSize', () => {
  it('takes a real setting', () => {
    expect(playoffFieldSize(6, 12)).toBe(6);
    expect(playoffFieldSize(4, 10)).toBe(4);
  });

  it('treats zero as unset — a field of none would put nobody in the playoffs', () => {
    expect(playoffFieldSize(0, 12)).toBe(6);
    expect(playoffFieldSize(undefined, 12)).toBe(6);
  });

  it('never seeds more teams than the league has', () => {
    expect(playoffFieldSize(6, 4)).toBe(4);
    expect(playoffFieldSize(0, 4)).toBe(4);
  });
});

describe('expectedLosses', () => {
  it("fills out the rest of a team's own schedule", () => {
    // 3 played, 11 to come, 8.4 wins expected across the fourteen.
    expect(expectedLosses({ wins: 2, losses: 1, ties: 0 }, 11, 8.4)).toBeCloseTo(5.6, 6);
  });

  it('does not count a tie as a defeat', () => {
    // playoffs.ts has no concept of a tie, so a drawn game is neither won nor
    // lost. Folding it into the losses would misreport a real result.
    expect(expectedLosses({ wins: 3, losses: 3, ties: 1 }, 7, 6.5)).toBeCloseTo(6.5, 6);
  });

  it("is per team, so a short schedule does not borrow another team's games", () => {
    // A week Sleeper never published leaves some rosters with fewer fixtures.
    const full = expectedLosses({ wins: 0, losses: 0, ties: 0 }, 14, 7);
    const short = expectedLosses({ wins: 0, losses: 0, ties: 0 }, 12, 7);
    expect(full).toBe(7);
    expect(short).toBe(5);
  });

  it('never goes negative when a team wins more than it plays', () => {
    expect(expectedLosses({ wins: 0, losses: 0, ties: 0 }, 2, 2.0000001)).toBe(0);
  });

  it('reads a finished season as its actual record', () => {
    expect(expectedLosses({ wins: 9, losses: 5, ties: 0 }, 0, 9)).toBe(5);
  });
});

describe('unprojectedStarters', () => {
  const slot = (playerId: string | null) => ({ player: playerId ? { playerId } : null });

  it('counts a starter the projections have never heard of', () => {
    // He scores zero, so he only reaches a slot when nobody better exists — and
    // then the team's expected score is built on a number we do not have.
    expect(unprojectedStarters([slot('a'), slot('b')], { a: {} })).toBe(1);
  });

  it('does not count an empty slot, which is reported separately', () => {
    expect(unprojectedStarters([slot(null), slot('a')], { a: {} })).toBe(0);
  });

  it('says zero when every starter is covered', () => {
    expect(unprojectedStarters([slot('a'), slot('b')], { a: {}, b: {} })).toBe(0);
  });

  it('copes with a lineup nobody starts in', () => {
    expect(unprojectedStarters([], {})).toBe(0);
  });
});

describe('pointsFor', () => {
  it('reassembles the decimal Sleeper splits into its own field', () => {
    expect(pointsFor({ fpts: 1234, fpts_decimal: 56 })).toBeCloseTo(1234.56, 6);
  });

  it('reads a fresh roster as zero rather than as missing', () => {
    expect(pointsFor(undefined)).toBe(0);
    expect(pointsFor({})).toBe(0);
  });
});
