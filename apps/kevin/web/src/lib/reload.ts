// After a deploy, an open copy of the app still asks for the previous build's chunks, which no longer
// exist (each release is a fresh folder). The server answers those with a 404, the import fails, and
// the fix is to load the page again: the new index.html names the new chunks. This reloads once; if the
// load fails again within a minute the error is shown instead, so a broken build cannot reload forever.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const KEY = 'kevin:reloaded-for-build';
const WINDOW_MS = 60_000;

export interface ReloadEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
  now: () => number;
}

const browser = (): ReloadEnv => {
  let storage: ReloadEnv['storage'] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return { storage, reload: () => window.location.reload(), now: () => Date.now() };
};

/**
 * Reloads the page unless it already did so in the last minute. Returns whether it reloaded.
 * Without storage it does not reload: it could not tell a second failure from the first.
 */
export function reloadOnceForNewBuild(env: ReloadEnv = browser()): boolean {
  if (!env.storage) return false;
  let last = 0;
  try {
    last = Number(env.storage.getItem(KEY)) || 0;
  } catch {
    return false;
  }
  if (env.now() - last < WINDOW_MS) return false;
  try {
    env.storage.setItem(KEY, String(env.now()));
  } catch {
    return false;
  }
  env.reload();
  return true;
}

/** A failed chunk load: reload once (the promise then never settles, the page is going away), else rethrow. */
export async function loadChunk<T>(load: () => Promise<T>, env?: ReloadEnv): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (reloadOnceForNewBuild(env)) return new Promise<T>(() => undefined);
    throw e;
  }
}

/** React.lazy for a page, recovering from a chunk that belongs to a build that has been replaced. */
export function lazyPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => loadChunk(load));
}

/** Vite's own signal that a preloaded chunk failed: handled the same way. Call once at startup. */
export function listenForStaleBuild(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForNewBuild()) event.preventDefault();
  });
}
