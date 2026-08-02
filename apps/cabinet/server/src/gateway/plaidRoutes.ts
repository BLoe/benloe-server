/* ============================================================================
   HTTP surface for the Plaid integration.

   Split into two registrations with very different security postures, and the
   split is the point:

   - registerPlaidRoutes  — everything Ben drives, mounted behind buildApp's
     Artanis owner wall like the rest of /api.

   - registerPlaidWebhook — the ONE endpoint Plaid itself calls. Plaid cannot
     hold a session cookie, so this route must sit OUTSIDE the auth wall. What
     replaces the session is cryptography: an ES256 signature over a hash of
     the exact request bytes (see PlaidClient.verifyWebhook). It must be
     registered before `app.use(express.json())` so it can keep the raw body —
     re-serializing a parsed body changes the whitespace and breaks the hash
     comparison permanently.

   The rule inherited from credentialRoutes.ts and worth restating: no route in
   this file imports getCredentialSecret. Routes hold a PlaidClient; the client
   holds the key. A response body from here can never contain a token because
   nothing in this file has ever seen one.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import { PlaidApiError, PlaidNotConfiguredError, type PlaidClient } from '../integrations/plaid.js';
import {
  deleteItem,
  listAccounts,
  listHoldings,
  listItems,
  moneySummary,
  netWorthNow,
  utcIso,
  netWorthTrend,
  recentTransactions,
  setAccountHidden,
  spendByCategory,
  spendByDay,
} from '../domains/money.js';

export interface PlaidRouteDeps {
  db: Database.Database;
  plaid: PlaidClient;
}

/** Map an integration error onto an HTTP status without leaking internals. */
function fail(res: Response, err: unknown): Response {
  if (err instanceof PlaidNotConfiguredError) {
    // 503, not 500: the server is healthy, this deployment just has no keys.
    return res.status(503).json({ error: err.message, configured: false });
  }
  if (err instanceof PlaidApiError) {
    // Plaid's display_message is written for end users and is safe to surface;
    // error_code is what makes a failure actionable in the UI.
    return res.status(502).json({
      error: err.displayMessage ?? err.message,
      error_code: err.errorCode,
      needs_relink: err.needsRelink,
    });
  }
  console.error('plaid route: %s', err instanceof Error ? err.message : String(err));
  return res.status(500).json({ error: 'Plaid request failed' });
}

export function registerPlaidRoutes(app: Express, deps: PlaidRouteDeps): void {
  const { db, plaid } = deps;

  /**
   * Everything the Money surface needs to render itself, including the
   * unhappy paths. `configured: false` and an item in `login_required` are
   * normal states that the UI must be able to show, not errors.
   */
  app.get('/api/plaid/status', (_req: Request, res: Response) => {
    res.json({
      configured: plaid.configured(),
      environment: plaid.environment,
      redirect_uri: plaid.redirectUri,
      webhook_url: plaid.webhookUrl,
      items: listItems(db).map((i) => ({
        id: i.id,
        institution: i.institution_name,
        status: i.status,
        error_code: i.error_code,
        // utcIso, not the raw column: SQLite stamps UTC without a zone marker
        // and the browser would read it as local. consent_expiration_time comes
        // from Plaid already zoned and passes through untouched.
        last_synced_at: utcIso(i.last_synced_at),
        consent_expiration_time: utcIso(i.consent_expiration_time),
      })),
      accounts: listAccounts(db, true),
      net_worth: netWorthNow(db),
    });
  });

  /**
   * Mint a Link token. With `item_id`, Link opens in update mode to repair a
   * broken connection instead of creating a second one.
   */
  app.post('/api/plaid/link-token', async (req: Request, res: Response) => {
    try {
      const itemPk = Number((req.body ?? {}).item_id);
      const link_token = await plaid.createLinkToken({
        userId: 'ben',
        ...(Number.isFinite(itemPk) && itemPk > 0 ? { itemPk } : {}),
      });
      res.json({ link_token, environment: plaid.environment });
    } catch (err) {
      fail(res, err);
    }
  });

  /**
   * Complete a link. The initial sync can pull two years of history across
   * several pages, which is far longer than a browser should wait on a POST —
   * so the exchange responds as soon as the token is sealed and the backfill
   * runs detached. The UI polls /status, which is where the real progress
   * lives anyway.
   */
  app.post('/api/plaid/exchange', async (req: Request, res: Response) => {
    const publicToken = (req.body ?? {}).public_token;
    if (typeof publicToken !== 'string' || !publicToken) {
      return res.status(400).json({ error: 'public_token is required' });
    }
    try {
      const item = await plaid.exchangePublicToken(publicToken);
      res.status(201).json({
        ok: true,
        item: { id: item.id, institution: item.institution_name, status: item.status },
        syncing: true,
      });
      void plaid.syncItem(item.id).catch((err) => {
        console.error('plaid: initial sync failed for item %s: %s', item.id, (err as Error).message);
      });
    } catch (err) {
      fail(res, err);
    }
  });

  /** Manual sync — one institution with `item_id`, otherwise all of them. */
  app.post('/api/plaid/sync', async (req: Request, res: Response) => {
    try {
      const itemPk = Number((req.body ?? {}).item_id);
      if (Number.isFinite(itemPk) && itemPk > 0) {
        return res.json({ reports: [await plaid.syncItem(itemPk)] });
      }
      res.json(await plaid.syncAll());
    } catch (err) {
      fail(res, err);
    }
  });

  /** Unlink: revoke the token at Plaid, then drop the rows (cascades). */
  app.delete('/api/plaid/items/:id', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad item id' });
    try {
      await plaid.removeItem(id);
      deleteItem(db, id);
      res.json({ ok: true, deleted: id });
    } catch (err) {
      fail(res, err);
    }
  });

  /** Hide/show an account in rollups without unlinking it. */
  app.patch('/api/plaid/accounts/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const hidden = !!(req.body ?? {}).hidden;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad account id' });
    if (!setAccountHidden(db, id, hidden)) return res.status(404).json({ error: 'no such account' });
    res.json({ ok: true, id, hidden });
  });

  /**
   * Institution search. This exists so the "is UBS reachable through Plaid?"
   * question is answered by the API rather than by reading marketing pages —
   * one call, definitive, and it also covers every future "can it see X?".
   */
  app.get('/api/plaid/institutions', async (req: Request, res: Response) => {
    const query = String(req.query.query ?? '').trim();
    if (query.length < 2) return res.status(400).json({ error: 'query must be at least 2 characters' });
    const products = String(req.query.products ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    try {
      res.json({ query, products, institutions: await plaid.searchInstitutions(query, products) });
    } catch (err) {
      fail(res, err);
    }
  });

  /* ------------------------------------------------------------- money --- */

  app.get('/api/money/summary', (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 30);
    res.json(moneySummary(db, Number.isFinite(days) ? days : 30));
  });

  app.get('/api/money/transactions', (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 14);
    const limit = Number(req.query.limit ?? 100);
    res.json({
      transactions: recentTransactions(db, {
        days: Number.isFinite(days) ? days : 14,
        limit: Number.isFinite(limit) ? limit : 100,
      }),
    });
  });

  app.get('/api/money/trend', (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 90);
    const d = Number.isFinite(days) ? days : 90;
    res.json({ net_worth: netWorthTrend(db, d), spend_by_day: spendByDay(db, Math.min(d, 90)) });
  });

  app.get('/api/money/categories', (req: Request, res: Response) => {
    const days = Number(req.query.days ?? 30);
    res.json({ categories: spendByCategory(db, Number.isFinite(days) ? days : 30) });
  });

  app.get('/api/money/holdings', (_req: Request, res: Response) => {
    res.json({ holdings: listHoldings(db) });
  });
}

/**
 * The webhook. MUST be registered before the global express.json() and before
 * the /api auth wall.
 *
 * Failure mode chosen deliberately: an unverified webhook gets a 403 and is
 * dropped. Plaid retries, so a transient verification failure (a key fetch
 * that timed out) self-heals; and a forged one never reaches handleWebhook,
 * which is what stops an attacker from triggering syncs or flipping an Item's
 * status by POSTing at a public URL.
 *
 * The response is always a bare status. A webhook endpoint that echoes what it
 * did is a free oracle for anyone probing it.
 */
export function registerPlaidWebhook(app: Express, deps: PlaidRouteDeps): void {
  app.post(
    '/api/plaid/webhook',
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req: Request, res: Response) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const header = req.headers['plaid-verification'];
      const verification = Array.isArray(header) ? header[0] : header;
      try {
        if (!(await deps.plaid.verifyWebhook(raw, verification))) {
          return res.status(403).end();
        }
        const body = JSON.parse(raw.toString('utf8'));
        // Acknowledge before working. Plaid times these out and retries, and a
        // slow sync would otherwise turn one webhook into a retry storm.
        res.status(200).end();
        const outcome = await deps.plaid.handleWebhook(body);
        console.log('plaid webhook: %s', outcome);
      } catch (err) {
        console.error('plaid webhook: %s', err instanceof Error ? err.message : String(err));
        if (!res.headersSent) res.status(400).end();
      }
    },
  );
}
