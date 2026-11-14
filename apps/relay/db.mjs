// Relay's storage: one SQLite file, three tables. Shared by server.mjs (the
// HTTP side an outside agent talks to) and cli.mjs (the side a Claude Code
// session on this box talks to). No dependencies: node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';

// Under /var/lib, not /srv/benloe/data: every parent directory is root-owned,
// so no other uid on the box can swap the database out from under us.
export const DEFAULT_DB = process.env.RELAY_DB || '/var/lib/benloe-relay/relay.db';
export const MAX_DB_BYTES = 200 * 1024 * 1024; // posts are refused past this
// The sender name the local CLI posts under. A token may never carry it: its
// messages would be indistinguishable from this side's own.
export const LOCAL_SENDER = 'claude';
export const MAX_BODY_CHARS = 200_000;
const AGENT = /^[a-z][a-z0-9-]{0,30}$/;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export function openDb(path = DEFAULT_DB) {
  process.umask(0o077);
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS tokens (
      id           TEXT PRIMARY KEY,
      agent        TEXT NOT NULL,
      hash         TEXT NOT NULL UNIQUE,   -- sha256 of the token; the token itself is never stored
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      revoked_at   TEXT,
      last_used_at TEXT,
      last_ip      TEXT,
      note         TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sender     TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      token_id   TEXT,                     -- which credential posted it; NULL for the local CLI
      ip         TEXT
    );
    CREATE TABLE IF NOT EXISTS cursors (
      reader  TEXT PRIMARY KEY,
      last_id INTEGER NOT NULL
    );
  `);
  return db;
}

// ---- tokens ---------------------------------------------------------------

export function createToken(db, agent, ttlMs, note = null) {
  if (!AGENT.test(agent)) throw new Error(`agent name must match ${AGENT}`);
  if (agent === LOCAL_SENDER) throw new Error(`"${agent}" is reserved for the local side`);
  if (!(ttlMs > 0)) throw new Error('ttl must be positive');
  const id = randomBytes(3).toString('hex');
  const token = `rly_${id}_${randomBytes(32).toString('base64url')}`;
  const expires_at = new Date(Date.now() + ttlMs).toISOString();
  db.prepare('INSERT INTO tokens (id, agent, hash, created_at, expires_at, note) VALUES (?,?,?,?,?,?)')
    .run(id, agent, sha(token), now(), expires_at, note);
  return { id, agent, token, expires_at };
}

// -> { ok: true, token: row } | { ok: false, reason }
export function checkToken(db, presented) {
  if (typeof presented !== 'string' || !/^rly_[0-9a-f]{6}_[A-Za-z0-9_-]{43}$/.test(presented)) {
    return { ok: false, reason: 'malformed token' };
  }
  const row = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha(presented));
  if (!row) return { ok: false, reason: 'unknown token' };
  if (row.revoked_at) return { ok: false, reason: 'token revoked' };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: 'token expired' };
  return { ok: true, token: row };
}

export function touchToken(db, id, ip) {
  db.prepare('UPDATE tokens SET last_used_at = ?, last_ip = ? WHERE id = ?').run(now(), ip, id);
}

export function listTokens(db) {
  return db.prepare('SELECT id, agent, created_at, expires_at, revoked_at, last_used_at, last_ip, note FROM tokens ORDER BY created_at').all();
}

// `which` is a token id, an agent name, or '--all'. Returns how many were live.
export function revokeTokens(db, which) {
  const where = which === '--all' ? '1=1' : '(id = ? OR agent = ?)';
  const args = which === '--all' ? [] : [which, which];
  return db.prepare(`UPDATE tokens SET revoked_at = ? WHERE revoked_at IS NULL AND ${where}`).run(now(), ...args).changes;
}

// ---- messages -------------------------------------------------------------

export function addMessage(db, sender, body, { tokenId = null, ip = null } = {}) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('message body is empty');
  if (body.length > MAX_BODY_CHARS) throw new Error(`message body over ${MAX_BODY_CHARS} characters`);
  if (body.includes('\u0000')) throw new Error('message body contains a NUL character');
  const created_at = now();
  const r = db.prepare('INSERT INTO messages (sender, body, created_at, token_id, ip) VALUES (?,?,?,?,?)')
    .run(sender, body, created_at, tokenId, ip);
  return { id: Number(r.lastInsertRowid), sender, created_at };
}

export function dbBytes(db) {
  return db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
}

export function getMessage(db, id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// Ascending by id. With `after`, the next `limit` messages past it; without,
// the most recent `limit`.
export function getMessages(db, { after = null, limit = 20 } = {}) {
  if (after !== null) {
    return db.prepare('SELECT * FROM messages WHERE id > ? ORDER BY id LIMIT ?').all(after, limit);
  }
  return db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

// Messages `reader` has not seen that someone else sent.
export function unreadFor(db, reader) {
  const cur = db.prepare('SELECT last_id FROM cursors WHERE reader = ?').get(reader)?.last_id ?? 0;
  return db.prepare('SELECT * FROM messages WHERE id > ? AND sender != ? ORDER BY id').all(cur, reader);
}

export function markRead(db, reader, id) {
  db.prepare(`INSERT INTO cursors (reader, last_id) VALUES (?, ?)
              ON CONFLICT(reader) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).run(reader, id);
}

// ---- display (the local CLI) ----------------------------------------------

// Bodies are written by the other side and read by a model in a terminal.
// Control characters are shown as \xNN so nothing reaches the terminal as an
// escape sequence, and every body line is prefixed, so a body cannot draw
// something that reads as the header of another message: a real header is
// the only line that starts at column 0.
export const clean = (s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
export function formatMessage(m, { maxChars = 0 } = {}) {
  // Every field is cleaned, not only the body: the database is written by the
  // server's uid, which is not this reader's.
  const f = (v) => clean(String(v)).replace(/\n/g, ' ');
  const via = m.token_id ? `  [via token ${f(m.token_id)}, from ${f(m.ip)}]` : '  [local]';
  let body = String(m.body).trimEnd();
  let note = [];
  if (maxChars && body.length > maxChars) {
    note = [`  [truncated: ${body.length - maxChars} more characters. Full text: relay show ${f(m.id)} > <file>]`];
    body = body.slice(0, maxChars);
  }
  const lines = clean(body).split('\n').map((line) => `  │ ${line}`);
  return [`──── #${f(m.id)}  ${f(m.sender)}  ${f(m.created_at)}${via}`, ...lines, ...note, ''].join('\n');
}
