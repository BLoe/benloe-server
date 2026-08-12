/**
 * The operator dashboard: the owner, in a browser, editing the server's
 * environment without touching the VPS.
 *
 * AUTH. Sessions come from artanis, and the principal must be the owner — an
 * `agent`-role key is refused outright, which Cabinet's own wall does not do.
 * That distinction is the point: Cabinet's agent credentials are valid for
 * Cabinet and worthless here.
 *
 * This only became a trustworthy design on 2026-08-02. Before that, artanis ran
 * as root with agent-writable code and an agent-readable session database, so
 * "authenticate with artanis" would have meant "the agent can mint itself a
 * session and walk in". Hardening artanis was a prerequisite for this file.
 *
 * READABLE, unlike the credential UI this replaced. That one was write-only
 * because it held third-party API keys, which you rotate at the provider rather
 * than read back. This holds config documents that cannot be edited without
 * being read. The compensating controls are the ones that were always doing the
 * work: TLS, an owner-only session, and an audit line per access.
 *
 * MANY SETS, ONE RENDER. Every mutation here — save, restore, delete — ends in
 * a full materialise of every set. Rendering all of them rather than only the
 * one that changed is what keeps `shared` honest: editing JWT_SECRET in
 * `shared` has to reach twelve files, not one.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { AuditFn } from './audit.js';
import {
  listSets,
  listVersions,
  readAllSets,
  readSet,
  saveSet,
  deleteSet,
  SET_NAME_RE,
  SHARED_SET,
} from './store.js';
import { materialize, type MaterializeResult } from './materialize.js';
import { renderPage, type PageSet } from './page.js';

export interface DashboardDeps {
  db: Database.Database;
  key: Buffer | null;
  audit: AuditFn;
  ownerEmail: string;
  /** Where the rendered env files are written. */
  runtimeDir: string;
  /** Injectable for tests; production uses global fetch → artanis. */
  authFetch?: typeof fetch;
  authServiceUrl?: string;
  /** Where a browser without a session is sent. Injectable for tests. */
  loginUrl?: string;
  /** Injectable for tests. */
  materializeImpl?: typeof materialize;
}

interface Principal {
  email: string;
  role: string;
}
interface AuthedRequest extends Request {
  principal?: Principal;
}

export function buildDashboardApp(deps: DashboardDeps) {
  const app = express();
  const authFetch = deps.authFetch ?? fetch;
  const authUrl = deps.authServiceUrl ?? 'http://localhost:3002';
  const doMaterialize = deps.materializeImpl ?? materialize;

  // Remembered so the page can show what the last render actually wrote.
  let lastRendered: MaterializeResult['written'] = {};
  app.set('setLastRendered', (w: MaterializeResult['written']) => {
    lastRendered = w;
  });

  app.use(cookieParser());
  app.use(express.json({ limit: '512kb' }));

  // Unauthenticated: lets Caddy and uptime checks see the process is alive
  // without a session. Counts only — no names, no content.
  app.get('/healthz', (_req, res) =>
    res.json({ ok: true, keyLoaded: deps.key !== null, sets: listSets(deps.db).length }),
  );

  /**
   * A browser arriving without a session should land on the login page, not on
   * a JSON error it cannot act on. API clients still get the status code.
   * Artanis sets its cookie on .benloe.com, so a session from any subdomain
   * already counts here.
   */
  function unauthenticated(req: Request, res: Response, status: 401 | 403, error: string) {
    const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
    if (wantsHtml && status === 401) {
      const self = `https://${req.headers.host ?? 'secrets.benloe.com'}${req.originalUrl}`;
      return res.redirect(`${deps.loginUrl ?? 'https://auth.benloe.com/'}?redirect=${encodeURIComponent(self)}`);
    }
    return res.status(status).json({ error });
  }

  async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.token;
      const authz = req.headers.authorization;
      if (!token && !authz) return unauthenticated(req, res, 401, 'Authentication required');
      const headers: Record<string, string> = authz ? { Authorization: authz } : { Cookie: `token=${token}` };
      const r = await authFetch(`${authUrl}/api/auth/me`, { headers });
      if (!r.ok) return unauthenticated(req, res, 401, 'Authentication failed');
      const { user } = (await r.json()) as { user?: { email?: string; role?: string } };
      // OWNER ONLY. Agent keys authenticate fine at artanis and are deliberately
      // useless here — this is the one surface the agent must not reach even
      // with valid credentials.
      //
      // BOTH halves are checked on purpose. The email test alone is sufficient
      // only while artanis guarantees agent principals never carry an owner
      // address, which it does today by minting them at @agents.benloe.com. That
      // is an invariant of a DIFFERENT service, and this is the wrong place to
      // depend on one: the role check makes the rule true locally, so a change
      // over there cannot quietly open this door.
      if (!user?.email || user.email !== deps.ownerEmail || user.role === 'agent') {
        return unauthenticated(req, res, 403, 'This dashboard is owner-only.');
      }
      req.principal = { email: user.email, role: user.role ?? 'user' };
      next();
    } catch {
      res.status(503).json({ error: 'Auth service unavailable' });
    }
  }

  app.use(authenticate);

  /** `shared` first because everything else inherits it; the rest alphabetically,
   *  which is how the operator thinks of them (one per app). */
  function order(a: string, b: string): number {
    if (a === SHARED_SET) return -1;
    if (b === SHARED_SET) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  app.get('/', (req: AuthedRequest, res) => {
    const sets: PageSet[] = [];
    let keyTotal = 0;
    for (const meta of listSets(deps.db).sort((x, y) => order(x.name, y.name))) {
      let document: string | null = null;
      let error: string | undefined;
      try {
        document = readSet(deps.db, deps.key, meta.name);
        keyTotal += meta.key_count;
      } catch (err) {
        // One unreadable set must not blank the whole page — the dashboard is
        // exactly where an operator would go to understand a key problem.
        error = err instanceof Error ? err.message : 'could not decrypt this set';
      }
      sets.push({
        name: meta.name,
        version: meta.version,
        updated_at: meta.updated_at,
        updated_by: meta.updated_by,
        byte_length: meta.byte_length,
        document,
        error,
        versions: listVersions(deps.db, meta.name),
      });
    }

    deps.audit({
      via: 'dashboard',
      action: 'sets.read',
      ok: true,
      key_count: keyTotal,
      credentials: sets.map((s) => s.name),
      actor: req.principal?.email,
    });

    res.type('html').send(
      renderPage({
        sets,
        keyLoaded: deps.key !== null,
        ownerEmail: deps.ownerEmail,
        rendered: lastRendered,
        sharedName: SHARED_SET,
        namePattern: SET_NAME_RE.source,
      }),
    );
  });

  /**
   * Render every set to the runtime directory. Called after each mutation:
   * from the operator's point of view the save and the render are one
   * operation, because a save that did not reach the consumers has not done
   * anything.
   */
  function renderAll(): MaterializeResult['written'] {
    const { written } = doMaterialize(readAllSets(deps.db, deps.key), deps.runtimeDir);
    lastRendered = written;
    return written;
  }

  /** Save one set, then re-render everything. */
  function commit(req: AuthedRequest, res: Response, name: string, text: string, action: string) {
    try {
      const saved = saveSet(deps.db, deps.key, name, text, req.principal?.email ?? null);
      const written = renderAll();
      deps.audit({
        via: 'dashboard',
        action,
        ok: true,
        version: saved.version,
        key_count: saved.key_count,
        byte_length: saved.byte_length,
        credentials: [name],
        actor: req.principal?.email,
      });
      res.json({ ...saved, rendered: written });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'save failed';
      deps.audit({
        via: 'dashboard',
        action,
        ok: false,
        error: message,
        credentials: [name],
        actor: req.principal?.email,
      });
      res.status(400).json({ error: message });
    }
  }

  /** Reject a bad name here rather than letting the store throw, so the client
   *  gets the same rule it validated against and not a 500. */
  function badName(name: string): boolean {
    return typeof name !== 'string' || !SET_NAME_RE.test(name);
  }

  app.post('/api/sets/:name', (req: AuthedRequest, res) => {
    const name = req.params.name ?? '';
    if (badName(name)) return res.status(400).json({ error: `Invalid set name — expected ${SET_NAME_RE}.` });
    const { document } = (req.body ?? {}) as { document?: unknown };
    if (typeof document !== 'string') return res.status(400).json({ error: 'document (a string) is required' });
    commit(req, res, name, document, 'set.save');
  });

  /** Restore is a SAVE of an old version's text, never a delete of newer ones.
   *  History stays append-only, so an accidental restore is itself undoable. */
  app.post('/api/sets/:name/restore', (req: AuthedRequest, res) => {
    const name = req.params.name ?? '';
    if (badName(name)) return res.status(400).json({ error: `Invalid set name — expected ${SET_NAME_RE}.` });
    const { version } = (req.body ?? {}) as { version?: unknown };
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return res.status(400).json({ error: 'version (an integer) is required' });
    }
    let text: string | null;
    try {
      text = readSet(deps.db, deps.key, name, version);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'restore failed' });
    }
    if (text === null) return res.status(404).json({ error: `No such version: ${name} v${version}` });
    commit(req, res, name, text, 'set.restore');
  });

  app.delete('/api/sets/:name', (req: AuthedRequest, res) => {
    const name = req.params.name ?? '';
    if (badName(name)) return res.status(400).json({ error: `Invalid set name — expected ${SET_NAME_RE}.` });
    // `shared` is load-bearing for every other set; deleting it would silently
    // strip JWT_SECRET from every rendered file at the next save.
    if (name === SHARED_SET) return res.status(400).json({ error: `The ${SHARED_SET} set cannot be deleted.` });
    try {
      const deleted = deleteSet(deps.db, name);
      if (!deleted) return res.status(404).json({ error: `No such set: ${name}` });
      // The materialiser only writes files, so removing the set would otherwise
      // leave a stale <name>.env in /run — a retired app's credentials still
      // readable, which is the opposite of what a delete is for.
      rmSync(join(deps.runtimeDir, `${name}.env`), { force: true });
      const written = renderAll();
      deps.audit({
        via: 'dashboard',
        action: 'set.delete',
        ok: true,
        credentials: [name],
        actor: req.principal?.email,
      });
      res.json({ deleted: true, rendered: written });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'delete failed';
      deps.audit({
        via: 'dashboard',
        action: 'set.delete',
        ok: false,
        error: message,
        credentials: [name],
        actor: req.principal?.email,
      });
      res.status(400).json({ error: message });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'no such endpoint' }));

  return app;
}
