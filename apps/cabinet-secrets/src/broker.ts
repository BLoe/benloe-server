/**
 * The capability API Cabinet talks to, over a unix domain socket.
 *
 * AUTHENTICATION IS THE FILESYSTEM. The socket is created 0660
 * cabinet-secrets:claude-worker, so the set of processes that can connect is
 * exactly {root, cabinet-secrets, claude-worker}. There is no token to steal,
 * leak into a transcript, or forget to rotate, and the check is enforced by the
 * kernel rather than by this code being correct. A TCP port on localhost would
 * have been reachable by every uid on the box, including any future service.
 *
 * WHAT IS DELIBERATELY ABSENT: any route that returns credential material.
 * Not `GET /v1/credentials/:name/secret`, not a "just for debugging" variant,
 * not a decrypt RPC. The agent can enumerate names, ask whether an integration
 * is configured, and ask for a credential to be USED. That is the whole surface.
 * test/no-secret-egress.test.ts fails if this file ever imports decryptSecret.
 */
import express, { type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { AuditFn } from './audit.js';
import { listCredentials } from './store.js';
import {
  plaidConfigured,
  plaidExchangePublicToken,
  plaidRequest,
  PlaidNotConfiguredError,
  PlaidPathRefusedError,
  type PlaidProxyDeps,
} from './plaid.js';
import { CREDENTIAL_NAME_RE } from './store.js';

export interface BrokerDeps {
  db: Database.Database;
  key: Buffer | null;
  audit: AuditFn;
  environment: string;
  fetchImpl?: typeof fetch;
}

function proxyDeps(deps: BrokerDeps): PlaidProxyDeps {
  return { db: deps.db, key: deps.key, audit: deps.audit, environment: deps.environment, fetchImpl: deps.fetchImpl };
}

/** Map a thrown error to a status without ever echoing an unbounded message. */
function fail(res: Response, err: unknown): void {
  if (err instanceof PlaidPathRefusedError) {
    res.status(403).json({ error: err.message });
  } else if (err instanceof PlaidNotConfiguredError) {
    res.status(503).json({ error: err.message });
  } else {
    res.status(500).json({ error: err instanceof Error ? err.message : 'broker error' });
  }
}

export function buildBrokerApp(deps: BrokerDeps) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, keyLoaded: deps.key !== null, environment: deps.environment });
  });

  // Metadata only — see listCredentials' explicit column list.
  app.get('/v1/credentials', (_req, res) => {
    res.json({ credentials: listCredentials(deps.db) });
  });

  app.get('/v1/plaid/status', (_req, res) => {
    res.json({ configured: plaidConfigured(proxyDeps(deps)), environment: deps.environment });
  });

  app.post('/v1/plaid/request', async (req: Request, res: Response) => {
    const { path, body, accessTokenCredential } = (req.body ?? {}) as {
      path?: unknown;
      body?: unknown;
      accessTokenCredential?: unknown;
    };
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return res.status(400).json({ error: 'path (a leading-slash Plaid path) is required' });
    }
    if (accessTokenCredential !== undefined && typeof accessTokenCredential !== 'string') {
      return res.status(400).json({ error: 'accessTokenCredential must be a credential name' });
    }
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
      return res.status(400).json({ error: 'body must be an object' });
    }
    try {
      const result = await plaidRequest(proxyDeps(deps), {
        path,
        body: body as Record<string, unknown> | undefined,
        accessTokenCredential: accessTokenCredential as string | undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/v1/plaid/exchange', async (req: Request, res: Response) => {
    const { publicToken, credentialName } = (req.body ?? {}) as { publicToken?: unknown; credentialName?: unknown };
    if (typeof publicToken !== 'string' || !publicToken) {
      return res.status(400).json({ error: 'publicToken is required' });
    }
    if (typeof credentialName !== 'string' || !CREDENTIAL_NAME_RE.test(credentialName)) {
      return res.status(400).json({ error: 'credentialName must be a lowercase slug' });
    }
    try {
      // Returns the NAME the token was filed under, never the token.
      res.json(await plaidExchangePublicToken(proxyDeps(deps), publicToken, credentialName));
    } catch (err) {
      fail(res, err);
    }
  });

  // Anything else is a 404 rather than a hint about what might exist.
  app.use((_req, res) => res.status(404).json({ error: 'no such broker endpoint' }));

  return app;
}
