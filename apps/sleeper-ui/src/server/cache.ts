/**
 * Tiny TTL cache with stale-while-revalidate and on-disk persistence for the
 * expensive stuff (the 14MB player dump).
 *
 * Sleeper's limit is 1000 req/min and we are a single-user dashboard, so this is
 * about being a good citizen and keeping page loads instant — not about scale.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Entry<T> {
  value: T;
  expires: number;
  refreshing?: Promise<T>;
}

const mem = new Map<string, Entry<any>>();

export const TTL = {
  /** Live scoring windows. */
  matchups: 30_000,
  /** Standings shift only as games finalise. */
  rosters: 60_000,
  /** League config, users, drafts. */
  league: 10 * 60_000,
  /** Transactions trickle in. */
  transactions: 2 * 60_000,
  /** Player DB changes about once a day. */
  players: 12 * 60 * 60_000,
  state: 5 * 60_000,
} as const;

/**
 * Returns cached data immediately when fresh. When stale, returns the stale value
 * and refreshes in the background, so a slow upstream never blocks a page render.
 */
export async function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = mem.get(key) as Entry<T> | undefined;
  const now = Date.now();

  if (hit && hit.expires > now) return hit.value;

  if (hit) {
    // Stale: serve it, kick off a refresh unless one is already running.
    if (!hit.refreshing) {
      hit.refreshing = fetcher()
        .then((value) => {
          mem.set(key, { value, expires: Date.now() + ttl });
          return value;
        })
        .catch((err) => {
          // Keep serving stale data rather than breaking the page.
          console.warn(`[cache] refresh failed for ${key}: ${err.message}`);
          hit.refreshing = undefined;
          hit.expires = Date.now() + 15_000; // brief backoff before retrying
          return hit.value;
        });
    }
    return hit.value;
  }

  const value = await fetcher();
  mem.set(key, { value, expires: now + ttl });
  return value;
}

export function invalidate(prefix?: string) {
  if (!prefix) return mem.clear();
  for (const k of mem.keys()) if (k.startsWith(prefix)) mem.delete(k);
}

export function stats() {
  const now = Date.now();
  return {
    entries: mem.size,
    keys: [...mem.entries()].map(([k, v]) => ({
      key: k,
      freshFor: Math.max(0, Math.round((v.expires - now) / 1000)),
    })),
  };
}

/** Disk-backed layer for payloads too big to refetch casually. */
export async function diskCached<T>(
  dir: string,
  name: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const path = join(dir, `${name}.json`);
  try {
    const raw = await readFile(path, 'utf8');
    const { at, value } = JSON.parse(raw);
    if (Date.now() - at < ttlMs) return value as T;
  } catch {
    // no usable cache file; fall through and fetch
  }

  try {
    const value = await fetcher();
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ at: Date.now(), value }));
    return value;
  } catch (err) {
    // Upstream failed — an expired cache file still beats an error page.
    try {
      const { value } = JSON.parse(await readFile(path, 'utf8'));
      console.warn(`[cache] serving expired ${name} after fetch failure`);
      return value as T;
    } catch {
      throw err;
    }
  }
}
