/**
 * Encrypted at-rest storage for Sleeper session tokens.
 *
 * A Sleeper token is a long-lived credential for someone's whole account, so it
 * is encrypted with AES-256-GCM before it touches the disk. The password used to
 * obtain it is never stored, never logged, and never leaves the request handler.
 *
 * Keyed by Sleeper user_id, so a visitor only ever reaches their own token.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ALGO = 'aes-256-gcm';
const SALT = 'sleeper-ui.token-store.v1';

interface Record_ {
  /** iv:tag:ciphertext, all base64url. */
  sealed: string;
  username: string;
  savedAt: number;
}

export class TokenStore {
  private key: Buffer;
  private cache: Map<string, Record_> | null = null;

  constructor(
    private path: string,
    secret: string
  ) {
    if (!secret) throw new Error('TokenStore requires a secret');
    // scrypt rather than using the raw secret: the signing secret is not a key.
    this.key = scryptSync(secret, SALT, 32);
  }

  private seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
  }

  private open(sealed: string): string | null {
    try {
      const [ivB, tagB, encB] = sealed.split('.');
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encB, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Wrong key or tampered file — treat as absent rather than throwing.
      return null;
    }
  }

  private async load(): Promise<Map<string, Record_>> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      this.cache = new Map(Object.entries(JSON.parse(raw) as Record<string, Record_>));
    } catch {
      this.cache = new Map();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    const map = await this.load();
    await mkdir(dirname(this.path), { recursive: true });
    // Write-then-rename so a crash mid-write cannot truncate the store.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async set(userId: string, username: string, token: string): Promise<void> {
    const map = await this.load();
    map.set(userId, { sealed: this.seal(token), username, savedAt: Date.now() });
    await this.persist();
  }

  async get(userId: string): Promise<string | null> {
    const map = await this.load();
    const rec = map.get(userId);
    if (!rec) return null;
    return this.open(rec.sealed);
  }

  async has(userId: string): Promise<boolean> {
    return (await this.load()).has(userId);
  }

  async savedAt(userId: string): Promise<number | null> {
    return (await this.load()).get(userId)?.savedAt ?? null;
  }

  async remove(userId: string): Promise<void> {
    const map = await this.load();
    if (map.delete(userId)) await this.persist();
  }
}

export const defaultTokenPath = (dir: string) => join(dir, 'sleeper-tokens.json');
