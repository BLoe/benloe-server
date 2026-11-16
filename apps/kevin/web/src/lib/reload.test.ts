import { describe, expect, it } from 'vitest';
import { loadChunk, reloadOnceForNewBuild, type ReloadEnv } from './reload';

function env(start = 1_000_000) {
  const store = new Map<string, string>();
  let reloads = 0;
  let t = start;
  const e: ReloadEnv = { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }, reload: () => void reloads++, now: () => t };
  return { e, reloads: () => reloads, advance: (ms: number) => (t += ms) };
}

describe('recovering from a chunk of a replaced build', () => {
  it('reloads once, then lets the error show if the reload did not fix it, and again after a while', () => {
    const x = env();
    expect(reloadOnceForNewBuild(x.e)).toBe(true);
    expect(reloadOnceForNewBuild(x.e)).toBe(false);
    x.advance(30_000);
    expect(reloadOnceForNewBuild(x.e)).toBe(false);
    expect(x.reloads()).toBe(1);
    x.advance(31_000);
    expect(reloadOnceForNewBuild(x.e)).toBe(true);
    expect(x.reloads()).toBe(2);
  });

  it('does not reload without storage, which it needs to stop a loop', () => {
    let reloads = 0;
    expect(reloadOnceForNewBuild({ storage: null, reload: () => void reloads++, now: () => 1 })).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(reloadOnceForNewBuild({ storage: throwing, reload: () => void reloads++, now: () => 1 })).toBe(false);
    expect(reloads).toBe(0);
  });

  it('loads a chunk normally, reloads on the first failure, and rethrows the second', async () => {
    const x = env();
    expect(await loadChunk(async () => 'page', x.e)).toBe('page');
    const pending = loadChunk(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), x.e);
    const settled = await Promise.race([pending.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);
    expect(settled).toBe('waiting'); // the page is reloading; nothing renders an error meanwhile
    expect(x.reloads()).toBe(1);
    await expect(loadChunk(() => Promise.reject(new TypeError('still missing')), x.e)).rejects.toThrow('still missing');
  });
});
