/**
 * Tests run against the frozen fixtures — real data from Ben's leagues, not mocks.
 * If Sleeper changes a payload shape, `npm run capture` + these tests catch it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pts,
  buildTeams,
  buildStandings,
  buildMatchups,
  buildResultTimeline,
  buildAllPlay,
  currentStreak,
  buildRosterView,
  type RawRoster,
  type RawUser,
  type PlayerIndex,
} from '../src/lib/derive.js';

const F = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (n: string) => JSON.parse(readFileSync(join(F, `${n}.json`), 'utf8'));

const league = load('dynasty-2025.league');
const rosters: RawRoster[] = load('dynasty-2025.rosters');
const users: RawUser[] = load('dynasty-2025.users');
const matchups = load('dynasty-2025.matchups');
const players: PlayerIndex = load('players.slim');

const BEN = '810215947997663232';

describe('pts', () => {
  it('recombines whole and hundredths', () => {
    expect(pts(1332, 82)).toBe(1332.82);
    expect(pts(1629, 12)).toBe(1629.12);
  });

  it('treats missing parts as zero', () => {
    expect(pts(100)).toBe(100);
    expect(pts(undefined, undefined)).toBe(0);
    expect(pts(null, null)).toBe(0);
  });

  it('does not accumulate float error', () => {
    expect(pts(0, 10)).toBe(0.1);
    expect(pts(1, 5)).toBe(1.05);
  });
});

describe('buildTeams', () => {
  const teams = buildTeams(rosters, users);

  it('covers every roster', () => {
    expect(teams.size).toBe(rosters.length);
    expect(teams.size).toBe(12);
  });

  it('prefers the custom team name over the display name', () => {
    const ben = [...teams.values()].find((t) => t.ownerId === BEN)!;
    expect(ben.teamName).toBe("Mr. Rodger's Naberhood");
    expect(ben.managerName).toBe('BenLoe');
  });

  it('uses the uploaded avatar URL when present', () => {
    const ben = [...teams.values()].find((t) => t.ownerId === BEN)!;
    expect(ben.avatar).toMatch(/^https:\/\/sleepercdn\.com\//);
  });

  it('falls back for an orphan roster', () => {
    const orphan = buildTeams(
      [{ ...rosters[0], roster_id: 99, owner_id: null }] as RawRoster[],
      users
    );
    expect(orphan.get(99)!.teamName).toBe('Orphan Team');
  });
});

describe('buildStandings', () => {
  const table = buildStandings(rosters, users);

  it('ranks all twelve teams contiguously', () => {
    expect(table).toHaveLength(12);
    expect(table.map((r) => r.rank)).toEqual([...Array(12)].map((_, i) => i + 1));
  });

  it('sorts by win percentage then points for', () => {
    for (let i = 1; i < table.length; i++) {
      const a = table[i - 1];
      const b = table[i];
      expect(
        a.winPct > b.winPct || (a.winPct === b.winPct && a.pointsFor >= b.pointsFor)
      ).toBe(true);
    }
  });

  it("matches Ben's known 2025 record and points", () => {
    const ben = table.find((r) => r.ownerId === BEN)!;
    expect(ben.wins).toBe(10);
    expect(ben.losses).toBe(4);
    expect(ben.pointsFor).toBe(1332.82);
    expect(ben.maxPoints).toBe(1562.58);
  });

  it('computes efficiency as scored over max possible', () => {
    const ben = table.find((r) => r.ownerId === BEN)!;
    expect(ben.efficiency).toBeCloseTo(1332.82 / 1562.58, 6);
    // Efficiency is a ratio of achieved to achievable; it can never exceed 1.
    for (const row of table) {
      expect(row.efficiency).toBeGreaterThan(0);
      expect(row.efficiency).toBeLessThanOrEqual(1);
    }
  });

  it('gives every team a total of 14 regular season games', () => {
    for (const row of table) {
      expect(row.wins + row.losses + row.ties).toBe(14);
    }
  });
});

describe('buildMatchups', () => {
  const teams = buildTeams(rosters, users);

  it('pairs a full week into six head-to-head games', () => {
    const week1 = buildMatchups(matchups['1'], teams, 1);
    expect(week1).toHaveLength(6);
    for (const m of week1) {
      expect(m.away).not.toBeNull();
    }
  });

  it('lists the higher scorer first', () => {
    for (const m of buildMatchups(matchups['3'], teams, 3)) {
      expect(m.home.points).toBeGreaterThanOrEqual(m.away!.points);
      expect(m.margin).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes margin and total consistently', () => {
    for (const m of buildMatchups(matchups['5'], teams, 5)) {
      expect(m.margin).toBeCloseTo(m.home.points - m.away!.points, 2);
      expect(m.total).toBeCloseTo(m.home.points + m.away!.points, 2);
    }
  });

  it('covers all twelve rosters exactly once per week', () => {
    const seen = buildMatchups(matchups['7'], teams, 7).flatMap((m) => [
      m.home.rosterId,
      m.away!.rosterId,
    ]);
    expect(new Set(seen).size).toBe(12);
  });

  it('skips entries with no matchup_id', () => {
    const withBye = [...matchups['1'], { ...matchups['1'][0], roster_id: 99, matchup_id: null }];
    expect(buildMatchups(withBye, teams, 1)).toHaveLength(6);
  });

  it('handles an odd roster left without an opponent', () => {
    const solo = [matchups['1'][0]];
    const [m] = buildMatchups(solo, teams, 1);
    expect(m.away).toBeNull();
    expect(m.margin).toBe(0);
  });
});

describe('buildResultTimeline', () => {
  const timeline = buildResultTimeline(matchups, league.settings.playoff_week_start);

  it('records 14 regular season games for every roster', () => {
    expect(timeline.size).toBe(12);
    for (const results of timeline.values()) {
      expect(results).toHaveLength(14);
    }
  });

  it('excludes playoff weeks', () => {
    for (const results of timeline.values()) {
      for (const r of results) {
        expect(r.week).toBeLessThan(league.settings.playoff_week_start);
      }
    }
  });

  it("reproduces Ben's 10-4 record from game results", () => {
    const benRoster = rosters.find((r) => r.owner_id === BEN)!;
    const results = timeline.get(benRoster.roster_id)!;
    expect(results.filter((r) => r.result === 'W')).toHaveLength(10);
    expect(results.filter((r) => r.result === 'L')).toHaveLength(4);
  });

  it('agrees with the standings for every team', () => {
    for (const roster of rosters) {
      const results = timeline.get(roster.roster_id)!;
      expect(results.filter((r) => r.result === 'W').length).toBe(roster.settings.wins);
      expect(results.filter((r) => r.result === 'L').length).toBe(roster.settings.losses);
    }
  });

  it('labels each result consistently with its scores', () => {
    for (const results of timeline.values()) {
      for (const r of results) {
        const expected =
          r.points > r.opponentPoints ? 'W' : r.points < r.opponentPoints ? 'L' : 'T';
        expect(r.result).toBe(expected);
      }
    }
  });
});

describe('currentStreak', () => {
  it('counts the trailing run', () => {
    expect(currentStreak([{ result: 'L' }, { result: 'W' }, { result: 'W' }] as any)).toBe('W2');
    expect(currentStreak([{ result: 'W' }, { result: 'L' }] as any)).toBe('L1');
  });

  it('handles an empty timeline', () => {
    expect(currentStreak([])).toBe('—');
  });
});

describe('buildAllPlay', () => {
  const allPlay = buildAllPlay(matchups, league.settings.playoff_week_start);

  it('gives every team 14 weeks against 11 opponents', () => {
    expect(allPlay.size).toBe(12);
    for (const r of allPlay.values()) {
      expect(r.wins + r.losses + r.ties).toBe(14 * 11);
    }
  });

  it('conserves wins and losses across the league', () => {
    let wins = 0;
    let losses = 0;
    for (const r of allPlay.values()) {
      wins += r.wins;
      losses += r.losses;
    }
    expect(wins).toBe(losses);
  });

  it('produces a percentage between 0 and 1', () => {
    for (const r of allPlay.values()) {
      expect(r.pct).toBeGreaterThanOrEqual(0);
      expect(r.pct).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildRosterView', () => {
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const view = buildRosterView(benRoster, league.roster_positions, players);

  it('creates one row per non-bench lineup slot plus every remaining player', () => {
    const startingSlots = league.roster_positions.filter((p: string) => p !== 'BN');
    const starters = view.filter((s) => s.kind === 'starter');
    expect(starters).toHaveLength(startingSlots.length);
    expect(starters.map((s) => s.slot)).toEqual(startingSlots);
  });

  it('accounts for every rostered player exactly once', () => {
    const ids = view.map((s) => s.player?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(new Set(benRoster.players!).size);
  });

  it('separates bench, IR and taxi', () => {
    const kinds = new Set(view.map((s) => s.kind));
    expect(kinds.has('starter')).toBe(true);
    expect(kinds.has('bench')).toBe(true);
    for (const slot of view) {
      if (slot.kind === 'taxi') expect(benRoster.taxi).toContain(slot.player!.id);
      if (slot.kind === 'ir') expect(benRoster.reserve).toContain(slot.player!.id);
    }
  });

  it('resolves real player names from the index', () => {
    const named = view.filter((s) => s.player && !s.player.name.startsWith('Player '));
    expect(named.length).toBeGreaterThan(20);
  });

  it('attaches points when supplied', () => {
    const week1 = matchups['1'].find((m: any) => m.roster_id === benRoster.roster_id)!;
    const withPts = buildRosterView(
      benRoster,
      league.roster_positions,
      players,
      week1.players_points
    );
    expect(withPts.some((s) => typeof s.points === 'number' && s.points > 0)).toBe(true);
  });

  it('synthesises a defense entry for a team-abbreviation id', () => {
    const withDef = buildRosterView(
      { ...benRoster, players: ['SF'], starters: [], reserve: [], taxi: [] } as any,
      ['QB'],
      {}
    );
    const def = withDef.find((s) => s.player?.id === 'SF')!;
    expect(def.player!.name).toBe('SF Defense');
    expect(def.player!.pos).toBe('DEF');
  });

  it('leaves an empty starting slot null rather than inventing a player', () => {
    const empty = buildRosterView(
      { ...benRoster, starters: ['0', '0'], players: [], reserve: [], taxi: [] } as any,
      ['QB', 'RB'],
      players
    );
    expect(empty.every((s) => s.player === null)).toBe(true);
  });
});

describe('a season that has not started yet', () => {
  // Sleeper publishes the whole schedule before kickoff with every score at 0.
  // Counting those as ties made a fresh league read 0-0-11 with a losing streak.
  const unplayed = {
    1: rosters.map((r, i) => ({
      roster_id: r.roster_id,
      matchup_id: Math.floor(i / 2) + 1,
      points: 0,
      custom_points: null,
      starters: [],
      starters_points: [],
      players: [],
      players_points: {},
    })),
  };

  it('records no games', () => {
    const timeline = buildResultTimeline(unplayed as any, 15);
    expect(timeline.size).toBe(0);
  });

  it('produces no all-play record', () => {
    expect(buildAllPlay(unplayed as any, 15).size).toBe(0);
  });

  it('reports no streak', () => {
    expect(currentStreak([])).toBe('—');
  });

  it('still counts a week where only one team has scored', () => {
    const partial = {
      1: unplayed[1].map((m, i) => (i === 0 ? { ...m, points: 88.4 } : m)),
    };
    expect(buildAllPlay(partial as any, 15).size).toBeGreaterThan(0);
  });

  it('does not discard played weeks in a finished season', () => {
    // Guard against the fix over-reaching: the real 2025 season still counts.
    expect(buildResultTimeline(matchups, league.settings.playoff_week_start).size).toBe(12);
  });
});

describe('auction league fixture', () => {
  // A second league with different settings guards against dynasty-specific assumptions.
  const aRosters: RawRoster[] = load('auction-2025.rosters');
  const aUsers: RawUser[] = load('auction-2025.users');
  const aLeague = load('auction-2025.league');

  it('builds standings for a non-dynasty league', () => {
    const table = buildStandings(aRosters, aUsers);
    expect(table).toHaveLength(aLeague.total_rosters);
    expect(table[0].rank).toBe(1);
  });

  it('lays out a roster with DEF slots', () => {
    expect(aLeague.roster_positions).toContain('DEF');
    const view = buildRosterView(aRosters[0], aLeague.roster_positions, players);
    expect(view.find((s) => s.slot === 'DEF')).toBeDefined();
  });
});
