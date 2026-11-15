import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.mjs';
import { createToken, revokeTokens, addMessage, unreadFor, markRead, formatMessage, formatWithin, inboxBatch, openDb, checkToken, MAX_BODY_CHARS } from './db.mjs';

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
  assert.ok(!text.includes(tok.slice(11)), 'the secret part of the token');
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
  assert.equal(all.next_after, all.messages.at(-1).id);
  assert.deepEqual(Object.keys(all.messages[0]).sort(), ['body', 'created_at', 'id', 'sender'], 'no ip or token id leaks to the reader');

  const firstId = all.messages[0].id;
  const page = await (await call(`/v1/messages?after=${firstId}&limit=1`)).json();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].body, '# design\nraw markdown');
  assert.equal(page.has_more, true);
  assert.equal(page.next_after, page.messages[0].id, 'next_after is the last id sent, not the newest in the channel');
  const tail = await (await call(`/v1/messages?after=${all.next_after}`)).json();
  assert.deepEqual(tail.messages, []);
  assert.equal(tail.next_after, all.next_after, 'an empty read hands the cursor back unchanged');
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
  const r = await call('/v1/messages', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 10), type: 'text/plain' });
  assert.equal(r.status, 413);
  assert.equal((await call('/v1/whoami')).status, 200, 'and the server is still answering');
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

test('revoke by agent name', () => {
  createToken(db, 'other', 60_000);
  createToken(db, 'other', 60_000);
  assert.equal(revokeTokens(db, 'other'), 2);
  assert.equal(revokeTokens(db, 'other'), 0);
});

test('revoke --all kills every live token', () => {
  const d = mkdtempSync(join(tmpdir(), 'relay-all-'));
  const other = openDb(join(d, 'relay.db'));
  const a = createToken(other, 'a', 60_000);
  const b = createToken(other, 'b', 60_000);
  assert.equal(revokeTokens(other, '--all'), 2);
  assert.equal(checkToken(other, a.token).reason, 'token revoked');
  assert.equal(checkToken(other, b.token).reason, 'token revoked');
  other.close();
  rmSync(d, { recursive: true, force: true });
});

test('display budget counts what is printed, so nothing unseen is marked read', () => {
  // Control characters print as 4, and every line gains a prefix.
  const worst = { id: 1, sender: 'benji', created_at: 't', token_id: 'x', ip: '1.1.1.1', body: '\u0001'.repeat(12_000) };
  const lines = { ...worst, id: 2, body: '\n'.repeat(11_000) + 'end' };
  for (const m of [worst, lines]) {
    const out = formatMessage(m, { maxChars: 10_000 });
    assert.ok(out.length < 10_400, `printed ${out.length}`);
    assert.match(out, /truncated: message is \d+ characters\. Full text: relay show/);
  }
  const { text, shown } = formatWithin([worst, lines, { ...worst, id: 3 }], { perMessage: 10_000, budget: 24_000 });
  assert.equal(shown.length, 2);
  assert.ok(text.join('').length <= 24_000);
  assert.equal(formatWithin([worst], { perMessage: 10_000, budget: 10 }).shown.length, 1, 'always at least one');
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
  const start = (await (await call('/v1/messages?limit=1')).json()).next_after;
  for (let i = 0; i < 6; i++) addMessage(db, 'claude', String(i) + 'y'.repeat(MAX_BODY_CHARS - 1));
  const fwd = await (await call(`/v1/messages?after=${start}&limit=100`)).json();
  assert.equal(fwd.messages.length, 5);
  assert.equal(fwd.has_more, true);
  assert.equal(fwd.messages[0].body[0], '0', 'paging forward keeps the oldest');
  assert.equal(fwd.next_after, fwd.messages.at(-1).id);
  const rest = await (await call(`/v1/messages?after=${fwd.next_after}`)).json();
  assert.equal(rest.messages.length, 1);
  assert.equal(rest.has_more, false);
  const latest = await (await call('/v1/messages?limit=100')).json();
  assert.equal(latest.messages.length, 5);
  assert.equal(latest.messages.at(-1).body[0], '5', 'the default read keeps the newest');
  assert.equal(latest.older_omitted, true, 'and says it left older ones out');
  assert.equal(latest.has_more, false);
});

test('posts are limited to 20 a minute per token', async () => {
  const t = createToken(db, 'chatty', 60_000).token;
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await call('/v1/messages', { token: t, method: 'POST', body: 'x', type: 'text/plain' })).status);
  assert.deepEqual([...new Set(codes.slice(0, 20))], [201]);
  assert.equal(codes[20], 429);
});

test('following next_after through has_more sees every message exactly once', async () => {
  const start = (await (await call('/v1/messages?limit=1')).json()).next_after;
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(addMessage(db, 'claude', `page ${i}`).id);
  const seen = [];
  let after = start;
  for (let guard = 0; guard < 10; guard++) {
    const r = await (await call(`/v1/messages?after=${after}&limit=3`)).json();
    seen.push(...r.messages.map((m) => m.id));
    after = r.next_after;
    if (!r.has_more) break;
  }
  assert.deepEqual(seen, ids);
});

test('120 requests a minute per token, then 429', async () => {
  const t = createToken(db, 'busy', 60_000).token;
  const codes = [];
  for (let i = 0; i < 121; i++) codes.push((await call('/v1/whoami', { token: t })).status);
  assert.deepEqual([...new Set(codes.slice(0, 120))], [200]);
  assert.equal(codes[120], 429);
});

test('posts are refused with 507 once the database passes its cap; reads still work', async () => {
  const d = mkdtempSync(join(tmpdir(), 'relay-full-'));
  const small = createApp({ dbPath: join(d, 'relay.db'), log: () => {}, maxDbBytes: 1 });
  await new Promise((r) => small.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${small.server.address().port}/v1/messages`;
  const headers = { Authorization: `Bearer ${createToken(small.db, 'benji', 60_000).token}`, 'Content-Type': 'text/plain' };
  assert.equal((await fetch(url, { method: 'POST', body: 'x', headers })).status, 507);
  assert.equal((await fetch(url, { headers })).status, 200);
  small.server.close();
  small.server.closeAllConnections();
  rmSync(d, { recursive: true, force: true });
});

test('display: every database field is cleaned, long bodies are cut with a pointer', () => {
  const out = formatMessage({ id: 7, sender: 'x\u001b[31m', created_at: 'now\n──── #8  claude', token_id: 't\u0007', ip: '1.1.1.1', body: 'b'.repeat(50) }, { maxChars: 10 });
  assert.ok(!/[\u001b\u0007]/.test(out));
  assert.equal(out.split('\n').filter((l) => l.startsWith('────')).length, 1);
  assert.match(out, /truncated: message is 50 characters\. Full text: relay show 7/);
  assert.ok(!out.includes('b'.repeat(11)));
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

test('inbox batches by print budget and marks nothing itself; the caller marks after printing', () => {
  const d = mkdtempSync(join(tmpdir(), 'relay-inbox-'));
  const box = openDb(join(d, 'relay.db'));
  const limits = { perMessage: 10_000, budget: 24_000 };
  for (let i = 1; i <= 4; i++) addMessage(box, 'benji', `message ${i} ` + 'x'.repeat(9_000), { tokenId: 't', ip: '1.1.1.1' });
  addMessage(box, 'claude', 'my own message never counts as unread');

  const first = inboxBatch(box, 'claude', limits);
  assert.deepEqual([first.total, first.text.length, first.left], [4, 2, 2]);
  assert.match(first.text[0], /message 1 /);
  assert.equal(unreadFor(box, 'claude').length, 4, 'fetching a batch marks nothing (this is all --peek does)');
  markRead(box, 'claude', first.upTo);
  const second = inboxBatch(box, 'claude', limits);
  assert.deepEqual([second.total, second.text.length, second.left], [2, 2, 0]);
  assert.match(second.text[0], /message 3 /);
  markRead(box, 'claude', second.upTo);
  assert.deepEqual(inboxBatch(box, 'claude', limits), { total: 0, text: [], left: 0, upTo: null });
  box.close();
  rmSync(d, { recursive: true, force: true });
});
