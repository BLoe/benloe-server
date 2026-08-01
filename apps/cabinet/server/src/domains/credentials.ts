/* ============================================================================
   Integration credentials, encrypted at rest with AES-256-GCM.

   The charter rule this module exists to enforce, stated once here so it never
   has to be re-derived at a call site:

     A decrypted secret may travel from this file into integration code and
     nowhere else. Not into a response body, not into an MCP tool result, not
     into a log line, not into an error message, not into agent chat context.

   Everything below is shaped around that. `listCredentials` — the ONLY read
   the UI, the routes and the agent are allowed to touch — enumerates its
   columns explicitly so a future column cannot silently join the payload.
   `getCredentialSecret` is the single decrypt path, and it is deliberately not
   re-exported anywhere near a route module.

   The key never touches the database or the repo: it comes from
   CABINET_CRED_KEY in the process environment (see credKey). When that
   variable is absent Cabinet runs DEGRADED rather than broken — metadata reads
   keep working, so "is Plaid configured?" is answerable, while every write and
   every decrypt fails loudly. Silent degradation would be the worst of both:
   Ben thinks a token is stored and it isn't.
   ========================================================================== */
import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256 needs exactly this many key bytes; anything else is a misconfiguration, not a fallback. */
const KEY_BYTES = 32;
/**
 * 96 bits, the GCM-native IV size. Not 128: any other length forces the cipher
 * through GHASH to derive the counter block, which is both slower and outside
 * the well-analyzed case. Never reused — a fresh one is drawn per write.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

/** Lowercase slug: it is a lookup key in code and a URL path segment in the routes. */
export const CREDENTIAL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Thrown when the store is asked to do something that needs the key it doesn't
 * have (or has in a broken form). A distinct class so callers can map it to a
 * 503 "not configured" instead of a generic 500 — the difference between
 * "Cabinet is misconfigured" and "Cabinet is broken" matters at 2am.
 */
export class CredentialKeyError extends Error {}
/** Thrown when ciphertext fails GCM authentication — tampering, wrong key, or a corrupted row. */
export class CredentialAuthError extends Error {}

export interface CredentialInput {
  name: string;
  provider?: string | null;
  description?: string | null;
  /** The plaintext. Never stored, never returned, never logged. */
  secret: string;
}

/**
 * The public shape of a credential. Note what is NOT here: ciphertext, iv,
 * auth_tag, and obviously the secret. This type is the contract that lets a
 * route or a tool hand a credential list to the agent without a second
 * thought — if it type-checks as CredentialMeta, it is safe to render.
 */
export interface CredentialMeta {
  id: number;
  name: string;
  provider: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
}

export interface PutResult {
  name: string;
  /** False when an existing name was overwritten — i.e. this was a rotation. */
  created: boolean;
}

/**
 * The decryption key from the environment, or null when unconfigured.
 *
 * Read once at startup and passed down, rather than read at every call site:
 * a single `credKey(process.env)` at boot is one place to audit, and it keeps
 * the key out of the reach of any code that merely imports this module.
 *
 * A PRESENT-but-malformed key throws instead of returning null. Treating a
 * truncated or mistyped key as "unconfigured" would silently drop Cabinet into
 * degraded mode with no signal, and — far worse — a key of the wrong length
 * that still decoded would fail to decrypt every existing row while looking
 * like a configuration question rather than an alarm.
 */
export function credKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.CABINET_CRED_KEY?.trim();
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new CredentialKeyError('CABINET_CRED_KEY is not valid base64.');
  }
  if (key.length !== KEY_BYTES) {
    // Deliberately reports only the length. The key material itself must not
    // appear in an exception that something upstream will happily log.
    throw new CredentialKeyError(
      `CABINET_CRED_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

function requireKey(key: Buffer | null): Buffer {
  if (!key) {
    throw new CredentialKeyError(
      'CABINET_CRED_KEY is not set — the credential store is in read-metadata-only mode and cannot encrypt or decrypt.',
    );
  }
  if (key.length !== KEY_BYTES) {
    throw new CredentialKeyError(`Credential key must be ${KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * Bind each ciphertext to the name it is filed under, as GCM additional
 * authenticated data. The AAD is authenticated but not encrypted, so this
 * costs nothing and buys one specific defense: someone with write access to
 * cabinet.db (but not the key) cannot move the 'sandbox-plaid' ciphertext onto
 * the 'plaid-production' row and have the Plaid client happily use it. The tag
 * check fails, because the name it was sealed with no longer matches.
 *
 * Consequence worth knowing: a credential cannot be renamed in place. Renaming
 * means re-encrypting under the new name, which is correct — a rename is a new
 * binding, not a metadata edit.
 */
function aad(name: string): Buffer {
  return Buffer.from(name, 'utf8');
}

/**
 * Store (or rotate) a secret. Returns metadata only — there is nothing in the
 * return value a caller could accidentally echo back to a client.
 *
 * An existing `name` is overwritten in place: new ciphertext, new IV, new tag,
 * `rotated_at` stamped, `created_at` preserved. That combination is the point —
 * "this credential has existed since March and was last rotated in August" is a
 * question the security-conscious version of this table has to be able to
 * answer. provider/description fall back to their previous values when omitted,
 * so rotating a token from a script doesn't blank the human notes about it.
 */
export function putCredential(db: Database.Database, key: Buffer | null, input: CredentialInput): PutResult {
  const k = requireKey(key);
  const name = input.name?.trim() ?? '';
  if (!CREDENTIAL_NAME_RE.test(name)) {
    throw new Error(`Invalid credential name '${name}' — expected a lowercase slug like 'plaid-access-token'.`);
  }
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    // Note the message says nothing about the value. Even "secret too short"
    // is a fact about a secret; keep error text free of anything derived from it.
    throw new Error('A non-empty secret is required.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  cipher.setAAD(aad(name));
  const ciphertext = Buffer.concat([cipher.update(input.secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const existed = !!db.prepare('SELECT 1 FROM credential WHERE name = ?').get(name);
  db.prepare(
    `INSERT INTO credential (name, provider, description, ciphertext, iv, auth_tag)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(name) DO UPDATE SET
       provider    = COALESCE(excluded.provider, credential.provider),
       description = COALESCE(excluded.description, credential.description),
       ciphertext  = excluded.ciphertext,
       iv          = excluded.iv,
       auth_tag    = excluded.auth_tag,
       updated_at  = datetime('now'),
       rotated_at  = datetime('now')`,
  ).run(name, input.provider ?? null, input.description ?? null, ciphertext, iv, tag);

  return { name, created: !existed };
}

/* ---------------------------------------------------------------------------
   ⚠ THE ONE DECRYPT PATH — INTERNAL SERVER-SIDE USE ONLY ⚠

   No HTTP route, no MCP tool, no SSE event, no log line and no agent-visible
   string may carry this function's return value. It exists so that future
   integration code — a Plaid client, an insurance portal scraper — can obtain
   the token it needs at the moment it makes an outbound request, and then drop
   it. If you are reading this because you want to show Ben a secret in the UI:
   the answer is no. Show him `listCredentials` and let him paste a new one.

   Reviewer's tripwire: any diff that imports getCredentialSecret into
   src/gateway/** or src/mcp/** is wrong on its face.
   --------------------------------------------------------------------------- */
export function getCredentialSecret(db: Database.Database, key: Buffer | null, name: string): string | null {
  const k = requireKey(key);
  const row = db
    .prepare('SELECT ciphertext, iv, auth_tag FROM credential WHERE name = ?')
    .get(name) as { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer } | undefined;
  if (!row) return null;

  // GCM will reject a wrong-length tag anyway; checking first turns a corrupt
  // row into a clear diagnosis instead of a generic "unsupported state".
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
    // Swallow the underlying message on purpose: node's is harmless today, but
    // this catch is the boundary where a future crypto error string could carry
    // fragments of state into a stack trace someone logs.
    throw new CredentialAuthError(
      `Credential '${name}' failed authentication — wrong key, tampered row, or corrupted storage.`,
    );
  }

  // Reading a secret IS using it, so record it here rather than trusting every
  // future caller to remember. That is what makes last_used_at trustworthy
  // enough to answer "has this integration silently stopped running?".
  touchCredential(db, name);
  return plaintext;
}

/**
 * METADATA ONLY. This is the read the UI, the routes and the agent may use.
 *
 * The column list is spelled out rather than `SELECT *` for one reason that is
 * worth the extra line: with `*`, the day someone adds a column to
 * `credential` is the day ciphertext starts appearing in an API response and
 * in agent context. An explicit list fails safe — a new column is invisible
 * until a human deliberately adds it here.
 */
export function listCredentials(db: Database.Database): CredentialMeta[] {
  return db
    .prepare(
      `SELECT id, name, provider, description, created_at, updated_at, last_used_at, rotated_at
       FROM credential ORDER BY name`,
    )
    .all() as CredentialMeta[];
}

/** Metadata for one name, or null. Same explicit-column discipline as listCredentials. */
export function getCredentialMeta(db: Database.Database, name: string): CredentialMeta | null {
  const row = db
    .prepare(
      `SELECT id, name, provider, description, created_at, updated_at, last_used_at, rotated_at
       FROM credential WHERE name = ?`,
    )
    .get(name) as CredentialMeta | undefined;
  return row ?? null;
}

/** True if it existed and is now gone. Needs no key: deleting ciphertext you cannot read is still deleting it. */
export function deleteCredential(db: Database.Database, name: string): boolean {
  return db.prepare('DELETE FROM credential WHERE name = ?').run(name).changes > 0;
}

/**
 * Stamp last_used_at. getCredentialSecret already calls this, so the explicit
 * export is for the case it can't cover: integration code holding a cached or
 * long-lived session that hasn't needed to decrypt again but is demonstrably
 * still using the credential. Without that, a perfectly healthy integration
 * would look abandoned.
 */
export function touchCredential(db: Database.Database, name: string): boolean {
  return db.prepare(`UPDATE credential SET last_used_at = datetime('now') WHERE name = ?`).run(name).changes > 0;
}

/**
 * Constant-time comparison of a caller-supplied string against a stored
 * credential — for the case where Cabinet is the one VERIFYING a secret (an
 * inbound webhook signature, a shared ingest token) rather than presenting it.
 * Exists so that use case never becomes a reason to call getCredentialSecret
 * and compare with `===`, which leaks the secret's prefix through timing and,
 * more practically, puts the plaintext in a local variable at a call site
 * nobody audited.
 */
export function verifyCredential(db: Database.Database, key: Buffer | null, name: string, candidate: string): boolean {
  const actual = getCredentialSecret(db, key, name);
  if (actual === null) return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself be a signal;
  // compare lengths first and still run the constant-time compare when equal.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
