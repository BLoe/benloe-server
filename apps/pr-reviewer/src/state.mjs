/**
 * Which PR head SHAs have already been reviewed.
 *
 * Keyed on head SHA, not PR number: pushing new commits to an open PR SHOULD
 * earn a fresh review, and re-reviewing an unchanged branch every five minutes
 * would burn Ben's rate limit for no new information.
 *
 * A plain JSON file rather than SQLite — this is a few dozen short strings
 * with one writer, and a dependency (or a migration story) would cost more
 * than it returns.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Entries older than this are pruned, so the ledger cannot grow forever. */
const RETAIN_DAYS = 90;

export function loadState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    // Tolerate a hand-edited or truncated file rather than crashing the timer:
    // the worst case of a reset ledger is one duplicate review, whereas a
    // crash-looping poller reviews nothing at all until someone notices.
    if (parsed && typeof parsed === 'object' && parsed.reviewed && typeof parsed.reviewed === 'object') {
      return parsed;
    }
    return { reviewed: {} };
  } catch {
    return { reviewed: {} };
  }
}

export function saveState(path, state, now = new Date()) {
  const cutoff = now.getTime() - RETAIN_DAYS * 86_400_000;
  const reviewed = {};
  for (const [sha, at] of Object.entries(state.reviewed)) {
    if (Date.parse(at) >= cutoff) reviewed[sha] = at;
  }
  mkdirSync(dirname(path), { recursive: true });
  // Write-then-rename: a timer killed mid-write must not leave a truncated
  // ledger behind, because loadState would then silently re-review everything.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ reviewed }, null, 2)}\n`);
  renameSync(tmp, path);
}

export const wasReviewed = (state, sha) => Boolean(state.reviewed[sha]);

export function markReviewed(state, sha, now = new Date()) {
  state.reviewed[sha] = now.toISOString();
  return state;
}
