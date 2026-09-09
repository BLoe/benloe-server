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

export interface LeagueRow {
  id: string;
  name: string;
  config: LeagueConfig;
  values: PlayerValue[];
  capturedAt: number;
  draftStartTime: number | null;
  /** What the prices were calibrated against, or null if nothing. */
  calibration: Calibration | null;
}

export interface Calibration {
  source: string;
  seasons: string[];
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
      teams_json    TEXT,
      my_team_id    TEXT,
      captured_at   INTEGER NOT NULL,
      draft_start   INTEGER,
      calibration   TEXT
    );

    CREATE TABLE IF NOT EXISTS picks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id  TEXT NOT NULL,
      player_id  TEXT NOT NULL,
      team_id    TEXT,
      price      INTEGER NOT NULL,
      at         INTEGER NOT NULL,
      voided     INTEGER NOT NULL DEFAULT 0,
      keeper     INTEGER NOT NULL DEFAULT 0,
      mine       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS picks_league ON picks (league_id, id);
  `);

  // Databases created before these columns existed need them adding; SQLite has
  // no IF NOT EXISTS for ALTER, so ask first.
  const pickCols = db.prepare(`PRAGMA table_info(picks)`).all() as Array<{ name: string }>;
  if (!pickCols.some((c) => c.name === 'keeper')) {
    db.exec(`ALTER TABLE picks ADD COLUMN keeper INTEGER NOT NULL DEFAULT 0`);
  }
  if (!pickCols.some((c) => c.name === 'mine')) {
    db.exec(`ALTER TABLE picks ADD COLUMN mine INTEGER NOT NULL DEFAULT 0`);
    /*
     * Backfill from the old model before it is unreachable.
     *
     * Picks used to name the buying manager, and the league recorded which of
     * those was yours. A completed draft is sitting in this table; defaulting
     * every row to "not mine" would silently erase which fifteen players were
     * actually won. This runs exactly once, at the moment the column appears.
     */
    const filled = db
      .prepare(
        `UPDATE picks SET mine = 1
          WHERE team_id IS NOT NULL
            AND team_id = (SELECT my_team_id FROM leagues WHERE leagues.id = picks.league_id)`
      )
      .run();
    if (filled.changes > 0) {
      console.log(`[gavel] backfilled ${filled.changes} pick(s) as yours from the old team model`);
    }
  }
  const leagueCols = db.prepare(`PRAGMA table_info(leagues)`).all() as Array<{ name: string }>;
  if (!leagueCols.some((c) => c.name === 'calibration')) {
    db.exec(`ALTER TABLE leagues ADD COLUMN calibration TEXT`);
  }

  return db;
}

export type Db = ReturnType<typeof openDb>;

export function upsertLeague(db: Db, row: LeagueRow): void {
  db.prepare(
    `INSERT INTO leagues (id, name, config, values_json, captured_at, draft_start, calibration)
     VALUES (@id, @name, @config, @values_json, @captured_at, @draft_start, @calibration)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       config = excluded.config,
       values_json = excluded.values_json,
       captured_at = excluded.captured_at,
       draft_start = excluded.draft_start,
       calibration = excluded.calibration`
  ).run({
    id: row.id,
    name: row.name,
    config: JSON.stringify(row.config),
    values_json: JSON.stringify(row.values),
    captured_at: row.capturedAt,
    draft_start: row.draftStartTime,
    calibration: row.calibration ? JSON.stringify(row.calibration) : null,
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
    capturedAt: row.captured_at,
    draftStartTime: row.draft_start ?? null,
    calibration: row.calibration ? JSON.parse(row.calibration) : null,
  };
}



/** The live pick list — voided rows are excluded, and `seq` is the row id. */
export function listPicks(db: Db, leagueId: string): Pick[] {
  const rows = db
    .prepare(
      `SELECT id, player_id, price, at, keeper, mine FROM picks WHERE league_id = ? AND voided = 0 ORDER BY id`
    )
    .all(leagueId) as any[];
  return rows.map((r) => ({
    seq: r.id,
    playerId: r.player_id,
    price: r.price,
    at: r.at,
    keeper: !!r.keeper,
    mine: !!r.mine,
  }));
}

export function addPick(
  db: Db,
  leagueId: string,
  pick: { playerId: string; price: number; mine?: boolean; keeper?: boolean }
): Pick {
  const at = Date.now();
  // `team_id` is dead — ownership is the `mine` flag — but a database created
  // before that change still carries `team_id TEXT NOT NULL`, and SQLite cannot
  // drop a NOT NULL with ALTER. Relaxing it in CREATE TABLE only helps a fresh
  // file. Writing an empty string satisfies the old constraint and costs
  // nothing on a new one.
  //
  // This shipped broken and failed EVERY insert on the live database for a
  // whole draft. Nothing surfaced it: the write path is deliberately
  // fire-and-forget so the board never blocks on the network, so the retry
  // queue simply grew while the UI stayed perfectly correct.
  const info = db
    .prepare(
      `INSERT INTO picks (league_id, player_id, team_id, price, at, keeper, mine)
       VALUES (?, ?, '', ?, ?, ?, ?)`
    )
    .run(leagueId, pick.playerId, pick.price, at, pick.keeper ? 1 : 0, pick.mine ? 1 : 0);
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
      `SELECT id, player_id, price, at, keeper, mine FROM picks WHERE league_id = ? AND voided = 0 ORDER BY id DESC LIMIT 1`
    )
    .get(leagueId) as any;
  if (!row) return null;
  voidPick(db, leagueId, row.id);
  return {
    seq: row.id,
    playerId: row.player_id,
    price: row.price,
    at: row.at,
    keeper: !!row.keeper,
    mine: !!row.mine,
  };
}

export function editPick(
  db: Db,
  leagueId: string,
  seq: number,
  patch: { price?: number; mine?: boolean }
): boolean {
  const existing = db
    .prepare(`SELECT price, mine FROM picks WHERE league_id = ? AND id = ? AND voided = 0`)
    .get(leagueId, seq) as any;
  if (!existing) return false;
  db.prepare(`UPDATE picks SET price = ?, mine = ? WHERE league_id = ? AND id = ?`).run(
    patch.price ?? existing.price,
    patch.mine === undefined ? existing.mine : patch.mine ? 1 : 0,
    leagueId,
    seq
  );
  return true;
}
