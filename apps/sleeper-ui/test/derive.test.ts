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
  buildChatFeed,
  buildActivityRows,
  buildDepthChart,
  buildPlayerHistory,
  describePeriod,
  indexProjections,
  projectLineup,
  compareLineup,
  positionalStrength,
  ageProfile,
  projectSeason,
  winProbability,
  scoringKey,
  dayLabel,
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

describe('buildChatFeed', () => {
  const teams = buildTeams(rosters, users);
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const other = rosters.find((r) => r.owner_id && r.owner_id !== BEN)!;

  const base = (over: Partial<any> = {}) => ({
    message_id: '1',
    text: 'hello',
    created: 1_766_000_000_000,
    author_id: BEN,
    author_display_name: 'BenLoe',
    author_avatar: null,
    author_is_bot: false,
    attachment: null,
    reactions: null,
    pinned: false,
    edited: null,
    ...over,
  });

  it('orders oldest first regardless of input order', () => {
    const feed = buildChatFeed([
      base({ message_id: '3', created: 3000 }),
      base({ message_id: '1', created: 1000 }),
      base({ message_id: '2', created: 2000 }),
    ]);
    expect(feed.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('names authors by their team in this league', () => {
    const feed = buildChatFeed([base({ author_id: BEN })], {
      teams,
      rosters,
      myUserId: BEN,
    });
    expect(feed[0].authorName).toBe("Mr. Rodger's Naberhood");
    expect(feed[0].isMine).toBe(true);
  });

  it('falls back to the display name for a non-league author', () => {
    const feed = buildChatFeed(
      [base({ author_id: 'stranger', author_display_name: 'SomeBot' })],
      { teams, rosters, myUserId: BEN }
    );
    expect(feed[0].authorName).toBe('SomeBot');
    expect(feed[0].isMine).toBe(false);
  });

  it('groups consecutive messages from one author inside the window', () => {
    const t = 1_766_000_000_000;
    const feed = buildChatFeed([
      base({ message_id: '1', created: t }),
      base({ message_id: '2', created: t + 60_000 }),
      base({ message_id: '3', created: t + 120_000 }),
    ]);
    expect(feed.map((m) => m.continues)).toEqual([false, true, true]);
  });

  it('breaks the group when the author changes', () => {
    const t = 1_766_000_000_000;
    const feed = buildChatFeed([
      base({ message_id: '1', created: t, author_id: BEN }),
      base({ message_id: '2', created: t + 1000, author_id: other.owner_id }),
    ]);
    expect(feed[1].continues).toBe(false);
  });

  it('breaks the group after a long gap', () => {
    const t = 1_766_000_000_000;
    const feed = buildChatFeed([
      base({ message_id: '1', created: t }),
      base({ message_id: '2', created: t + 30 * 60_000 }),
    ]);
    expect(feed[1].continues).toBe(false);
  });

  it('marks the first message of each day and no others', () => {
    const day1 = new Date(2026, 0, 5, 10, 0).getTime();
    const day2 = new Date(2026, 0, 6, 10, 0).getTime();
    const feed = buildChatFeed(
      [
        base({ message_id: '1', created: day1 }),
        base({ message_id: '2', created: day1 + 60_000 }),
        base({ message_id: '3', created: day2 }),
      ],
      { now: new Date(2026, 0, 6, 12, 0).getTime() }
    );
    expect(feed[0].dayLabel).toBeTruthy();
    expect(feed[1].dayLabel).toBeNull();
    expect(feed[2].dayLabel).toBe('Today');
  });

  it('never groups across a day boundary', () => {
    const day1 = new Date(2026, 0, 5, 23, 59).getTime();
    const day2 = new Date(2026, 0, 6, 0, 1).getTime();
    const feed = buildChatFeed([
      base({ message_id: '1', created: day1 }),
      base({ message_id: '2', created: day2 }),
    ]);
    expect(feed[1].continues).toBe(false);
  });

  it('counts reactions given as user id lists', () => {
    const feed = buildChatFeed([base({ reactions: { '🔥': ['a', 'b', 'c'], '💀': ['d'] } })]);
    expect(feed[0].reactions).toEqual([
      { emoji: '🔥', count: 3 },
      { emoji: '💀', count: 1 },
    ]);
  });

  it('counts reactions given as plain numbers', () => {
    const feed = buildChatFeed([base({ reactions: { '👍': 2 } })]);
    expect(feed[0].reactions).toEqual([{ emoji: '👍', count: 2 }]);
  });

  it('ignores empty or malformed reaction maps', () => {
    expect(buildChatFeed([base({ reactions: null })])[0].reactions).toEqual([]);
    expect(buildChatFeed([base({ reactions: { '🔥': [] } })])[0].reactions).toEqual([]);
  });

  it('handles a message with no text but an attachment', () => {
    const feed = buildChatFeed([base({ text: null, attachment: { kind: 'image' } })]);
    expect(feed[0].text).toBe('');
    expect(feed[0].hasAttachment).toBe(true);
  });

  it('accepts second-precision timestamps', () => {
    const feed = buildChatFeed([base({ created: 1_766_000_000 })]);
    expect(feed[0].created).toBe(1_766_000_000_000);
  });

  it('drops entries with no message id', () => {
    expect(buildChatFeed([base(), { ...base(), message_id: '' } as any])).toHaveLength(1);
  });

  it('parses the synthetic chat fixture the harness renders', () => {
    const feed = buildChatFeed(load('chat.sample'), { teams, rosters, myUserId: BEN });
    expect(feed.length).toBeGreaterThan(10);
    expect(feed.every((m) => m.authorName && m.authorName !== 'Unknown')).toBe(true);
    // Oldest first, strictly increasing.
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i].created).toBeGreaterThanOrEqual(feed[i - 1].created);
    }
    expect(feed.some((m) => m.reactions.length > 0)).toBe(true);
    expect(feed.filter((m) => m.dayLabel).length).toBeGreaterThan(1);
  });

  it('resolves a co-owner to their team', () => {
    const coOwned = rosters.map((r) =>
      r.roster_id === benRoster.roster_id ? { ...r, co_owners: ['co-owner-id'] } : r
    );
    const feed = buildChatFeed([base({ author_id: 'co-owner-id' })], {
      teams,
      rosters: coOwned,
      myUserId: BEN,
    });
    expect(feed[0].authorName).toBe("Mr. Rodger's Naberhood");
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 5, 15, 12, 0).getTime();

  it('names today and yesterday', () => {
    expect(dayLabel(new Date(2026, 5, 15, 9, 0).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 5, 14, 9, 0).getTime(), now)).toBe('Yesterday');
  });

  it('uses the weekday inside the last week', () => {
    expect(dayLabel(new Date(2026, 5, 11, 9, 0).getTime(), now)).toMatch(/day$/);
  });

  it('falls back to a date further back', () => {
    expect(dayLabel(new Date(2026, 2, 3, 9, 0).getTime(), now)).toMatch(/Mar/);
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

describe('buildActivityRows', () => {
  const teams = buildTeams(rosters, users);
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const otherRoster = rosters.find((r) => r.roster_id !== benRoster.roster_id)!;

  const tx = (over: Partial<any> = {}): any => ({
    transaction_id: 't1',
    type: 'free_agent',
    status: 'complete',
    leg: 4,
    created: 1_760_000_000_000,
    roster_ids: [benRoster.roster_id],
    adds: null,
    drops: null,
    draft_picks: null,
    settings: null,
    ...over,
  });

  it('labels an add-only move "Added"', () => {
    const [row] = buildActivityRows([tx({ adds: { '4984': benRoster.roster_id } })], teams, players);
    expect(row.action).toBe('Added');
    expect(row.added.map((a) => a.name)).toEqual([players['4984'].name]);
    expect(row.dropped).toEqual([]);
  });

  it('labels a drop-only move "Dropped" rather than "Add"', () => {
    // This is the bug the redesign fixed: Sleeper types both as `free_agent`,
    // so a drop was rendering under an "Add" chip.
    const [row] = buildActivityRows([tx({ drops: { '4984': benRoster.roster_id } })], teams, players);
    expect(row.action).toBe('Dropped');
    expect(row.added).toEqual([]);
    expect(row.dropped).toHaveLength(1);
  });

  it('labels a swap "Added & dropped"', () => {
    const [row] = buildActivityRows(
      [tx({ adds: { '4984': benRoster.roster_id }, drops: { '6786': benRoster.roster_id } })],
      teams,
      players
    );
    expect(row.action).toBe('Added & dropped');
    expect(row.added).toHaveLength(1);
    expect(row.dropped).toHaveLength(1);
  });

  it('reports the method separately from the action', () => {
    const [waiver] = buildActivityRows(
      [tx({ type: 'waiver', adds: { '4984': benRoster.roster_id }, settings: { waiver_bid: 17 } })],
      teams,
      players
    );
    expect(waiver.action).toBe('Added');
    expect(waiver.method).toBe('Waivers');
    expect(waiver.faab).toBe(17);
  });

  it('only attributes FAAB to a waiver claim', () => {
    const [fa] = buildActivityRows(
      [tx({ adds: { '4984': benRoster.roster_id }, settings: { waiver_bid: 17 } })],
      teams,
      players
    );
    expect(fa.method).toBe('Free agency');
    expect(fa.faab).toBeNull();
  });

  it('treats a zero bid as no cost', () => {
    const [row] = buildActivityRows(
      [tx({ type: 'waiver', adds: { '4984': benRoster.roster_id }, settings: { waiver_bid: 0 } })],
      teams,
      players
    );
    expect(row.faab).toBeNull();
  });

  it('splits a trade into one row per side', () => {
    const rows = buildActivityRows(
      [
        tx({
          type: 'trade',
          roster_ids: [benRoster.roster_id, otherRoster.roster_id],
          adds: { '4984': benRoster.roster_id, '6786': otherRoster.roster_id },
          drops: { '4984': otherRoster.roster_id, '6786': benRoster.roster_id },
        }),
      ],
      teams,
      players
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.action).toBe('Trade');
      expect(row.added).toHaveLength(1);
      expect(row.dropped).toHaveLength(1);
      expect(row.counterparties).toHaveLength(1);
      expect(row.counterparties[0].rosterId).not.toBe(row.rosterId);
    }
    // Each side gained what the other gave up.
    expect(rows[0].added[0].name).toBe(rows[1].dropped[0].name);
  });

  it('puts draft picks on the right side of a trade', () => {
    const rows = buildActivityRows(
      [
        tx({
          type: 'trade',
          roster_ids: [benRoster.roster_id, otherRoster.roster_id],
          draft_picks: [
            { season: '2027', round: 1, owner_id: benRoster.roster_id, previous_owner_id: otherRoster.roster_id },
          ],
        }),
      ],
      teams,
      players
    );
    const gained = rows.find((r) => r.rosterId === benRoster.roster_id)!;
    const gave = rows.find((r) => r.rosterId === otherRoster.roster_id)!;
    expect(gained.added[0]).toMatchObject({ kind: 'pick', name: '2027 round 1 pick' });
    expect(gave.dropped[0]).toMatchObject({ kind: 'pick' });
  });

  it('skips incomplete transactions', () => {
    expect(
      buildActivityRows([tx({ status: 'failed', adds: { '4984': benRoster.roster_id } })], teams, players)
    ).toEqual([]);
  });

  it('skips a roster that neither gained nor lost anything', () => {
    const rows = buildActivityRows(
      [tx({ roster_ids: [benRoster.roster_id, otherRoster.roster_id], adds: { '4984': benRoster.roster_id } })],
      teams,
      players
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rosterId).toBe(benRoster.roster_id);
  });

  it('resolves team names and a team defense from the player index', () => {
    const [row] = buildActivityRows([tx({ adds: { SF: benRoster.roster_id } })], teams, players);
    expect(row.teamName).toBe("Mr. Rodger's Naberhood");
    expect(row.added[0].name).toBe('San Francisco 49ers');
    expect(row.added[0].pos).toBe('DEF');
  });

  it('falls back to a readable label for a defense missing from the index', () => {
    const [row] = buildActivityRows([tx({ adds: { SF: benRoster.roster_id } })], teams, {});
    expect(row.added[0].name).toBe('SF Defense');
    expect(row.added[0].pos).toBe('DEF');
  });

  it('does not invent a name for an unknown player id', () => {
    const [row] = buildActivityRows([tx({ adds: { '99999999': benRoster.roster_id } })], teams, {});
    expect(row.added[0].name).toBe('Player 99999999');
    expect(row.added[0].pos).toBeNull();
  });

  it('sorts newest first', () => {
    const rows = buildActivityRows(
      [
        tx({ transaction_id: 'old', created: 1000, adds: { '4984': benRoster.roster_id } }),
        tx({ transaction_id: 'new', created: 9000, adds: { '6786': benRoster.roster_id } }),
      ],
      teams,
      players
    );
    expect(rows.map((r) => r.transactionId)).toEqual(['new', 'old']);
  });

  it('gives every row a unique key', () => {
    const rows = buildActivityRows(
      [
        tx({
          type: 'trade',
          roster_ids: [benRoster.roster_id, otherRoster.roster_id],
          adds: { '4984': benRoster.roster_id, '6786': otherRoster.roster_id },
        }),
      ],
      teams,
      players
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('handles the real 2025 transaction feed without producing an empty row', () => {
    const raw = Object.values(load('dynasty-2025.transactions') as Record<string, any[]>).flat();
    const rows = buildActivityRows(raw, teams, players);
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      expect(row.added.length + row.dropped.length).toBeGreaterThan(0);
      expect(row.teamName).not.toMatch(/^Roster /);
      // The action must agree with what actually moved.
      if (row.action === 'Added') expect(row.dropped).toHaveLength(0);
      if (row.action === 'Dropped') expect(row.added).toHaveLength(0);
    }
    // Real leagues do all three, so all three labels should appear.
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has('Added')).toBe(true);
    expect(actions.has('Dropped')).toBe(true);
  });
});

describe('describePeriod', () => {
  const preseason = { week: 0, display_week: 0, season: '2026', season_type: 'pre', league_season: '2026' };
  const regular = (w: number) => ({ week: w, display_week: w, season: '2026', season_type: 'regular', league_season: '2026' });
  const current = { season: '2026', status: 'in_season', playoffWeekStart: 15 };

  it('calls the offseason preseason rather than week 1', () => {
    const p = describePeriod(preseason, current);
    expect(p.label).toBe('Preseason');
    expect(p.isGameWeek).toBe(false);
    expect(p.week).toBeNull();
  });

  it('labels the true offseason', () => {
    expect(describePeriod({ ...preseason, season_type: 'off' }, current).label).toBe('Offseason');
  });

  it('counts regular season weeks', () => {
    expect(describePeriod(regular(1), current).label).toBe('Week 1');
    expect(describePeriod(regular(9), current).label).toBe('Week 9');
    expect(describePeriod(regular(9), current).week).toBe(9);
  });

  it('names the playoffs once the league reaches them', () => {
    expect(describePeriod(regular(15), current).label).toBe('Playoffs · Week 15');
    expect(describePeriod(regular(16), current).label).toBe('Playoffs · Week 16');
    // The cut-off is the league's own setting, not a fixed week.
    expect(describePeriod(regular(15), { ...current, playoffWeekStart: 16 }).label).toBe('Week 15');
  });

  it('treats a finished league as final regardless of the NFL calendar', () => {
    expect(describePeriod(regular(5), { season: '2026', status: 'complete', playoffWeekStart: 15 }).label).toBe('Final');
  });

  it('marks a past season as final and still points at its last week', () => {
    const p = describePeriod(preseason, { season: '2025', status: 'complete', playoffWeekStart: 15 });
    expect(p.label).toBe('2025 final');
    expect(p.isGameWeek).toBe(false);
    expect(p.week).toBe(17);
  });

  it('does not count week 0 as a game week even when the type says regular', () => {
    expect(describePeriod(regular(0), current).label).toBe('Preseason');
  });

  it('falls back sensibly on an unknown season type', () => {
    expect(describePeriod({ ...regular(4), season_type: 'weird' }, current).label).toBe('Week 4');
    expect(describePeriod({ ...regular(0), season_type: 'weird' }, current).label).toBe('Offseason');
  });

  it('reads the real preseason state fixture as preseason', () => {
    expect(describePeriod(load('state'), { season: '2026', status: 'in_season' }).label).toBe('Preseason');
  });
});

describe('waiver bid history', () => {
  const teams = buildTeams(rosters, users);
  const raw = Object.values(load('dynasty-2025.transactions') as Record<string, any[]>).flat();
  const rows = buildActivityRows(raw, teams, players);

  const allContests = rows.flatMap((r) => r.contests);
  const allBids = allContests.flatMap((c) => c.bids);

  it('attaches competing bids to a contested claim', () => {
    expect(rows.filter((r) => r.contests.length).length).toBeGreaterThan(10);
  });

  it('only records a contest when somebody else actually bid', () => {
    for (const c of allContests) expect(c.bids.length).toBeGreaterThan(1);
  });

  it('never attaches bids to a trade or a free agency move', () => {
    for (const r of rows) {
      if (r.method !== 'Waivers') expect(r.contests).toEqual([]);
    }
  });

  it('names the player each contest was for', () => {
    for (const c of allContests) {
      expect(c.playerName).toBeTruthy();
      expect(c.playerName).not.toMatch(/^Player \d/);
    }
  });

  it('orders bids highest first', () => {
    for (const c of allContests) {
      for (let i = 1; i < c.bids.length; i++) {
        expect(c.bids[i - 1].amount).toBeGreaterThanOrEqual(c.bids[i].amount);
      }
    }
  });

  it('marks exactly one winner per contest', () => {
    for (const c of allContests) {
      expect(c.bids.filter((b) => b.won)).toHaveLength(1);
    }
  });

  it('the winning bid belongs to the team on the row', () => {
    for (const r of rows) {
      for (const c of r.contests) {
        expect(c.bids.find((b) => b.won)!.rosterId).toBe(r.rosterId);
      }
    }
  });

  it('drops a target that was won more than once in the same week', () => {
    // `leg` is 1 for the entire preseason, so a player can genuinely be claimed
    // twice weeks apart. Those cannot be split into runs, so they are omitted
    // rather than shown with two winners.
    for (const c of allContests) expect(c.bids.filter((b) => b.won)).toHaveLength(1);
  });

  it('keeps two players claimed together as separate contests', () => {
    // A single waiver transaction can add more than one player; flattening them
    // into one list produced two winners for one "contest".
    const multi = rows.find((r) => r.contests.length > 1);
    if (multi) {
      const ids = multi.contests.map((c) => c.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const c of allContests) expect(c.bids.filter((b) => b.won)).toHaveLength(1);
  });

  it('translates Sleeper failure notes into short outcomes', () => {
    const outcomes = new Set(allBids.map((b) => b.outcome));
    expect(outcomes.has('Won')).toBe(true);
    expect(outcomes.has('Outbid')).toBe(true);
    for (const b of allBids) expect(b.won).toBe(b.outcome === 'Won');
  });

  it('surfaces a bid that beat the winner but failed for another reason', () => {
    // Kyle Monangai in week 1: two higher bids failed on roster limits.
    const beaten = allContests.find((c) =>
      c.bids.some((b) => !b.won && b.amount > c.bids.find((x) => x.won)!.amount)
    );
    expect(beaten).toBeDefined();
    expect(beaten!.bids.some((b) => b.outcome === 'Roster full')).toBe(true);
  });

  it('resolves every bidder to a team name', () => {
    for (const b of allBids) expect(b.teamName).not.toMatch(/^Roster /);
  });
});

describe('buildDepthChart', () => {
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const groups = buildDepthChart(benRoster, league.roster_positions, players);
  const byPos = Object.fromEntries(groups.map((g) => [g.pos, g]));

  it('leads with the positions the league actually starts', () => {
    expect(groups.map((g) => g.pos).slice(0, 4)).toEqual(['QB', 'RB', 'WR', 'TE']);
  });

  it('accounts for every rostered player exactly once', () => {
    const ids = groups.flatMap((g) => g.entries.map((e) => e.player.id));
    expect(new Set(ids).size).toBe(new Set(benRoster.players!).size);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('keeps a flex starter with their own position, flagged as flex', () => {
    const rb = byPos.RB;
    const flex = rb.entries.filter((e) => e.isFlex);
    expect(flex.length).toBeGreaterThan(0);
    for (const e of flex) {
      expect(e.player.pos).toBe('RB');
      expect(e.kind).toBe('starter');
      expect(e.slot).toMatch(/FLEX/);
    }
    expect(rb.counts.flex).toBe(flex.length);
  });

  it('puts starters first, then bench, then taxi, then injured reserve', () => {
    const order = { starter: 0, bench: 1, taxi: 2, ir: 3 } as const;
    for (const g of groups) {
      for (let i = 1; i < g.entries.length; i++) {
        expect(order[g.entries[i].kind]).toBeGreaterThanOrEqual(order[g.entries[i - 1].kind]);
      }
    }
  });

  it('ranks a dedicated starter above a flex starter', () => {
    const starters = byPos.RB.entries.filter((e) => e.kind === 'starter');
    const firstFlex = starters.findIndex((e) => e.isFlex);
    const lastDedicated = starters.map((e) => e.isFlex).lastIndexOf(false);
    expect(firstFlex).toBeGreaterThan(lastDedicated);
  });

  it('counts agree with the entries in every group', () => {
    for (const g of groups) {
      const c = g.counts;
      expect(c.starting).toBe(g.entries.filter((e) => e.kind === 'starter').length);
      expect(c.bench).toBe(g.entries.filter((e) => e.kind === 'bench').length);
      expect(c.taxi).toBe(g.entries.filter((e) => e.kind === 'taxi').length);
      expect(c.ir).toBe(g.entries.filter((e) => e.kind === 'ir').length);
    }
  });

  it('keeps taxi and injured reserve in their position group', () => {
    expect(byPos.RB.counts.taxi).toBeGreaterThan(0);
    expect(byPos.RB.counts.ir).toBeGreaterThan(0);
    for (const e of byPos.RB.entries) expect(e.player.pos).toBe('RB');
  });

  it('reports an unfilled starting slot as a hole', () => {
    const empty = buildDepthChart(
      { ...benRoster, starters: ['0', '0'], players: [], reserve: [], taxi: [] } as any,
      ['QB', 'FLEX'],
      players
    );
    expect(empty.find((g) => g.pos === 'QB')!.emptySlots).toEqual(['QB']);
    expect(empty.find((g) => g.pos === 'FLEX')!.emptySlots).toEqual(['FLEX']);
  });

  it('handles a league with a DEF slot', () => {
    const aRosters = load('auction-2025.rosters');
    const aLeague = load('auction-2025.league');
    const g = buildDepthChart(aRosters[0], aLeague.roster_positions, players);
    expect(g.some((x) => x.pos === 'DEF')).toBe(true);
  });
});

describe('scoringKey', () => {
  it('maps a league\'s reception value to the matching projection field', () => {
    expect(scoringKey({ rec: 1 })).toBe('pts_ppr');
    expect(scoringKey({ rec: 0.5 })).toBe('pts_half_ppr');
    expect(scoringKey({ rec: 0 })).toBe('pts_std');
  });

  it('treats a missing scoring block as standard', () => {
    expect(scoringKey(undefined)).toBe('pts_std');
    expect(scoringKey({})).toBe('pts_std');
  });

  it("matches Ben's non-PPR dynasty league", () => {
    expect(scoringKey(league.scoring_settings)).toBe('pts_std');
  });
});

describe('indexProjections', () => {
  const raw = [
    { player_id: '1', opponent: 'BUF', stats: { pts_std: 20.5, pts_ppr: 24.5, gp: 1, pass_yd: 280.4, pass_td: 2.1, rush_yd: 30.2, rec: 0 } },
    { player_id: '2', opponent: null, stats: { adp_dd_ppr: 1000 } },
    { player_id: '3', stats: { pts_std: 0, gp: 18 } },
    { stats: { pts_std: 9 } },
  ];

  it('keeps only entries with a points projection', () => {
    const idx = indexProjections(raw, 'pts_std');
    expect(Object.keys(idx).sort()).toEqual(['1', '3']);
  });

  it('reads the field matching the league scoring', () => {
    expect(indexProjections(raw, 'pts_std')['1'].points).toBe(20.5);
    expect(indexProjections(raw, 'pts_ppr')['1'].points).toBe(24.5);
  });

  it('keeps a zero projection, which is information', () => {
    expect(indexProjections(raw, 'pts_std')['3'].points).toBe(0);
  });

  it('carries games and opponent', () => {
    const p = indexProjections(raw, 'pts_std')['1'];
    expect(p.games).toBe(1);
    expect(p.opponent).toBe('BUF');
  });

  it('lists only the stat lines this player actually produces', () => {
    const labels = indexProjections(raw, 'pts_std')['1'].lines.map((l) => l.label);
    expect(labels).toContain('Pass yds');
    expect(labels).toContain('Rush yds');
    // Zero receptions should not appear for a quarterback.
    expect(labels).not.toContain('Rec');
  });

  it('survives an empty or malformed payload', () => {
    expect(indexProjections([], 'pts_std')).toEqual({});
    expect(indexProjections(undefined as any, 'pts_std')).toEqual({});
  });
});

describe('buildPlayerHistory', () => {
  const teams = buildTeams(rosters, users);
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const other = rosters.find((r) => r.roster_id !== benRoster.roster_id)!;
  const raw = Object.values(load('dynasty-2025.transactions') as Record<string, any[]>).flat();

  const picks = [
    { player_id: '12527', round: 1, pick_no: 7, draft_slot: 7, roster_id: benRoster.roster_id, picked_by: BEN, is_keeper: null },
  ];

  it('records a draft pick with its position', () => {
    const h = buildPlayerHistory('12527', [], picks as any, teams, '2025');
    expect(h).toHaveLength(1);
    expect(h[0].kind).toBe('drafted');
    expect(h[0].method).toBe('Draft');
    expect(h[0].detail).toContain('Round 1, pick 7');
    expect(h[0].detail).toContain('2025');
    expect(h[0].toTeam).toBe("Mr. Rodger's Naberhood");
  });

  it('sorts the draft before any in-season move', () => {
    const player = raw.find((t: any) => t.status === 'complete' && Object.keys(t.adds ?? {}).length)!;
    const pid = Object.keys(player.adds)[0];
    const h = buildPlayerHistory(pid, raw, [{ ...picks[0], player_id: pid }] as any, teams, '2025');
    expect(h[0].kind).toBe('drafted');
    for (let i = 1; i < h.length; i++) {
      expect(h[i].created).toBeGreaterThanOrEqual(h[i - 1].created);
    }
  });

  it('records a waiver add with the amount paid', () => {
    const waiver = raw.find(
      (t: any) => t.type === 'waiver' && t.status === 'complete' && (t.settings?.waiver_bid ?? 0) > 0
    )!;
    const pid = Object.keys(waiver.adds)[0];
    const h = buildPlayerHistory(pid, [waiver], [], teams);
    const added = h.find((e) => e.kind === 'added')!;
    expect(added.method).toBe('Waivers');
    expect(added.faab).toBe(waiver.settings.waiver_bid);
    expect(added.toTeam).toBeTruthy();
  });

  it('does not attribute FAAB to a free agency pickup', () => {
    const fa = { transaction_id: 'x', type: 'free_agent', status: 'complete', leg: 3, created: 5,
      roster_ids: [benRoster.roster_id], adds: { '99': benRoster.roster_id }, drops: null,
      draft_picks: null, settings: { waiver_bid: 20 } };
    const [e] = buildPlayerHistory('99', [fa] as any, [], teams);
    expect(e.method).toBe('Free agency');
    expect(e.faab).toBeNull();
  });

  it('reads a trade as one move between two teams', () => {
    const trade = { transaction_id: 't', type: 'trade', status: 'complete', leg: 6, created: 9,
      roster_ids: [benRoster.roster_id, other.roster_id],
      adds: { '55': benRoster.roster_id }, drops: { '55': other.roster_id },
      draft_picks: null, settings: null };
    const [e] = buildPlayerHistory('55', [trade] as any, [], teams);
    expect(e.kind).toBe('traded');
    expect(e.fromRosterId).toBe(other.roster_id);
    expect(e.toRosterId).toBe(benRoster.roster_id);
  });

  it('records a drop with the team that lost them', () => {
    const drop = { transaction_id: 'd', type: 'free_agent', status: 'complete', leg: 4, created: 7,
      roster_ids: [benRoster.roster_id], adds: null, drops: { '77': benRoster.roster_id },
      draft_picks: null, settings: null };
    const [e] = buildPlayerHistory('77', [drop] as any, [], teams);
    expect(e.kind).toBe('dropped');
    expect(e.fromTeam).toBe("Mr. Rodger's Naberhood");
    expect(e.toTeam).toBeNull();
  });

  it('ignores transactions that do not involve this player', () => {
    expect(buildPlayerHistory('does-not-exist', raw, picks as any, teams)).toEqual([]);
  });

  it('ignores failed transactions', () => {
    const failed = raw.filter((t: any) => t.status !== 'complete' && Object.keys(t.adds ?? {}).length);
    const pid = Object.keys(failed[0].adds)[0];
    const h = buildPlayerHistory(pid, failed, [], teams);
    expect(h).toEqual([]);
  });

  it('builds a coherent history from the real season for a well-travelled player', () => {
    const counts = new Map<string, number>();
    for (const t of raw as any[]) {
      if (t.status !== 'complete') continue;
      for (const pid of [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]) {
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
    }
    const [busiest] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const h = buildPlayerHistory(busiest, raw, [], teams);
    expect(h.length).toBeGreaterThan(2);
    for (const e of h) {
      expect(['drafted', 'added', 'dropped', 'traded']).toContain(e.kind);
      const named = e.toTeam ?? e.fromTeam;
      expect(named).toBeTruthy();
      expect(named).not.toMatch(/^Roster /);
    }
  });
});

describe('buildPlayerHistory FAAB attribution', () => {
  const teams = buildTeams(rosters, users);
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;

  // One waiver claim adds one player and drops another to make room. The bid
  // bought the player who arrived; the one cut did not cost anything.
  const claim = {
    transaction_id: 'w1',
    type: 'waiver',
    status: 'complete',
    leg: 2,
    created: 100,
    roster_ids: [benRoster.roster_id],
    adds: { arrived: benRoster.roster_id },
    drops: { cut: benRoster.roster_id },
    draft_picks: null,
    settings: { waiver_bid: 17 },
  };

  it('charges the bid to the player who was added', () => {
    const [e] = buildPlayerHistory('arrived', [claim] as any, [], teams);
    expect(e.kind).toBe('added');
    expect(e.faab).toBe(17);
  });

  it('does not charge the bid to the player who was dropped', () => {
    const [e] = buildPlayerHistory('cut', [claim] as any, [], teams);
    expect(e.kind).toBe('dropped');
    expect(e.faab).toBeNull();
  });

  it('holds across the real season: no drop ever carries a fee', () => {
    const raw = Object.values(load('dynasty-2025.transactions') as Record<string, any[]>).flat();
    const ids = new Set<string>();
    for (const t of raw as any[]) {
      for (const pid of [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]) ids.add(pid);
    }
    for (const pid of [...ids].slice(0, 120)) {
      for (const e of buildPlayerHistory(pid, raw, [], teams)) {
        if (e.kind === 'dropped') expect(e.faab).toBeNull();
      }
    }
  });
});

describe('projectLineup', () => {
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const slots = league.roster_positions;

  // Season-long projections span many games; per-week divides them back down.
  const proj = (points: number, games = 17) => ({ points, games });
  const build = (over: Record<string, { points: number; games?: number }> = {}) => {
    const out: Record<string, { points: number; games?: number }> = {};
    for (const id of benRoster.players ?? []) out[id] = proj(0);
    return { ...out, ...over };
  };

  it('fills every startable slot when the roster is deep enough', () => {
    const { lineup, unfilled } = projectLineup(benRoster, slots, players, build());
    expect(unfilled).toBe(0);
    expect(lineup).toHaveLength(slots.filter((s: string) => s !== 'BN').length);
  });

  it('never starts a taxi or injured-reserve player', () => {
    const banned = new Set([...(benRoster.taxi ?? []), ...(benRoster.reserve ?? [])]);
    expect(banned.size).toBeGreaterThan(0);
    // Make a taxi player the highest projection in the league.
    const taxiId = [...banned][0];
    const { lineup } = projectLineup(benRoster, slots, players, build({ [taxiId]: proj(9999) }));
    expect(lineup.some((s) => s.player.id === taxiId)).toBe(false);
  });

  it('puts each player in a slot their position can fill', () => {
    const { lineup } = projectLineup(benRoster, slots, players, build());
    for (const s of lineup) {
      if (s.slot === 'FLEX') expect(['RB', 'WR', 'TE']).toContain(s.player.pos);
      else if (s.slot !== 'SUPER_FLEX') expect(s.player.pos).toBe(s.slot);
    }
  });

  it('does not let a flex steal the only player at a dedicated position', () => {
    // One tight end on the roster; FLEX must not take them from the TE slot.
    const tes = (benRoster.players ?? []).filter((id) => players[id]?.pos === 'TE');
    expect(tes.length).toBeGreaterThan(0);
    const { lineup } = projectLineup(benRoster, slots, players, build({ [tes[0]]: proj(9999) }));
    const te = lineup.find((s) => s.player.id === tes[0]);
    expect(te?.slot).toBe('TE');
  });

  it('starts the highest projection available at a position', () => {
    const rbs = (benRoster.players ?? []).filter(
      (id) => players[id]?.pos === 'RB' && !benRoster.taxi?.includes(id) && !benRoster.reserve?.includes(id)
    );
    const { lineup } = projectLineup(benRoster, slots, players, build({ [rbs[0]]: proj(1700) }));
    expect(lineup.some((s) => s.player.id === rbs[0])).toBe(true);
  });

  it('converts a season projection into a per-week figure', () => {
    const rbs = (benRoster.players ?? []).filter(
      (id) =>
        players[id]?.pos === 'RB' &&
        !benRoster.taxi?.includes(id) &&
        !benRoster.reserve?.includes(id)
    );
    const { perWeek, total } = projectLineup(
      benRoster,
      slots,
      players,
      build({ [rbs[0]]: proj(170, 17) })
    );
    expect(total).toBeCloseTo(170, 1);
    expect(perWeek).toBeCloseTo(10, 1);
  });

  it('counts unfilled slots when the roster is too thin', () => {
    const thin = { ...benRoster, players: [], taxi: [], reserve: [] } as any;
    const { lineup, unfilled } = projectLineup(thin, slots, players, {});
    expect(lineup).toHaveLength(0);
    expect(unfilled).toBe(slots.filter((s: string) => s !== 'BN').length);
  });
});

describe('winProbability', () => {
  it('is even when two lineups project the same', () => {
    expect(winProbability(110, 110)).toBeCloseTo(0.5, 6);
  });

  it('favours the higher projection without ever being certain', () => {
    const p = winProbability(130, 100);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });

  it('is symmetric', () => {
    expect(winProbability(120, 95) + winProbability(95, 120)).toBeCloseTo(1, 6);
  });

  it('treats a small edge as close to a coin flip', () => {
    // Three points on a ~110 lineup is noise, not an advantage.
    expect(winProbability(113, 110)).toBeLessThan(0.56);
  });

  it('grows with the size of the edge', () => {
    expect(winProbability(140, 100)).toBeGreaterThan(winProbability(120, 100));
  });
});

describe('projectSeason', () => {
  const schedule = load('dynasty-2025.matchups');
  const projections: Record<string, { points: number; games: number }> = {};
  for (const [id, p] of Object.entries(players)) {
    // Deterministic pseudo-projection so the test does not need live data.
    projections[id] = { points: (Number(id.replace(/\D/g, '')) % 200) + 20, games: 17 };
  }

  const { teams, matchups } = projectSeason(
    rosters,
    users,
    league.roster_positions,
    players,
    projections,
    schedule,
    league.settings.playoff_week_start
  );

  it('projects every team', () => {
    expect(teams).toHaveLength(rosters.length);
    expect(teams.map((t) => t.rank)).toEqual([...Array(teams.length)].map((_, i) => i + 1));
  });

  it('only projects regular season weeks', () => {
    for (const m of matchups) expect(m.week).toBeLessThan(league.settings.playoff_week_start);
  });

  it('gives every team a full schedule of expected results', () => {
    const games = league.settings.playoff_week_start - 1;
    for (const t of teams) {
      expect(t.wins + t.losses).toBeCloseTo(games, 1);
    }
  });

  it('conserves wins and losses across the league', () => {
    const wins = teams.reduce((s, t) => s + t.wins, 0);
    const losses = teams.reduce((s, t) => s + t.losses, 0);
    expect(wins).toBeCloseTo(losses, 0);
  });

  it('ranks the highest-projecting roster first', () => {
    const best = [...teams].sort((a, b) => b.weeklyPoints - a.weeklyPoints)[0];
    expect(teams[0].weeklyPoints).toBe(best.weeklyPoints);
  });

  it('never claims certainty about a matchup', () => {
    for (const m of matchups) {
      expect(m.favouriteWinChance).toBeGreaterThanOrEqual(0.5);
      expect(m.favouriteWinChance).toBeLessThan(1);
    }
  });

  it('lists the higher-projecting side first in each matchup', () => {
    for (const m of matchups) {
      expect(m.home.points).toBeGreaterThanOrEqual(m.away.points);
      expect(m.margin).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns nothing when there are no projections', () => {
    const empty = projectSeason(rosters, users, league.roster_positions, players, {}, schedule, 15);
    // Every lineup scores zero, so every matchup is a coin flip.
    for (const t of empty.teams) expect(t.weeklyPoints).toBe(0);
    for (const m of empty.matchups) expect(m.favouriteWinChance).toBeCloseTo(0.5, 6);
  });
});

describe('per-week projections', () => {
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const slots = league.roster_positions;
  const startable = (benRoster.players ?? []).filter(
    (id) => !benRoster.taxi?.includes(id) && !benRoster.reserve?.includes(id)
  );

  it("ignores Sleeper's 18-week gp, which counts a bye as a game", () => {
    // Every player carries gp: 18 in the real feed. Spreading a season over 18
    // would price in a week the player is not on the field.
    const proj = Object.fromEntries(startable.map((id) => [id, { points: 170, games: 18 }]));
    const { lineup } = projectLineup(benRoster, slots, players, proj);
    expect(lineup[0].perWeek).toBeCloseTo(10, 6);
  });

  it('honours a genuine per-player games figure below the season length', () => {
    const proj = Object.fromEntries(startable.map((id) => [id, { points: 100, games: 10 }]));
    const { lineup } = projectLineup(benRoster, slots, players, proj);
    expect(lineup[0].perWeek).toBeCloseTo(10, 6);
  });

  it('falls back to a full season when games is missing', () => {
    const proj = Object.fromEntries(startable.map((id) => [id, { points: 170 }]));
    const { lineup } = projectLineup(benRoster, slots, players, proj);
    expect(lineup[0].perWeek).toBeCloseTo(10, 6);
  });
});

describe('compareLineup', () => {
  const benRoster = rosters.find((r) => r.owner_id === BEN)!;
  const slots = league.roster_positions;
  const startable = (benRoster.players ?? []).filter(
    (id) => !benRoster.taxi?.includes(id) && !benRoster.reserve?.includes(id)
  );
  const flat = (points: number) =>
    Object.fromEntries(startable.map((id) => [id, { points, games: 17 }]));

  it('names no moves when there is nothing to gain', () => {
    // Equal projections make the "best" lineup an arbitrary tie-break, which
    // would otherwise surface as swaps worth zero points.
    const c = compareLineup(benRoster, slots, players, flat(100));
    expect(c.gain).toBe(0);
    expect(c.bringIn).toHaveLength(0);
    expect(c.sitDown).toHaveLength(0);
  });

  it('finds the bench player who should be starting', () => {
    // Give one benched player at a startable position an enormous projection.
    const starters = new Set(benRoster.starters ?? []);
    const benched = startable.find(
      (id) => !starters.has(id) && ['QB', 'RB', 'WR', 'TE'].includes(players[id]?.pos ?? '')
    )!;
    const c = compareLineup(benRoster, slots, players, { ...flat(1), [benched]: { points: 9999, games: 17 } });

    expect(c.gain).toBeGreaterThan(0);
    expect(c.bringIn.map((m) => m.player.id)).toContain(benched);
    expect(c.sitDown.length).toBeGreaterThan(0);
  });

  it('never suggests starting a taxi or injured-reserve player', () => {
    const stashed = [...(benRoster.taxi ?? []), ...(benRoster.reserve ?? [])];
    expect(stashed.length).toBeGreaterThan(0);
    const proj = { ...flat(1), ...Object.fromEntries(stashed.map((id) => [id, { points: 9999, games: 17 }])) };
    const c = compareLineup(benRoster, slots, players, proj);
    for (const m of c.bringIn) expect(stashed).not.toContain(m.player.id);
  });

  it('never reports a negative gain — the best lineup cannot be worse', () => {
    for (const roster of rosters) {
      const proj = Object.fromEntries(
        (roster.players ?? []).map((id, i) => [id, { points: (i * 37) % 200, games: 17 }])
      );
      expect(compareLineup(roster, slots, players, proj).gain).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports the current lineup honestly even when it is not optimal', () => {
    const proj = Object.fromEntries(
      startable.map((id, i) => [id, { points: (i * 53) % 300, games: 17 }])
    );
    const c = compareLineup(benRoster, slots, players, proj);
    const expected = (benRoster.starters ?? [])
      .filter((id) => id && id !== '0')
      .reduce((sum, id) => sum + (proj[id]?.points ?? 0), 0);
    expect(c.currentPoints).toBeCloseTo(expected, 6);
    expect(c.bestPoints).toBeGreaterThanOrEqual(c.currentPoints);
  });

  it('brings in more than it sits when a lineup slot was left empty', () => {
    const thin = { ...benRoster, starters: [(benRoster.starters ?? [])[0]] } as any;
    const c = compareLineup(thin, slots, players, flat(10));
    expect(c.bringIn.length).toBeGreaterThan(c.sitDown.length);
  });
});

describe('positionalStrength', () => {
  const slots = league.roster_positions;
  const proj: Record<string, { points: number; games: number }> = {};
  for (const [id] of Object.entries(players)) {
    proj[id] = { points: (Number(id.replace(/\D/g, '')) % 200) + 10, games: 17 };
  }
  const table = positionalStrength(rosters, slots, players, proj);

  it('covers every roster', () => {
    expect(table.size).toBe(rosters.length);
  });

  it('ranks within 1..12 and gives exactly one team the top rank per position', () => {
    const firsts = new Map<string, number>();
    for (const rows of table.values()) {
      for (const r of rows) {
        expect(r.rank).toBeGreaterThanOrEqual(1);
        expect(r.rank).toBeLessThanOrEqual(rosters.length);
        if (r.rank === 1) firsts.set(r.pos, (firsts.get(r.pos) ?? 0) + 1);
      }
    }
    // Ties would allow more than one; with distinct pseudo-projections there is one.
    for (const count of firsts.values()) expect(count).toBeGreaterThanOrEqual(1);
  });

  it('agrees with the lineup it is derived from', () => {
    for (const roster of rosters) {
      const { perWeek } = projectLineup(roster, slots, players, proj);
      const summed = (table.get(roster.roster_id) ?? []).reduce((s, r) => s + r.startingPoints, 0);
      expect(summed).toBeCloseTo(perWeek, 6);
    }
  });

  it('reports the same league best to every roster', () => {
    const byPos = new Map<string, Set<number>>();
    for (const rows of table.values()) {
      for (const r of rows) {
        if (!byPos.has(r.pos)) byPos.set(r.pos, new Set());
        byPos.get(r.pos)!.add(Math.round(r.leagueBest * 1000));
      }
    }
    for (const seen of byPos.values()) expect(seen.size).toBe(1);
  });

  it('the top-ranked roster is the one matching the league best', () => {
    for (const rows of table.values()) {
      for (const r of rows) {
        if (r.rank === 1) expect(r.startingPoints).toBeCloseTo(r.leagueBest, 6);
      }
    }
  });

  it('counts everyone rostered at a position, lineup or not', () => {
    const roster = rosters[0];
    const rows = table.get(roster.roster_id)!;
    const counted = rows.reduce((s, r) => s + r.rostered, 0);
    expect(counted).toBe((roster.players ?? []).length);
  });
});

describe('ageProfile', () => {
  const proj = Object.fromEntries(
    Object.keys(players).map((id) => [id, { points: 170, games: 17 }])
  );
  const roster = rosters.find((r) => r.owner_id === BEN)!;
  const profile = ageProfile(roster, rosters, players, proj);

  it('splits into three bands that sum to the whole', () => {
    expect(profile.bands).toHaveLength(3);
    const shares = profile.bands.reduce((s, b) => s + b.share, 0);
    expect(shares).toBeCloseTo(1, 6);
  });

  it('puts each player in exactly one band', () => {
    const counted = profile.bands.reduce((s, b) => s + b.players, 0);
    const eligible = (roster.players ?? []).filter(
      (id) => !roster.reserve?.includes(id) && players[id]?.age != null
    );
    expect(counted).toBe(eligible.length);
  });

  it('excludes injured reserve from the picture', () => {
    const withIr = { ...roster, reserve: [] } as any;
    const bigger = ageProfile(withIr, rosters, players, proj);
    const counted = (p: typeof profile) => p.bands.reduce((s, b) => s + b.players, 0);
    expect(counted(bigger)).toBeGreaterThanOrEqual(counted(profile));
  });

  it('weights by projected points, so a prospect who will not score is not youth', () => {
    const young = (roster.players ?? []).filter((id) => (players[id]?.age ?? 99) <= 24);
    expect(young.length).toBeGreaterThan(0);
    // Zero out the young players: their band should collapse to no share.
    const zeroed = { ...proj, ...Object.fromEntries(young.map((id) => [id, { points: 0, games: 17 }])) };
    const p = ageProfile(roster, rosters, players, zeroed);
    expect(p.bands[0].share).toBe(0);
    expect(p.bands[0].players).toBe(young.filter((id) => !roster.reserve?.includes(id)).length);
  });

  it('reports a weighted age inside the range of the roster', () => {
    const ages = (roster.players ?? [])
      .map((id) => players[id]?.age)
      .filter((a): a is number => a != null);
    expect(profile.weightedAge!).toBeGreaterThanOrEqual(Math.min(...ages));
    expect(profile.weightedAge!).toBeLessThanOrEqual(Math.max(...ages));
  });

  it('gives a league figure to sit against, and league shares that sum to one', () => {
    expect(profile.leagueWeightedAge).not.toBeNull();
    expect(profile.leagueShares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it('survives a roster with no projections at all', () => {
    const p = ageProfile(roster, rosters, players, {});
    expect(p.weightedAge).toBeNull();
    for (const b of p.bands) expect(b.share).toBe(0);
  });
});
