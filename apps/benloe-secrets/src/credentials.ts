/* ============================================================================
   Credential storage, AES-256-GCM at rest.

   Lifted from apps/cabinet/server/src/domains/credentials.ts, which was already
   careful and correct. What changed is not the crypto — it is WHERE THIS RUNS.

   In Cabinet, this module lived inside the process the agent drives, holding a
   key the agent's own source could stop scrubbing. Here it runs as uid
   cabinet-secrets, from a root-owned code tree, against a database in
   /var/lib/cabinet-secrets that claude-worker cannot open. The agent can ask
   this service to USE a credential; there is no code path, anywhere in this
   repo, by which it can be handed one.

   That is the entire point of the split, so the rule is worth restating in the
   place it is enforced:

     decryptSecret() is module-private to the broker. Nothing it returns may
     leave this process except as bytes on an outbound TLS connection to the
     third party the credential belongs to.

   ========================================================================== */
import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;
/** 96 bits — the GCM-native IV size. Any other length pushes the cipher through
 *  GHASH to derive the counter block: slower, and outside the well-analyzed
 *  case. Freshly drawn per write; never reused. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

/** Lowercase slug — this is both a lookup key and a URL path segment. */
export const CREDENTIAL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class CredentialKeyError extends Error {}
export class CredentialAuthError extends Error {}

export interface CredentialInput {
  name: string;
  description?: string | null;
  /** Plaintext. Never stored, never returned, never logged. */
  secret: string;
}

/**
 * The public shape. Note what is absent: ciphertext, iv, auth_tag, secret.
 * If a value type-checks as CredentialMeta it is safe to serialise anywhere.
 */
export interface CredentialMeta {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
}

export interface PutResult {
  name: string;
  /** False when an existing name was overwritten — i.e. a rotation. */
  created: boolean;
}

export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS credential (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      ciphertext  BLOB NOT NULL,
      iv          BLOB NOT NULL,
      auth_tag    BLOB NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      rotated_at  TEXT
    );
  `);

  // 2026-08-03: `provider` dropped. It was stored and displayed but never read
  // by any logic — redundant with the naming convention that already encodes
  // it (`plaid-secret` says "Plaid" perfectly well). CREATE TABLE IF NOT EXISTS
  // won't alter an existing table, so an already-deployed database needs this
  // explicit drop. Guarded by a column check so it is idempotent.
  const hasProvider = (db.prepare('PRAGMA table_info(credential)').all() as { name: string }[]).some(
    (c) => c.name === 'provider',
  );
  if (hasProvider) db.exec('ALTER TABLE credential DROP COLUMN provider');
}

/**
 * Load the key from a file, not the environment.
 *
 * Deliberate difference from Cabinet's version, which read CABINET_CRED_KEY out
 * of process.env and then had to scrub it. An env var is inherited by every
 * child process and is visible in a process's own /proc/<pid>/environ; the
 * scrub was a workaround for having put it somewhere inherently leaky. A file
 * readable only by this uid has neither problem, and it means an operator can
 * rotate the key without rewriting a PM2 config.
 *
 * A present-but-malformed key THROWS rather than reading as "unconfigured":
 * treating a truncated key as absent would silently drop the broker into a
 * degraded mode where every existing row fails to decrypt while looking like a
 * configuration question rather than an alarm.
 */
export function loadKey(readFile: (p: string) => string, path: string): Buffer | null {
  let raw: string;
  try {
    raw = readFile(path).trim();
  } catch {
    return null; // genuinely absent — the broker runs metadata-only
  }
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new CredentialKeyError('key file is not valid base64.');
  }
  if (key.length !== KEY_BYTES) {
    // Length only. Key material must never reach an exception string that
    // something upstream will cheerfully log.
    throw new CredentialKeyError(
      `key must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

function requireKey(key: Buffer | null): Buffer {
  if (!key) {
    throw new CredentialKeyError('No key loaded — the broker is in read-metadata-only mode and cannot encrypt or decrypt.');
  }
  if (key.length !== KEY_BYTES) throw new CredentialKeyError(`Key must be ${KEY_BYTES} bytes.`);
  return key;
}

/**
 * Bind each ciphertext to the name it is filed under, as GCM additional
 * authenticated data. Authenticated but not encrypted, so it is free, and it
 * buys one specific defence: someone with write access to the database but not
 * the key cannot move the 'plaid-sandbox-secret' ciphertext onto the
 * 'plaid-production-secret' row and have the proxy use it. The tag check fails.
 *
 * Consequence: a credential cannot be renamed in place. A rename is a new
 * binding, which is correct.
 */
function aad(name: string): Buffer {
  return Buffer.from(name, 'utf8');
}

export function putCredential(db: Database.Database, key: Buffer | null, input: CredentialInput): PutResult {
  const k = requireKey(key);
  const name = input.name?.trim() ?? '';
  if (!CREDENTIAL_NAME_RE.test(name)) {
    throw new Error(`Invalid credential name '${name}' — expected a lowercase slug like 'plaid-secret'.`);
  }
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    // Says nothing about the value. Even "too short" is a fact about a secret.
    throw new Error('A non-empty secret is required.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  cipher.setAAD(aad(name));
  const ciphertext = Buffer.concat([cipher.update(input.secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const existed = !!db.prepare('SELECT 1 FROM credential WHERE name = ?').get(name);
  db.prepare(
    `INSERT INTO credential (name, description, ciphertext, iv, auth_tag)
     VALUES (?,?,?,?,?)
     ON CONFLICT(name) DO UPDATE SET
       description = COALESCE(excluded.description, credential.description),
       ciphertext  = excluded.ciphertext,
       iv          = excluded.iv,
       auth_tag    = excluded.auth_tag,
       updated_at  = datetime('now'),
       rotated_at  = datetime('now')`,
  ).run(name, input.description ?? null, ciphertext, iv, tag);

  return { name, created: !existed };
}

/* ---------------------------------------------------------------------------
   ⚠ THE ONE DECRYPT PATH ⚠

   Not exported from the package barrel, and imported by exactly one module:
   src/plaid.ts, which uses it to fill in an outbound request to Plaid and then
   drops it. No route handler, no broker RPC, no log line and no error message
   may carry this function's return value.

   The reviewer's tripwire from Cabinet's original still applies, tightened: any
   diff that imports decryptSecret into src/dashboard.ts or src/broker.ts is
   wrong on its face, and there is a test that fails if it happens
   (test/no-secret-egress.test.ts).
   --------------------------------------------------------------------------- */
export function decryptSecret(db: Database.Database, key: Buffer | null, name: string): string | null {
  const k = requireKey(key);
  const row = db
    .prepare('SELECT ciphertext, iv, auth_tag FROM credential WHERE name = ?')
    .get(name) as { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer } | undefined;
  if (!row) return null;

  if (row.auth_tag.length !== TAG_BYTES || row.iv.length !== IV_BYTES) {
    throw new CredentialAuthError(`Credential '${name}' has a malformed iv/auth_tag — the row is corrupt.`);
  }

  const decipher = createDecipheriv(ALGO, k, row.iv);
  decipher.setAAD(aad(name));
  decipher.setAuthTag(row.auth_tag);
  let plaintext: string;
  try {
    plaintext = decipher.update(row.ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    // Underlying message swallowed on purpose: this catch is the boundary where
    // a future crypto error string could carry fragments of state into a stack
    // trace someone logs.
    throw new CredentialAuthError(
      `Credential '${name}' failed authentication — wrong key, tampered row, or corrupted storage.`,
    );
  }

  touchCredential(db, name);
  return plaintext;
}

/**
 * METADATA ONLY — the read the dashboard, the broker RPC and (transitively) the
 * agent may use. Columns are spelled out rather than SELECT * for one reason
 * worth the extra line: with *, the day someone adds a column is the day
 * ciphertext starts appearing in an API response. An explicit list fails safe.
 */
export function listCredentials(db: Database.Database): CredentialMeta[] {
  return db
    .prepare(
      `SELECT id, name, description, created_at, updated_at, last_used_at, rotated_at
       FROM credential ORDER BY name`,
    )
    .all() as CredentialMeta[];
}

export function getCredentialMeta(db: Database.Database, name: string): CredentialMeta | null {
  const row = db
    .prepare(
      `SELECT id, name, description, created_at, updated_at, last_used_at, rotated_at
       FROM credential WHERE name = ?`,
    )
    .get(name) as CredentialMeta | undefined;
  return row ?? null;
}

/** Needs no key: deleting ciphertext you cannot read is still deleting it. */
export function deleteCredential(db: Database.Database, name: string): boolean {
  return db.prepare('DELETE FROM credential WHERE name = ?').run(name).changes > 0;
}

export function touchCredential(db: Database.Database, name: string): boolean {
  return db.prepare(`UPDATE credential SET last_used_at = datetime('now') WHERE name = ?`).run(name).changes > 0;
}

/**
 * Constant-time comparison against a stored credential, for the case where the
 * broker VERIFIES a secret (an inbound webhook signature) rather than presents
 * one. Exists so that case never becomes a reason to call decryptSecret and
 * compare with ===, which leaks the prefix through timing and puts plaintext in
 * a local variable at a call site nobody audited.
 */
export function verifyCredential(db: Database.Database, key: Buffer | null, name: string, candidate: string): boolean {
  const actual = decryptSecret(db, key, name);
  if (actual === null) return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
