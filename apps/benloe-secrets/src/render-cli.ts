/**
 * Render every stored set to tmpfs, then exit.
 *
 * This exists because of a boot-ordering problem that has exactly one correct
 * answer. PM2 resurrects thirteen services at once, and each of them reads its
 * configuration from a file in /run — which is tmpfs, and therefore empty after
 * every reboot. If the service that writes those files is itself just another
 * PM2 app, it is racing its own consumers, and the failure mode is a handful of
 * services silently coming up without credentials.
 *
 * So the render runs as a systemd oneshot ordered Before=pm2-root.service. By
 * the time PM2 starts, the files exist.
 *
 * Run as the benloe-secrets uid via the same setpriv shim the service uses, so
 * a root process never evaluates this code and never holds the key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createAuditLog } from './audit.js';
import { materialize } from './materialize.js';
import { loadKey, migrate, readAllSets } from './store.js';

const DATA_DIR = process.env.BENLOE_SECRETS_DIR ?? '/var/lib/benloe-secrets';
const KEY_PATH = process.env.BENLOE_SECRETS_KEY_FILE ?? '/etc/benloe/benloe-secrets.key';
const RUNTIME_DIR = process.env.BENLOE_SECRETS_RUNTIME_DIR ?? '/run/benloe-secrets';

function main(): number {
  let key: Buffer | null;
  try {
    key = loadKey((p) => readFileSync(p, 'utf8'), KEY_PATH);
  } catch (err) {
    console.error('render: key unusable:', err instanceof Error ? err.message : err);
    return 1;
  }
  if (!key) {
    console.error(`render: no key at ${KEY_PATH} — cannot decrypt.`);
    return 1;
  }

  const db = new Database(join(DATA_DIR, 'secrets.db'), { readonly: false });
  migrate(db);
  const audit = createAuditLog(join(DATA_DIR, 'audit.log'));

  // All-or-nothing by construction: readAllSets decrypts every set before
  // materialize writes anything, so a single corrupt row throws here rather
  // than leaving half the box configured from the current store and half from
  // whatever the previous boot left behind.
  const sets = readAllSets(db, key);
  if (sets.size === 0) {
    // Nothing stored is a legitimate state on a fresh install, and must not
    // block boot. Loud, but not fatal.
    console.error('render: no sets stored yet — nothing to write.');
    audit({ via: 'boot', action: 'materialize', ok: false, error: 'no sets stored' });
    db.close();
    return 0;
  }

  const { written } = materialize(sets, RUNTIME_DIR);
  for (const [path, n] of Object.entries(written)) console.log(`render: ${path} (${n} keys)`);
  audit({ via: 'boot', action: 'materialize', ok: true, key_count: Object.keys(written).length });
  db.close();
  return 0;
}

process.exit(main());
