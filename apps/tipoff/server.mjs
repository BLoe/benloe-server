// Tipoff's one dynamic piece:
//  - /api/gate     Caddy's forward_auth target: 204 for the owner, 401 for
//                  nobody signed in (Caddy redirects to artanis), 403 for
//                  anyone else. This is what keeps the static board private.
//  - /api/uploads  an owner-only drop box for screenshots (Yahoo's draft
//                  lobby, pick lists) that a later Claude session reads off
//                  disk.
// The board itself never calls either; once loaded it needs nothing here.
//
// No dependencies. Auth is artanis's cookie checked against the auth service
// on localhost, the same delegation Gavel uses.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, unlinkSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 3014);
const DIR = process.env.TIPOFF_UPLOAD_DIR || '/srv/benloe/data/tipoff/uploads';
// Beside the uploads dir: /srv/benloe/data/tipoff/state.json in production.
const STATE = process.env.TIPOFF_STATE_FILE || join(DIR, '..', 'state.json');
const AUTH = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';
const OWNER = (process.env.TIPOFF_OWNER_EMAIL || '').toLowerCase();
const MAX = 15 * 1024 * 1024;
mkdirSync(DIR, { recursive: true });

// Content is trusted by its bytes, never by the header the browser sent.
const SNIFF = [
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'gif', type: 'image/gif', test: (b) => b.subarray(0, 4).toString() === 'GIF8' },
];
const TYPE = Object.fromEntries(SNIFF.map((s) => [s.ext, s.type]));
const NAME = /^[0-9TZ-]+-[0-9a-f]{6}\.(png|jpg|webp|gif)$/;

const cache = new Map();
// 'owner' | 'other' | null (not signed in)
async function who(req) {
  if (process.env.NODE_ENV !== 'production' && process.env.TIPOFF_TEST_USER) return 'owner';
  const token = (req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === 'token')?.[1];
  if (!token || !OWNER) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < 30_000) return hit.who;
  try {
    const res = await fetch(`${AUTH}/api/auth/me`, { headers: { Cookie: `token=${token}` }, signal: AbortSignal.timeout(5000) });
    const email = res.ok ? ((await res.json()).user?.email ?? '').toLowerCase() : '';
    const w = !email ? null : email === OWNER ? 'owner' : 'other';
    cache.set(token, { who: w, at: Date.now() });
    return w;
  } catch {
    return null; // not cached: a blip should not lock the owner out
  }
}

// Test harness only: serve public/ from this process so one ephemeral port
// carries pages and API alike. Unreachable in production.
const STATIC = process.env.NODE_ENV !== 'production' && process.env.TIPOFF_SERVE_STATIC;
const PUBLIC = new URL('./public/', import.meta.url).pathname;
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function list() {
  return readdirSync(DIR)
    .filter((f) => NAME.test(f))
    .map((f) => ({ name: f, bytes: statSync(join(DIR, f)).size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (STATIC && !url.pathname.startsWith('/api/')) {
    const f = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).replace(/\.\./g, '');
    try {
      res.writeHead(200, { 'Content-Type': MIME[f.split('.').pop()] ?? 'application/octet-stream' });
      return res.end(readFileSync(join(PUBLIC, f)));
    } catch {
      return json(res, 404, { error: 'not found' });
    }
  }
  const w = await who(req);
  if (url.pathname === '/api/gate') {
    res.writeHead(w === 'owner' ? 204 : w ? 403 : 401, { 'Cache-Control': 'no-store' });
    return res.end(w === 'other' ? 'This board is private.' : '');
  }
  if (!url.pathname.startsWith('/api/uploads') && url.pathname !== '/api/state') return json(res, 404, { error: 'not found' });
  if (w !== 'owner') return json(res, w ? 403 : 401, { error: w ? 'Not yours.' : 'Sign in at auth.benloe.com.', needsAuth: !w });

  // The board's draft state, mirrored here so a Claude session can read the
  // live draft off disk. The browser stays the source of truth: it pushes
  // after every change and never reads this back.
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(STATE));
      } catch {
        return json(res, 404, { error: 'no state yet' });
      }
    }
    if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 512 * 1024) return json(res, 413, { error: 'too large' });
      chunks.push(c);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return json(res, 400, { error: 'not JSON' });
    }
    if (!Array.isArray(body?.marks)) return json(res, 400, { error: 'no marks' });
    writeFileSync(STATE + '.tmp', JSON.stringify({ receivedAt: new Date().toISOString(), ...body }, null, 1), { mode: 0o600 });
    renameSync(STATE + '.tmp', STATE);
    return json(res, 200, { ok: true });
  }

  const name = url.pathname.slice('/api/uploads/'.length);
  if (req.method === 'GET' && !name) return json(res, 200, { files: list() });
  if (req.method === 'GET' && NAME.test(name)) {
    try {
      const body = readFileSync(join(DIR, name));
      res.writeHead(200, { 'Content-Type': TYPE[name.split('.').pop()], 'Cache-Control': 'private, max-age=3600' });
      return res.end(body);
    } catch {
      return json(res, 404, { error: 'no such file' });
    }
  }
  if (req.method === 'DELETE' && NAME.test(name)) {
    try {
      unlinkSync(join(DIR, name));
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 404, { error: 'no such file' });
    }
  }
  if (req.method === 'POST' && !name) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX) return json(res, 413, { error: 'Over 15 MB.' });
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    const kind = SNIFF.find((s) => s.test(buf));
    if (!kind) return json(res, 415, { error: 'Not a PNG, JPEG, WebP or GIF image.' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `${stamp}-${randomBytes(3).toString('hex')}.${kind.ext}`;
    writeFileSync(join(DIR, file), buf, { mode: 0o600 });
    return json(res, 201, { name: file, bytes: buf.length });
  }
  json(res, 405, { error: 'method not allowed' });
}).listen(PORT, '127.0.0.1', () => console.log(`tipoff uploads on 127.0.0.1:${PORT} -> ${DIR}`));
