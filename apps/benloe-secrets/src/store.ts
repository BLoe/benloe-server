/* ============================================================================
   Secret storage: many named sets, each a plaintext document, AES-256-GCM at
   rest.

   This is the "plaintext mode" that AWS Secrets Manager offers and that every
   operator actually uses for server config: the secret IS the file. One
   textarea, one document, one save. There is no per-key CRUD, no naming scheme
   and no per-entry rotation ceremony, because the thing being managed is a set
   of environment variables that are edited together and consumed together.

   WHAT MAKES IT MANY DOCUMENTS AND NOT ONE. A single document means every
   consumer that can read the file can read every credential on the box. Split
   it per app and the scoping stops being a rule written in source and becomes
   the shape of the data: kickball cannot read the Mailgun key because that key
   is in the 'cabinet' set, not because some list here says so. The one set
   named `shared` holds the values several apps must agree on (JWT_SECRET,
   AUTH_SERVICE_URL) and is merged under each app's own set by the materialiser.

   WHAT THE ENCRYPTION BUYS, stated honestly. The consumers of these values are
   ordinary services running as root, so this is not confidentiality from root:
   root can read the key file and the rendered env alike. It buys three real
   things — no plaintext secrets inside a git working tree, one durable copy
   that only one uid can open, and a version history so a bad edit is one click
   from being undone.

   Every save appends a version and keeps the previous one, and that is
   deliberate. For a textarea holding credentials, the realistic accident is not
   a leak, it is a paste that silently drops twenty lines. The answer to that is
   history, not a confirmation dialog.
   ========================================================================== */
import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
/** 96 bits — the GCM-native IV size. Freshly drawn per write; never reused. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

/** The set whose keys every other set inherits. Never rendered on its own —
 *  it has no consumer of its own, only defaults for the sets that do. */
export const SHARED_SET = 'shared';

/** A set name becomes a filename in /run and a path component in the URL, so
 *  it is kept to the boring intersection: lowercase, digits, dashes, leading
 *  letter. Nothing here can traverse a directory or need escaping. */
export const SET_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** Bound on a single document: generous against any real env file, and it
 *  stops a runaway paste from filling the disk. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

export class SecretKeyError extends Error {}
export class SecretAuthError extends Error {}

export interface SetMeta {
  name: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
  key_count: number;
  byte_length: number;
}

export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS secret_set (
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL,
      ciphertext  BLOB NOT NULL,
      iv          BLOB NOT NULL,
      auth_tag    BLOB NOT NULL,
      byte_length INTEGER NOT NULL,
      key_count   INTEGER NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by  TEXT,
      PRIMARY KEY (name, version)
    );
  `);
}

/**
 * Load the key from a file, not the environment.
 *
 * An env var is inherited by every child process and is visible in that
 * process's own /proc/<pid>/environ. A file readable only by this uid has
 * neither problem, and the key can be rotated without editing a PM2 config.
 *
 * A present-but-malformed key THROWS rather than reading as "unconfigured".
 * Treating a truncated key as absent would drop the service into a mode where
 * the stored sets cannot be read, while looking like a configuration question
 * rather than an alarm.
 */
export function loadKey(readFile: (p: string) => string, path: string): Buffer | null {
  let raw: string;
  try {
    raw = readFile(path).trim();
  } catch {
    return null; // genuinely absent
  }
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new SecretKeyError('key file is not valid base64.');
  }
  if (key.length !== KEY_BYTES) {
    // Length only. Key material must never reach an exception string that
    // something upstream will cheerfully log.
    throw new SecretKeyError(
      `key must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

function requireKey(key: Buffer | null): Buffer {
  if (!key) throw new SecretKeyError('No key loaded — cannot encrypt or decrypt.');
  if (key.length !== KEY_BYTES) throw new SecretKeyError(`Key must be ${KEY_BYTES} bytes.`);
  return key;
}

function requireName(name: string): string {
  if (typeof name !== 'string' || !SET_NAME_RE.test(name)) {
    throw new Error(`Invalid set name ${JSON.stringify(name)} — expected ${SET_NAME_RE}.`);
  }
  return name;
}

/**
 * Bind each ciphertext to BOTH its set name and its version as GCM additional
 * authenticated data. Authenticated but not encrypted, so it costs nothing.
 *
 * Two attacks it closes for someone with write access to the database but not
 * the key: copying an old row over a newer one to roll a set back, and copying
 * a row from a privileged set into an unprivileged one to make its plaintext
 * render into a file that app is allowed to read. Both fail the tag check.
 */
function aad(name: string, version: number): Buffer {
  return Buffer.from(`${name}@v${version}`, 'utf8');
}

/**
 * Parse an env document into ordered key/value pairs.
 *
 * Deliberately the shape every consumer's dotenv call already accepts:
 * `KEY=value`, `#` comments, blank lines, optional surrounding quotes. The
 * value is taken verbatim after the FIRST `=`, so base64 and PEM material with
 * `=` padding survives intact.
 *
 * Later duplicates win, matching dotenv, so an override appended at the bottom
 * of the file does what an operator expects.
 */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

const META_COLS = 'name, version, updated_at, updated_by, key_count, byte_length';

/**
 * One row per set — its newest version only, name ASC. This is the index the
 * dashboard lists from, and it carries no material: counts and timestamps
 * describe a set without opening it.
 */
export function listSets(db: Database.Database): SetMeta[] {
  return db
    .prepare(
      `SELECT ${META_COLS} FROM secret_set
       WHERE version = (SELECT MAX(version) FROM secret_set s2 WHERE s2.name = secret_set.name)
       ORDER BY name ASC`,
    )
    .all() as SetMeta[];
}

/** Every stored version of one set, newest first. Also carries no material. */
export function listVersions(db: Database.Database, name: string): SetMeta[] {
  return db
    .prepare(`SELECT ${META_COLS} FROM secret_set WHERE name = ? ORDER BY version DESC`)
    .all(requireName(name)) as SetMeta[];
}

function currentVersion(db: Database.Database, name: string): number | null {
  const row = db.prepare('SELECT MAX(version) AS v FROM secret_set WHERE name = ?').get(name) as {
    v: number | null;
  };
  return row?.v ?? null;
}

export function saveSet(
  db: Database.Database,
  key: Buffer | null,
  name: string,
  text: string,
  updatedBy: string | null,
): SetMeta {
  const k = requireKey(key);
  requireName(name);
  if (typeof text !== 'string') throw new Error('A document is required.');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is ${byteLength} bytes; the limit is ${MAX_DOCUMENT_BYTES}.`);
  }
  const keyCount = parseEnv(text).size;

  // The version is part of the authenticated data, so it has to be known
  // before the encrypt rather than assigned by the insert. Versions run per
  // set: saving 'cabinet' does not bump 'kickball'.
  const version = (currentVersion(db, name) ?? 0) + 1;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  cipher.setAAD(aad(name, version));
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  db.prepare(
    `INSERT INTO secret_set (name, version, ciphertext, iv, auth_tag, byte_length, key_count, updated_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(name, version, ciphertext, iv, tag, byteLength, keyCount, updatedBy);

  // Read back rather than synthesising updated_at, so the timestamp callers see
  // is the one SQLite actually wrote.
  return db
    .prepare(`SELECT ${META_COLS} FROM secret_set WHERE name = ? AND version = ?`)
    .get(name, version) as SetMeta;
}

/**
 * Decrypt one stored set.
 *
 * Unlike the credential broker alongside this, returning plaintext IS the job:
 * these are environment variables and every consumer needs them verbatim. The
 * boundary that matters is therefore not this function but who can reach its
 * callers. There are exactly two — the owner-authenticated dashboard, and the
 * materialiser that renders the tmpfs env files — and both live in this
 * process, behind this uid.
 */
export function readSet(
  db: Database.Database,
  key: Buffer | null,
  name: string,
  version?: number,
): string | null {
  const k = requireKey(key);
  requireName(name);
  const v = version ?? currentVersion(db, name);
  if (v === null) return null;
  const row = db
    .prepare('SELECT name, version, ciphertext, iv, auth_tag FROM secret_set WHERE name = ? AND version = ?')
    .get(name, v) as
    | { name: string; version: number; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }
    | undefined;
  if (!row) return null;

  if (row.auth_tag.length !== TAG_BYTES || row.iv.length !== IV_BYTES) {
    throw new SecretAuthError(`${name} v${v} has a malformed iv/auth_tag — the row is corrupt.`);
  }

  const decipher = createDecipheriv(ALGO, k, row.iv);
  // AAD comes from where the row LIVES, not from anything stored inside it, so
  // a row carried into another set or another version cannot bring its own
  // matching AAD along.
  decipher.setAAD(aad(name, v));
  decipher.setAuthTag(row.auth_tag);
  try {
    return decipher.update(row.ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    // Underlying message swallowed on purpose: this catch is the boundary where
    // a crypto error string could carry fragments of state into a stack trace
    // someone logs.
    throw new SecretAuthError(
      `${name} v${v} failed authentication — wrong key, tampered row, or corrupted storage.`,
    );
  }
}

/**
 * Current plaintext of every set, keyed by name. This is what the materialiser
 * takes: rendering is all-or-nothing because a partial render would leave some
 * app's file describing a state that never existed.
 */
export function readAllSets(db: Database.Database, key: Buffer | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const meta of listSets(db)) {
    const text = readSet(db, key, meta.name, meta.version);
    if (text !== null) out.set(meta.name, text);
  }
  return out;
}

/**
 * Drop a set entirely, history included. The one operation here that destroys
 * rather than appends — used when an app is retired, so its credentials stop
 * being carried forward in every backup of this database.
 */
export function deleteSet(db: Database.Database, name: string): boolean {
  const info = db.prepare('DELETE FROM secret_set WHERE name = ?').run(requireName(name));
  return info.changes > 0;
}
