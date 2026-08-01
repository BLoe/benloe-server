/* ============================================================================
   HTTP surface for the credential store — mounted behind buildApp's owner auth
   wall like the rest of /api.

   The asymmetry here is the whole design and is intentional: secrets go IN
   through this file and never come back OUT. Every response is built from
   `listCredentials`/`getCredentialMeta`, which cannot return ciphertext or
   plaintext even by accident (see domains/credentials.ts — the column lists
   there are explicit for exactly this reason). There is no GET-one-secret
   route, and there must never be one; decryption lives in
   getCredentialSecret, which this module deliberately does not import.

   Two smaller rules that are easy to lose in a refactor:
   - Never log or echo req.body on these routes. The body carries the
     plaintext, so a debug `console.log(req.body)` here would write Ben's Plaid
     token to the journal, and an error handler that echoes the request body
     would put it in a response.
   - Never put the secret (or anything derived from it — length, prefix, a
     hash) into an error message. "Invalid" is the entire vocabulary.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  CREDENTIAL_NAME_RE,
  CredentialKeyError,
  deleteCredential,
  getCredentialMeta,
  listCredentials,
  putCredential,
} from '../domains/credentials.js';

export interface CredentialRouteDeps {
  db: Database.Database;
  /**
   * The key from credKey(process.env), or null. Null is a supported running
   * state, not an error: the list endpoint keeps working (degraded,
   * read-metadata-only) and writes answer 503 with a message that says which
   * env var is missing, so the failure is self-diagnosing.
   */
  key: Buffer | null;
}

export function registerCredentialRoutes(app: Express, deps: CredentialRouteDeps): void {
  const { db } = deps;

  /**
   * The metadata list. `configured` is what the UI needs to render "the key
   * isn't loaded, this server can't decrypt anything" instead of pretending
   * the credentials are usable.
   */
  app.get('/api/credentials', (_req: Request, res: Response) => {
    res.json({ configured: deps.key !== null, credentials: listCredentials(db) });
  });

  /**
   * Create or rotate. The secret arrives in the body — the only direction it
   * ever travels over HTTP — and the response is pure metadata: same shape as
   * one element of GET's list, so a client can update its state from the
   * response without a refetch and without ever holding a secret it displayed.
   */
  app.post('/api/credentials', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { name?: unknown; provider?: unknown; description?: unknown; secret?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!CREDENTIAL_NAME_RE.test(name)) {
      return res.status(400).json({ error: "name must be a lowercase slug, e.g. 'plaid-access-token'" });
    }
    if (typeof body.secret !== 'string' || body.secret.length === 0) {
      return res.status(400).json({ error: 'secret is required' });
    }
    if (typeof body.provider !== 'undefined' && body.provider !== null && typeof body.provider !== 'string') {
      return res.status(400).json({ error: 'provider must be a string' });
    }
    if (typeof body.description !== 'undefined' && body.description !== null && typeof body.description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }
    try {
      const { created } = putCredential(db, deps.key, {
        name,
        provider: (body.provider as string | null | undefined) ?? null,
        description: (body.description as string | null | undefined) ?? null,
        secret: body.secret,
      });
      // 201 on create, 200 on rotate — the same distinction putCredential
      // draws, surfaced so the UI can say "added" vs "rotated" truthfully.
      res.status(created ? 201 : 200).json({ ok: true, created, credential: getCredentialMeta(db, name) });
    } catch (err) {
      if (err instanceof CredentialKeyError) {
        // 503, not 500: the server is fine, this deployment just has no key.
        return res.status(503).json({ error: err.message });
      }
      // Generic on purpose. putCredential's other throws are validation-shaped
      // and already covered above; anything else must not have its message
      // reflected back, because the failing call had the plaintext in scope.
      res.status(500).json({ error: 'could not store credential' });
    }
  });

  /**
   * Delete. Needs no key — dropping ciphertext you can't read is still a
   * complete delete, and being able to revoke a credential while the key is
   * unavailable is a feature, not an oversight.
   */
  app.delete('/api/credentials/:name', (req: Request, res: Response) => {
    const name = req.params.name ?? '';
    if (!deleteCredential(db, name)) return res.status(404).json({ error: 'no such credential' });
    res.json({ ok: true, deleted: name });
  });
}
