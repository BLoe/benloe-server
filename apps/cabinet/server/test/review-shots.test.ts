import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';

// GET /api/review-shots (list) + GET /api/review-shots/:name (bytes) — a
// read-only file server scoped to one directory and two extensions, so a
// peer agent (e.g. benji) can retrieve screenshots taken during dev-server
// QA that otherwise only exist on this VPS's disk.

const OWNER = 'below413@gmail.com';

const fakeAuthFetch = (async (url: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  const authz = String((init?.headers as Record<string, string>)?.Authorization ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER } }), { status: 200 });
  if (authz.includes('benji')) return new Response(JSON.stringify({ user: { email: 'benji@agents.benloe.com', name: 'benji', role: 'agent' } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

function fakeRuntime() {
  return {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor: async () => null,
    run: async () => ({ stopReason: 'success', sessionId: 's1' }),
  };
}

let dir: string;
let shotsDir: string;
let cabinet: CabinetDb;
let approvals: ApprovalQueue;
let widgetBus: EventEmitter;
let server: Server;
let base: string;

async function startApp() {
  const app = buildApp({
    db: cabinet.db,
    runtime: fakeRuntime() as never,
    approvals,
    widgetBus,
    ownerEmail: OWNER,
    authFetch: fakeAuthFetch,
    reviewShotsDir: shotsDir,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const asOwner = (path: string) => fetch(base + path, { headers: { Cookie: 'token=owner' } });
const asAgent = (path: string) => fetch(base + path, { headers: { Authorization: 'Bearer benji-key' } });
const noAuth = (path: string) => fetch(base + path);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-shots-'));
  shotsDir = join(dir, 'review-screenshots');
  mkdirSync(shotsDir, { recursive: true });
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/review-shots', () => {
  it('requires auth', async () => {
    await startApp();
    expect((await noAuth('/api/review-shots')).status).toBe(401);
  });

  it('returns an empty list when the dir has nothing (or does not exist yet)', async () => {
    rmSync(shotsDir, { recursive: true, force: true }); // doesn't exist at all
    await startApp();
    const res = await asOwner('/api/review-shots');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shots: [] });
  });

  it('lists only .png/.jpg/.jpeg, newest first, ignores other extensions', async () => {
    writeFileSync(join(shotsDir, 'a.png'), 'aaa');
    await new Promise((r) => setTimeout(r, 5));
    writeFileSync(join(shotsDir, 'b.jpg'), 'bbbb');
    await new Promise((r) => setTimeout(r, 5));
    writeFileSync(join(shotsDir, 'c.jpeg'), 'ccccc');
    writeFileSync(join(shotsDir, 'notes.txt'), 'not a shot');
    writeFileSync(join(shotsDir, 'no-ext'), 'nope');

    await startApp();
    const res = await asAgent('/api/review-shots');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shots: { name: string; size: number; mtime: string }[] };
    expect(body.shots.map((s) => s.name)).toEqual(['c.jpeg', 'b.jpg', 'a.png']); // newest first
    expect(body.shots.find((s) => s.name === 'c.jpeg')?.size).toBe(5);
    for (const s of body.shots) expect(typeof s.mtime).toBe('string');
  });
});

describe('GET /api/review-shots/:name', () => {
  it('requires auth', async () => {
    writeFileSync(join(shotsDir, 'a.png'), 'aaa');
    await startApp();
    expect((await noAuth('/api/review-shots/a.png')).status).toBe(401);
  });

  it('serves bytes with the correct content-type', async () => {
    writeFileSync(join(shotsDir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(shotsDir, 'shot.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    await startApp();

    const png = await asOwner('/api/review-shots/shot.png');
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await png.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const jpg = await asOwner('/api/review-shots/shot.jpg');
    expect(jpg.status).toBe(200);
    expect(jpg.headers.get('content-type')).toBe('image/jpeg');
  });

  it('404s a well-formed but nonexistent name', async () => {
    await startApp();
    const res = await asOwner('/api/review-shots/missing.png');
    expect(res.status).toBe(404);
  });

  it('400s an invalid extension', async () => {
    writeFileSync(join(shotsDir, 'shot.txt'), 'hi');
    await startApp();
    const res = await asOwner('/api/review-shots/shot.txt');
    expect(res.status).toBe(400);
  });

  it('rejects an encoded-slash traversal attempt (../ smuggled as %2e%2e%2f)', async () => {
    // A secret file OUTSIDE the shots dir, one level up — the attack target.
    writeFileSync(join(dir, 'secret.png'), 'top secret');
    await startApp();
    const res = await asOwner('/api/review-shots/' + encodeURIComponent('../secret.png'));
    expect(res.status).toBe(400);
  });

  it('never leaks a file outside the dir via raw slashes in the URL', async () => {
    writeFileSync(join(dir, 'secret.png'), 'top secret');
    await startApp();
    const res = await asOwner('/api/review-shots/../secret.png');
    // Express itself won't route raw ../ into a single :name segment; either
    // way, 200-with-the-secret-bytes must never happen.
    expect(res.status).not.toBe(200);
  });

  it('rejects a name with no extension at all', async () => {
    writeFileSync(join(shotsDir, 'noext'), 'hi');
    await startApp();
    const res = await asOwner('/api/review-shots/noext');
    expect(res.status).toBe(400);
  });
});
