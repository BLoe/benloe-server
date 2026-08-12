/**
 * benloe-secrets — the server's secret store.
 *
 * Runs as its own unprivileged uid, from a root-owned code tree, against a
 * database and key file no other service uid can open. It does three things:
 * serves an owner-only dashboard for editing the named secret sets, renders
 * those sets to tmpfs where services read them, and brokers Plaid calls for
 * Cabinet over a unix socket.
 *
 * Why a separate service at all, in one paragraph: Cabinet's agent can write
 * Cabinet's own source and deploy it, so any protection expressed as code
 * inside that process — an env scrub, a "do not import this" comment — is a
 * suggestion the agent can edit. Moving the key across a uid boundary makes it
 * a property of the operating system instead. See docs/SECRETS.md.
 *
 * BOOTSTRAP. This service cannot get its own configuration from the store it
 * serves, so the handful of values it needs live in /etc/benloe/benloe-secrets.conf
 * (root-owned). That file is the permanent, deliberately tiny bootstrap set.
 *
 * TWO LISTENERS, DELIBERATELY DIFFERENT IN KIND:
 *
 *   1. A LOCALHOST HTTP PORT for the dashboard, fronted by Caddy at
 *      secrets.benloe.com and authenticated against artanis as the owner.
 *      Bound to 127.0.0.1 so the only way in is through Caddy's TLS.
 *
 *   2. A UNIX SOCKET for Cabinet's capability broker. Authenticated by
 *      filesystem permissions (0660 benloe-secrets:claude-worker) rather than a
 *      shared token, so there is nothing to leak and the kernel does the
 *      enforcing. Serves capabilities — "make this Plaid call" — never secrets.
 *
 * TWO STORES, TWO SCHEMAS. store.ts holds the env sets; credentials.ts holds
 * the broker's individually-named credentials. They share a database file and a
 * key file and nothing else, so both migrations have to run here.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { createAuditLog } from './audit.js';
import { buildBrokerApp } from './broker.js';
import { buildDashboardApp } from './dashboard.js';
import { materialize } from './materialize.js';
import { migrate as migrateCredentials } from './credentials.js';
import { loadKey, migrate, readAllSets, SecretKeyError } from './store.js';

const DATA_DIR = process.env.BENLOE_SECRETS_DIR ?? '/var/lib/benloe-secrets';
const KEY_PATH = process.env.BENLOE_SECRETS_KEY_FILE ?? '/etc/benloe/benloe-secrets.key';
const RUNTIME_DIR = process.env.BENLOE_SECRETS_RUNTIME_DIR ?? '/run/benloe-secrets';
const HTTP_PORT = Number(process.env.PORT ?? 3011);
const OWNER = process.env.BENLOE_OWNER_EMAIL;

// The broker socket lives in its OWN directory, and that is load-bearing rather
// than tidy: the socket must be reachable by claude-worker (Cabinet's shells)
// and the rendered env files must never be. One directory cannot express both,
// so there are two. See infra/systemd/benloe-secrets.tmpfiles.conf.
const SOCKET_DIR = process.env.BENLOE_SECRETS_SOCKET_DIR ?? '/run/benloe-secrets-broker';
const SOCKET_PATH = join(SOCKET_DIR, 'broker.sock');
/** The group allowed to talk to the broker socket. */
const PEER_GROUP = process.env.BENLOE_SECRETS_PEER_GROUP ?? 'claude-worker';
const PLAID_ENV = process.env.PLAID_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';

if (!OWNER) {
  console.error('BENLOE_OWNER_EMAIL is required — refusing to start without an owner to authorise against.');
  process.exit(1);
}

// Refuse to run privileged. The PM2 config starts us through a setpriv shim, so
// this should be impossible; asserting it means a future config mistake fails
// loudly here rather than silently handing the key to a root process.
if (process.getuid?.() === 0) {
  console.error('refusing to run as root — benloe-secrets must run as its own unprivileged uid');
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const db = new Database(join(DATA_DIR, 'secrets.db'));
migrate(db);
migrateCredentials(db);

let key: Buffer | null = null;
try {
  key = loadKey((p) => readFileSync(p, 'utf8'), KEY_PATH);
} catch (err) {
  // A malformed key must not take the service down: the dashboard is exactly
  // where an operator would go to understand and fix it, and it reports
  // keyLoaded:false prominently. Message reports length only, never material.
  console.error('key: %s Running without encryption.', err instanceof SecretKeyError ? err.message : err);
}
if (!key) {
  console.warn(`key: no usable key at ${KEY_PATH} — cannot encrypt or decrypt. Generate one with: openssl rand -base64 32`);
}

const auditPath = join(DATA_DIR, 'audit.log');
const audit = createAuditLog(auditPath);

// Render on startup, so a restart of this service repairs a missing or stale
// /run after a reboot. The dedicated pre-PM2 systemd unit is what guarantees
// the files exist BEFORE consumers start; this is the belt to that's braces.
if (key) {
  try {
    const sets = readAllSets(db, key);
    const { written } = materialize(sets, RUNTIME_DIR);
    audit({ via: 'boot', action: 'materialize', ok: true, key_count: Object.keys(written).length });
    console.log(`rendered ${Object.keys(written).length} file(s) into ${RUNTIME_DIR}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'materialize failed';
    audit({ via: 'boot', action: 'materialize', ok: false, error: message });
    console.error('materialize on boot failed:', message);
  }
}

// ---- dashboard (127.0.0.1, behind Caddy) ----
buildDashboardApp({ db, key, audit, ownerEmail: OWNER, runtimeDir: RUNTIME_DIR }).listen(HTTP_PORT, '127.0.0.1', () =>
  console.log(`benloe-secrets dashboard on 127.0.0.1:${HTTP_PORT} (owner ${OWNER})`),
);

// ---- broker socket (Cabinet) ----
mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o750 });
// A stale socket file from an unclean shutdown would make bind() fail with
// EADDRINUSE even though nothing is listening.
if (existsSync(SOCKET_PATH)) {
  try {
    unlinkSync(SOCKET_PATH);
  } catch (err) {
    console.error('could not remove stale socket:', err instanceof Error ? err.message : err);
  }
}

const brokerServer = buildBrokerApp({ db, key, audit, environment: PLAID_ENV }).listen(SOCKET_PATH, () => {
  // The socket's mode IS the access control, so set it before announcing.
  //
  // We only chmod. The GROUP comes from the setgid bit on SOCKET_DIR (2750,
  // group claude-worker — see infra/systemd/benloe-secrets.tmpfiles.conf), so
  // the socket inherits it at bind() time. An unprivileged process cannot
  // chgrp into a group it does not belong to, and the fix for that is NOT to
  // put this uid in claude-worker's group: that would let this service read
  // Cabinet's files, which is backwards.
  try {
    chmodSync(SOCKET_PATH, 0o660);
    const gid = statSync(SOCKET_PATH).gid;
    const expected = Number(execFileSync('id', ['-g', PEER_GROUP], { encoding: 'utf8' }).trim());
    if (gid !== expected) {
      // Fail closed and loudly. A socket in the wrong group is either
      // unreachable by Cabinet (silently broken) or reachable by more than
      // Cabinet (silently dangerous); guessing which is not acceptable here.
      throw new Error(`socket group is ${gid}, expected ${expected} (${PEER_GROUP}) — is ${SOCKET_DIR} setgid?`);
    }
    console.log(`benloe-secrets broker on ${SOCKET_PATH} (0660, group ${PEER_GROUP})`);
  } catch (err) {
    console.error('FATAL: could not secure the broker socket:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  brokerServer.close();
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    /* already gone */
  }
  db.close();
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
