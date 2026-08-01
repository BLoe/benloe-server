import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { openDb, queryReadonly, QueryGuardError, type CabinetDb } from '../src/db/index.js';
import {
  credKey,
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
