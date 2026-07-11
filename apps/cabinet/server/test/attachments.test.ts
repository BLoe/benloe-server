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
import { saveAttachment, MAX_IMAGE_BYTES } from '../src/gateway/attachments.js';

// POST /api/attachments (upload) + GET /api/attachments/:id (serve) — the
// disk+id store backing composer image attachments (§ vision spike,
// 2026-07-11), same read-only-file-server shape as review-shots.

const OWNER = 'below413@gmail.com';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
let attachmentsDir: string;
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
    attachmentsDir,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const asOwner = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Cookie: 'token=owner', ...(init.headers ?? {}) } });
const asAgent = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer benji-key', ...(init.headers ?? {}) } });
const noAuth = (path: string, init: RequestInit = {}) => fetch(base + path, init);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-attach-'));
  attachmentsDir = join(dir, 'chat-images'); // deliberately NOT pre-created — save must mkdir it
  cabinet = openDb(join(dir, 'cabinet.db'));
  approvals = new ApprovalQueue(cabinet.db);
  widgetBus = new EventEmitter();
});

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/attachments', () => {
  it('requires auth', async () => {
    await startApp();
    const res = await noAuth('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }) });
    expect(res.status).toBe(401);
  });

  it('saves a valid png and returns an id ending in .png + the mediaType', async () => {
    await startApp();
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; mediaType: string };
    expect(body.mediaType).toBe('image/png');
    expect(body.id).toMatch(/^[a-f0-9-]+\.png$/);
    expect(existsSync(join(attachmentsDir, body.id))).toBe(true);
    expect(readFileSync(join(attachmentsDir, body.id))).toEqual(PNG_BYTES);
  });

  it('an agent principal can upload too (not owner-only)', async () => {
    await startApp();
    const res = await asAgent('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/jpeg', dataBase64: PNG_BYTES.toString('base64') }) });
    expect(res.status).toBe(201);
  });

  it('400s an unsupported mime type (e.g. svg — not on the allowlist, XSS-relevant)', async () => {
    await startApp();
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/svg+xml', dataBase64: 'aGk=' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unsupported/i);
  });

  it('400s a non-image mime entirely', async () => {
    await startApp();
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'application/pdf', dataBase64: 'aGk=' }) });
    expect(res.status).toBe(400);
  });

  it('400s missing dataBase64', async () => {
    await startApp();
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/png' }) });
    expect(res.status).toBe(400);
  });

  it('400s a decoded payload over MAX_IMAGE_BYTES — server-side, never trusting the client', async () => {
    await startApp();
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1).toString('base64');
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/png', dataBase64: big }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/i);
  }, 20_000);

  it('an image right at the cap is accepted', async () => {
    await startApp();
    const exact = Buffer.alloc(MAX_IMAGE_BYTES, 2).toString('base64');
    const res = await asOwner('/api/attachments', { method: 'POST', body: JSON.stringify({ mediaType: 'image/png', dataBase64: exact }) });
    expect(res.status).toBe(201);
  }, 20_000);
});

describe('GET /api/attachments/:id', () => {
  it('requires auth', async () => {
    await startApp();
    const { id } = saveAttachment(attachmentsDir, 'image/png', PNG_BYTES.toString('base64'));
    expect((await noAuth(`/api/attachments/${id}`)).status).toBe(401);
  });

  it('serves the exact bytes with the right content-type under the OWNER cookie session — the path an <img> tag actually uses (no Bearer header available to it)', async () => {
    await startApp();
    const { id } = saveAttachment(attachmentsDir, 'image/png', PNG_BYTES.toString('base64'));
    const res = await fetch(base + `/api/attachments/${id}`, { headers: { Cookie: 'token=owner' } }); // no Content-Type/json — a real <img> GET
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('an agent bearer key also works (not owner-only)', async () => {
    await startApp();
    const { id } = saveAttachment(attachmentsDir, 'image/jpeg', PNG_BYTES.toString('base64'));
    const res = await asAgent(`/api/attachments/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('404s a well-formed but nonexistent id', async () => {
    await startApp();
    const res = await asOwner('/api/attachments/00000000-0000-0000-0000-000000000000.png');
    expect(res.status).toBe(404);
  });

  it('400s an invalid extension', async () => {
    await startApp();
    const res = await asOwner('/api/attachments/whatever.txt');
    expect(res.status).toBe(400);
  });

  it('rejects an encoded-slash traversal attempt', async () => {
    await startApp();
    const res = await asOwner('/api/attachments/' + encodeURIComponent('../cabinet.db'));
    expect(res.status).toBe(400);
  });
});
