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
import { CREDENTIAL_CATALOG, envReport, isManagedCredential } from '../domains/credentialCatalog.js';

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
    const stored = listCredentials(db);
    const byName = new Map(stored.map((c) => [c.name, c]));

    // Catalog slots joined to what's actually stored. The UI renders the slot
    // whether or not it's filled, so an empty store shows "Plaid Client ID —
    // not set" rather than a blank page plus a naming puzzle.
    const slots = CREDENTIAL_CATALOG.map((slot) => ({
      ...slot,
      stored: byName.has(slot.name),
      meta: byName.get(slot.name) ?? null,
    }));

    // Anything stored that no slot claims. Split so machine-managed per-bank
    // tokens are visibly not hand-editable, and a genuinely unrecognised
    // credential is visible rather than silently hidden by the catalog.
    const catalogued = new Set(CREDENTIAL_CATALOG.map((s) => s.name));
    const extra = stored.filter((c) => !catalogued.has(c.name));

    res.json({
      configured: deps.key !== null,
      // Unchanged shape, still the full stored list — existing clients and the
      // contract tests depend on it; slots/env are additive.
      credentials: stored,
      slots,
      managed: extra.filter((c) => isManagedCredential(c.name)),
      unrecognised: extra.filter((c) => !isManagedCredential(c.name)),
      // `deps.key !== null` is the honest presence probe for CABINET_CRED_KEY:
      // the variable itself is scrubbed from process.env at boot, so the loaded
      // key buffer is the only remaining evidence it was ever set.
      env: envReport(process.env, {
        CABINET_CRED_KEY: deps.key !== null,
        GITHUB_APP_PRIVATE_KEY_B64: !!process.env.GITHUB_TOKEN,
      }),
    });
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
    // Machine-managed names are off-limits to hand editing. A per-bank access
    // token is issued by Plaid and bound to an item row; pasting anything else
    // over it doesn't fail here — it fails at the next sync, as an
    // authentication error against a bank, which is a genuinely awful place to
    // start debugging. The integration writes these through the domain, not
    // this route, so nothing legitimate is blocked.
    if (isManagedCredential(name)) {
      return res.status(409).json({
        error: `'${name}' is managed automatically by an integration and cannot be set by hand. Re-link the account instead.`,
      });
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
    // A machine-managed name that a LIVE item still points at must not be
    // deletable here. Dropping it doesn't fail now — it fails at the next sync,
    // as an authentication error against Ben's bank, with the token that would
    // explain it already gone. Unlinking goes through DELETE /api/plaid/items/
    // :id, which revokes at Plaid first and then cascades; that path is
    // unaffected.
    //
    // Orphans are still deletable on purpose: a credential no item references
    // is debris, and refusing to clean up debris would make this rule a leak
    // rather than a guard.
    if (isManagedCredential(name)) {
      const owner = db.prepare('SELECT id FROM plaid_item WHERE token_credential = ?').get(name) as
        | { id: number }
        | undefined;
      if (owner) {
        return res.status(409).json({
          error: `'${name}' is the live access token for a linked account. Unlink the account instead — that revokes it at the provider first.`,
          item_id: owner.id,
        });
      }
    }
    if (!deleteCredential(db, name)) return res.status(404).json({ error: 'no such credential' });
    res.json({ ok: true, deleted: name });
  });
}
