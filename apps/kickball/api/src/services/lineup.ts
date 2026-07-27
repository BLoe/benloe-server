/**
 * Bridges stored data and the pure optimizers: reads the roster, comparisons
 * and season history out of SQLite, runs the engines, and writes the resulting
 * lineup back.
 */

import type { DB } from '../db';
import { readSettings } from '../db';
import { STATS, POSITIONS, DEFENSE_KEYS, getStat } from '../engine/domain';
import { fitBradleyTerry } from '../engine/ratings';
import type { Comparison, PlayerRating } from '../engine/ratings';
import { optimizeBattingOrder } from '../engine/batting';
import type { OffenseProfile } from '../engine/batting';
import { optimizeDefense, positionFit } from '../engine/defense';
import type { DefenseLock, DefensePlayer, Gender } from '../engine/defense';

export interface PlayerRow {
  id: string;
  name: string;
  gender: string;
  active: number;
  excluded_positions: string;
  notes: string;
  sort_order: number;
  created_at: string;
}

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  active: boolean;
  excludedPositions: string[];
  notes: string;
  sortOrder: number;
}

export function toPlayer(row: PlayerRow): Player {
  let excluded: string[] = [];
  try {
    const parsed = JSON.parse(row.excluded_positions);
    if (Array.isArray(parsed)) excluded = parsed.filter((v) => typeof v === 'string');
  } catch {
    excluded = [];
  }
  const gender: Gender =
    row.gender === 'woman' || row.gender === 'nonbinary' ? row.gender : 'man';
  return {
    id: row.id,
    name: row.name,
    gender,
    active: row.active === 1,
    excludedPositions: excluded,
    notes: row.notes,
    sortOrder: row.sort_order,
  };
}

export function listPlayers(db: DB, options: { activeOnly?: boolean } = {}): Player[] {
  const sql = options.activeOnly
    ? 'SELECT * FROM players WHERE active = 1 ORDER BY sort_order, name'
    : 'SELECT * FROM players ORDER BY sort_order, name';
  return (db.prepare(sql).all() as PlayerRow[]).map(toPlayer);
}

export type RatingTable = Map<string, Map<string, PlayerRating>>;

/**
 * Fits every stat from the stored comparisons.
 *
 * Self-comparisons are included by default because a player judging a matchup
 * they are in is still a real opinion, but they can be weighted out entirely
 * from the dashboard to see how much they were moving the numbers.
 */
export function computeRatings(
  db: DB,
  options: { includeSelfRatings?: boolean; playerIds?: string[] } = {}
): RatingTable {
  const includeSelf = options.includeSelfRatings ?? true;
  const ids = options.playerIds ?? listPlayers(db).map((p) => p.id);

  const rows = db
    .prepare('SELECT stat_key, player_a, player_b, winner_id, rater_id FROM comparisons')
    .all() as {
    stat_key: string;
    player_a: string;
    player_b: string;
    winner_id: string | null;
    rater_id: string | null;
  }[];

  const byStat = new Map<string, Comparison[]>();
  for (const stat of STATS) byStat.set(stat.key, []);

  for (const row of rows) {
    const bucket = byStat.get(row.stat_key);
    if (!bucket) continue;
    const isSelf = row.rater_id !== null && (row.rater_id === row.player_a || row.rater_id === row.player_b);
    bucket.push({
      a: row.player_a,
      b: row.player_b,
      winner: row.winner_id,
      weight: isSelf && !includeSelf ? 0 : 1,
    });
  }

  const table: RatingTable = new Map();
  for (const stat of STATS) {
    table.set(stat.key, fitBradleyTerry(ids, byStat.get(stat.key) ?? []));
  }
  return table;
}

/** Comparison counts per stat, for the dashboard's coverage view. */
export function comparisonCounts(db: DB): Record<string, number> {
  const rows = db
    .prepare('SELECT stat_key, COUNT(*) AS n FROM comparisons GROUP BY stat_key')
    .all() as { stat_key: string; n: number }[];
  const counts: Record<string, number> = {};
  for (const stat of STATS) counts[stat.key] = 0;
  for (const row of rows) if (row.stat_key in counts) counts[row.stat_key] = row.n;
  return counts;
}

function ratingOf(table: RatingTable, statKey: string, playerId: string): number {
  return table.get(statKey)?.get(playerId)?.rating ?? 50;
}

function thetaOf(table: RatingTable, statKey: string, playerId: string): number {
  return table.get(statKey)?.get(playerId)?.theta ?? 0;
}

export function offenseProfile(playerId: string, table: RatingTable): OffenseProfile {
  return {
    playerId,
    onBase: thetaOf(table, 'on_base', playerId),
    power: thetaOf(table, 'power', playerId),
    bunting: thetaOf(table, 'bunting', playerId),
    baserunning: thetaOf(table, 'baserunning', playerId),
    iq: thetaOf(table, 'offense_iq', playerId),
  };
}

export interface SeasonHistory {
  played: Record<string, number>;
  possible: Record<string, number>;
}

/**
 * Innings fielded and innings available, across published games only.
 * Drafts do not count; nobody actually sat out a lineup that was never used.
 */
export function seasonHistory(db: DB, excludeGameId?: string): SeasonHistory {
  const exclusion = excludeGameId ? 'AND g.id != ?' : '';
  const params = excludeGameId ? [excludeGameId] : [];

  const playedRows = db
    .prepare(
      `SELECT da.player_id AS id, COUNT(*) AS n
         FROM defense_assignments da
         JOIN games g ON g.id = da.game_id
        WHERE g.status = 'published' ${exclusion}
        GROUP BY da.player_id`
    )
    .all(...params) as { id: string; n: number }[];

  const possibleRows = db
    .prepare(
      `SELECT a.player_id AS id, COUNT(DISTINCT g.id) AS games
         FROM availability a
         JOIN games g ON g.id = a.game_id
        WHERE g.status = 'published' AND a.available = 1 ${exclusion}
        GROUP BY a.player_id`
    )
    .all(...params) as { id: string; games: number }[];

  const settings = readSettings(db);
  const played: Record<string, number> = {};
  const possible: Record<string, number> = {};
  for (const row of playedRows) played[row.id] = row.n;
  for (const row of possibleRows) possible[row.id] = row.games * settings.innings;
  return { played, possible };
}

export function defensePlayer(
  player: Player,
  table: RatingTable,
  history: SeasonHistory
): DefensePlayer {
  const ratings: Record<string, number> = {};
  for (const key of DEFENSE_KEYS) ratings[key] = ratingOf(table, key, player.id);
  return {
    playerId: player.id,
    gender: player.gender,
    ratings,
    excludedPositions: player.excludedPositions,
    priorPlayed: history.played[player.id] ?? 0,
    priorPossible: history.possible[player.id] ?? 0,
  };
}

export interface GenerateResult {
  battingOrder: string[];
  assignment: string[][];
  summary: LineupSummary;
}

export interface LineupSummary {
  expectedRuns: number;
  runsByInning: number[];
  meanFit: number;
  inningsPlayed: Record<string, number>;
  fairShare: Record<string, number>;
  positionsPlayed: Record<string, string[]>;
  warnings: string[];
  insights: string[];
  generatedAt: string;
}

/**
 * Runs both optimizers for a game and returns the result without persisting.
 *
 * Locks come from assignments the manager has already pinned by hand, so
 * regenerating keeps deliberate choices and re-solves everything around them.
 */
export function generateLineup(
  db: DB,
  gameId: string,
  options: { seed?: string; locks?: DefenseLock[] } = {}
): GenerateResult {
  const settings = readSettings(db);
  const available = availablePlayers(db, gameId);

  if (available.length < POSITIONS.length) {
    throw new Error(
      `Only ${available.length} players are marked available. You need at least ${POSITIONS.length} to field a defense.`
    );
  }

  const table = computeRatings(db);
  const history = seasonHistory(db, gameId);
  const seed = options.seed || gameId;

  const battingResult = optimizeBattingOrder(
    available.map((p) => offenseProfile(p.id, table)),
    { seed: `${seed}:batting` }
  );

  const defenseResult = optimizeDefense(
    available.map((p) => defensePlayer(p, table, history)),
    {
      seed: `${seed}:defense`,
      innings: settings.innings,
      minWomenInField: settings.min_women_in_field,
      locks: options.locks ?? [],
    }
  );

  const nameOf = new Map(available.map((p) => [p.id, p.name]));

  return {
    battingOrder: battingResult.order,
    assignment: defenseResult.assignment,
    summary: {
      expectedRuns: battingResult.expectedRuns,
      runsByInning: battingResult.runsByInning,
      meanFit: defenseResult.meanFit,
      inningsPlayed: defenseResult.inningsPlayed,
      fairShare: defenseResult.fairShare,
      positionsPlayed: defenseResult.positionsPlayed,
      warnings: defenseResult.warnings,
      insights: buildInsights(battingResult.order, table, nameOf, defenseResult.assignment),
      generatedAt: new Date().toISOString(),
    },
  };
}

export function availablePlayers(db: DB, gameId: string): Player[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM players p
         JOIN availability a ON a.player_id = p.id
        WHERE a.game_id = ? AND a.available = 1 AND p.active = 1
        ORDER BY p.sort_order, p.name`
    )
    .all(gameId) as PlayerRow[];
  return rows.map(toPlayer);
}

/**
 * Plain-language notes about why the lineup looks the way it does. These are
 * the only place ratings surface publicly, and always as a compliment.
 */
function buildInsights(
  order: string[],
  table: RatingTable,
  nameOf: Map<string, string>,
  assignment: string[][]
): string[] {
  const insights: string[] = [];
  const name = (id: string) => nameOf.get(id) ?? 'Someone';

  if (order.length > 0) {
    insights.push(`${name(order[0])} leads off — best odds of starting the game on base.`);
  }

  const best = (statKey: string): string | null => {
    const ratings = table.get(statKey);
    if (!ratings) return null;
    let bestId: string | null = null;
    let bestValue = -Infinity;
    for (const id of order) {
      const value = ratings.get(id)?.rating ?? 50;
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }
    // Only worth mentioning if they actually stand out.
    return bestValue > 55 ? bestId : null;
  };

  const slugger = best('power');
  if (slugger) {
    const slot = order.indexOf(slugger) + 1;
    insights.push(`${name(slugger)} bats ${ordinal(slot)}, in position to drive in the top of the order.`);
  }

  const bunter = best('bunting');
  if (bunter && bunter !== slugger) {
    insights.push(`${name(bunter)} is the bunt threat that keeps the striker honest.`);
  }

  const thirdIndex = POSITIONS.findIndex((p) => p.key === 'third');
  const rcIndex = POSITIONS.findIndex((p) => p.key === 'right_center');
  if (assignment.length > 0) {
    const strikers = new Set(assignment.map((row) => row[thirdIndex]));
    if (strikers.size === 1) {
      insights.push(`${name([...strikers][0])} strikes all six innings.`);
    }
    const roamers = new Set(assignment.map((row) => row[rcIndex]));
    if (roamers.size === 1) {
      insights.push(`${name([...roamers][0])} roams all six.`);
    }
  }

  return insights;
}

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] ?? suffixes[value] ?? suffixes[0]);
}

/** Position fit for every player at every position, for the dashboard grid. */
export function fitMatrix(players: Player[], table: RatingTable, history: SeasonHistory) {
  return players.map((player) => {
    const dp = defensePlayer(player, table, history);
    const fits: Record<string, number> = {};
    for (const position of POSITIONS) fits[position.key] = positionFit(dp, position.key);
    return { playerId: player.id, fits };
  });
}

export { getStat };
