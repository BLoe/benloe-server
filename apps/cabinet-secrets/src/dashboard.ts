/**
 * The operator dashboard: Ben, in a browser, managing credentials without
 * touching the VPS.
 *
 * AUTH. Sessions come from artanis, exactly as Cabinet's do, and the principal
 * must be the owner — an `agent`-role key is refused outright, which Cabinet's
 * own wall does not do. That distinction is the point: Cabinet's agent
 * credentials are valid for Cabinet and worthless here.
 *
 * This only became a trustworthy design on 2026-08-02. Before that, artanis ran
 * as root with agent-writable code and an agent-readable session database, so
 * "authenticate with artanis" would have meant "Cabinet can mint itself a
 * session and walk in". Hardening artanis was a prerequisite for this file, not
 * a separate piece of work.
 *
 * WRITE-ONLY BY CONSTRUCTION. There is no route that returns a stored secret,
 * and the UI never renders one. A credential can be created, rotated (paste a
 * new value) or deleted. If you need to know the current value, you don't —
 * you rotate it at the provider and paste the new one here. That is the same
 * discipline every real secret manager lands on, and it removes the single
 * most dangerous button a UI like this could have.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { AuditFn } from './audit.js';
import { CREDENTIAL_NAME_RE, deleteCredential, listCredentials, putCredential } from './store.js';
import { plaidConfigured, type PlaidProxyDeps } from './plaid.js';
import { renderPage } from './page.js';

export interface DashboardDeps {
  db: Database.Database;
  key: Buffer | null;
  audit: AuditFn;
  environment: string;
  ownerEmail: string;
  auditLogPath: string;
  /** Injectable for tests; production uses global fetch → artanis. */
  authFetch?: typeof fetch;
  authServiceUrl?: string;
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

  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));

  // Unauthenticated: lets Caddy/uptime checks see the process is alive without
  // a session. Says nothing about what is stored.
  app.get('/healthz', (_req, res) => res.json({ ok: true, keyLoaded: deps.key !== null }));

  async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.token;
      const authz = req.headers.authorization;
      if (!token && !authz) return res.status(401).json({ error: 'Authentication required' });
      const headers: Record<string, string> = authz ? { Authorization: authz } : { Cookie: `token=${token}` };
      const r = await authFetch(`${authUrl}/api/auth/me`, { headers });
      if (!r.ok) return res.status(401).json({ error: 'Authentication failed' });
      const { user } = (await r.json()) as { user?: { email?: string; role?: string } };
      // OWNER ONLY. Cabinet's agent keys authenticate fine at artanis and are
      // deliberately useless here — this is the one surface the agent must not
      // reach even with valid credentials.
      if (!user?.email || user.email !== deps.ownerEmail) {
        return res.status(403).json({ error: 'This dashboard is owner-only.' });
      }
      req.principal = { email: user.email, role: user.role ?? 'user' };
      next();
    } catch {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
  app.use(authenticate as never);

  app.get('/', (_req, res) => {
    res.type('html').send(renderPage());
  });

  app.get('/api/state', (req: AuthedRequest, res) => {
    const proxy: PlaidProxyDeps = {
      db: deps.db,
      key: deps.key,
      audit: deps.audit,
      environment: deps.environment,
    };
    res.json({
      actor: req.principal?.email ?? null,
      keyLoaded: deps.key !== null,
      environment: deps.environment,
      plaidConfigured: plaidConfigured(proxy),
      credentials: listCredentials(deps.db), // metadata only
    });
  });

  app.put('/api/credentials/:name', (req: AuthedRequest, res) => {
    const name = req.params.name ?? '';
    if (!CREDENTIAL_NAME_RE.test(name)) {
      return res.status(400).json({ error: 'Name must be a lowercase slug, e.g. plaid-secret.' });
    }
    const { secret, description } = (req.body ?? {}) as {
      secret?: unknown;
      description?: unknown;
    };
    if (typeof secret !== 'string' || secret.length === 0) {
      return res.status(400).json({ error: 'A non-empty secret is required.' });
    }
    try {
      const result = putCredential(deps.db, deps.key, {
        name,
        secret,
        description: typeof description === 'string' ? description : null,
      });
      deps.audit({
        via: 'dashboard',
        action: result.created ? 'credential.put' : 'credential.rotate',
        credentials: [name],
        ok: true,
        actor: req.principal?.email,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to store credential';
      deps.audit({ via: 'dashboard', action: 'credential.put', credentials: [name], ok: false, error: message, actor: req.principal?.email });
      // 503 when the key is missing: "not configured" is a different problem
      // from "broken", and at 2am the distinction matters.
      res.status(/key/i.test(message) ? 503 : 400).json({ error: message });
    }
  });

  app.delete('/api/credentials/:name', (req: AuthedRequest, res) => {
    const name = req.params.name ?? '';
    const gone = deleteCredential(deps.db, name);
    deps.audit({ via: 'dashboard', action: 'credential.delete', credentials: [name], ok: gone, actor: req.principal?.email });
    res.json({ deleted: gone });
  });

  /** Recent audit lines, newest first. Names and outcomes only — see audit.ts. */
  app.get('/api/audit', (_req, res) => {
    let lines: string[] = [];
    try {
      lines = readFileSync(deps.auditLogPath, 'utf8').trim().split('\n').filter(Boolean).slice(-200).reverse();
    } catch {
      lines = [];
    }
    res.json({
      events: lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l };
        }
      }),
    });
  });

  return app;
}
