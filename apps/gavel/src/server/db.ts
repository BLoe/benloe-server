/**
 * Draft state on disk.
 *
 * SQLite, synchronous, local file. The write path on the draft's critical path
 * is a single INSERT into an append-only table — no transaction spanning
 * multiple tables, no derived columns to keep in sync, nothing that can be left
 * half-written if the process dies between picks.
 *
 * Picks are NEVER deleted. Undo sets `voided`, so a mis-click during a live
 * auction costs one keystroke and loses no history. The whole board is a fold
 * over the non-voided picks, so correcting the log corrects every number.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LeagueConfig } from '../lib/league.js';
import type { PlayerValue } from '../lib/valuation.js';
import type { Pick } from '../lib/draft.js';
import type { TeamMeta } from '../lib/draft.js';

export interface LeagueRow {
  id: string;
  name: string;
  config: LeagueConfig;
  values: PlayerValue[];
  teams: TeamMeta[];
  /** The team the board belongs to — "my" needs and budget are highlighted. */
  myTeamId: string | null;
  capturedAt: number;
  draftStartTime: number | null;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // WAL keeps a reader (the board) from ever blocking on a writer (a pick).
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS leagues (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      config        TEXT NOT NULL,
      values_json   TEXT NOT NULL,
      teams_json    TEXT NOT NULL,
      my_team_id    TEXT,
      captured_at   INTEGER NOT NULL,
      draft_start   INTEGER
    );

    CREATE TABLE IF NOT EXISTS picks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      team_id    TEXT NOT NULL,
      price      INTEGER NOT NULL,
      at         INTEGER NOT NULL,
      voided     INTEGER NOT NULL DEFAULT 0,
      keeper     INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS picks_league ON picks (league_id, id);
  `);

  // Databases created before keepers existed need the column adding; SQLite has
  // no IF NOT EXISTS for ALTER, so ask first.
  const columns = db.prepare(`PRAGMA table_info(picks)`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'keeper')) {
    db.exec(`ALTER TABLE picks ADD COLUMN keeper INTEGER NOT NULL DEFAULT 0`);
  }

  return db;
}

export type Db = ReturnType<typeof openDb>;

export function upsertLeague(db: Db, row: LeagueRow): void {
  db.prepare(
    `INSERT INTO leagues (id, name, config, values_json, teams_json, my_team_id, captured_at, draft_start)
     VALUES (@id, @name, @config, @values_json, @teams_json, @my_team_id, @captured_at, @draft_start)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       config = excluded.config,
       values_json = excluded.values_json,
       teams_json = excluded.teams_json,
       captured_at = excluded.captured_at,
       draft_start = excluded.draft_start`
  ).run({
    id: row.id,
    name: row.name,
    config: JSON.stringify(row.config),
    values_json: JSON.stringify(row.values),
    teams_json: JSON.stringify(row.teams),
    my_team_id: row.myTeamId,
    captured_at: row.capturedAt,
    draft_start: row.draftStartTime,
  });
}

export function getLeagues(db: Db): LeagueRow[] {
  const rows = db.prepare(`SELECT * FROM leagues ORDER BY name`).all() as any[];
  return rows.map(hydrate);
}

export function getLeague(db: Db, id: string): LeagueRow | null {
  const row = db.prepare(`SELECT * FROM leagues WHERE id = ?`).get(id) as any;
  return row ? hydrate(row) : null;
}

function hydrate(row: any): LeagueRow {
  return {
    id: row.id,
    name: row.name,
    config: JSON.parse(row.config),
    values: JSON.parse(row.values_json),
    teams: JSON.parse(row.teams_json),
    myTeamId: row.my_team_id ?? null,
    capturedAt: row.captured_at,
    draftStartTime: row.draft_start ?? null,
  };
}

export function setMyTeam(db: Db, leagueId: string, teamId: string | null): void {
  db.prepare(`UPDATE leagues SET my_team_id = ? WHERE id = ?`).run(teamId, leagueId);
}

export function setTeams(db: Db, leagueId: string, teams: TeamMeta[]): void {
  db.prepare(`UPDATE leagues SET teams_json = ? WHERE id = ?`).run(JSON.stringify(teams), leagueId);
}

/** The live pick list — voided rows are excluded, and `seq` is the row id. */
export function listPicks(db: Db, leagueId: string): Pick[] {
  const rows = db
    .prepare(
      `SELECT id, player_id, team_id, price, at, keeper FROM picks WHERE league_id = ? AND voided = 0 ORDER BY id`
    )
    .all(leagueId) as any[];
  return rows.map((r) => ({
    seq: r.id,
    playerId: r.player_id,
    teamId: r.team_id,
    price: r.price,
    at: r.at,
    keeper: !!r.keeper,
  }));
}

export function addPick(
  db: Db,
  leagueId: string,
  pick: { playerId: string; teamId: string; price: number; keeper?: boolean }
): Pick {
  const at = Date.now();
  const info = db
    .prepare(
      `INSERT INTO picks (league_id, player_id, team_id, price, at, keeper) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(leagueId, pick.playerId, pick.teamId, pick.price, at, pick.keeper ? 1 : 0);
  return { seq: Number(info.lastInsertRowid), ...pick, at };
}

/** Void one pick. Returns whether anything changed, so undo can report honestly. */
export function voidPick(db: Db, leagueId: string, seq: number): boolean {
  const info = db
    .prepare(`UPDATE picks SET voided = 1 WHERE league_id = ? AND id = ? AND voided = 0`)
    .run(leagueId, seq);
  return info.changes > 0;
}

/** Void the most recent live pick — the undo the keyboard shortcut calls. */
export function voidLastPick(db: Db, leagueId: string): Pick | null {
  const row = db
    .prepare(
      `SELECT id, player_id, team_id, price, at, keeper FROM picks WHERE league_id = ? AND voided = 0 ORDER BY id DESC LIMIT 1`
    )
    .get(leagueId) as any;
  if (!row) return null;
  voidPick(db, leagueId, row.id);
  return {
    seq: row.id,
    playerId: row.player_id,
    teamId: row.team_id,
    price: row.price,
    at: row.at,
    keeper: !!row.keeper,
  };
}

export function editPick(
  db: Db,
  leagueId: string,
  seq: number,
  patch: { teamId?: string; price?: number }
): boolean {
  const existing = db
    .prepare(`SELECT team_id, price FROM picks WHERE league_id = ? AND id = ? AND voided = 0`)
    .get(leagueId, seq) as any;
  if (!existing) return false;
  db.prepare(`UPDATE picks SET team_id = ?, price = ? WHERE league_id = ? AND id = ?`).run(
    patch.teamId ?? existing.team_id,
    patch.price ?? existing.price,
    leagueId,
    seq
  );
  return true;
}
