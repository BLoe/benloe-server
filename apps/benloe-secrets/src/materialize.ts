/**
 * Materialise the stored sets onto tmpfs, where services can read them.
 *
 * WHY A FILE AND NOT AN API. Thirteen services on this box get their
 * configuration through `dotenv` reading a path. Replacing that with an RPC
 * would mean rewriting every one of them, and every future one, for no gain:
 * the values still end up in the consumer's memory either way. What actually
 * needed fixing was the durable plaintext copy sitting in a git working tree.
 * So the shape stays "a file at a path", and the file moves to RAM.
 *
 * WHY /run. It is tmpfs. The rendered env never touches a disk, so there is no
 * block to forget to wipe and nothing for a stolen backup or a snapshotted
 * volume to leak. It is empty after a reboot and is regenerated from the
 * encrypted store on the way back up, which makes the encrypted store the only
 * durable copy by construction rather than by discipline.
 *
 * SCOPING IS THE SHAPE OF THE DATA. Each app reads exactly one file — its own
 * set merged over `shared` — so kickball cannot read the Mailgun key because
 * that key lives in the `cabinet` set, not because some list in this file says
 * so. Adding a key to the wrong set is the only way to over-share, and that is
 * visible in the store rather than buried in code.
 */
import { chmodSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv, SET_NAME_RE, SHARED_SET } from './store.js';

export interface MaterializeResult {
  /** absolute path -> number of keys written */
  written: Record<string, number>;
  /** set name -> sorted key names in its rendered file */
  effective: Record<string, string[]>;
  /** file names removed because no set produces them any more */
  pruned: string[];
}

const HEADER = '# Rendered by benloe-secrets. Do not edit — edits are lost on the next save.';

function render(pairs: Iterable<[string, string]>): string {
  const lines = [HEADER];
  // Values go out verbatim after the first '=' so base64 padding and PEM
  // bodies survive a round trip untouched.
  for (const [k, v] of pairs) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}

/**
 * Write atomically: render to a temp name in the same directory, then rename
 * over the target. A service starting up mid-write would otherwise read a
 * truncated file and fail as though a variable were simply missing — a
 * confusing failure that looks like a config error rather than a race.
 */
function writeAtomic(path: string, contents: string): void {
  const tmp = `${path}.tmp`;
  // Remove any leftover temp file FIRST. This is not tidiness — it is the
  // difference between recovering and wedging. A temp file surviving an earlier
  // failed render (a SIGKILL between write and rename, tmpfs filling up) is mode
  // 0400, and writeFileSync opens O_WRONLY: an unprivileged uid cannot open its
  // own read-only file for writing, so every subsequent render would fail EACCES
  // forever, with the last good file frozen in place.
  try {
    unlinkSync(tmp);
  } catch {
    /* not there, which is the normal case */
  }
  writeFileSync(tmp, contents, { mode: 0o400 });
  // writeFileSync's mode is subject to the umask, so set it explicitly.
  chmodSync(tmp, 0o400);
  renameSync(tmp, path);
}

/**
 * Delete rendered files that no longer correspond to a set.
 *
 * Without this, removing an app's set — or renaming one — leaves its file
 * behind holding the last secrets it was given, readable for as long as the box
 * stays up. The same applies to the single `env` file the previous
 * single-document design rendered: it contained every key on the box, and
 * nothing in a write-only materialiser would ever have removed it.
 *
 * Only touches names this module could itself have written, so an operator's
 * unrelated file in the directory is left alone.
 */
/** The superseded single-document design rendered every key on the box to one
 *  file called exactly `env` — no set name, no extension, so the `<name>.env`
 *  pattern below never matches it. Leaving it behind would mean every root
 *  service could still read everything, which is precisely what this design
 *  exists to end, so it is named explicitly and always swept. */
const LEGACY_NAMES = new Set(['env', 'env.tmp']);

function prune(dir: string, keep: Set<string>): string[] {
  const removed: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!shouldRemove(entry, keep)) continue;
    try {
      unlinkSync(join(dir, entry));
      removed.push(entry);
    } catch {
      /* already gone, or not ours to remove */
    }
  }
  return removed;
}

function shouldRemove(entry: string, keep: Set<string>): boolean {
  if (LEGACY_NAMES.has(entry)) return true;

  const base = entry.endsWith('.env.tmp')
    ? entry.slice(0, -'.env.tmp'.length)
    : entry.endsWith('.env')
      ? entry.slice(0, -'.env'.length)
      : null;

  // Not a name this module could have written — an operator's own file stays.
  if (base === null || !SET_NAME_RE.test(base)) return false;
  return !keep.has(base);
}

/**
 * Render every set to `dir` as one file per app: `<dir>/<name>.env`.
 *
 * `shared` is never written on its own — it has no consumer, it exists only to
 * be merged into the others. On a key collision THE APP'S SET WINS, so a set
 * can override a shared default without the shared value having to know about
 * it.
 *
 * Mode 0400, owned by this service's uid. Root can read everything regardless —
 * that is unavoidable — but no other uid on the box can, and each app's unit is
 * pointed at its own file alone.
 */
export function materialize(sets: Map<string, string>, dir: string): MaterializeResult {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const shared = parseEnv(sets.get(SHARED_SET) ?? '');
  const written: Record<string, number> = {};
  const effective: Record<string, string[]> = {};

  for (const [name, text] of sets) {
    if (name === SHARED_SET) continue;
    // Defence in depth. Every caller reaches here through store.ts, which
    // validates the name on the way out of the database — but this function is
    // exported, and a name is interpolated into a path below. A hostile row
    // should fail the render closed rather than write outside the directory.
    if (!SET_NAME_RE.test(name)) throw new Error(`refusing to render set with invalid name: ${JSON.stringify(name)}`);

    const merged = new Map(shared);
    for (const [k, v] of parseEnv(text)) merged.set(k, v);

    const path = join(dir, `${name}.env`);
    writeAtomic(path, render(merged));
    written[path] = merged.size;
    effective[name] = [...merged.keys()].sort();
  }

  // Prune only after every write has succeeded. If a render throws halfway, the
  // previous files are still in place and still valid; deleting first would turn
  // a partial failure into missing configuration.
  const pruned = prune(dir, new Set([...sets.keys()].filter((n) => n !== SHARED_SET)));

  return { written, effective, pruned };
}
