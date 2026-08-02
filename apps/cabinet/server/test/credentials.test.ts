import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { openDb, queryReadonly, QueryGuardError, type CabinetDb } from '../src/db/index.js';
import {
  credKey,
  CREDENTIAL_NAME_RE,
  CredentialAuthError,
  CredentialKeyError,
  deleteCredential,
  getCredentialMeta,
  getCredentialSecret,
  listCredentials,
  putCredential,
  touchCredential,
  verifyCredential,
} from '../src/domains/credentials.js';
import {
  CREDENTIAL_CATALOG,
  ENV_CATALOG,
  envReport,
  isManagedCredential,
} from '../src/domains/credentialCatalog.js';
import { CLIENT_ID_CRED, SECRET_CRED } from '../src/integrations/plaid.js';
import { registerCredentialRoutes } from '../src/gateway/credentialRoutes.js';

let dir: string;
let cabinet: CabinetDb;

// A fixed 32-byte key, so a decrypt failure in these tests means the code
// broke and never that the fixture drifted.
const KEY = Buffer.alloc(32, 7);
const KEY_B64 = KEY.toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9);

const SECRET = 'access-sandbox-8f3a-not-a-real-plaid-token';

interface RawRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}
const raw = (name: string) =>
  cabinet.db.prepare('SELECT ciphertext, iv, auth_tag FROM credential WHERE name = ?').get(name) as RawRow;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-cred-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});

afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('credKey', () => {
  it('returns null when CABINET_CRED_KEY is absent or blank — the degraded mode signal', () => {
    expect(credKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(credKey({ CABINET_CRED_KEY: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(credKey({ CABINET_CRED_KEY: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('decodes a valid base64 32-byte key', () => {
    const k = credKey({ CABINET_CRED_KEY: KEY_B64 } as NodeJS.ProcessEnv);
    expect(k).not.toBeNull();
    expect(k!.length).toBe(32);
    expect(k!.equals(KEY)).toBe(true);
  });

  it('throws rather than degrading silently when the key is the wrong length', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => credKey({ CABINET_CRED_KEY: short } as NodeJS.ProcessEnv)).toThrow(CredentialKeyError);
  });

  it('never puts key material into the error message', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    try {
      credKey({ CABINET_CRED_KEY: short } as NodeJS.ProcessEnv);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(short);
      expect((err as Error).message).toContain('32 bytes');
    }
  });
});

describe('encrypt/decrypt round trip', () => {
  it('stores a secret and hands the same plaintext back', () => {
    putCredential(cabinet.db, KEY, {
      name: 'plaid-access-token',
      provider: 'plaid',
      description: 'sandbox item',
      secret: SECRET,
    });
    expect(getCredentialSecret(cabinet.db, KEY, 'plaid-access-token')).toBe(SECRET);
  });

  it('round-trips unicode and long secrets without mangling bytes', () => {
    const weird = 'pässwörd-🔐-' + 'x'.repeat(4000);
    putCredential(cabinet.db, KEY, { name: 'weird', secret: weird });
    expect(getCredentialSecret(cabinet.db, KEY, 'weird')).toBe(weird);
  });

  it('returns null for a name that was never stored', () => {
    expect(getCredentialSecret(cabinet.db, KEY, 'nope')).toBeNull();
  });

  it('writes ciphertext, not the plaintext — nothing in the row contains the secret', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', secret: SECRET });
    const row = raw('plaid');
    expect(row.ciphertext.toString('utf8')).not.toBe(SECRET);
    expect(row.ciphertext.includes(Buffer.from(SECRET, 'utf8'))).toBe(false);
    // And the whole row, serialized however anyone might dump it, has no
    // recognizable fragment of the plaintext in it.
    const dump = cabinet.db.prepare('SELECT * FROM credential WHERE name = ?').get('plaid');
    expect(JSON.stringify(dump)).not.toContain('plaid-access');
    expect(JSON.stringify(dump)).not.toContain(SECRET.slice(0, 12));
  });

  it('uses a fresh IV for every write, so the same secret never encrypts the same way twice', () => {
    putCredential(cabinet.db, KEY, { name: 'a', secret: SECRET });
    putCredential(cabinet.db, KEY, { name: 'b', secret: SECRET });
    const a = raw('a');
    const b = raw('b');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.length).toBe(12);
    expect(a.auth_tag.length).toBe(16);
  });
});

describe('GCM authentication', () => {
  beforeEach(() => {
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', secret: SECRET });
  });

  it('refuses to decrypt a tampered ciphertext', () => {
    const { ciphertext } = raw('plaid');
    const tampered = Buffer.from(ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    cabinet.db.prepare('UPDATE credential SET ciphertext = ? WHERE name = ?').run(tampered, 'plaid');
    expect(() => getCredentialSecret(cabinet.db, KEY, 'plaid')).toThrow(CredentialAuthError);
  });

  it('refuses to decrypt when the auth tag is tampered with', () => {
    const { auth_tag } = raw('plaid');
    const tampered = Buffer.from(auth_tag);
    tampered[0] = tampered[0]! ^ 0x01;
    cabinet.db.prepare('UPDATE credential SET auth_tag = ? WHERE name = ?').run(tampered, 'plaid');
    expect(() => getCredentialSecret(cabinet.db, KEY, 'plaid')).toThrow(CredentialAuthError);
  });

  it('rejects a truncated auth tag as a corrupt row rather than trying to decrypt it', () => {
    const { auth_tag } = raw('plaid');
    cabinet.db.prepare('UPDATE credential SET auth_tag = ? WHERE name = ?').run(auth_tag.subarray(0, 8), 'plaid');
    expect(() => getCredentialSecret(cabinet.db, KEY, 'plaid')).toThrow(CredentialAuthError);
  });

  it('refuses to decrypt when the IV has been swapped', () => {
    putCredential(cabinet.db, KEY, { name: 'other', secret: 'something else' });
    const otherIv = raw('other').iv;
    cabinet.db.prepare('UPDATE credential SET iv = ? WHERE name = ?').run(otherIv, 'plaid');
    expect(() => getCredentialSecret(cabinet.db, KEY, 'plaid')).toThrow(CredentialAuthError);
  });

  it('refuses to decrypt with the wrong key', () => {
    expect(() => getCredentialSecret(cabinet.db, OTHER_KEY, 'plaid')).toThrow(CredentialAuthError);
  });

  it('refuses a ciphertext moved onto another credential name (AAD binding)', () => {
    // Someone with DB write access but no key copies the sandbox token's
    // ciphertext onto the production row. The name is authenticated data, so
    // the tag no longer verifies.
    putCredential(cabinet.db, KEY, { name: 'plaid-prod', secret: 'production-token' });
    const sandbox = raw('plaid');
    cabinet.db
      .prepare('UPDATE credential SET ciphertext = ?, iv = ?, auth_tag = ? WHERE name = ?')
      .run(sandbox.ciphertext, sandbox.iv, sandbox.auth_tag, 'plaid-prod');
    expect(() => getCredentialSecret(cabinet.db, KEY, 'plaid-prod')).toThrow(CredentialAuthError);
  });

  it('does not leak the plaintext or the key through the failure message', () => {
    const { ciphertext } = raw('plaid');
    const tampered = Buffer.from(ciphertext);
    tampered[1] = tampered[1]! ^ 0xff;
    cabinet.db.prepare('UPDATE credential SET ciphertext = ? WHERE name = ?').run(tampered, 'plaid');
    try {
      getCredentialSecret(cabinet.db, KEY, 'plaid');
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(KEY_B64);
      expect(msg).toContain('failed authentication');
    }
  });
});

describe('listCredentials', () => {
  it('returns metadata and nothing else — no ciphertext, no iv, no tag, no plaintext', () => {
    putCredential(cabinet.db, KEY, {
      name: 'plaid',
      provider: 'plaid',
      description: 'sandbox item for the checking account',
      secret: SECRET,
    });
    const list = listCredentials(cabinet.db);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual([
      'created_at',
      'description',
      'id',
      'last_used_at',
      'name',
      'provider',
      'rotated_at',
      'updated_at',
    ]);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain('auth_tag');
  });

  it('works with no key at all — the degraded read-metadata-only mode', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', secret: SECRET });
    // Same DB, but this process has no CABINET_CRED_KEY.
    const list = listCredentials(cabinet.db);
    expect(list[0]!.name).toBe('plaid');
    expect(list[0]!.provider).toBe('plaid');
    expect(list[0]!.created_at).toBeTruthy();
  });

  it('orders by name so the UI is stable across reloads', () => {
    putCredential(cabinet.db, KEY, { name: 'zulu', secret: 's' });
    putCredential(cabinet.db, KEY, { name: 'alpha', secret: 's' });
    expect(listCredentials(cabinet.db).map((c) => c.name)).toEqual(['alpha', 'zulu']);
  });
});

describe('unconfigured key (degraded mode)', () => {
  it('refuses to write, with an error naming the missing env var', () => {
    expect(() => putCredential(cabinet.db, null, { name: 'plaid', secret: SECRET })).toThrow(CredentialKeyError);
    expect(() => putCredential(cabinet.db, null, { name: 'plaid', secret: SECRET })).toThrow(/CABINET_CRED_KEY/);
  });

  it('refuses to decrypt', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(() => getCredentialSecret(cabinet.db, null, 'plaid')).toThrow(CredentialKeyError);
  });

  it('still lists, touches and deletes — the operations that never need the key', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(listCredentials(cabinet.db)).toHaveLength(1);
    expect(touchCredential(cabinet.db, 'plaid')).toBe(true);
    expect(deleteCredential(cabinet.db, 'plaid')).toBe(true);
    expect(listCredentials(cabinet.db)).toHaveLength(0);
  });
});

describe('rotation', () => {
  it('overwriting an existing name replaces the secret and stamps rotated_at', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', description: 'sandbox', secret: 'old-token' });
    const before = getCredentialMeta(cabinet.db, 'plaid')!;
    expect(before.rotated_at).toBeNull();

    const result = putCredential(cabinet.db, KEY, { name: 'plaid', secret: 'new-token' });
    expect(result.created).toBe(false);

    const after = getCredentialMeta(cabinet.db, 'plaid')!;
    expect(after.rotated_at).not.toBeNull();
    // Same row: rotation is not a new credential, and created_at keeps telling
    // the truth about how long this integration has existed.
    expect(after.id).toBe(before.id);
    expect(after.created_at).toBe(before.created_at);
    expect(listCredentials(cabinet.db)).toHaveLength(1);
    expect(getCredentialSecret(cabinet.db, KEY, 'plaid')).toBe('new-token');
  });

  it('rotates the ciphertext and the IV, not just the plaintext', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: 'same-token' });
    const before = raw('plaid');
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: 'same-token' });
    const after = raw('plaid');
    expect(after.iv.equals(before.iv)).toBe(false);
    expect(after.ciphertext.equals(before.ciphertext)).toBe(false);
  });

  it('keeps provider/description when a rotation omits them', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', description: 'sandbox item', secret: 'a' });
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: 'b' });
    const meta = getCredentialMeta(cabinet.db, 'plaid')!;
    expect(meta.provider).toBe('plaid');
    expect(meta.description).toBe('sandbox item');
  });

  it('reports created:true only on first write', () => {
    expect(putCredential(cabinet.db, KEY, { name: 'x', secret: 'a' }).created).toBe(true);
    expect(putCredential(cabinet.db, KEY, { name: 'x', secret: 'b' }).created).toBe(false);
  });
});

describe('validation', () => {
  it('rejects names that are not lowercase slugs', () => {
    for (const bad of ['', ' ', 'Plaid', 'has space', '-leading', 'a/b', 'x'.repeat(65)]) {
      expect(() => putCredential(cabinet.db, KEY, { name: bad, secret: 's' })).toThrow();
    }
  });

  it('rejects an empty secret without describing it', () => {
    expect(() => putCredential(cabinet.db, KEY, { name: 'plaid', secret: '' })).toThrow(/non-empty secret/);
  });
});

describe('last_used_at', () => {
  it('is null until the credential is actually used', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(getCredentialMeta(cabinet.db, 'plaid')!.last_used_at).toBeNull();
  });

  it('is stamped by a decrypt, so an abandoned integration is visible without decrypting', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    getCredentialSecret(cabinet.db, KEY, 'plaid');
    expect(getCredentialMeta(cabinet.db, 'plaid')!.last_used_at).toBeTruthy();
  });

  it('can be stamped explicitly for callers holding a cached session', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(touchCredential(cabinet.db, 'plaid')).toBe(true);
    expect(getCredentialMeta(cabinet.db, 'plaid')!.last_used_at).toBeTruthy();
    expect(touchCredential(cabinet.db, 'ghost')).toBe(false);
  });
});

describe('deleteCredential', () => {
  it('removes the row and reports whether anything was there', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(deleteCredential(cabinet.db, 'plaid')).toBe(true);
    expect(deleteCredential(cabinet.db, 'plaid')).toBe(false);
    expect(getCredentialSecret(cabinet.db, KEY, 'plaid')).toBeNull();
  });
});

describe('verifyCredential', () => {
  it('matches the stored secret and rejects anything else', () => {
    putCredential(cabinet.db, KEY, { name: 'ingest-token', secret: SECRET });
    expect(verifyCredential(cabinet.db, KEY, 'ingest-token', SECRET)).toBe(true);
    expect(verifyCredential(cabinet.db, KEY, 'ingest-token', SECRET + 'x')).toBe(false);
    expect(verifyCredential(cabinet.db, KEY, 'ingest-token', 'nope')).toBe(false);
    expect(verifyCredential(cabinet.db, KEY, 'missing', SECRET)).toBe(false);
  });
});

describe('the agent cannot reach the table through query_db', () => {
  it('rejects a SELECT against credential even though the rows are only ciphertext', () => {
    putCredential(cabinet.db, KEY, { name: 'plaid', secret: SECRET });
    expect(() => queryReadonly(cabinet.readonlyDb, 'SELECT * FROM credential')).toThrow(QueryGuardError);
    expect(() => queryReadonly(cabinet.readonlyDb, 'select ciphertext from CREDENTIAL')).toThrow(QueryGuardError);
    // Ordinary tables still work — the guard is targeted, not a blanket.
    expect(() => queryReadonly(cabinet.readonlyDb, 'SELECT * FROM substance_log')).not.toThrow();
  });
});

/* ---------------------------------------------------------------------------
   HTTP surface. Mounted on a bare express app rather than through buildApp:
   the auth wall is buildApp's tested concern, and these tests are about the
   one property that belongs to this module — a secret goes in and never
   comes back out.
   --------------------------------------------------------------------------- */
describe('credential routes', () => {
  let server: Server;
  let base: string;

  async function start(key: Buffer | null) {
    const app = express();
    app.use(express.json());
    registerCredentialRoutes(app, { db: cabinet.db, key });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const post = (body: unknown) =>
    fetch(base + '/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  afterEach(async () => {
    await new Promise((r) => server?.close(r));
  });

  it('POST stores the secret and answers with metadata only', async () => {
    await start(KEY);
    const r = await post({ name: 'plaid', provider: 'plaid', description: 'sandbox', secret: SECRET });
    expect(r.status).toBe(201);
    const text = await r.text();
    // The strongest assertion available: the raw response body, before any
    // parsing, contains no fragment of the secret.
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 10));
    expect(text).not.toContain('ciphertext');
    const body = JSON.parse(text) as { created: boolean; credential: Record<string, unknown> };
    expect(body.created).toBe(true);
    expect(body.credential.name).toBe('plaid');
    expect(body.credential).not.toHaveProperty('secret');
    // ...and it really was stored, decryptable server-side.
    expect(getCredentialSecret(cabinet.db, KEY, 'plaid')).toBe(SECRET);
  });

  it('GET lists metadata and reports whether the key is loaded', async () => {
    await start(KEY);
    await post({ name: 'plaid', provider: 'plaid', secret: SECRET });
    const r = await fetch(base + '/api/credentials');
    const text = await r.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { configured: boolean; credentials: Record<string, unknown>[] };
    expect(body.configured).toBe(true);
    expect(body.credentials).toHaveLength(1);
    expect(Object.keys(body.credentials[0]!)).not.toContain('ciphertext');
  });

  it('has no route that returns a secret — GET /api/credentials/:name is not a thing', async () => {
    await start(KEY);
    await post({ name: 'plaid', secret: SECRET });
    // Nothing is registered at that path, so express falls through to 404.
    expect((await fetch(base + '/api/credentials/plaid')).status).toBe(404);
    expect((await fetch(base + '/api/credentials/plaid/secret')).status).toBe(404);
    expect((await fetch(base + '/api/credentials/plaid/reveal')).status).toBe(404);
  });

  it('POST on an existing name rotates it and answers 200, not 201', async () => {
    await start(KEY);
    await post({ name: 'plaid', provider: 'plaid', secret: 'old' });
    const r = await post({ name: 'plaid', secret: 'new' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { created: boolean; credential: { rotated_at: string | null; provider: string } };
    expect(body.created).toBe(false);
    expect(body.credential.rotated_at).not.toBeNull();
    expect(body.credential.provider).toBe('plaid');
    expect(getCredentialSecret(cabinet.db, KEY, 'plaid')).toBe('new');
  });

  it('DELETE removes it; a second delete is a 404', async () => {
    await start(KEY);
    await post({ name: 'plaid', secret: SECRET });
    expect((await fetch(base + '/api/credentials/plaid', { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(base + '/api/credentials/plaid', { method: 'DELETE' })).status).toBe(404);
    expect(listCredentials(cabinet.db)).toHaveLength(0);
  });

  it('validates the payload without echoing it', async () => {
    await start(KEY);
    expect((await post({ name: 'Not A Slug', secret: 's' })).status).toBe(400);
    expect((await post({ name: 'plaid' })).status).toBe(400);
    expect((await post({ name: 'plaid', secret: '' })).status).toBe(400);
    expect((await post({ name: 'plaid', secret: 123 })).status).toBe(400);
    expect((await post({ name: 'plaid', secret: 's', provider: 5 })).status).toBe(400);
    const r = await post({ name: 'plaid', secret: SECRET, description: { oops: true } });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain(SECRET);
  });

  it('degrades correctly with no key: lists, deletes, but refuses writes with 503', async () => {
    // Seed with a key, then serve without one — the real "env var missing on
    // this box" scenario.
    putCredential(cabinet.db, KEY, { name: 'plaid', provider: 'plaid', secret: SECRET });
    await start(null);
    const list = (await (await fetch(base + '/api/credentials')).json()) as {
      configured: boolean;
      credentials: unknown[];
    };
    expect(list.configured).toBe(false);
    expect(list.credentials).toHaveLength(1);

    const w = await post({ name: 'other', secret: 'x' });
    expect(w.status).toBe(503);
    expect((await w.json()).error).toMatch(/CABINET_CRED_KEY/);

    // Revocation must keep working while the key is unavailable.
    expect((await fetch(base + '/api/credentials/plaid', { method: 'DELETE' })).status).toBe(200);
  });
});

/* ---------------------------------------------------------------------------
   The catalog. This is what turns the store into something Ben can actually
   operate: named slots instead of a key/value editor he has to guess the keys
   for. The tests that matter here are the ones about what must NEVER leave.
   --------------------------------------------------------------------------- */
describe('credential catalog', () => {
  it('every catalog slot name is a legal credential name', () => {
    // A slot whose name the POST route rejects is a button that cannot work.
    for (const slot of CREDENTIAL_CATALOG) {
      expect(CREDENTIAL_NAME_RE.test(slot.name), `illegal slot name ${slot.name}`).toBe(true);
    }
  });

  it('slot names are unique', () => {
    const names = CREDENTIAL_CATALOG.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no catalog slot collides with a machine-managed prefix', () => {
    // Otherwise the page would render an editable slot that the POST route
    // then refuses with a 409 — a button built to fail.
    for (const slot of CREDENTIAL_CATALOG) {
      expect(isManagedCredential(slot.name), `${slot.name} is managed`).toBe(false);
    }
  });

  it('the catalog names match the constants the Plaid client actually reads', () => {
    // The failure this prevents: renaming CLIENT_ID_CRED in the integration and
    // leaving the catalog pointing at the old slug. Ben fills in the form, it
    // saves successfully, and Plaid stays "not configured" with no error
    // anywhere. Cheap assertion, silent and baffling failure.
    const names = CREDENTIAL_CATALOG.map((s) => s.name);
    expect(names).toContain(CLIENT_ID_CRED);
    expect(names).toContain(SECRET_CRED);
  });
});

describe('envReport', () => {
  it('never reports a value for a variable not marked public — even when set', () => {
    // The single most important assertion in this file. If this ever fails,
    // a secret is being served to a browser.
    const env = Object.fromEntries(
      ENV_CATALOG.map((s) => [s.name, `VALUE-OF-${s.name}`]),
    ) as unknown as NodeJS.ProcessEnv;
    for (const row of envReport(env, { CABINET_CRED_KEY: true, GITHUB_APP_PRIVATE_KEY_B64: true })) {
      const spec = ENV_CATALOG.find((s) => s.name === row.name)!;
      if (spec.publicValue === true && spec.scrubbedAtBoot !== true) continue;
      expect(row.value, `${row.name} leaked a value`).toBeNull();
    }
  });

  it('reports the value for public config vars', () => {
    const rows = envReport({ PLAID_ENV: 'production' } as NodeJS.ProcessEnv);
    const plaid = rows.find((r) => r.name === 'PLAID_ENV')!;
    expect(plaid.set).toBe(true);
    expect(plaid.value).toBe('production');
  });

  it('reports an empty string as set-but-empty rather than absent', () => {
    // "set to nothing" and "not set" produce different symptoms and deserve
    // different displays; collapsing them hides a real misconfiguration.
    const rows = envReport({ PLAID_ENV: '' } as NodeJS.ProcessEnv);
    const plaid = rows.find((r) => r.name === 'PLAID_ENV')!;
    expect(plaid.set).toBe(false);
    expect(plaid.value).toBe('');
  });

  it('takes scrubbed vars from the resolved artifact, not from the environment', () => {
    // CABINET_CRED_KEY is deleted from process.env at boot so the agent's Bash
    // tool cannot print it. Probing the environment would therefore report a
    // correctly-configured server as "encryption key missing" — a false alarm
    // that sends you debugging a problem that does not exist.
    const rows = envReport({} as NodeJS.ProcessEnv, { CABINET_CRED_KEY: true });
    const key = rows.find((r) => r.name === 'CABINET_CRED_KEY')!;
    expect(key.set).toBe(true);
    expect(key.scrubbed).toBe(true);
    expect(key.value).toBeNull();
  });

  it('reports a scrubbed var as unset when nothing resolved it — unknown errs toward absent', () => {
    const rows = envReport({ CABINET_CRED_KEY: 'a-real-looking-key' } as NodeJS.ProcessEnv, {});
    const key = rows.find((r) => r.name === 'CABINET_CRED_KEY')!;
    expect(key.set).toBe(false);
    expect(key.value).toBeNull();
  });
});

describe('credential routes — catalog payload', () => {
  let server: Server;
  let base: string;

  async function start(key: Buffer | null) {
    const app = express();
    app.use(express.json());
    registerCredentialRoutes(app, { db: cabinet.db, key });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await new Promise((r) => server?.close(r));
  });

  interface Payload {
    configured: boolean;
    credentials: { name: string }[];
    slots: { name: string; stored: boolean; meta: { name: string } | null }[];
    managed: { name: string }[];
    unrecognised: { name: string }[];
    env: { name: string; set: boolean; required: boolean; value: string | null }[];
  }
  const get = async (): Promise<Payload> => (await (await fetch(base + '/api/credentials')).json()) as Payload;

  it('renders every catalog slot on an empty store, marked not-stored', async () => {
    await start(KEY);
    const body = await get();
    expect(body.slots).toHaveLength(CREDENTIAL_CATALOG.length);
    expect(body.slots.every((s) => s.stored === false)).toBe(true);
    expect(body.slots.every((s) => s.meta === null)).toBe(true);
  });

  it('joins stored metadata onto its slot', async () => {
    putCredential(cabinet.db, KEY, { name: CLIENT_ID_CRED, secret: 'client-id-value' });
    await start(KEY);
    const slot = (await get()).slots.find((s) => s.name === CLIENT_ID_CRED)!;
    expect(slot.stored).toBe(true);
    expect(slot.meta?.name).toBe(CLIENT_ID_CRED);
  });

  it('never serves a secret or ciphertext in the payload, in any section', async () => {
    putCredential(cabinet.db, KEY, { name: CLIENT_ID_CRED, secret: SECRET });
    putCredential(cabinet.db, KEY, { name: 'plaid-item-abc123', secret: SECRET });
    putCredential(cabinet.db, KEY, { name: 'legacy-thing', secret: SECRET });
    await start(KEY);
    // Assert on the RAW text before parsing — a secret smuggled into an
    // unexpected field would still be caught here.
    const text = await (await fetch(base + '/api/credentials')).text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('auth_tag');
  });

  it('separates machine-managed credentials from unrecognised ones', async () => {
    putCredential(cabinet.db, KEY, { name: 'plaid-item-abc123', secret: SECRET });
    putCredential(cabinet.db, KEY, { name: 'legacy-thing', secret: SECRET });
    await start(KEY);
    const body = await get();
    expect(body.managed.map((c) => c.name)).toEqual(['plaid-item-abc123']);
    expect(body.unrecognised.map((c) => c.name)).toEqual(['legacy-thing']);
    // A catalogued-and-stored credential belongs to its slot, not to either
    // leftover bucket.
    expect(body.credentials).toHaveLength(2);
  });

  it('refuses a hand-written machine-managed name with 409', async () => {
    await start(KEY);
    const r = await fetch(base + '/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'plaid-item-abc123', secret: 'pasted-by-hand' }),
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/managed automatically/i);
    // And nothing was written.
    expect(getCredentialMeta(cabinet.db, 'plaid-item-abc123')).toBeNull();
  });

  it('reports the encryption key as present from the loaded buffer, not the env var', async () => {
    // The route must not probe process.env for CABINET_CRED_KEY: app.ts
    // deletes it at boot. Serving with a key present and the var absent is
    // exactly the production state.
    const saved = process.env.CABINET_CRED_KEY;
    delete process.env.CABINET_CRED_KEY;
    try {
      await start(KEY);
      const body = await get();
      expect(body.configured).toBe(true);
      expect(body.env.find((e) => e.name === 'CABINET_CRED_KEY')!.set).toBe(true);
    } finally {
      if (saved !== undefined) process.env.CABINET_CRED_KEY = saved;
    }
  });

  it('refuses to delete the live access token of a linked account', async () => {
    // The hole this closes: POST already blocked hand-writing a plaid-item-*
    // name, but DELETE would happily destroy one. That failure surfaces days
    // later as a bank authentication error, with the token that would have
    // explained it already gone.
    putCredential(cabinet.db, KEY, { name: 'plaid-item-abc123', secret: SECRET });
    cabinet.db
      .prepare(`INSERT INTO plaid_item (item_id, institution_name, token_credential) VALUES (?, ?, ?)`)
      .run('item-live', 'Bank of America', 'plaid-item-abc123');
    await start(KEY);

    const r = await fetch(base + '/api/credentials/plaid-item-abc123', { method: 'DELETE' });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/unlink/i);
    // And it is genuinely still there — a 409 that deleted anyway would be worse
    // than no guard at all.
    expect(getCredentialMeta(cabinet.db, 'plaid-item-abc123')).not.toBeNull();
  });

  it('still deletes an ORPHANED managed credential — debris is cleanable', async () => {
    // The guard protects live connections, not the prefix. A credential no item
    // points at is leftover state, and refusing to remove it would turn a guard
    // into a leak.
    putCredential(cabinet.db, KEY, { name: 'plaid-item-orphan', secret: SECRET });
    await start(KEY);
    const r = await fetch(base + '/api/credentials/plaid-item-orphan', { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(getCredentialMeta(cabinet.db, 'plaid-item-orphan')).toBeNull();
  });

  it('marks the encryption key required and optional integrations not', async () => {
    // A page that warns about every unset variable trains Ben to ignore the
    // section, including the one line that would have explained a real outage.
    await start(KEY);
    const env = (await get()).env;
    const req = (n: string) => env.find((e) => e.name === n)!.required;
    expect(req('CABINET_CRED_KEY')).toBe(true);
    expect(req('PLAID_ENV')).toBe(false);
    expect(req('CABINET_VAPID_PRIVATE_KEY')).toBe(false);
  });

  it('reports the encryption key as missing when the store is genuinely unkeyed', async () => {
    await start(null);
    const body = await get();
    expect(body.configured).toBe(false);
    expect(body.env.find((e) => e.name === 'CABINET_CRED_KEY')!.set).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   The import boundary, enforced rather than merely documented.

   credentials.ts, credentialRoutes.ts and plaid.ts all carry comments saying
   getCredentialSecret must not be imported into the HTTP or MCP layers. Until
   this test existed that rule lived only in prose, which means it was not a
   rule — it was a hope that the next person read the header. The whole
   guarantee Ben is relying on ("the page can't show me a key, and neither can
   Cabinet") rests on there being no decrypt reachable from a request handler
   or an agent tool, so the rule gets a build failure behind it.

   Deliberately a source scan and not a type-level trick: it catches a dynamic
   import and a re-export too, and it fails with a filename.
   --------------------------------------------------------------------------- */
describe('decrypt containment', () => {
  const SRC = new URL('../src/', import.meta.url).pathname;

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && full.endsWith('.ts') ? [full] : [];
    });
  }

  /**
   * Comments must not count. All three of gateway/credentialRoutes.ts,
   * gateway/plaidRoutes.ts and mcp/cabinet-server.ts carry header prose
   * ASSERTING they don't import getCredentialSecret — a plain substring scan
   * flags every one of them and the test fails on the files that are getting
   * it right. Strip comments first, then look for real code.
   */
  function code(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  const usesDecrypt = (file: string): boolean => /\bgetCredentialSecret\b/.test(code(file));

  it('no file under gateway/ or mcp/ imports or calls getCredentialSecret', () => {
    const offenders = ['gateway', 'mcp']
      .flatMap((sub) => walk(join(SRC, sub)))
      .filter(usesDecrypt)
      .map((f) => f.slice(SRC.length));
    expect(offenders, 'a decrypt path reached the HTTP/MCP layer').toEqual([]);
  });

  it('integrations/plaid.ts is still the only user outside the domain itself', () => {
    // Not a ban — an inventory. If this list grows, that is a real design
    // decision someone should have to make on purpose, in a diff, with a
    // reviewer. It should never grow by accident.
    const users = walk(SRC)
      .filter(usesDecrypt)
      .map((f) => f.slice(SRC.length))
      .sort();
    expect(users).toEqual(['domains/credentials.ts', 'integrations/plaid.ts']);
  });

  it('the scan actually detects a violation — it is not vacuously passing', () => {
    // A containment test that can never fail is worse than none: it reads as a
    // guarantee while enforcing nothing. Prove the detector fires.
    const tmp = join(dir, 'fake-route.ts');
    writeFileSync(tmp, "import { getCredentialSecret } from '../domains/credentials.js';\n");
    expect(usesDecrypt(tmp)).toBe(true);
    // ...and that prose about it does not.
    writeFileSync(tmp, '// this file deliberately does not import getCredentialSecret\n');
    expect(usesDecrypt(tmp)).toBe(false);
  });
});
