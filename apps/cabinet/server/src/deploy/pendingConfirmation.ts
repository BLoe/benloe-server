import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { persistAssistantMessage, systemThread } from '../gateway/transcript.js';

// First commit verified end-to-end through infra/scripts/cabinet-deploy.sh
// itself (the wrapper's own inaugural shipment went out the old manual way,
// since it couldn't confirm its own first deploy) — this comment is that
// proof run.
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

  const threadId = systemThread(db, 'sys-deploy', 'user', 'Deploys');
  persistAssistantMessage(db, threadId, [
    { type: 'text', text: `✓ Deployed ${liveSha} — ${status.commitSubject}, verified live` },
  ]);
  db.prepare("UPDATE thread SET updated_at = datetime('now') WHERE id = ?").run(threadId);

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
