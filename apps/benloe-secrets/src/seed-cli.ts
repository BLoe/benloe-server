/**
 * One-shot migration: split the legacy single document into named sets.
 *
 * The store used to hold ONE encrypted env document — every key on the box in
 * one blob, rendered to one file that every service read. Scoping was then a
 * matter of pointing each unit at the same file and hoping. This turns that
 * blob into one set per app plus a `shared` set, after which scoping is the
 * shape of the data: kickball cannot read the Mailgun key because that key
 * lives in the `cabinet` set, not because some list in some source file says so.
 *
 * Reads the legacy `secret_document` table directly rather than through
 * store.ts, which no longer knows that table exists. The legacy AAD was
 * `v<version>` — the version alone, with no set name, because there were no
 * sets. That difference is exactly why this decrypt is written out longhand
 * here instead of being smuggled into readSet().
 *
 * Refuses to run if `secret_set` already has rows, so re-running it by accident
 * cannot clobber edits made in the dashboard since.
 */
import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createAuditLog } from './audit.js';
import { materialize } from './materialize.js';
import { loadKey, migrate, parseEnv, readAllSets, saveSet, SHARED_SET } from './store.js';

const DATA_DIR = process.env.BENLOE_SECRETS_DIR ?? '/var/lib/benloe-secrets';
const KEY_PATH = process.env.BENLOE_SECRETS_KEY_FILE ?? '/etc/benloe/benloe-secrets.key';
const RUNTIME_DIR = process.env.BENLOE_SECRETS_RUNTIME_DIR ?? '/run/benloe-secrets';

/**
 * WHERE THIS TABLE CAME FROM, so the next person can re-derive it rather than
 * trust it. Each app's own code was grepped for each of the 27 key names —
 * apps/<app>/{src,api/src,backend/src,server/src,web/src,scripts}, plus that
 * app's ecosystem config and .env.example, with node_modules and dist excluded
 * (they would otherwise contribute thousands of dependency variable names).
 * A key referenced by more than one app is DUPLICATED into each of those apps'
 * sets rather than put in `shared`, because `shared` reaches all thirteen. See
 * the note on SHARED_SET below for why that distinction turned out to matter.
 *
 * Two judgements the grep could not make on its own, both recorded here because
 * they are the ones a future reader would otherwise re-litigate:
 *
 *  - pr-reviewer's tests mention GITHUB_APP_ID / _INSTALLATION_ID /
 *    _PRIVATE_KEY_B64, but they mention them to assert that pr-reviewer REFUSES
 *    them: it authenticates as its own GitHub App, deliberately not Cabinet's.
 *    A negative reference is not a use, so those keys stay Cabinet-only.
 *  - artanis references ANTHROPIC_API_KEY only from scripts/, not from its
 *    running server. It makes no difference to the outcome — cabinet and
 *    sleeper-ui both use the key, so it is shared regardless — and is noted so
 *    the count below is reproducible.
 *
 * The empty arrays are not oversights. dada-api, fitness and weights-api use no
 * secret from this file at all — they authenticate by calling artanis rather
 * than by verifying a token themselves. They still get a set, because a set is
 * what produces their rendered file, and an app with no secrets should get an
 * empty file rather than somebody else's.
 */
const ALLOCATION: Record<string, string[]> = {
  // `shared` reaches EVERY app, so it earns exactly one member.
  //
  // The first draft of this table put all eight multi-app keys here, which
  // quietly handed kickball the Yahoo client secret and the artanis encryption
  // secret — the precise over-share this split exists to end. A key used by two
  // apps is duplicated into those two sets instead. That costs a second edit
  // when it rotates, and the dashboard shows the full effective key list per app
  // so the duplication is visible rather than folklore.
  //
  // It ends up with none.
  //
  // JWT_SECRET looked like the one genuine member — artanis mints the sessions
  // six other services verify, so they are broken the instant they disagree. But
  // `shared` reaches ALL thirteen sets, and that put the session signing key into
  // pr-reviewer.env. pr-reviewer feeds attacker-controlled text from public pull
  // requests to an agent. Whoever holds JWT_SECRET can forge a session for any
  // principal, including the owner — which is the credential this very dashboard
  // authenticates with. A prompt injection would have escalated from a public PR
  // to every secret on the box, through the one service most likely to be
  // manipulated.
  //
  // So it is duplicated into exactly the six services that verify sessions.
  // Rotating it means six edits instead of one; that is the correct trade, and
  // the dashboard shows each app's effective keys so the duplication is visible.
  [SHARED_SET]: [],
  artanis: ['MAILGUN_API_KEY', 'ANTHROPIC_API_KEY', 'ENCRYPTION_SECRET', 'JWT_SECRET'],
  cabinet: [
    'CABINET_CLAUDE_AUTH',
    'CABINET_OWNER_EMAIL',
    'CABINET_VAPID_PRIVATE_KEY',
    'CABINET_VAPID_PUBLIC_KEY',
    'CABINET_VAPID_SUBJECT',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY_B64',
    'ANTHROPIC_API_KEY',
    'ENCRYPTION_SECRET',
    'JWT_SECRET',
  ],
  'dada-api': [],
  'fantasy-hawk': ['BALLDONTLIE_API_KEY', 'YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET', 'JWT_SECRET'],
  fitness: [],
  gamenight: ['JWT_SECRET'],
  kickball: ['CABINET_OWNER_EMAIL'],
  'pr-reviewer': ['PR_REVIEWER_APP_ID', 'PR_REVIEWER_INSTALLATION_ID', 'PR_REVIEWER_PRIVATE_KEY_B64'],
  'sleeper-ui': ['ANTHROPIC_API_KEY', 'SLEEPER_LOGIN_ALLOW', 'SLEEPER_LOGIN_ENABLED', 'JWT_SECRET'],
  waker: ['SLEEPER_LOGIN_ALLOW', 'SLEEPER_LOGIN_ENABLED', 'JWT_SECRET'],
  'weights-api': [],
  'yahoo-fantasy-mcp': ['MCP_TOKEN_ENCRYPTION_KEY', 'MCP_TOKEN_SECRET', 'YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET'],
  // Keys no app references. They are kept — dropping a secret nobody can find a
  // caller for is how a service breaks four days later — but they are kept OUT
  // of everyone's reach. No app reads unassigned.env; it exists so the values
  // survive in the store and stay visible in the dashboard until someone can say
  // whether they are dead. Moving one into an app's set is a browser edit.
  unassigned: ['CARPENTER_APP_ID', 'CARPENTER_APP_INSTALLATION_ID', 'CARPENTER_APP_PRIVATE_KEY_B64', 'FITNESS_DATABASE_URL'],
};

/**
 * Keys no app's source mentions. They go to the `unassigned` set — carried
 * forward so nothing is silently lost, but reachable by nobody until someone
 * decides where they belong. CARPENTER_* looks like a retired GitHub App and
 * FITNESS_DATABASE_URL like a superseded connection string, but "looks like" is
 * not evidence, so they are kept and announced rather than deleted.
 */
const ORPHANS = ['CARPENTER_APP_ID', 'CARPENTER_APP_INSTALLATION_ID', 'CARPENTER_APP_PRIVATE_KEY_B64', 'FITNESS_DATABASE_URL'];

const ALGO = 'aes-256-gcm';

interface LegacyRow {
  version: number;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

/** Newest legacy document, or null if the table is absent or empty. */
function readLegacyDocument(db: Database.Database, key: Buffer): string | null {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='secret_document'`)
    .get();
  if (!exists) return null;

  const row = db
    .prepare('SELECT version, ciphertext, iv, auth_tag FROM secret_document ORDER BY version DESC LIMIT 1')
    .get() as LegacyRow | undefined;
  if (!row) return null;

  const decipher = createDecipheriv(ALGO, key, row.iv);
  decipher.setAAD(Buffer.from(`v${row.version}`, 'utf8'));
  decipher.setAuthTag(row.auth_tag);
  return decipher.update(row.ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/** Render a set's text from the pairs it owns. Values verbatim, keys sorted. */
function renderSet(names: string[], source: Map<string, string>): string {
  return (
    names
      .slice()
      .sort()
      .map((n) => `${n}=${source.get(n)}`)
      .join('\n') + '\n'
  );
}

function main(): number {
  const key = loadKey((p) => readFileSync(p, 'utf8'), KEY_PATH);
  if (!key) {
    console.error(`split: no key at ${KEY_PATH}`);
    return 1;
  }

  const db = new Database(join(DATA_DIR, 'secrets.db'));
  migrate(db);

  const already = db.prepare('SELECT COUNT(*) AS n FROM secret_set').get() as { n: number };
  if (already.n > 0) {
    console.error(`split: refusing — secret_set already has ${already.n} row(s). Edit the sets in the dashboard.`);
    return 1;
  }

  const text = readLegacyDocument(db, key);
  if (text === null) {
    console.error('split: no legacy document found — nothing to migrate.');
    return 1;
  }

  const source = parseEnv(text);
  console.log(`split: legacy document has ${source.size} keys.`);

  // THE INVARIANT. Every input key must land in at least one set, and no set
  // may claim a key the document does not have. Checked before a single row is
  // written, because a half-migrated store is worse than an unmigrated one:
  // the refusal below is recoverable by editing this table, whereas a key that
  // quietly vanished surfaces days later as an unexplained outage.
  const allocated = new Set<string>();
  const phantom: string[] = [];
  for (const [set, names] of Object.entries(ALLOCATION)) {
    for (const n of names) {
      if (!source.has(n)) phantom.push(`${n} (claimed by ${set})`);
      allocated.add(n);
    }
  }
  const missing = [...source.keys()].filter((k) => !allocated.has(k)).sort();

  if (missing.length || phantom.length) {
    console.error('split: REFUSING — the allocation does not cover the document exactly.');
    if (missing.length) console.error(`  keys in the document with no set: ${missing.join(', ')}`);
    if (phantom.length) console.error(`  keys allocated but not in the document: ${phantom.join(', ')}`);
    console.error('  Fix ALLOCATION in src/seed-cli.ts and re-run. Nothing has been written.');
    return 1;
  }

  const stillOrphaned = ORPHANS.filter((k) => source.has(k));
  if (stillOrphaned.length) {
    console.warn('');
    console.warn('split: ATTENTION — these keys match NO app and were put in `shared` rather than dropped:');
    for (const k of stillOrphaned) console.warn(`  ${k}`);
    console.warn('  Every app now receives them. Find their owner and move them, or delete them deliberately.');
    console.warn('');
  }

  // Names only, never values — this output is meant to be pasted into a review.
  console.log('split: allocation (key names only) —');
  for (const [set, names] of Object.entries(ALLOCATION)) {
    console.log(`  ${set} (${names.length}): ${names.length ? names.slice().sort().join(', ') : '— shared only'}`);
  }

  const audit = createAuditLog(join(DATA_DIR, 'audit.log'));
  for (const [set, names] of Object.entries(ALLOCATION)) {
    const saved = saveSet(db, key, set, renderSet(names, source), 'migrate:secret_document');
    audit({
      via: 'boot',
      action: 'set.save',
      ok: true,
      version: saved.version,
      key_count: saved.key_count,
      byte_length: saved.byte_length,
      actor: 'migrate:secret_document',
    });
    console.log(`split: stored ${set} v${saved.version} — ${saved.key_count} keys, ${saved.byte_length} bytes`);
  }

  // Render from the STORE, not from ALLOCATION, so the files reflect what was
  // actually persisted and a bad write cannot hide behind a correct plan.
  const { written, effective } = materialize(readAllSets(db, key), RUNTIME_DIR);
  for (const [path, n] of Object.entries(written)) console.log(`split: rendered ${path} (${n} keys)`);
  for (const [set, names] of Object.entries(effective)) console.log(`split: ${set}.env sees ${names.join(', ')}`);
  audit({ via: 'boot', action: 'materialize', ok: true, key_count: Object.keys(written).length });

  db.close();
  return 0;
}

process.exit(main());
