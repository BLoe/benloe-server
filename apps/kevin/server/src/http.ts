// The gateway: one HTTP server. Everything under it is owner-only, checked
// against artanis (the box's auth service) on every request.
//
// The web chat is the first channel. A second one (Telegram, SMS) would call
// the same threads.send() and listen on the same bus.
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentPath, extract, getAttachment, MAX_UPLOAD_BYTES, saveUpload } from './attachments.js';
import { bus } from './bus.js';
import { config } from './config.js';
import { type DB, getSetting, OWNER_ACCOUNT_KEY, setSetting } from './db.js';
import type { Kevin } from './kevin.js';
import { notify, subscribe } from './push.js';
import { createThread, getThread, listThreads, resolveConfirm, send, stop } from './threads.js';

type Who = 'owner' | 'other' | null;
const authCache = new Map<string, { who: Who; at: number }>();

/**
 * Who sent this request, by asking artanis about its session cookie. Only an answer is cached (signed
 * in as someone, or the session refused with 401/403), for 30 seconds. An unreachable or failing auth
 * service is logged and not cached: it says nothing about the session, and remembering it as "not
 * signed in" would send Ben round the sign-in page until it expired.
 */
export async function whoIs(req: Request, db: DB): Promise<Who> {
  if (config.testUser) return 'owner';
  const token = (req.headers.cookie ?? '').split(';').map((p) => p.trim().split('=')).find(([k]) => k === 'token')?.[1];
  if (!token || !config.ownerEmail) return null;
  const hit = authCache.get(token);
  if (hit && Date.now() - hit.at < 30_000) return hit.who;
  let who: Who;
  try {
    const res = await fetch(`${config.authUrl}/api/auth/me`, { headers: { Cookie: `token=${token}` }, signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) who = null;
    else if (!res.ok) {
      console.error(`auth service answered ${res.status} to a session check; not treated as an answer`);
      return null;
    } else {
      const user = ((await res.json()) as { user?: { id?: unknown; email?: unknown } }).user;
      const email = typeof user?.email === 'string' ? user.email.toLowerCase() : '';
      who = !email ? null : email === config.ownerEmail ? 'owner' : 'other';
      if (who === 'owner' && typeof user?.id === 'string' && user.id && getSetting<string | null>(db, OWNER_ACCOUNT_KEY, null) !== user.id) {
        setSetting(db, OWNER_ACCOUNT_KEY, user.id);
      }
    }
  } catch (e) {
    console.error(`auth service could not be asked about a session: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (authCache.size > 500) authCache.clear();
  authCache.set(token, { who, at: Date.now() });
  return who;
}

// Fetched by the browser without credentials when installing the PWA.
const PUBLIC = /^\/(manifest\.webmanifest|icons\/[\w.-]+|favicon\.ico)$/;

export function createHttp(kevin: Kevin): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && PUBLIC.test(req.path)) return next();
    const who = await whoIs(req, kevin.db);
    if (who === 'owner') return next();
    if (req.path.startsWith('/api/')) return void res.status(who ? 403 : 401).json({ error: who ? 'not the owner' : 'sign in' });
    if (who) return void res.status(403).type('text/plain').send('Kevin is Ben’s private assistant.');
    // Back to the page that was asked for, on this site. A request line can carry a full URL instead of a path; that is not passed on.
    const back = /^\/(?![/\\])/.test(req.originalUrl) ? req.originalUrl : '/';
    res.redirect(302, `https://auth.benloe.com/?redirect=${encodeURIComponent(config.publicUrl + back)}`);
  });

  // Cross-site request forgery: a state-changing request must carry a header a
  // foreign page cannot set without a preflight, and a matching Origin if it sends one.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (req.headers['x-kevin'] !== '1' || (origin && !config.testUser && origin !== config.publicUrl)) return void res.status(403).json({ error: 'bad origin' });
    next();
  });

  const api = Router();
  const json = express.json({ limit: '2mb' });
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e: unknown) => {
        console.error(`${req.method} ${req.path} failed`, e);
        if (!res.headersSent) res.status(500).json({ error: e instanceof Error ? e.message : 'internal error' });
      });
  };

  api.get('/me', (_req, res) => void res.json({ email: config.ownerEmail, timezone: config.timezone, vapidPublicKey: config.vapidPublic, models: config.models }));

  api.get('/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const off = bus.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const beat = setInterval(() => res.write(': keepalive\n\n'), 25_000);
    req.on('close', () => {
      off();
      clearInterval(beat);
    });
  });

  // ---- threads ----
  api.get('/threads', (req, res) => void res.json(listThreads(kevin, req.query.archived === '1')));
  api.post('/threads', json, (_req, res) => void res.json(createThread(kevin)));
  api.get('/threads/:id', (req, res) => {
    const t = getThread(kevin, String(req.params.id));
    if (!t) return void res.status(404).json({ error: 'no such thread' });
    res.json(t);
  });
  api.patch('/threads/:id', json, (req, res) => {
    const id = String(req.params.id);
    const b = req.body as { title?: string; archived?: boolean };
    if (!kevin.db.prepare('SELECT 1 FROM threads WHERE id = ?').get(id)) return void res.status(404).json({ error: 'no such thread' });
    if (typeof b.title === 'string' && b.title.trim()) kevin.db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(b.title.trim().slice(0, 120), id);
    if (typeof b.archived === 'boolean') kevin.db.prepare('UPDATE threads SET archived = ? WHERE id = ?').run(b.archived ? 1 : 0, id);
    bus.publish({ type: 'thread_updated', threadId: id });
    res.json(getThread(kevin, id));
  });
  api.post('/threads/:id/messages', json, (req, res) => {
    const id = String(req.params.id);
    const b = req.body as { text?: string; attachments?: number[]; page?: string; deep?: boolean };
    if (!kevin.db.prepare('SELECT 1 FROM threads WHERE id = ?').get(id)) return void res.status(404).json({ error: 'no such thread' });
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 100_000) : '';
    const attachments = Array.isArray(b.attachments) ? b.attachments.filter((n) => Number.isInteger(n)).slice(0, 10) : [];
    if (!text && !attachments.length) return void res.status(400).json({ error: 'empty message' });
    const page = typeof b.page === 'string' && /^\/[\w\-/]{0,80}$/.test(b.page) ? b.page : null;
    // The turn runs on; its progress arrives over /api/events.
    void send(kevin, id, { text, attachments, page, deep: !!b.deep }).catch((e) => console.error('send failed', e));
    res.status(202).json({ ok: true });
  });
  api.post('/threads/:id/stop', (req, res) => void res.json({ stopped: stop(String(req.params.id)) }));
  api.post('/threads/:id/confirm', json, (req, res) => {
    const b = req.body as { confirmId?: string; approved?: boolean };
    res.json({ ok: resolveConfirm(String(req.params.id), String(b.confirmId), b.approved === true) });
  });

  // ---- uploads ----
  api.post('/uploads', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ error: 'send the file as the request body' });
    let a;
    try {
      // Express has already decoded the query string; decoding again would reject a name with a "%" in it.
      a = saveUpload(kevin.db, req.body, typeof req.query.filename === 'string' ? req.query.filename : 'upload');
    } catch (e) {
      return void res.status(400).json({ error: (e as Error).message });
    }
    a = await extract(kevin.db, a.id);
    res.json({ id: a.id, filename: a.filename, mime: a.mime, kind: a.kind, size: a.size, extract_status: a.extract_status, extracted_preview: a.extracted_text?.slice(0, 4000) ?? null });
  }));
  api.get('/attachments/:id/raw', (req, res) => {
    const a = getAttachment(kevin.db, Number(req.params.id));
    if (!a || !existsSync(attachmentPath(a))) return void res.status(404).json({ error: 'no such attachment' });
    // Uploaded bytes are never allowed to run as a page on this origin.
    // A PDF is the exception: the browser's own PDF viewer will not render inside a sandbox, and the type was
    // decided from the file's bytes at upload, so it is served plainly.
    if (a.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Content-Disposition', `${a.kind === 'image' || a.kind === 'pdf' ? 'inline' : 'attachment'}; filename="${a.filename.replace(/[^\w.\- ]/g, '_')}"`);
    res.type(a.mime).sendFile(attachmentPath(a));
  });

  // ---- reads and writes, uniform across every page ----
  api.get('/view/:domain/:name', wrap(async (req, res) => {
    const view = kevin.views.get(`${String(req.params.domain)}/${String(req.params.name)}`);
    if (!view) return void res.status(404).json({ error: 'no such view' });
    const params = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    res.json(await view(params, kevin.db));
  }));
  api.post('/act/:tool', json, wrap(async (req, res) => {
    const r = await kevin.tools.call(String(req.params.tool), req.body, { db: kevin.db, source: 'ui', confirm: () => Promise.resolve(true) });
    if (!r.ok) return void res.status(400).json({ ok: false, error: r.text });
    res.json({ ok: true, result: r.value ?? null });
  }));
  api.get('/domains', (_req, res) => void res.json(kevin.domains.map((d) => ({ name: d.name, views: Object.keys(d.views ?? {}), tools: (d.tools ?? []).map((t) => t.name) }))));
  api.get('/tools', (_req, res) => void res.json(kevin.tools.list().map((t) => ({ name: t.name, description: t.description, write: !!t.touches, agent: t.agent !== false }))));

  // ---- push ----
  api.post('/push/subscribe', json, (req, res) => {
    try {
      subscribe(kevin.db, req.body as { endpoint: string; keys: { p256dh: string; auth: string } }, req.headers['user-agent'] ?? null);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  api.post('/push/test', wrap(async (_req, res) => void res.json(await notify(kevin.db, { title: 'Kevin', body: 'Notifications are working on this device.', link: '/', source: 'test' }))));

  for (const d of kevin.domains) {
    if (!d.routes) continue;
    const r = Router();
    d.routes(r, kevin.db);
    api.use(`/x/${d.name}`, r);
  }
  api.use((_req, res) => void res.status(404).json({ error: 'not found' }));
  app.use('/api', api);

  // ---- the web app ----
  if (existsSync(config.webDir)) {
    app.use(express.static(config.webDir, {
      index: false,
      setHeaders: (res, path) => {
        // Hashed assets are immutable; everything else must revalidate so a deploy reaches the next load.
        res.setHeader('Cache-Control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(config.webDir, 'index.html'));
    });
  }
  return app;
}
