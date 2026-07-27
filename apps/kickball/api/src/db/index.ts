/**
 * SQLite storage.
 *
 * Migrations are an ordered list of statements applied once and recorded in
 * schema_migrations. To change the schema, append a migration; never edit one
 * that has already run.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_SETTINGS } from '../engine/domain';

export type DB = Database.Database;

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_initial',
    sql: `
      CREATE TABLE players (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        gender             TEXT NOT NULL DEFAULT 'man',
        active             INTEGER NOT NULL DEFAULT 1,
        excluded_positions TEXT NOT NULL DEFAULT '[]',
        notes              TEXT NOT NULL DEFAULT '',
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL
      );

      CREATE TABLE comparisons (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        stat_key   TEXT NOT NULL,
        player_a   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        player_b   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        winner_id  TEXT REFERENCES players(id) ON DELETE CASCADE,
        rater_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_comparisons_stat ON comparisons(stat_key);
      CREATE INDEX idx_comparisons_rater ON comparisons(rater_id);

      CREATE TABLE games (
        id           TEXT PRIMARY KEY,
        played_on    TEXT NOT NULL,
        opponent     TEXT NOT NULL DEFAULT '',
        first_pitch  TEXT NOT NULL DEFAULT '',
        field        TEXT NOT NULL DEFAULT '',
        notes        TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'draft',
        slug         TEXT UNIQUE,
        seed         TEXT NOT NULL DEFAULT '',
        generated_at TEXT,
        summary      TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_games_status ON games(status);

      CREATE TABLE availability (
        game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        available INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, player_id)
      );

      CREATE TABLE batting_slots (
        game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        slot      INTEGER NOT NULL,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        PRIMARY KEY (game_id, slot)
      );

      CREATE TABLE defense_assignments (
        game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        inning       INTEGER NOT NULL,
        position_key TEXT NOT NULL,
        player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        locked       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, inning, position_key)
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function openDatabase(filename: string): DB {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedSettings(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        new Date().toISOString()
      );
    });
    run();
  }
}

function seedSettings(db: DB): void {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insert.run('team_name', DEFAULT_SETTINGS.team_name);
  insert.run('innings', String(DEFAULT_SETTINGS.innings));
  insert.run('min_women_in_field', String(DEFAULT_SETTINGS.min_women_in_field));
  insert.run('rating_game_passcode', '');
  const seededAdmins = process.env.KICKBALL_ADMIN_EMAILS || process.env.CABINET_OWNER_EMAIL || '';
  insert.run('admin_emails', seededAdmins);
}

export interface Settings {
  team_name: string;
  innings: number;
  min_women_in_field: number;
  rating_game_passcode: string;
  admin_emails: string;
}

export function readSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    team_name: map.get('team_name') ?? DEFAULT_SETTINGS.team_name,
    innings: Number(map.get('innings') ?? DEFAULT_SETTINGS.innings),
    min_women_in_field: Number(map.get('min_women_in_field') ?? DEFAULT_SETTINGS.min_women_in_field),
    rating_game_passcode: map.get('rating_game_passcode') ?? '',
    admin_emails: map.get('admin_emails') ?? '',
  };
}

export function writeSetting(db: DB, key: keyof Settings, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
