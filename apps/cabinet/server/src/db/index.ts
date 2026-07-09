import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface CabinetDb {
  db: Database.Database;
  /** Separate readonly connection backing the query_db tool (§7.1). */
  readonlyDb: Database.Database;
  close(): void;
}

export function openDb(path: string): CabinetDb {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const readonlyDb = new Database(path, { readonly: true });
  return {
    db,
    readonlyDb,
    close() {
      readonlyDb.close();
      db.close();
    },
  };
}

/** Hand-rolled migration runner: applies migrations/*.sql in name order, once each. */
export function migrate(db: Database.Database): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))',
  );
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migration').all().map((r) => (r as { name: string }).name),
  );
  const ran: string[] = [];
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const record = db.prepare('INSERT INTO schema_migration (name) VALUES (?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file);
    })();
    ran.push(file);
  }
  return ran;
}

const FORBIDDEN = /\b(pragma|attach|detach|vacuum|reindex)\b/i;
const MAX_ROWS = 500;

export class QueryGuardError extends Error {}

/**
 * SELECT-only query surface for the agent's query_db tool.
 * Defense in depth: keyword screen + single-statement check + a genuinely
 * readonly connection, so even a bypassed screen cannot write.
 */
export function queryReadonly(
  readonlyDb: Database.Database,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown>[] {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  if (!/^(select|with)\b/i.test(stripped)) {
    throw new QueryGuardError('Only SELECT (or WITH ... SELECT) statements are allowed.');
  }
  if (FORBIDDEN.test(stripped)) {
    throw new QueryGuardError('Statement contains a forbidden keyword.');
  }
  let stmt;
  try {
    stmt = readonlyDb.prepare(stripped); // throws on multi-statement input
  } catch (err) {
    throw new QueryGuardError(`SQL rejected: ${(err as Error).message}`);
  }
  if (!stmt.reader) {
    throw new QueryGuardError('Statement does not return rows.');
  }
  const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
  if (rows.length > MAX_ROWS) {
    return rows.slice(0, MAX_ROWS);
  }
  return rows;
}

/** 'YYYY-MM-DD' for a Date in America/New_York — the canonical local_day. */
export function localDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
