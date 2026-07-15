import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type CabinetDb } from '../src/db/index.js';
import { ApprovalQueue } from '../src/tiers/approvals.js';
import { buildApp } from '../src/gateway/app.js';
import { createSseParser, type SseEvent } from '../src/gateway/sse.js';
import { interlocutorLine } from '../src/runtime/prompt.js';

const OWNER = 'below413@gmail.com';
const fakeAuthFetch = (async (_u: string | URL, init?: RequestInit) => {
  const cookie = String((init?.headers as Record<string, string>)?.Cookie ?? '');
  const authz = String((init?.headers as Record<string, string>)?.Authorization ?? '');
  if (cookie.includes('token=owner')) return new Response(JSON.stringify({ user: { email: OWNER, name: 'Ben', role: 'admin' } }), { status: 200 });
  if (authz.includes('benji')) return new Response(JSON.stringify({ user: { email: 'benji@agents.benloe.com', name: 'benji', role: 'agent' } }), { status: 200 });
  return new Response('nope', { status: 401 });
}) as typeof fetch;

let dir: string; let cabinet: CabinetDb; let server: Server; let base: string;
let captured: { interlocutor?: { name: string; role: string; isOwner: boolean } } | null;

async function start() {
  captured = null;
  const runtime = {
    authMode: 'subscription' as const,
    queue: { depth: 0 },
    interrupt: () => true,
    titleFor: async () => null,
    run: async (req: { promptInput?: typeof captured }) => {
      captured = req.promptInput ?? null;
      return { stopReason: 'success', sessionId: 's' };
    },
  };
  const app = buildApp({ db: cabinet.db, runtime: runtime as never, approvals: new ApprovalQueue(cabinet.db), widgetBus: new EventEmitter(), ownerEmail: OWNER, authFetch: fakeAuthFetch });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const call = (p: string, cred: string, init: RequestInit = {}) =>
  fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(cred === 'owner' ? { Cookie: 'token=owner' } : { Authorization: 'Bearer agk_benji' }), ...(init.headers ?? {}) } });
async function drain(res: Response) { const p = createSseParser(() => {}); const rd = res.body!.getReader(); const d = new TextDecoder(); for (;;) { const { done, value } = await rd.read(); if (done) break; p(d.decode(value)); } }

beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'cabinet-attr-')); cabinet = openDb(join(dir, 'cabinet.db')); await start(); });
afterEach(async () => { await new Promise((r) => server.close(r)); cabinet.close(); rmSync(dir, { recursive: true, force: true }); });

describe('identity attribution', () => {
  it('stamps created_by on a chat the principal opens', async () => {
    const { id } = await (await call('/api/chats', 'benji', { method: 'POST', body: '{}' })).json();
    const row = cabinet.db.prepare('SELECT created_by FROM chat WHERE id = ?').get(id) as { created_by: string };
    expect(row.created_by).toBe('benji@agents.benloe.com');
  });

  it('stamps a user message with its author and tells the runtime who it is (agent)', async () => {
    const { id } = await (await call('/api/chats', 'benji', { method: 'POST', body: '{}' })).json();
    await drain(await call('/api/chat', 'benji', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'a suggestion' }) }));
    const msg = cabinet.db.prepare("SELECT author FROM message WHERE chat_id = ? AND role = 'user'").get(id) as { author: string };
    expect(msg.author).toBe('benji@agents.benloe.com');
    expect(captured?.interlocutor).toMatchObject({ name: 'benji', role: 'agent', isOwner: false });
  });

  it('attributes the owner as principal', async () => {
    const { id } = await (await call('/api/chats', 'owner', { method: 'POST', body: '{}' })).json();
    await drain(await call('/api/chat', 'owner', { method: 'POST', body: JSON.stringify({ chatId: id, text: 'hi' }) }));
    const msg = cabinet.db.prepare("SELECT author FROM message WHERE chat_id = ? AND role = 'user'").get(id) as { author: string };
    expect(msg.author).toBe(OWNER);
    expect(captured?.interlocutor).toMatchObject({ isOwner: true });
  });
});

describe('interlocutorLine', () => {
  it('frames the owner as the principal', () => {
    expect(interlocutorLine({ name: 'Ben', role: 'admin', isOwner: true })).toContain('your principal');
  });
  it('frames an agent as a trusted peer, explicitly NOT the principal', () => {
    const l = interlocutorLine({ name: 'Benji', role: 'agent', isOwner: false });
    expect(l).toContain('Benji');
    expect(l).toContain('trusted peer');
    expect(l).toMatch(/NOT as your principal/);
  });
});
