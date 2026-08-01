// The gateway half of the "self-deploy that doesn't drop the conversation"
// loop (2026-08-01). Its sibling half is the `redeploy` privop in
// /usr/local/sbin/cabinet-privops (source of truth:
// infra/scripts/cabinet-privops.sh).
//
// Flow:
//   1. Cabinet finishes editing/building/committing, then calls
//      `cabinet-privops redeploy cabinet-api`. That returns IMMEDIATELY.
//   2. The privop records what it is about to do — the build we are on now,
//      the build we are moving to, the commit subject — into
//      <dataDir>/deploy-intent.json, then detaches a restarter that DRAINS
//      (waits for /healthz to report no turn in flight) before restarting.
//      So in the normal case the turn that asked for the deploy gets to
//      finish speaking first.
//   3. The new process boots and reads that file back. It now knows the
//      restart it just went through was a deploy, not a crash — and can say
//      so, in the chat where Ben was actually working.
//
// This replaces the last-deploy.json path (deploy/pendingConfirmation.ts),
// which was driven by infra/scripts/cabinet-deploy.sh and has been dead since
// 2026-07-16: Cabinet now calls the privop directly, so nothing wrote that
// file and no deploy has been announced since. The difference that matters
// to Ben: the confirmation lands in HIS chat, not in a separate sys-deploy
// log he never reads.
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const INTENT = 'deploy-intent.json';

export interface DeployIntent {
  app: string;
  requestedAt: string;
  /** buildMarker of the process that was running when the deploy was asked for. */
  fromSha?: string;
  /** The commit the restart is expected to bring live. */
  toSha?: string;
  subject?: string;
  /** Did the restarter get to a quiet moment, or did it hit its cap and cut in? */
  drained?: boolean;
  waitedSeconds?: number;
}

/**
 * Read-and-consume, like takePendingTurn. Consuming FIRST means a boot loop
 * can never re-announce the same deploy forever — the announcement is a
 * nicety, and a nicety must not be able to wedge startup.
 */
export function takeDeployIntent(dataDir: string): DeployIntent | null {
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, INTENT), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('deployIntent: unreadable intent file, dropping —', err instanceof Error ? err.message : err);
      clearDeployIntent(dataDir);
    }
    return null;
  }
  clearDeployIntent(dataDir);
  try {
    const intent = JSON.parse(raw) as DeployIntent;
    return typeof intent?.app === 'string' ? intent : null;
  } catch (err) {
    console.error('deployIntent: corrupt intent file, dropping —', err instanceof Error ? err.message : err);
    return null;
  }
}

export function clearDeployIntent(dataDir: string): void {
  try {
    unlinkSync(join(dataDir, INTENT));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('deployIntent: failed to clear intent file —', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * The line Ben sees. Deliberately reports the VERIFIED state (what actually
 * came up) rather than what the deploy hoped for: the whole reason this
 * machinery exists is that "build+commit+push succeeded" was being mistaken
 * for "the new code is running", three separate times.
 */
export function formatDeployReport(intent: DeployIntent, liveSha: string): string {
  const short = (s?: string) => (s && s !== 'unknown' ? s.slice(0, 12) : null);
  const from = short(intent.fromSha);
  const to = short(intent.toSha);
  const live = short(liveSha);

  const landed = !!to && !!live && to === live;
  // No toSha recorded (older privop, or git was unreadable) — fall back to
  // "did the running build change at all", which is still the honest signal.
  const changed = !!from && !!live && from !== live;
  const ok = landed || (!to && changed);

  const head = ok ? '✓ Self-deploy landed' : '⚠ Self-deploy did not land the expected build';
  const bits: string[] = [];
  if (from && live && from !== live) bits.push(`${from} → ${live}`);
  else if (live) bits.push(`running ${live}`);
  if (intent.subject) bits.push(intent.subject);
  if (!ok && to && live && to !== live) bits.push(`expected ${to}`);
  if (intent.drained === false) {
    bits.push(`restart cut in after waiting ${intent.waitedSeconds ?? '?'}s for the turn to finish`);
  }
  return `${head} — ${bits.join(' · ')}`;
}
