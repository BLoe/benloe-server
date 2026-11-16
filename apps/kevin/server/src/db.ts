// One SQLite database. Core tables here; each domain adds its own through
// `migrations` in its module (see domains.ts). Migrations are append-only and
// keyed by id: never edit one that has shipped, add another.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export interface Migration {
  id: string;
  sql: string;
}

const CORE: Migration[] = [
  {
    id: 'core-001',
    sql: `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      origin TEXT NOT NULL DEFAULT 'chat',          -- 'chat' | 'job'
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      summary TEXT,                                  -- compaction: what happened before summary_upto
      summary_upto INTEGER NOT NULL DEFAULT 0,       -- messages.id; history is sent from after this
      memory_upto INTEGER NOT NULL DEFAULT 0         -- turns.id already folded into the memory log
    );
    -- One row per turn: what Ben sent, what the UI showed, what it cost.
    CREATE TABLE turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',        -- running | done | error | stopped | refused
      origin TEXT NOT NULL DEFAULT 'chat',           -- chat | job
      model TEXT,
      effort TEXT,
      user_ui TEXT NOT NULL DEFAULT '{}',            -- JSON {text, attachments:[{id,filename,mime}], page}
      assistant_ui TEXT NOT NULL DEFAULT '[]',       -- JSON UiItem[]
      error TEXT,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX turns_thread ON turns(thread_id, id);
    -- The conversation as the API sees it (already stripped of thinking and
    -- server-tool blocks; see agent.ts).
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      turn_id INTEGER NOT NULL REFERENCES turns(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL                          -- JSON content blocks
    );
    CREATE INDEX messages_thread ON messages(thread_id, id);
    -- Every model request, whatever made it.
    CREATE TABLE usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      purpose TEXT NOT NULL,                         -- turn | title | summary | compaction | vision | research | memory
      thread_id TEXT,
      turn_id INTEGER,
      job_key TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
      web_searches INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX usage_at ON usage(at);
    CREATE TABLE tool_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      source TEXT NOT NULL,                          -- agent | ui | job
      thread_id TEXT,
      turn_id INTEGER,
      tool TEXT NOT NULL,
      input TEXT NOT NULL,
      ok INTEGER NOT NULL,
      result TEXT,                                   -- first 2000 chars
      ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX tool_audit_at ON tool_audit(at);
    -- Durable facts about Ben; rendered into the system prompt.
    CREATE TABLE facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- The daily log: events (written for free on every data change) and
    -- conversation summaries (written by the memory job).
    CREATE TABLE memory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      day TEXT NOT NULL,                             -- YYYY-MM-DD in Ben's timezone
      kind TEXT NOT NULL,                            -- event | summary | note
      thread_id TEXT,
      text TEXT NOT NULL
    );
    CREATE INDEX memory_log_day ON memory_log(day);
    -- One search index over everything recallable. kind+ref identify the source row.
    CREATE VIRTUAL TABLE search_index USING fts5(
      title, body, kind UNINDEXED, ref UNINDEXED, at UNINDEXED,
      tokenize = 'porter unicode61'
    );
    CREATE TABLE embeddings (
      kind TEXT NOT NULL, ref TEXT NOT NULL, chunk INTEGER NOT NULL,
      text TEXT NOT NULL, vec BLOB NOT NULL,
      PRIMARY KEY (kind, ref, chunk)
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,                    -- once | cron | interval
      trigger_value TEXT NOT NULL,                   -- ISO time | 5-field cron (Ben's tz) | minutes
      action TEXT NOT NULL,                          -- notify | check | agent_turn
      payload TEXT NOT NULL,                         -- JSON, shape by action (see jobs.ts)
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_at TEXT,
      spend_cap_usd REAL NOT NULL DEFAULT 1.0,       -- agent_turn only: lifetime-per-month cap
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'kevin'       -- kevin | ben
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_key TEXT NOT NULL,                         -- 'system:<name>' | 'schedule:<id>'
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome TEXT,                                  -- did-work | nothing-to-do | errored
      detail TEXT,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX job_runs_key ON job_runs(job_key, id);
    CREATE TABLE job_state (job_key TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, last_due TEXT);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT,                                     -- in-app path, e.g. /pantry or /chat/<thread>
      source TEXT,                                   -- job_key or 'kevin'
      read_at TEXT
    );
    CREATE TABLE push_subscriptions (
      endpoint TEXT PRIMARY KEY, keys TEXT NOT NULL, ua TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,                            -- relative to dataDir
      kind TEXT NOT NULL,                            -- image | pdf | text | other
      extracted_text TEXT,                           -- vision/pdf extraction; indexed
      extract_status TEXT NOT NULL DEFAULT 'pending' -- pending | done | failed | skipped
    );
    `,
  },
  {
    id: 'core-002',
    sql: `
    -- Who Ben is, in prose: the long-lived picture (family, history, health background, how he works).
    -- Lives here, not in the repo, because the repo is public. Rendered into the system prompt.
    CREATE TABLE profile_sections (
      key TEXT PRIMARY KEY,                          -- stable slug: 'family', 'health-history'
      title TEXT NOT NULL,
      body TEXT NOT NULL,                            -- markdown
      position INTEGER NOT NULL DEFAULT 0,           -- order in the prompt and on the page
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL                       -- kevin | ben | import
    );
    -- Every earlier version of a section. A rewrite can never silently lose what was there.
    CREATE TABLE profile_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      replaced_at TEXT NOT NULL,
      replaced_by TEXT NOT NULL
    );
    CREATE INDEX profile_history_key ON profile_history(key, id);
    `,
  },
  {
    id: 'core-003',
    sql: `
    -- The memory job's retry state for a conversation whose summary failed.
    ALTER TABLE threads ADD COLUMN memory_failures INTEGER NOT NULL DEFAULT 0;   -- failed attempts since the last success
    ALTER TABLE threads ADD COLUMN memory_retry_at TEXT;                         -- UTC ISO; the job leaves the thread alone until then
    `,
  },
];

export function openDb(path: string, extra: Migration[] = []): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id));
  for (const m of [...CORE, ...extra]) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (id, at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    })();
  }
  return db;
}

export const nowIso = () => new Date().toISOString();

/** JSON.parse for a stored column: a value that does not parse gives `fallback` instead of throwing. */
export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Settings key: the owner's account id at the auth service (artanis), learned from his own signed-in
 * requests (http.ts). Other apps on the box key their rows by that id (IRON PR does), and it is how
 * Kevin tells Ben's rows there from anyone else's.
 */
export const OWNER_ACCOUNT_KEY = 'owner_account_id';

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
