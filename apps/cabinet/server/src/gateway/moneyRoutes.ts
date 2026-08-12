/* ============================================================================
   HTTP surface for the money ledger — mounted behind buildApp's owner auth
   wall like the rest of /api.

   Every route here is a read over rows Cabinet already holds, plus the one
   write that decides whether an account counts toward the rollups. Nothing in
   this file reaches a network or a credential: the ledger is filled by
   tools/cabinet.ts (CSV import, manual accounts), and the reads below just
   report what landed.
   ========================================================================== */
import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  listAccounts,
  listHoldings,
  moneySummary,
  netWorthNow,
  netWorthTrend,
  recentTransactions,
  setAccountHidden,
  spendByCategory,
  spendByDay,
} from '../domains/money.js';

export interface MoneyRouteDeps {
  db: Database.Database;
}

export function registerMoneyRoutes(app: Express, deps: MoneyRouteDeps): void {
  const { db } = deps;

  /**
   * What the Money surface renders above the fold: every account, hidden ones
   * included, and the net worth computed from them. One call rather than two
   * because the caveat the surface shows ("computed from 4 of 6 accounts")
   * only makes sense when both halves came from the same read.
   */
  app.get('/api/money/accounts', (_req: Request, res: Response) => {
    res.json({ accounts: listAccounts(db, true), net_worth: netWorthNow(db) });
  });

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

  /** Hide/show an account in the rollups without deleting anything. */
  app.patch('/api/money/accounts/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const hidden = !!(req.body ?? {}).hidden;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad account id' });
    if (!setAccountHidden(db, id, hidden)) return res.status(404).json({ error: 'no such account' });
    res.json({ ok: true, id, hidden });
  });
}
