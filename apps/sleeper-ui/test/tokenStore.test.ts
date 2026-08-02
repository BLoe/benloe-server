import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore, defaultTokenPath } from '../src/server/tokenStore.js';

const SECRET = 'a-signing-secret-for-tests';
const TOKEN = 'eyJhbGciOi.super-secret-sleeper-token.signature';
const USER = '810215947997663232';

let dir: string;
let store: TokenStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tokenstore-'));
  store = new TokenStore(defaultTokenPath(dir), SECRET);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('TokenStore', () => {
  it('round-trips a token', async () => {
    await store.set(USER, 'benloe', TOKEN);
    expect(await store.get(USER)).toBe(TOKEN);
    expect(await store.has(USER)).toBe(true);
  });

  it('returns null for an unknown user', async () => {
    expect(await store.get('nobody')).toBeNull();
    expect(await store.has('nobody')).toBe(false);
  });

  it('never writes the token in plaintext', async () => {
    await store.set(USER, 'benloe', TOKEN);
    const raw = await readFile(defaultTokenPath(dir), 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('super-secret-sleeper-token');
  });

  it('is unreadable with a different secret', async () => {
    await store.set(USER, 'benloe', TOKEN);
    const other = new TokenStore(defaultTokenPath(dir), 'a-different-secret');
    expect(await other.get(USER)).toBeNull();
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    await store.set(USER, 'benloe', TOKEN);
    const path = defaultTokenPath(dir);
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const [iv, tag, enc] = parsed[USER].sealed.split('.');
    // Flip a byte of the ciphertext; GCM's tag should catch it.
    const flipped = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    parsed[USER].sealed = [iv, tag, flipped].join('.');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify(parsed));

    const fresh = new TokenStore(path, SECRET);
    expect(await fresh.get(USER)).toBeNull();
  });

  it('survives a reopen', async () => {
    await store.set(USER, 'benloe', TOKEN);
    const fresh = new TokenStore(defaultTokenPath(dir), SECRET);
    expect(await fresh.get(USER)).toBe(TOKEN);
  });

  it('keeps users separate', async () => {
    await store.set(USER, 'benloe', TOKEN);
    await store.set('other-user', 'someone', 'other-token');
    expect(await store.get(USER)).toBe(TOKEN);
    expect(await store.get('other-user')).toBe('other-token');
  });

  it('overwrites on re-login', async () => {
    await store.set(USER, 'benloe', TOKEN);
    await store.set(USER, 'benloe', 'a-newer-token');
    expect(await store.get(USER)).toBe('a-newer-token');
  });

  it('forgets a token on remove', async () => {
    await store.set(USER, 'benloe', TOKEN);
    await store.remove(USER);
    expect(await store.get(USER)).toBeNull();
    expect(await store.has(USER)).toBe(false);
    const raw = await readFile(defaultTokenPath(dir), 'utf8');
    expect(raw).not.toContain(TOKEN);
  });

  it('uses a fresh iv per write, so identical tokens do not look identical', async () => {
    await store.set('a', 'x', TOKEN);
    await store.set('b', 'y', TOKEN);
    const parsed = JSON.parse(await readFile(defaultTokenPath(dir), 'utf8'));
    expect(parsed.a.sealed).not.toBe(parsed.b.sealed);
  });

  it('records when a token was saved', async () => {
    const before = Date.now();
    await store.set(USER, 'benloe', TOKEN);
    const at = await store.savedAt(USER);
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it('refuses to construct without a secret', () => {
    expect(() => new TokenStore(defaultTokenPath(dir), '')).toThrow();
  });

  it('treats a corrupt store file as empty rather than crashing', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(defaultTokenPath(dir), 'not json at all');
    const fresh = new TokenStore(defaultTokenPath(dir), SECRET);
    expect(await fresh.has(USER)).toBe(false);
    await fresh.set(USER, 'benloe', TOKEN);
    expect(await fresh.get(USER)).toBe(TOKEN);
  });
});
