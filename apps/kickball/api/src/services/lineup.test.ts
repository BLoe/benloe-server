import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, readSettings, writeSetting } from '../db';
import type { DB } from '../db';
import { FIELDERS_PER_INNING, POSITIONS, STATS } from '../engine/domain';
import { computeRatings, generateLineup, listPlayers, seasonHistory } from './lineup';

let db: DB;

function addPlayer(name: string, gender = 'man', excluded: string[] = []): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO players (id, name, gender, active, excluded_positions, notes, sort_order, created_at)
     VALUES (?, ?, ?, 1, ?, '', 0, ?)`
  ).run(id, name, gender, JSON.stringify(excluded), new Date().toISOString());
  return id;
}

function addGame(playedOn = '2026-08-02', status = 'draft'): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO games (id, played_on, opponent, status, seed, summary, created_at)
     VALUES (?, ?, 'The Others', ?, 'seed', '{}', ?)`
  ).run(id, playedOn, status, new Date().toISOString());
  return id;
}

function setAvailable(gameId: string, playerIds: string[]) {
  const upsert = db.prepare(
    `INSERT INTO availability (game_id, player_id, available) VALUES (?, ?, 1)
     ON CONFLICT(game_id, player_id) DO UPDATE SET available = 1`
  );
  for (const id of playerIds) upsert.run(gameId, id);
}

function recordComparison(statKey: string, a: string, b: string, winner: string | null, rater: string | null = null) {
  db.prepare(
    `INSERT INTO comparisons (stat_key, player_a, player_b, winner_id, rater_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(statKey, a, b, winner, rater, new Date().toISOString());
}

/** Persists a lineup the way the generate route does, so history is realistic. */
function persistLineup(gameId: string, assignment: string[][], battingOrder: string[]) {
  const slot = db.prepare('INSERT INTO batting_slots (game_id, slot, player_id) VALUES (?, ?, ?)');
  battingOrder.forEach((id, i) => slot.run(gameId, i, id));
  const pos = db.prepare(
    'INSERT INTO defense_assignments (game_id, inning, position_key, player_id, locked) VALUES (?, ?, ?, ?, 0)'
  );
  assignment.forEach((row, inning) =>
    row.forEach((playerId, index) => pos.run(gameId, inning, POSITIONS[index].key, playerId))
  );
}

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('schema', () => {
  it('applies migrations and seeds league settings', () => {
    const settings = readSettings(db);
    expect(settings.team_name).toBe('No New Friends');
    expect(settings.innings).toBe(6);
    expect(settings.min_women_in_field).toBe(3);
  });

  it('is idempotent when opened again', () => {
    expect(() => openDatabase(':memory:')).not.toThrow();
    const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    expect(applied.n).toBeGreaterThan(0);
  });

  it('removes a deleted player from their comparisons', () => {
    const a = addPlayer('Ana', 'woman');
    const b = addPlayer('Ben');
    recordComparison('power', a, b, a);
    db.prepare('DELETE FROM players WHERE id = ?').run(a);
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM comparisons').get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe('computeRatings', () => {
  it('rates every stat for every player even with no comparisons', () => {
    const ids = [addPlayer('Ana', 'woman'), addPlayer('Ben')];
    const table = computeRatings(db);
    for (const stat of STATS) {
      for (const id of ids) expect(table.get(stat.key)!.get(id)!.rating).toBeCloseTo(50, 6);
    }
  });

  it('reflects recorded comparisons', () => {
    const a = addPlayer('Ana', 'woman');
    const b = addPlayer('Ben');
    for (let i = 0; i < 8; i++) recordComparison('power', a, b, a);
    const table = computeRatings(db);
    expect(table.get('power')!.get(a)!.rating).toBeGreaterThan(table.get('power')!.get(b)!.rating);
    // A different stat is untouched by those comparisons.
    expect(table.get('bunting')!.get(a)!.rating).toBeCloseTo(50, 6);
  });

  it('can weight out self-ratings', () => {
    const a = addPlayer('Ana', 'woman');
    const b = addPlayer('Ben');
    // Ana rates herself the better power kicker, eight times.
    for (let i = 0; i < 8; i++) recordComparison('power', a, b, a, a);

    const withSelf = computeRatings(db, { includeSelfRatings: true });
    const withoutSelf = computeRatings(db, { includeSelfRatings: false });

    expect(withSelf.get('power')!.get(a)!.rating).toBeGreaterThan(50);
    expect(withoutSelf.get('power')!.get(a)!.rating).toBeCloseTo(50, 6);
    expect(withoutSelf.get('power')!.get(a)!.comparisons).toBe(0);
  });

  it('keeps a third party rating a matchup they are not in', () => {
    const a = addPlayer('Ana', 'woman');
    const b = addPlayer('Ben');
    const c = addPlayer('Cat', 'woman');
    for (let i = 0; i < 8; i++) recordComparison('power', a, b, a, c);
    const withoutSelf = computeRatings(db, { includeSelfRatings: false });
    expect(withoutSelf.get('power')!.get(a)!.rating).toBeGreaterThan(50);
  });
});

describe('seasonHistory', () => {
  it('counts only published games', () => {
    const players = Array.from({ length: 11 }, (_, i) => addPlayer(`P${i}`, i < 4 ? 'woman' : 'man'));
    const draft = addGame('2026-07-05', 'draft');
    const published = addGame('2026-07-12', 'published');
    setAvailable(draft, players);
    setAvailable(published, players);

    const assignment = Array.from({ length: 6 }, () => players.slice(0, FIELDERS_PER_INNING));
    persistLineup(draft, assignment, players);
    persistLineup(published, assignment, players);

    const history = seasonHistory(db);
    // Only the published game contributes its six innings.
    expect(history.played[players[0]]).toBe(6);
    expect(history.possible[players[0]]).toBe(6);
    // The eleventh player was available but never took the field.
    expect(history.played[players[10]]).toBeUndefined();
    expect(history.possible[players[10]]).toBe(6);
  });

  it('excludes the game currently being generated', () => {
    const players = Array.from({ length: 10 }, (_, i) => addPlayer(`P${i}`, i < 4 ? 'woman' : 'man'));
    const game = addGame('2026-07-12', 'published');
    setAvailable(game, players);
    persistLineup(game, Array.from({ length: 6 }, () => players), players);

    expect(seasonHistory(db).played[players[0]]).toBe(6);
    expect(seasonHistory(db, game).played[players[0]]).toBeUndefined();
  });
});

describe('generateLineup', () => {
  function seedRoster(n: number, women: number): string[] {
    return Array.from({ length: n }, (_, i) => addPlayer(`Player ${i}`, i < women ? 'woman' : 'man'));
  }

  it('produces a full, legal lineup end to end', () => {
    const players = seedRoster(13, 6);
    const game = addGame();
    setAvailable(game, players);

    const result = generateLineup(db, game, { seed: 'e2e' });

    expect(result.battingOrder).toHaveLength(13);
    expect(new Set(result.battingOrder).size).toBe(13);
    expect(result.assignment).toHaveLength(6);
    for (const row of result.assignment) {
      expect(new Set(row).size).toBe(FIELDERS_PER_INNING);
      const women = row.filter((id) => players.indexOf(id) < 6).length;
      expect(women).toBeGreaterThanOrEqual(3);
    }
    expect(result.summary.expectedRuns).toBeGreaterThan(0);
    expect(result.summary.insights.length).toBeGreaterThan(0);
  });

  it('only uses players marked available', () => {
    const players = seedRoster(14, 6);
    const game = addGame();
    const available = players.slice(0, 11);
    setAvailable(game, available);

    const result = generateLineup(db, game, { seed: 'avail' });
    const used = new Set(result.assignment.flat());
    for (const id of used) expect(available).toContain(id);
    expect(result.battingOrder.sort()).toEqual([...available].sort());
  });

  it('refuses when fewer than ten are available', () => {
    const players = seedRoster(12, 6);
    const game = addGame();
    setAvailable(game, players.slice(0, 9));
    expect(() => generateLineup(db, game, { seed: 'short' })).toThrow(/at least 10/i);
  });

  it('respects a locked assignment', () => {
    const players = seedRoster(13, 6);
    const game = addGame();
    setAvailable(game, players);

    const result = generateLineup(db, game, {
      seed: 'locked',
      locks: [{ inning: 2, positionKey: 'catcher', playerId: players[12] }],
    });
    const catcherIndex = POSITIONS.findIndex((p) => p.key === 'catcher');
    expect(result.assignment[2][catcherIndex]).toBe(players[12]);
  });

  it('honours a position opt-out', () => {
    const pitcherHaters = Array.from({ length: 6 }, (_, i) => addPlayer(`No ${i}`, i < 3 ? 'woman' : 'man', ['pitcher']));
    const rest = Array.from({ length: 7 }, (_, i) => addPlayer(`Yes ${i}`, i < 3 ? 'woman' : 'man'));
    const game = addGame();
    setAvailable(game, [...pitcherHaters, ...rest]);

    const result = generateLineup(db, game, { seed: 'optout' });
    const pitcherIndex = POSITIONS.findIndex((p) => p.key === 'pitcher');
    for (const row of result.assignment) {
      expect(pitcherHaters).not.toContain(row[pitcherIndex]);
    }
  });

  it('follows the league minimum from settings', () => {
    const players = seedRoster(14, 7);
    writeSetting(db, 'min_women_in_field', '5');
    const game = addGame();
    setAvailable(game, players);

    const result = generateLineup(db, game, { seed: 'minfive' });
    for (const row of result.assignment) {
      expect(row.filter((id) => players.indexOf(id) < 7).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('follows the inning count from settings', () => {
    const players = seedRoster(12, 6);
    writeSetting(db, 'innings', '4');
    const game = addGame();
    setAvailable(game, players);
    expect(generateLineup(db, game, { seed: 'four' }).assignment).toHaveLength(4);
  });

  it('uses ratings to place a specialist', () => {
    const players = seedRoster(13, 6);
    const ace = players[10];
    // Give the ace a decisive pitching record against everyone else.
    for (const other of players) {
      if (other === ace) continue;
      for (let i = 0; i < 6; i++) recordComparison('pitching', ace, other, ace);
    }

    const game = addGame();
    setAvailable(game, players);
    const result = generateLineup(db, game, { seed: 'ace' });

    const pitcherIndex = POSITIONS.findIndex((p) => p.key === 'pitcher');
    const inningsPitched = result.assignment.filter((row) => row[pitcherIndex] === ace).length;
    expect(inningsPitched).toBeGreaterThanOrEqual(4);
  });

  it('gives last week down-time back this week', () => {
    const players = seedRoster(14, 6);

    const lastWeek = addGame('2026-07-19', 'published');
    setAvailable(lastWeek, players);
    // The last four players sat every inning last week.
    const regulars = players.slice(0, 10);
    persistLineup(lastWeek, Array.from({ length: 6 }, () => regulars), players);

    const thisWeek = addGame('2026-07-26');
    setAvailable(thisWeek, players);
    const result = generateLineup(db, thisWeek, { seed: 'carryover' });

    const benched = players.slice(10).map((id) => result.summary.inningsPlayed[id]);
    const played = players.slice(0, 10).map((id) => result.summary.inningsPlayed[id]);
    expect(Math.min(...benched)).toBeGreaterThan(Math.max(...played));
  });

  it('is reproducible for a given seed', () => {
    const players = seedRoster(13, 6);
    const game = addGame();
    setAvailable(game, players);
    const a = generateLineup(db, game, { seed: 'fixed' });
    const b = generateLineup(db, game, { seed: 'fixed' });
    expect(a.assignment).toEqual(b.assignment);
    expect(a.battingOrder).toEqual(b.battingOrder);
  });

  it('reports innings played that add up to the innings available', () => {
    const players = seedRoster(15, 7);
    const game = addGame();
    setAvailable(game, players);
    const result = generateLineup(db, game, { seed: 'accounting' });
    const total = Object.values(result.summary.inningsPlayed).reduce((s, v) => s + v, 0);
    expect(total).toBe(6 * FIELDERS_PER_INNING);
    expect(listPlayers(db)).toHaveLength(15);
  });
});
