// Relay's storage: one SQLite file, three tables. Shared by server.mjs (the
// HTTP side an outside agent talks to) and cli.mjs (the side a Claude Code
// session on this box talks to). No dependencies: node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, statSync } from 'node:fs';

// Under /var/lib, not /srv/benloe/data, which claude-worker owns. /var/lib is
// root-owned, and /var/lib/benloe-relay itself belongs to the `relay` user
// with group `relay` and mode 2770 (install.sh), so the only uids that can
// replace the database are the two that are meant to write it: `relay` (the
// server) and `relay-cli` (the local command), plus root.
export const DEFAULT_DB = process.env.RELAY_DB || '/var/lib/benloe-relay/relay.db';
export const MAX_DB_BYTES = 200 * 1024 * 1024; // posts are refused past this
// The sender name the local CLI posts under. A token may never carry it: its
// messages would be indistinguishable from this side's own.
export const LOCAL_SENDER = 'claude';
export const MAX_BODY_CHARS = 200_000;
// The longest a token may live. A token is assumed to leak (it sits in the
// outside agent's logs), and a bounded lifetime also keeps every expiry a
// four-digit year, which is the only form of date this file ever writes.
export const MAX_TTL_MS = 90 * 86_400_000;
const AGENT = /^[a-z][a-z0-9-]{0,30}$/;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export function openDb(path = DEFAULT_DB) {
  // The server and the local command are different uids sharing this file
  // through their group, so it must be writable by the group and closed to
  // everyone else. SQLite creates a database as 0644 less the umask (0640
  // here), and gives -wal and -shm the database file's own mode whatever the
  // umask is. So the side that owns the database (the one that created it)
  // opens it to the group here, before the first write makes those two
  // files, and they follow. A database the other uid owns is left alone:
  // only an owner can chmod, and that side has already done it.
  process.umask(0o007);
  const db = new DatabaseSync(path);
  const st = statSync(path);
  if (st.uid === process.geteuid?.() && (st.mode & 0o777) !== 0o660) chmodSync(path, 0o660);
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
  if (!(ttlMs <= MAX_TTL_MS)) throw new Error(`ttl is at most ${MAX_TTL_MS / 86_400_000} days`);
  const id = randomBytes(3).toString('hex');
  const token = `rly_${id}_${randomBytes(32).toString('base64url')}`;
  const expires_at = new Date(Date.now() + ttlMs).toISOString();
  db.prepare('INSERT INTO tokens (id, agent, hash, created_at, expires_at, note) VALUES (?,?,?,?,?,?)')
    .run(id, agent, sha(token), now(), expires_at, note);
  return { id, agent, token, expires_at };
}

// The one test of expiry, used to accept a token, to list it and to revoke
// it: true only if expires_at parses as a date and that date is in the
// future. A value that does not parse (NaN) fails this test; it does not
// slip past it.
export const notExpired = (row) => Date.parse(row.expires_at) > Date.now();

// -> { ok: true, token: row } | { ok: false, reason }
export function checkToken(db, presented) {
  if (typeof presented !== 'string' || !/^rly_[0-9a-f]{6}_[A-Za-z0-9_-]{43}$/.test(presented)) {
    return { ok: false, reason: 'malformed token' };
  }
  const row = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha(presented));
  if (!row) return { ok: false, reason: 'unknown token' };
  if (row.revoked_at) return { ok: false, reason: 'token revoked' };
  if (!notExpired(row)) return { ok: false, reason: 'token expired' };
  return { ok: true, token: row };
}

export function touchToken(db, id, ip) {
  db.prepare('UPDATE tokens SET last_used_at = ?, last_ip = ? WHERE id = ?').run(now(), ip, id);
}

export function listTokens(db) {
  return db.prepare('SELECT id, agent, created_at, expires_at, revoked_at, last_used_at, last_ip, note FROM tokens ORDER BY created_at').all();
}

// `which` is a token id, an agent name, or '--all'. Revokes the matching
// tokens that checkToken would still accept (not revoked, not expired, by the
// same test it uses) and returns how many that was. A token that is already
// dead is left as it is.
export function revokeTokens(db, which) {
  const rows = which === '--all'
    ? db.prepare('SELECT id, expires_at FROM tokens WHERE revoked_at IS NULL').all()
    : db.prepare('SELECT id, expires_at FROM tokens WHERE revoked_at IS NULL AND (id = ? OR agent = ?)').all(which, which);
  const stamp = db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
  const at = now();
  let n = 0;
  for (const row of rows.filter(notExpired)) n += stamp.run(at, row.id).changes;
  return n;
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
// something that reads as the header of another message: a line that begins
// with ──── at column 0 is always a real header.
export const clean = (s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
// The same, on one line: for a value that must not be able to start a new line.
export const cleanLine = (v) => clean(String(v)).replace(/\n/g, '\\n');
// maxChars bounds the PRINTED size of the body (after escaping, with the line
// prefixes), so a caller can budget on the length of what this returns.
export function formatMessage(m, { maxChars = 0 } = {}) {
  // Every field is cleaned, not only the body: whatever wrote the row, the
  // reader is a root session and trusts none of it.
  const f = (v) => clean(String(v)).replace(/\n/g, ' ');
  const via = m.token_id ? `  [via token ${f(m.token_id)}, from ${f(m.ip)}]` : '  [local]';
  const all = clean(String(m.body).trimEnd()).split('\n');
  const lines = [];
  let used = 0;
  let cut = false;
  for (const line of all) {
    const room = maxChars ? maxChars - used - 5 : Infinity;
    if (room <= 0) {
      cut = true;
      break;
    }
    const text = line.length > room ? line.slice(0, room) : line;
    lines.push(`  │ ${text}`);
    used += text.length + 5;
    if (text.length < line.length) {
      cut = true;
      break;
    }
  }
  const note = cut ? [`  [truncated: message is ${String(m.body).length} characters. Full text: relay show ${f(m.id)} > <file>]`] : [];
  return [`──── #${f(m.id)}  ${f(m.sender)}  ${f(m.created_at)}${via}`, ...lines, ...note, ''].join('\n');
}

/**
 * One `relay inbox` call: the unread messages that fit the print budget.
 * Nothing is marked here. The caller prints `text` and then calls
 * markRead(db, reader, upTo), so a message is only ever marked read after it
 * has been written out. What did not fit stays unread.
 * -> { total, text: [...], left, upTo }
 */
export function inboxBatch(db, reader, limits) {
  const msgs = unreadFor(db, reader);
  if (!msgs.length) return { total: 0, text: [], left: 0, upTo: null };
  const { text, shown } = formatWithin(msgs, limits);
  return { total: msgs.length, text, left: msgs.length - shown.length, upTo: shown.at(-1).id };
}

// Formats messages until `budget` printed characters are used (always at
// least one). -> { text: [...], shown: [...messages] }
export function formatWithin(msgs, { perMessage, budget }) {
  const text = [];
  const shown = [];
  let used = 0;
  for (const m of msgs) {
    const t = formatMessage(m, { maxChars: perMessage });
    if (shown.length && used + t.length > budget) break;
    used += t.length;
    text.push(t);
    shown.push(m);
  }
  return { text, shown };
}
