import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { persistAssistantMessage, systemChat } from '../gateway/transcript.js';

interface DeployStatus {
  targetSha: string;
  confirmedSha: string | null;
  ok: boolean;
  ts: string;
  attempts: number;
  commitSubject: string;
  acked: boolean;
}

/**
 * Runs once at startup (index.ts, right after the DB opens) — the half of
 * the self-deploy loop that lives INSIDE the freshly-restarted process.
 * infra/scripts/cabinet-deploy.sh builds+commits+pushes, then hands off to a
 * single detached cabinet-deploy-watch.sh child (setsid, survives the pm2
 * teardown it triggers) which calls the already-allowed `cabinet-privops
 * redeploy` privop, polls /healthz for the new buildMarker, self-heals with
 * one re-fire if the restart doesn't take, and writes the verified outcome
 * to <dataDir>/last-deploy.json. This function reads that file and answers
 * one question: "was I the restart a pending deploy was waiting for?"
 *
 * Deliberately gated on sha match alone, NOT on the watcher's own `ok`
 * verdict — if the watcher's poll timed out and gave up (e.g. a slow start
 * past its budget) but this process genuinely comes up matching moments
 * later, the confirmation still fires on that truth instead of staying
 * silent forever because a background poller quit early.
 *
 * Closes the exact trap that shipped stale buildMarkers 3x during the
 * chat-UX work: build+commit+push succeeding while the separate restart
 * step got forgotten, with no way to notice short of manually re-checking
 * healthz. Returns whether it posted (for the caller's own logging/tests).
 */
export function applyPendingDeployConfirmation(db: Database.Database, dataDir: string, liveSha: string): boolean {
  const statusFile = join(dataDir, 'last-deploy.json');
  if (!existsSync(statusFile)) return false;

  let status: DeployStatus;
  try {
    status = JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch (err) {
    console.error(
      'pendingConfirmation: unreadable/corrupt last-deploy.json, skipping —',
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  if (status.acked) return false;
  if (status.targetSha !== liveSha) return false; // not the restart this marker was waiting for (yet)

  const chatId = systemChat(db, 'sys-deploy', 'user', 'Deploys');
  persistAssistantMessage(db, chatId, [
    { type: 'text', text: `✓ Deployed ${liveSha} — ${status.commitSubject}, verified live` },
  ]);
  db.prepare("UPDATE chat SET updated_at = datetime('now') WHERE id = ?").run(chatId);

  try {
    writeFileSync(statusFile, JSON.stringify({ ...status, acked: true }, null, 2));
  } catch (err) {
    console.error(
      'pendingConfirmation: posted confirmation but failed to ack last-deploy.json — will re-post next restart —',
      err instanceof Error ? err.message : err,
    );
  }
  return true;
}

/**
 * Wraps applyPendingDeployConfirmation in a short bounded poll, started once
 * at process boot (index.ts). Necessary because of a chicken-and-egg baked
 * into the design: cabinet-deploy-watch.sh can only confirm a match by
 * polling THIS process's own /healthz — which means, by construction, it
 * writes last-deploy.json strictly AFTER this process has already booted.
 * A single check at import time will find nothing every single time no
 * matter how fast the watcher runs (measured in production: the watcher's
 * status-file write landed ~3s after this process's own pm2 created_at —
 * i.e. after its one-shot startup check had already run and skipped).
 * Polling for a while instead of asserting the marker is already there is
 * what actually closes the loop.
 *
 * Tick-counted rather than Date.now()-deadlined so it's deterministic under
 * fake timers in tests, and so it doesn't depend on wall-clock drift.
 * Cheap on the vastly more common case (a boot with no pending deploy at
 * all — crash-restart, manual pm2 restart, host reboot): an existsSync
 * check every couple seconds, self-cancelling the moment it posts or the
 * window elapses. `unref()`'d so it never keeps the process alive on its
 * own.
 */
export function schedulePendingDeployConfirmationWatch(
  db: Database.Database,
  dataDir: string,
  liveSha: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): void {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const maxTicks = Math.ceil(timeoutMs / pollMs);
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    let posted = false;
    try {
      posted = applyPendingDeployConfirmation(db, dataDir, liveSha);
    } catch (err) {
      console.error('pendingConfirmation: poll tick failed —', err instanceof Error ? err.message : err);
    }
    if (posted || ticks >= maxTicks) clearInterval(timer);
  }, pollMs);
  timer.unref?.();
}
