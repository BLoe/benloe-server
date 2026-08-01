// The seam the unit tests never covered: does /api/chat actually leave a
// pending-turn.json breadcrumb on disk for the WHOLE time a turn is running?
// pending-turn.test.ts calls markTurnInFlight() directly, so it proves the
// module works while saying nothing about whether the route wires it up.
// Production evidence (2026-08-01): every boot logged "no marker — clean
// start" even when a turn was demonstrably killed mid-flight.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';
import type { TurnEvent } from '../src/runtime/agent.js';

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

/** Starts the app with a scripted runtime; `duringRun` observes the world at
 *  the exact moment the turn is in flight — which is when the breadcrumb has
 *  to exist, because that is when a self-redeploy kills the process. */
async function startApp(duringRun: () => void) {
  const runtime = {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor: async () => null,
    run: async (req: { chatId: string; onEvent: (e: TurnEvent) => void }) => {
      duringRun();
      req.onEvent({ type: 'text-delta', delta: 'partial' } as TurnEvent);
      return { stopReason: 'success', sessionId: 's1' };
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-pt-route-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(() => {
  server?.close();
  cabinet?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function post(chatId: string, text: string) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'token=owner' },
    body: JSON.stringify({ chatId, text }),
  });
  await res.text(); // drain the SSE stream so the route's finally has run
  return res;
}

describe('/api/chat pending-turn breadcrumb', () => {
  it('writes the marker for the duration of the turn and clears it on a clean finish', async () => {
    let markerDuringTurn: string | null = null;
    await startApp(() => {
      markerDuringTurn = existsSync(markerPath()) ? readFileSync(markerPath(), 'utf8') : null;
    });

    const chatId = 'chat-1';
    cabinet.db.prepare('INSERT INTO chat (id, title) VALUES (?,?)').run(chatId, 'T');

    await post(chatId, 'the question that must survive a restart');

    // THE assertion: mid-turn, the breadcrumb is on disk.
    expect(markerDuringTurn, 'no pending-turn.json existed while the turn was running').not.toBeNull();
    expect(JSON.parse(markerDuringTurn!)).toMatchObject({
      chatId,
      promptHead: 'the question that must survive a restart',
    });

    // And a clean finish stands it down, so the next boot does not resume.
    expect(existsSync(markerPath())).toBe(false);
  });
});
