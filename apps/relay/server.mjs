// Relay: a message channel between an outside agent (Benji, Ben's work agent)
// and Claude Code sessions on this box. The outside agent speaks HTTP to this
// process; the local side reads and writes the same SQLite file via cli.mjs.
//
// What a token can do is the whole API below: read the channel, post to it,
// ask who it is. There is nothing else here to reach, and this process runs
// as the unprivileged `relay` user with no secrets.
//
//   GET  /                 plain-text usage, no auth
//   GET  /v1/whoami        -> { agent, token_id, expires_at }
//   GET  /v1/messages      ?after=<id>&limit=<n>  -> { messages, next_after, has_more }
//
// PM2 runs a root-owned installed copy of this file, not the repo's: see
// install.sh.
//   POST /v1/messages      {"body": "..."} as JSON, or the raw text as text/plain
//
// No dependencies.
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { openDb, checkToken, touchToken, addMessage, getMessages, dbBytes, MAX_BODY_CHARS, MAX_DB_BYTES, DEFAULT_DB } from './db.mjs';

const MAX_BYTES = 1024 * 1024; // request cap; the message cap is MAX_BODY_CHARS
const MAX_RESPONSE_CHARS = 1_000_000; // message text in one read; has_more says when it cut

const HELP = `relay.benloe.com - message channel between Benji and Claude on benloe.com

Every /v1 request needs:  Authorization: Bearer <token>

GET  /v1/whoami
     -> { agent, token_id, expires_at }

GET  /v1/messages
     Most recent 20 messages in the channel, oldest first.
     ?limit=<1-100>   how many
     ?after=<id>      only messages with a higher id, oldest first
     -> { messages: [{ id, sender, body, created_at }], next_after, has_more }
     next_after is the id of the last message in this response. Pass it as
     ?after= on your next read to get exactly what you have not seen yet.
     has_more: true means there is more waiting right now (a read carries at
     most ~1,000,000 characters of message text): read again with ?after=next_after.
     Without ?after you get the newest messages that fit; older_omitted: true
     means some of the last <limit> were left out for size. To be sure of
     seeing everything, page forward from an id you know with ?after=.

POST /v1/messages
     Content-Type: application/json   {"body": "your message"}
     or Content-Type: text/plain      with the message as the raw request body
     Up to ${MAX_BODY_CHARS} characters, 20 posts per minute.
     In JSON, newlines inside the string must be escaped (\\n); text/plain avoids that.
     -> 201 { id, sender, created_at }

Messages you post appear with your token's agent name as sender; the other side is "claude".
Nobody is listening live: a reply arrives when Ben asks the other side to read and answer.

Errors are JSON: { error }. 401 = missing/unknown/expired/revoked token. 429 = slow down.
`;

// Fixed-window counter. over() reads, hit() increments.
function limiter(max, windowMs) {
  const m = new Map();
  const live = (k) => {
    const e = m.get(k);
    return e && Date.now() - e.start < windowMs ? e : null;
  };
  return {
    over: (k) => (live(k)?.n ?? 0) >= max,
    hit(k) {
      let e = live(k);
      if (!e) {
        // Bounded: prune the expired, and if a flood of distinct keys is still
        // holding the map full, forget them all rather than scan on every hit.
        if (m.size >= 5000) {
          for (const key of m.keys()) if (!live(key)) m.delete(key);
          if (m.size >= 5000) m.clear();
        }
        e = { start: Date.now(), n: 0 };
        m.set(k, e);
      }
      e.n++;
      return e.n <= max;
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      // Past the cap, keep draining without keeping: the client then gets a
      // real 413 instead of a reset. Caddy caps bodies at the same size, and
      // requestTimeout bounds a slow sender.
      size += c.length;
      if (size <= MAX_BYTES) chunks.push(c);
      else chunks.length = 0;
    });
    req.on('end', () => (size > MAX_BYTES ? reject(Object.assign(new Error('request body too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const fail = (status, error) => Object.assign(new Error(error), { status });

export function createApp({ dbPath = DEFAULT_DB, log = console.log, maxDbBytes = MAX_DB_BYTES } = {}) {
  const db = openDb(dbPath);
  const badAuth = limiter(10, 60_000); // failed auth attempts per IP
  const perToken = limiter(120, 60_000); // requests per token
  const posts = limiter(20, 60_000); // posts per token

  // Through Caddy, the last X-Forwarded-For entry is the real peer. A process
  // on this box can connect to the loopback port directly and claim any
  // address, so the recorded address is evidence about outside callers only.
  const ipOf = (req) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';
    return isIP(ip) ? ip : '?';
  };

  const view = (m) => ({ id: m.id, sender: m.sender, body: m.body, created_at: m.created_at });

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://relay');
    } catch {
      throw fail(400, 'bad request target');
    }
    const ip = ipOf(req);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/v1')) return { status: 200, text: HELP };
    if (!url.pathname.startsWith('/v1/')) throw fail(404, 'not found');

    // A valid token always gets through; the lockout only slows guessing, so
    // a stranger behind the same NAT cannot shut the real client out.
    const header = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const auth = m
      ? checkToken(db, m[1])
      : { ok: false, reason: header ? 'Authorization header must be exactly: Bearer <token>' : 'missing header: Authorization: Bearer <token>' };
    if (!auth.ok) {
      if (badAuth.over(ip)) throw fail(429, 'too many failed attempts; wait a minute');
      badAuth.hit(ip);
      log(JSON.stringify({ at: new Date().toISOString(), ip, event: 'auth_failed', reason: auth.reason, path: url.pathname }));
      throw fail(401, auth.reason);
    }
    const tok = auth.token;
    if (!perToken.hit(tok.id)) throw fail(429, 'rate limit: 120 requests per minute');
    touchToken(db, tok.id, ip);
    log(JSON.stringify({ at: new Date().toISOString(), ip, event: 'request', agent: tok.agent, token: tok.id, method: req.method, path: url.pathname }));

    if (url.pathname === '/v1/whoami' && req.method === 'GET') {
      return { status: 200, json: { agent: tok.agent, token_id: tok.id, expires_at: tok.expires_at } };
    }

    if (url.pathname === '/v1/messages' && req.method === 'GET') {
      const num = (name, def, lo, hi) => {
        const raw = url.searchParams.get(name);
        if (raw === null) return def;
        if (!/^\d{1,15}$/.test(raw) || +raw < lo || +raw > hi) throw fail(400, `${name} must be an integer ${lo}-${hi}`);
        return +raw;
      };
      const limit = num('limit', 20, 1, 100);
      const after = num('after', null, 0, Number.MAX_SAFE_INTEGER);
      let rows = getMessages(db, { after, limit: after === null ? limit : limit + 1 });
      let has_more = after !== null && rows.length > limit;
      rows = rows.slice(0, limit);
      // Byte budget: keep the oldest when paging forward, the newest otherwise,
      // and always at least one message.
      const keep = [];
      let chars = 0;
      let older_omitted = false;
      for (const r of after === null ? rows.toReversed() : rows) {
        if (keep.length && chars + r.body.length > MAX_RESPONSE_CHARS) {
          if (after === null) older_omitted = true;
          else has_more = true;
          break;
        }
        chars += r.body.length;
        keep.push(r);
      }
      if (after === null) keep.reverse();
      return { status: 200, json: { messages: keep.map(view), next_after: keep.at(-1)?.id ?? after ?? 0, has_more, ...(older_omitted ? { older_omitted } : {}) } };
    }

    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      if (!posts.hit(tok.id)) throw fail(429, 'rate limit: 20 posts per minute');
      if (dbBytes(db) > maxDbBytes) throw fail(507, 'the channel is full; tell Ben');
      const raw = (await readBody(req)).toString('utf8');
      const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      let body;
      if (type === 'application/json') {
        try {
          body = JSON.parse(raw)?.body;
        } catch {
          throw fail(400, 'request body is not valid JSON (escape newlines inside the string as \\n, or send the raw text as Content-Type: text/plain)');
        }
        if (typeof body !== 'string') throw fail(400, 'expected {"body": "<message text>"}');
      } else if (type === 'text/plain' || type === 'text/markdown') {
        body = raw;
      } else {
        throw fail(415, 'Content-Type must be application/json ({"body": "..."}) or text/plain (raw message)');
      }
      if (!body.trim()) throw fail(400, 'message body is empty');
      if (body.length > MAX_BODY_CHARS) throw fail(413, `message over ${MAX_BODY_CHARS} characters; split it`);
      if (body.includes('\u0000')) throw fail(400, 'message contains a NUL character');
      return { status: 201, json: addMessage(db, tok.agent, body, { tokenId: tok.id, ip }) };
    }

    throw fail(url.pathname === '/v1/messages' || url.pathname === '/v1/whoami' ? 405 : 404, 'no such endpoint; GET / for usage');
  }

  const server = createServer(async (req, res) => {
    let out;
    try {
      out = await handle(req, res);
    } catch (e) {
      if (!e.status) console.error(JSON.stringify({ at: new Date().toISOString(), event: 'error', message: String(e?.stack || e) }));
      out = { status: e.status || 500, json: { error: e.status ? e.message : 'internal error' } };
    }
    if (res.destroyed) return;
    const payload = out.text ?? JSON.stringify(out.json) + '\n';
    res.writeHead(out.status, {
      'Content-Type': out.text ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(out.status === 413 ? { Connection: 'close' } : {}),
    });
    res.end(payload);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3015);
  createApp().server.listen(port, '127.0.0.1', () => console.log(`relay listening on 127.0.0.1:${port}`));
}
