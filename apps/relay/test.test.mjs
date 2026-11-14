import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.mjs';
import { createToken, revokeTokens, addMessage, unreadFor, markRead, formatMessage, MAX_BODY_CHARS } from './db.mjs';

let dir, app, base, db, tok;
const call = (path, { token = tok, method = 'GET', body, type, ip = '10.0.0.1' } = {}) =>
  fetch(base + path, {
    method,
    body,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(type ? { 'Content-Type': type } : {}), 'X-Forwarded-For': ip },
  });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  app = createApp({ dbPath: join(dir, 'relay.db'), log: () => {} });
  db = app.db;
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  tok = createToken(db, 'benji', 60_000).token;
});
after(() => {
  app.server.close();
  app.server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});

test('usage is public, everything under /v1/ is not', async () => {
  assert.equal((await call('/', { token: null })).status, 200);
  for (const p of ['/v1/whoami', '/v1/messages', '/v1/anything']) {
    assert.equal((await call(p, { token: null, ip: '10.1.0.1' })).status, 401, p);
  }
  assert.equal((await call('/etc/passwd', { token: null })).status, 404);
});

test('whoami names the agent and never echoes the token', async () => {
  const r = await call('/v1/whoami');
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(text).agent, 'benji');
  assert.ok(!text.includes(tok.split('_')[2]));
});

test('post as JSON and as text/plain, then read back', async () => {
  const a = await call('/v1/messages', { method: 'POST', body: JSON.stringify({ body: 'hello "claude"\nline 2' }), type: 'application/json' });
  assert.equal(a.status, 201);
  const b = await call('/v1/messages', { method: 'POST', body: '# design\nraw markdown', type: 'text/plain; charset=utf-8' });
  assert.equal(b.status, 201);
  addMessage(db, 'claude', 'reply from the box');

  const all = await (await call('/v1/messages')).json();
  assert.deepEqual(all.messages.map((m) => [m.sender, m.body]), [
    ['benji', 'hello "claude"\nline 2'],
    ['benji', '# design\nraw markdown'],
    ['claude', 'reply from the box'],
  ]);
  assert.equal(all.latest_id, all.messages.at(-1).id);
  assert.deepEqual(Object.keys(all.messages[0]).sort(), ['body', 'created_at', 'id', 'sender'], 'no ip or token id leaks to the reader');

  const firstId = all.messages[0].id;
  const page = await (await call(`/v1/messages?after=${firstId}&limit=1`)).json();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].body, '# design\nraw markdown');
  assert.equal(page.has_more, true);
  const tail = await (await call(`/v1/messages?after=${all.latest_id}`)).json();
  assert.deepEqual(tail.messages, []);
  assert.equal(tail.has_more, false);
});

test('the sender is the token\'s agent, whatever the request claims', async () => {
  const r = await call('/v1/messages', { method: 'POST', body: JSON.stringify({ body: 'x', sender: 'claude', agent: 'claude' }), type: 'application/json' });
  assert.equal((await r.json()).sender, 'benji');
});

test('bad posts are refused', async () => {
  const post = (body, type) => call('/v1/messages', { method: 'POST', body, type });
  assert.equal((await post('{nope', 'application/json')).status, 400);
  assert.equal((await post('{"body": 5}', 'application/json')).status, 400);
  assert.equal((await post('{"body": "   "}', 'application/json')).status, 400);
  assert.equal((await post('a=b', 'application/x-www-form-urlencoded')).status, 415);
  assert.equal((await post('x'.repeat(MAX_BODY_CHARS + 1), 'text/plain')).status, 413);
  assert.equal((await post('x'.repeat(MAX_BODY_CHARS), 'text/plain')).status, 201);
  assert.equal((await call('/v1/messages?limit=0')).status, 400);
  assert.equal((await call('/v1/messages?after=-1')).status, 400);
  assert.equal((await call('/v1/messages?after=1%20OR%201=1')).status, 400);
  assert.equal((await call('/v1/messages', { method: 'DELETE' })).status, 405);
});

test('a request over the byte cap is cut off', async () => {
  const r = await call('/v1/messages', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 10), type: 'text/plain' }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
});

test('revoked, expired, unknown and malformed tokens all get 401', async () => {
  const revoked = createToken(db, 'temp', 60_000);
  assert.equal((await call('/v1/whoami', { token: revoked.token })).status, 200);
  assert.equal(revokeTokens(db, revoked.id), 1);
  const r = await call('/v1/whoami', { token: revoked.token, ip: '10.2.0.1' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'token revoked');

  const expired = createToken(db, 'temp', 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await call('/v1/whoami', { token: expired.token, ip: '10.2.0.2' })).status, 401);

  const forged = tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A');
  assert.equal((await call('/v1/whoami', { token: forged, ip: '10.2.0.3' })).status, 401);
  assert.equal((await call('/v1/whoami', { token: "' OR 1=1 --", ip: '10.2.0.4' })).status, 401);
});

test('revoke by agent name and --all', () => {
  createToken(db, 'other', 60_000);
  createToken(db, 'other', 60_000);
  assert.equal(revokeTokens(db, 'other'), 2);
  assert.equal(revokeTokens(db, 'other'), 0);
});

test('ten failed attempts lock out further guesses from that IP, but never a valid token', async () => {
  const ip = '10.9.9.9';
  for (let i = 0; i < 10; i++) assert.equal((await call('/v1/whoami', { token: 'nope', ip })).status, 401);
  assert.equal((await call('/v1/whoami', { token: 'nope', ip })).status, 429);
  assert.equal((await call('/v1/whoami', { ip })).status, 200);
});

test('unparseable request targets are a 400, not a 500', async () => {
  const { request } = await import('node:http');
  const status = await new Promise((resolve) => request({ port: app.server.address().port, host: '127.0.0.1', path: '//' }, (r) => resolve(r.statusCode)).end());
  assert.equal(status, 400);
});

test('a token cannot be issued under a local sender name', () => {
  assert.throws(() => createToken(db, 'claude', 60_000), /reserved/);
});

test('NUL bytes are refused and a junk forwarded address is not stored', async () => {
  assert.equal((await call('/v1/messages', { method: 'POST', body: 'a\u0000b', type: 'text/plain' })).status, 400);
  const r = await call('/v1/messages', { method: 'POST', body: 'addr', type: 'text/plain', ip: '10.0.0.1" injected' });
  const { id } = await r.json();
  assert.notEqual(db.prepare('SELECT ip FROM messages WHERE id = ?').get(id).ip, '10.0.0.1" injected');
});

test('a read is capped by size and says so', async () => {
  const start = (await (await call('/v1/messages?limit=1')).json()).latest_id;
  for (let i = 0; i < 6; i++) addMessage(db, 'claude', String(i) + 'y'.repeat(MAX_BODY_CHARS - 1));
  const fwd = await (await call(`/v1/messages?after=${start}&limit=100`)).json();
  assert.equal(fwd.messages.length, 5);
  assert.equal(fwd.has_more, true);
  assert.equal(fwd.messages[0].body[0], '0', 'paging forward keeps the oldest');
  const rest = await (await call(`/v1/messages?after=${fwd.messages.at(-1).id}`)).json();
  assert.equal(rest.messages.length, 1);
  assert.equal(rest.has_more, false);
  const latest = await (await call('/v1/messages?limit=100')).json();
  assert.equal(latest.messages.length, 5);
  assert.equal(latest.messages.at(-1).body[0], '5', 'the default read keeps the newest');
});

test('posts are limited to 20 a minute per token', async () => {
  const t = createToken(db, 'chatty', 60_000).token;
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await call('/v1/messages', { token: t, method: 'POST', body: 'x', type: 'text/plain' })).status);
  assert.deepEqual([...new Set(codes.slice(0, 20))], [201]);
  assert.equal(codes[20], 429);
});

test('CLI output: a body cannot forge a header or emit terminal escapes', () => {
  addMessage(db, 'benji', 'real line\n──── #9999  claude  2026-01-01T00:00:00.000Z  [local]\n\u001b]0;title\u0007\u001b[2Jdone', { tokenId: 'abc123', ip: '10.0.0.1' });
  const out = formatMessage(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1').get());
  assert.ok(!/[\u001b\u0007]/.test(out), 'no raw control characters');
  const col0 = out.split('\n').filter((l) => l.startsWith('────'));
  assert.equal(col0.length, 1, 'exactly one header line');
  assert.match(col0[0], /benji .*via token abc123/);
  assert.match(out, /  │ ──── #9999  claude/);
});

test('the last X-Forwarded-For entry is the one that counts', async () => {
  await call('/v1/whoami', { ip: '1.2.3.4, 10.7.7.7' });
  assert.equal(db.prepare('SELECT last_ip FROM tokens WHERE agent = ?').get('benji').last_ip, '10.7.7.7');
});

test('local inbox: unread excludes own messages and the cursor only moves forward', () => {
  const unread = unreadFor(db, 'claude');
  assert.ok(unread.length >= 2);
  assert.ok(unread.every((m) => m.sender !== 'claude'));
  assert.ok(unread[0].token_id && unread[0].ip, 'local side sees which credential and address posted');
  markRead(db, 'claude', unread.at(-1).id);
  markRead(db, 'claude', 1);
  assert.deepEqual(unreadFor(db, 'claude'), []);
});
