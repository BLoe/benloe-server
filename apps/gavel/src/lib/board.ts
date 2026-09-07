/**
 * Build a priced board from a league config plus a projection source.
 *
 * Deliberately knows nothing about platforms. A league's identity is its
 * scoring map and roster shape, and both arrive as data — from Sleeper's own
 * settings for a Sleeper league, from a checked-in definition file for one
 * whose platform we do not read. Projections are Sleeper's either way, because
 * they are a projection of NFL players, not of a fantasy platform.
 *
 * This is what makes the Yahoo league work without ever calling Yahoo.
 */
import { scoreStatsRounded } from './scoring.js';
import { valueBoard, type BoardOptions, type PlayerProjection, type PlayerValue } from './valuation.js';
import { POSITIONS, type LeagueConfig, type Position } from './league.js';
import type { SleeperProjectionRow } from '../sources/sleeper.js';

function isPosition(value: string | null | undefined): value is Position {
  return !!value && (POSITIONS as readonly string[]).includes(value);
}

export function projectionsFor(
  rows: SleeperProjectionRow[],
  cfg: LeagueConfig,
  byes: Record<string, number>
): PlayerProjection[] {
  const players: PlayerProjection[] = [];
  for (const row of rows) {
    const p = row.player;
    const pos = p?.fantasy_positions?.[0];
    if (!isPosition(pos)) continue;

    // Points under THIS league's rules. Never a canned points column — Sleeper's
    // assume four-point passing touchdowns regardless of the league.
    const points = scoreStatsRounded(row.stats, cfg.scoring);
    if (!Number.isFinite(points)) continue;

    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
    if (!name) continue;

    players.push({
      id: row.player_id,
      name,
      position: pos,
      team: p?.team ?? null,
      points,
      byeWeek: p?.team ? (byes[p.team] ?? null) : null,
      adp: row.stats?.adp_std ?? null,
      injury: p?.injury_status ?? null,
    });
  }
  return players;
}

export function buildBoard(
  rows: SleeperProjectionRow[],
  cfg: LeagueConfig,
  byes: Record<string, number>,
  options: BoardOptions = {}
): { players: PlayerProjection[]; values: PlayerValue[] } {
  const players = projectionsFor(rows, cfg, byes);
  return { players, values: valueBoard(players, cfg, options) };
}
