// Reproduction of the production failure (2026-08-01): the shutdown latch in
// pendingTurn.ts assumes the process's OWN signal handler (markShutdown) runs
// BEFORE the in-flight turn unwinds its finally block. That ordering does not
// hold when pm2 restarts the app: pm2 signals the whole process tree, so the
// Claude CLI subprocess dies too — and the death of the child rejects
// runtime.run(), which runs /api/chat's finally and deletes the breadcrumb,
// racing the parent's own signal handler.
//
// Symptom: every boot logs "no marker — clean start", so an interrupted chat
// is never resumed. Observed across every restart for weeks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';
import { markShutdown } from '../src/gateway/pendingTurn.js';

const OWNER = 'below413@gmail.com';

const fakeAuthFetch = (async (_url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

let dir: string;
let cabinet: CabinetDb;
let approvals: ApprovalQueue;
let widgetBus: EventEmitter;
let server: Server;
let base: string;

const markerPath = () => join(dir, 'pending-turn.json');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-race-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(() => {
  markShutdown(false);
  server?.close();
  cabinet?.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `run` rejects the way it does in production when pm2 tears down the process
 * tree: the CLI subprocess is killed, so the SDK call fails — and this happens
 * BEFORE the parent process's SIGINT handler gets scheduled. `afterReject`
 * stands in for that late-arriving handler.
 */
async function startApp() {
  const runtime = {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor: async () => null,
    run: async () => {
      // The child died. The SDK surfaces it as a rejection on the next tick —
      // the parent's signal handler has NOT run yet.
      throw new Error('Claude Code process exited with code 143');
    },
  };
  const app = buildApp({
    db: cabinet.db,
    runtime: runtime as never,
    approvals,
    widgetBus,
    ownerEmail: OWNER,
    authFetch: fakeAuthFetch,
    dataDir: dir,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function killTurn(chatId: string) {
  cabinet.db.prepare('INSERT INTO chat (id, title) VALUES (?,?)').run(chatId, 'T');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'token=owner' },
    body: JSON.stringify({ chatId, text: 'Everything ok here? Can you keep working?' }),
  });
  await res.text(); // the route's finally has now run
}

describe('pending-turn breadcrumb vs. a pm2 process-tree teardown', () => {
  // The ordering the latch was designed for, and the only one it handles.
  it('keeps the marker when the signal handler wins the race', async () => {
    await startApp();
    markShutdown(); // SIGINT observed BEFORE the turn unwinds
    await killTurn('chat-1');
    expect(existsSync(markerPath())).toBe(true);
  });

  // The ordering production actually hits: pm2 kills the process tree, the CLI
  // subprocess dies first, and /api/chat's finally runs while the parent's
  // SIGINT handler is still queued. The latch is still false, so the dying
  // turn deletes its own breadcrumb and the next boot resumes nothing.
  it('keeps the marker when the CLI subprocess dies before the signal handler runs', async () => {
    await startApp();
    await killTurn('chat-1');
    markShutdown(); // SIGINT lands a tick too late

    expect(existsSync(markerPath()), 'breadcrumb was deleted by the dying turn — next boot has nothing to resume').toBe(
      true,
    );
  });
});
