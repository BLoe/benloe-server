/* ============================================================================
   Money — repository for linked accounts, transactions, holdings and net worth.

   This module owns three things that are easy to get wrong and expensive to
   get wrong silently:

   1. THE SIGN. Plaid reports `amount` positive when money LEAVES the account.
      Storage keeps that verbatim (see 018_money.sql). Every function here that
      returns something a human will read does the flip exactly once, and says
      so in its name or its doc. If you find yourself negating an amount at a
      call site, the bug is here, not there.

   2. TRANSFER EXCLUSION. A credit-card purchase appears on the card. The
      payment of that card appears on the checking account. Summing both counts
      the same coffee twice. Every spend rollup excludes the TRANSFER_* and
      LOAN_PAYMENTS categories, and that exclusion is centralised in
      SPEND_EXCLUDED_CATEGORIES rather than copy-pasted into each query.

   3. IDEMPOTENCE. Sync runs nightly, on demand, and on webhook — sometimes all
      three within a minute. Every write here is an upsert keyed on Plaid's own
      identifier, so running sync twice is indistinguishable from running it
      once.

   What this module deliberately does NOT do: talk to Plaid, or touch a
   credential. It takes rows and returns rows. integrations/plaid.ts is the
   only thing that knows a network exists.
   ========================================================================== */
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { localDay } from '../db/index.js';

/* ---------------------------------------------------------------- types --- */

/**
 * SQLite's `datetime('now')` returns UTC but stamps no zone marker:
 * "2026-08-02 04:41:09". A browser handed that string parses it as LOCAL time,
 * so in New York a sync that just finished renders as four hours in the future
 * — and "last synced 4h from now" is the kind of wrong that looks like a bug in
 * the sync rather than a bug in the formatting.
 *
 * Normalise on the way out, not in storage: 17 migrations of existing rows use
 * the naive format and a split convention inside one database is worse than a
 * conversion at the boundary. Idempotent — a string that already carries a zone
 * (Plaid's own timestamps do) passes through untouched.
 */
export function utcIso(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return value; // already zoned
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  return m ? `${m[1]}T${m[2]}Z` : value;
}

export type ItemStatus = 'active' | 'login_required' | 'error' | 'revoked';

export interface PlaidItemRow {
  id: number;
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  token_credential: string | null;
  status: ItemStatus;
  error_code: string | null;
  error_message: string | null;
  consent_expiration_time: string | null;
  transactions_cursor: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountInput {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  current_balance?: number | null;
  available_balance?: number | null;
  limit_amount?: number | null;
  iso_currency_code?: string | null;
}

export interface TransactionInput {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  category_primary?: string | null;
  category_detailed?: string | null;
  payment_channel?: string | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
}

export interface SecurityInput {
  security_id: string;
  name?: string | null;
  ticker_symbol?: string | null;
  type?: string | null;
  close_price?: number | null;
  close_price_as_of?: string | null;
  iso_currency_code?: string | null;
  is_cash_equivalent?: boolean;
}

export interface HoldingInput {
  account_id: string;
  security_id: string;
  quantity?: number | null;
  cost_basis?: number | null;
  institution_price?: number | null;
  institution_price_as_of?: string | null;
  institution_value?: number | null;
  iso_currency_code?: string | null;
}

/**
 * Categories excluded from every "what did Ben spend" rollup.
 *
 * TRANSFER_IN / TRANSFER_OUT catch moving money between Ben's own accounts and
 * paying off the credit card — real cash movements, but not consumption, and
 * counting them double-counts everything bought on the card. LOAN_PAYMENTS is
 * excluded from *spending* for the same double-count reason, not because it
 * isn't real money; it shows up in cash-flow, which is a separate question.
 */
export const SPEND_EXCLUDED_CATEGORIES = ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS'];

/* ------------------------------------------------------------ item CRUD --- */

/**
 * Insert or update an Item by its Plaid item_id.
 *
 * Upsert rather than insert because re-linking an institution (after a
 * password change, or Plaid's "update mode") returns the SAME item_id with a
 * fresh access token. That has to land as a rotation of one connection, not a
 * duplicate — two rows for one bank means two syncs, double-counted
 * transactions, and a UNIQUE violation on the first one to arrive.
 */
export function upsertItem(
  db: Database.Database,
  input: { item_id: string; institution_id?: string | null; institution_name?: string | null },
): PlaidItemRow {
  db.prepare(
    `INSERT INTO plaid_item (item_id, institution_id, institution_name, status)
     VALUES (@item_id, @institution_id, @institution_name, 'active')
     ON CONFLICT(item_id) DO UPDATE SET
       institution_id   = COALESCE(excluded.institution_id, plaid_item.institution_id),
       institution_name = COALESCE(excluded.institution_name, plaid_item.institution_name),
       status           = 'active',
       error_code       = NULL,
       error_message    = NULL,
       updated_at       = datetime('now')`,
  ).run({
    item_id: input.item_id,
    institution_id: input.institution_id ?? null,
    institution_name: input.institution_name ?? null,
  });
  return getItemByItemId(db, input.item_id)!;
}

export function getItemByItemId(db: Database.Database, itemId: string): PlaidItemRow | null {
  return (db.prepare('SELECT * FROM plaid_item WHERE item_id = ?').get(itemId) as PlaidItemRow | undefined) ?? null;
}

export function getItem(db: Database.Database, id: number): PlaidItemRow | null {
  return (db.prepare('SELECT * FROM plaid_item WHERE id = ?').get(id) as PlaidItemRow | undefined) ?? null;
}

/** Every Item except the ones we've revoked. Ordered oldest-first so sync order is stable. */
export function listItems(db: Database.Database, includeRevoked = false): PlaidItemRow[] {
  const sql = includeRevoked
    ? 'SELECT * FROM plaid_item ORDER BY id'
    : `SELECT * FROM plaid_item WHERE status != 'revoked' ORDER BY id`;
  return db.prepare(sql).all() as PlaidItemRow[];
}

/** Items healthy enough to attempt a sync against. */
export function syncableItems(db: Database.Database): PlaidItemRow[] {
  return db
    .prepare(`SELECT * FROM plaid_item WHERE status = 'active' AND token_credential IS NOT NULL ORDER BY id`)
    .all() as PlaidItemRow[];
}

export function setItemCredential(db: Database.Database, id: number, credentialName: string): void {
  db.prepare(`UPDATE plaid_item SET token_credential = ?, updated_at = datetime('now') WHERE id = ?`).run(
    credentialName,
    id,
  );
}

/**
 * Record an Item's health. `error` and `login_required` are distinct on
 * purpose: login_required is the one state Ben can personally fix (by
 * re-running Link), so it is the one the UI turns into a button rather than a
 * log line.
 */
export function setItemStatus(
  db: Database.Database,
  id: number,
  status: ItemStatus,
  err?: { code?: string | null; message?: string | null },
): void {
  db.prepare(
    `UPDATE plaid_item SET status = @status, error_code = @code, error_message = @message,
       updated_at = datetime('now') WHERE id = @id`,
  ).run({ id, status, code: err?.code ?? null, message: err?.message ?? null });
}

/**
 * Advance the sync cursor. Called ONLY after the page it describes is
 * committed — see the column comment in 018_money.sql. Advancing early loses
 * transactions permanently; advancing late re-fetches a page that upserts to a
 * no-op. The asymmetry is why this is its own function and not an inline UPDATE.
 */
export function setItemCursor(db: Database.Database, id: number, cursor: string): void {
  db.prepare(`UPDATE plaid_item SET transactions_cursor = ?, updated_at = datetime('now') WHERE id = ?`).run(
    cursor,
    id,
  );
}

export function markItemSynced(db: Database.Database, id: number): void {
  db.prepare(`UPDATE plaid_item SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
    id,
  );
}

export function setConsentExpiration(db: Database.Database, id: number, iso: string | null): void {
  db.prepare(`UPDATE plaid_item SET consent_expiration_time = ?, updated_at = datetime('now') WHERE id = ?`).run(
    iso,
    id,
  );
}

/** Cascades to accounts → transactions/holdings via ON DELETE CASCADE. */
export function deleteItem(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM plaid_item WHERE id = ?').run(id).changes > 0;
}

/* --------------------------------------------------------------- writes --- */

export function upsertAccounts(db: Database.Database, itemPk: number, accounts: AccountInput[]): number {
  const stmt = db.prepare(
    `INSERT INTO financial_account
       (item_pk, account_id, name, official_name, mask, type, subtype,
        current_balance, available_balance, limit_amount, iso_currency_code, balance_as_of)
     VALUES (@item_pk, @account_id, @name, @official_name, @mask, @type, @subtype,
             @current_balance, @available_balance, @limit_amount, @iso_currency_code, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       item_pk           = excluded.item_pk,
       name              = COALESCE(excluded.name, financial_account.name),
       official_name     = COALESCE(excluded.official_name, financial_account.official_name),
       mask              = COALESCE(excluded.mask, financial_account.mask),
       type              = COALESCE(excluded.type, financial_account.type),
       subtype           = COALESCE(excluded.subtype, financial_account.subtype),
       current_balance   = excluded.current_balance,
       available_balance = excluded.available_balance,
       limit_amount      = excluded.limit_amount,
       iso_currency_code = COALESCE(excluded.iso_currency_code, financial_account.iso_currency_code),
       balance_as_of     = datetime('now'),
       updated_at        = datetime('now')`,
  );
  const run = db.transaction((rows: AccountInput[]) => {
    for (const a of rows) {
      stmt.run({
        item_pk: itemPk,
        account_id: a.account_id,
        name: a.name ?? null,
        official_name: a.official_name ?? null,
        mask: a.mask ?? null,
        type: a.type ?? null,
        subtype: a.subtype ?? null,
        current_balance: a.current_balance ?? null,
        available_balance: a.available_balance ?? null,
        limit_amount: a.limit_amount ?? null,
        iso_currency_code: a.iso_currency_code ?? null,
      });
    }
  });
  run(accounts);
  return accounts.length;
}

export interface SyncCounts {
  added: number;
  modified: number;
  removed: number;
  skipped: number;
}

/**
 * Apply one page of /transactions/sync.
 *
 * `skipped` counts transactions whose account we don't have a row for. That
 * happens legitimately — Plaid can return a transaction for an account Ben
 * de-selected in Link — and silently dropping them would be a lie, so they are
 * counted and surfaced rather than swallowed. A non-zero skipped count with a
 * zero added count is the signature of accounts and transactions being applied
 * in the wrong order.
 *
 * The whole page lands in ONE transaction: a partial page plus an advanced
 * cursor is the one failure this design cannot recover from, so the commit and
 * the cursor write are chained by the caller around this boundary.
 */
export function applyTransactionSync(
  db: Database.Database,
  page: { added?: TransactionInput[]; modified?: TransactionInput[]; removed?: string[] },
): SyncCounts {
  const upsert = db.prepare(
    `INSERT INTO financial_transaction
       (account_pk, transaction_id, amount, iso_currency_code, date, authorized_date, name, merchant_name,
        category_primary, category_detailed, payment_channel, pending, pending_transaction_id)
     VALUES (@account_pk, @transaction_id, @amount, @iso_currency_code, @date, @authorized_date, @name, @merchant_name,
             @category_primary, @category_detailed, @payment_channel, @pending, @pending_transaction_id)
     ON CONFLICT(transaction_id) DO UPDATE SET
       amount                 = excluded.amount,
       iso_currency_code      = excluded.iso_currency_code,
       date                   = excluded.date,
       authorized_date        = excluded.authorized_date,
       name                   = excluded.name,
       merchant_name          = excluded.merchant_name,
       category_primary       = excluded.category_primary,
       category_detailed      = excluded.category_detailed,
       payment_channel        = excluded.payment_channel,
       pending                = excluded.pending,
       pending_transaction_id = excluded.pending_transaction_id,
       updated_at             = datetime('now')`,
  );
  const accountPk = db.prepare('SELECT id FROM financial_account WHERE account_id = ?');
  const del = db.prepare('DELETE FROM financial_transaction WHERE transaction_id = ?');
  // When a pending transaction settles, Plaid sends the settled row carrying
  // pending_transaction_id. Dropping the superseded row here (rather than
  // waiting for it to appear in `removed`, which is not guaranteed to be
  // prompt) is what stops a purchase being counted twice for several days.
  const delSuperseded = db.prepare('DELETE FROM financial_transaction WHERE transaction_id = ?');

  const counts: SyncCounts = { added: 0, modified: 0, removed: 0, skipped: 0 };

  const apply = db.transaction(() => {
    for (const [kind, rows] of [
      ['added', page.added ?? []],
      ['modified', page.modified ?? []],
    ] as const) {
      for (const t of rows) {
        const acct = accountPk.get(t.account_id) as { id: number } | undefined;
        if (!acct) {
          counts.skipped += 1;
          continue;
        }
        upsert.run({
          account_pk: acct.id,
          transaction_id: t.transaction_id,
          amount: t.amount,
          iso_currency_code: t.iso_currency_code ?? null,
          date: t.date,
          authorized_date: t.authorized_date ?? null,
          name: t.name ?? null,
          merchant_name: t.merchant_name ?? null,
          category_primary: t.category_primary ?? null,
          category_detailed: t.category_detailed ?? null,
          payment_channel: t.payment_channel ?? null,
          pending: t.pending ? 1 : 0,
          pending_transaction_id: t.pending_transaction_id ?? null,
        });
        if (t.pending_transaction_id) delSuperseded.run(t.pending_transaction_id);
        counts[kind] += 1;
      }
    }
    for (const id of page.removed ?? []) {
      counts.removed += del.run(id).changes;
    }
  });
  apply();
  return counts;
}

export function upsertSecurities(db: Database.Database, securities: SecurityInput[]): number {
  const stmt = db.prepare(
    `INSERT INTO security (security_id, name, ticker_symbol, type, close_price, close_price_as_of,
                           iso_currency_code, is_cash_equivalent)
     VALUES (@security_id, @name, @ticker_symbol, @type, @close_price, @close_price_as_of,
             @iso_currency_code, @is_cash_equivalent)
     ON CONFLICT(security_id) DO UPDATE SET
       name               = COALESCE(excluded.name, security.name),
       ticker_symbol      = COALESCE(excluded.ticker_symbol, security.ticker_symbol),
       type               = COALESCE(excluded.type, security.type),
       close_price        = excluded.close_price,
       close_price_as_of  = excluded.close_price_as_of,
       iso_currency_code  = COALESCE(excluded.iso_currency_code, security.iso_currency_code),
       is_cash_equivalent = excluded.is_cash_equivalent,
       updated_at         = datetime('now')`,
  );
  const run = db.transaction((rows: SecurityInput[]) => {
    for (const s of rows) {
      stmt.run({
        security_id: s.security_id,
        name: s.name ?? null,
        ticker_symbol: s.ticker_symbol ?? null,
        type: s.type ?? null,
        close_price: s.close_price ?? null,
        close_price_as_of: s.close_price_as_of ?? null,
        iso_currency_code: s.iso_currency_code ?? null,
        is_cash_equivalent: s.is_cash_equivalent ? 1 : 0,
      });
    }
  });
  run(securities);
  return securities.length;
}

/**
 * Replace the holdings for a set of accounts.
 *
 * Holdings are a current-position snapshot, so a sold-out position must
 * DISAPPEAR, not linger at its last known quantity. An upsert alone can't
 * express that, so this deletes the accounts' holdings and rewrites them —
 * inside one transaction, so a reader never observes an empty portfolio.
 */
export function replaceHoldings(db: Database.Database, accountIds: string[], holdings: HoldingInput[]): number {
  const accountPk = db.prepare('SELECT id FROM financial_account WHERE account_id = ?');
  const securityPk = db.prepare('SELECT id FROM security WHERE security_id = ?');
  const clear = db.prepare('DELETE FROM holding WHERE account_pk = ?');
  const ins = db.prepare(
    `INSERT INTO holding (account_pk, security_pk, quantity, cost_basis, institution_price,
                          institution_price_as_of, institution_value, iso_currency_code)
     VALUES (@account_pk, @security_pk, @quantity, @cost_basis, @institution_price,
             @institution_price_as_of, @institution_value, @iso_currency_code)
     ON CONFLICT(account_pk, security_pk) DO UPDATE SET
       quantity                = excluded.quantity,
       cost_basis              = excluded.cost_basis,
       institution_price       = excluded.institution_price,
       institution_price_as_of = excluded.institution_price_as_of,
       institution_value       = excluded.institution_value,
       iso_currency_code       = excluded.iso_currency_code,
       updated_at              = datetime('now')`,
  );
  let written = 0;
  const run = db.transaction(() => {
    for (const accountId of accountIds) {
      const a = accountPk.get(accountId) as { id: number } | undefined;
      if (a) clear.run(a.id);
    }
    for (const h of holdings) {
      const a = accountPk.get(h.account_id) as { id: number } | undefined;
      const s = securityPk.get(h.security_id) as { id: number } | undefined;
      if (!a || !s) continue;
      ins.run({
        account_pk: a.id,
        security_pk: s.id,
        quantity: h.quantity ?? null,
        cost_basis: h.cost_basis ?? null,
        institution_price: h.institution_price ?? null,
        institution_price_as_of: h.institution_price_as_of ?? null,
        institution_value: h.institution_value ?? null,
        iso_currency_code: h.iso_currency_code ?? null,
      });
      written += 1;
    }
  });
  run();
  return written;
}

/* ---------------------------------------------------------------- reads --- */

export interface AccountView {
  id: number;
  account_id: string;
  /**
   * The owning plaid_item, or null for a manual/CSV account. The UI needs this
   * to target Reconnect and Unlink at a specific item; without it the only
   * handle is the institution NAME, and two accounts at the same bank (Ben has
   * a BofA checking and a BofA card) would be indistinguishable — a "reconnect
   * this one" button that unlinks the other.
   */
  item_pk: number | null;
  institution_name: string | null;
  /** 'plaid' | 'manual' — provenance, so the UI can mark hand-imported figures. */
  source: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  limit_amount: number | null;
  balance_as_of: string | null;
  item_status: ItemStatus;
  hidden: number;
}

export function listAccounts(db: Database.Database, includeHidden = false): AccountView[] {
  return db
    .prepare(
      // LEFT JOIN, not JOIN: a manually-imported account has no plaid_item, and
      // an inner join would silently drop it from every listing and every
      // balance total. COALESCE gives it an item_status the UI can render
      // without special-casing null.
      `SELECT a.id, a.account_id, a.source, a.item_pk,
              COALESCE(i.institution_name, a.name) AS institution_name,
              a.name, a.mask, a.type, a.subtype,
              a.current_balance, a.available_balance, a.limit_amount, a.balance_as_of,
              COALESCE(i.status, 'manual') AS item_status, a.hidden
       FROM financial_account a
       LEFT JOIN plaid_item i ON i.id = a.item_pk
       ${includeHidden ? '' : 'WHERE a.hidden = 0'}
       ORDER BY institution_name, a.type, a.name`,
    )
    .all()
    .map((r) => ({ ...(r as AccountView), balance_as_of: utcIso((r as AccountView).balance_as_of) }));
}

export function setAccountHidden(db: Database.Database, accountPk: number, hidden: boolean): boolean {
  return (
    db
      .prepare(`UPDATE financial_account SET hidden = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(hidden ? 1 : 0, accountPk).changes > 0
  );
}

export interface NetWorth {
  cash: number;
  /** Positive = owed. */
  credit: number;
  investments: number;
  loans: number;
  net_worth: number;
  accounts_counted: number;
  accounts_total: number;
  /** Oldest balance timestamp contributing to the number — the honest "as of". */
  stalest_balance_at: string | null;
}

/**
 * Current net worth from the latest balance snapshot on each account.
 *
 * `accounts_counted` vs `accounts_total` is not decoration. If two of five
 * accounts are in login_required, their balances are stale or absent and the
 * total is wrong in a way that looks exactly like a real drop. Any caller
 * rendering the number renders the ratio with it.
 */
export function netWorthNow(db: Database.Database): NetWorth {
  const rows = db
    .prepare(
      // LEFT JOIN so manually-imported accounts (item_pk NULL — the UBS
      // fallback) count toward net worth. Omitting them would understate it by
      // whatever the brokerage holds, which is the largest number in the file.
      `SELECT a.type, a.current_balance, a.balance_as_of
       FROM financial_account a LEFT JOIN plaid_item i ON i.id = a.item_pk
       WHERE a.hidden = 0 AND COALESCE(i.status, 'manual') != 'revoked'`,
    )
    .all() as { type: string | null; current_balance: number | null; balance_as_of: string | null }[];

  const out: NetWorth = {
    cash: 0,
    credit: 0,
    investments: 0,
    loans: 0,
    net_worth: 0,
    accounts_counted: 0,
    accounts_total: rows.length,
    stalest_balance_at: null,
  };
  for (const r of rows) {
    if (r.current_balance === null) continue;
    out.accounts_counted += 1;
    if (r.balance_as_of && (!out.stalest_balance_at || r.balance_as_of < out.stalest_balance_at)) {
      out.stalest_balance_at = r.balance_as_of;
    }
    switch (r.type) {
      case 'depository':
        out.cash += r.current_balance;
        break;
      case 'credit':
        // Plaid reports card balances positive-as-owed. Kept positive here and
        // subtracted below, so `credit` reads as "debt" rather than as a
        // negative asset nobody can interpret at a glance.
        out.credit += r.current_balance;
        break;
      case 'investment':
      case 'brokerage':
        out.investments += r.current_balance;
        break;
      case 'loan':
        out.loans += r.current_balance;
        break;
      default:
        out.cash += r.current_balance;
    }
  }
  out.net_worth = out.cash + out.investments - out.credit - out.loans;
  // Compared naive above (lexicographic order is the same either way), zoned
  // here so the UI can render "balances as of" without inventing a timezone.
  out.stalest_balance_at = utcIso(out.stalest_balance_at);
  return out;
}

/** Write today's net-worth row. Idempotent — re-running replaces the day. */
export function snapshotNetWorth(db: Database.Database, day = localDay()): NetWorth {
  const nw = netWorthNow(db);
  db.prepare(
    `INSERT INTO net_worth_snapshot (local_day, cash, credit, investments, loans, net_worth,
                                     accounts_counted, accounts_total)
     VALUES (@day, @cash, @credit, @investments, @loans, @net_worth, @counted, @total)
     ON CONFLICT(local_day) DO UPDATE SET
       cash = excluded.cash, credit = excluded.credit, investments = excluded.investments,
       loans = excluded.loans, net_worth = excluded.net_worth,
       accounts_counted = excluded.accounts_counted, accounts_total = excluded.accounts_total`,
  ).run({
    day,
    cash: nw.cash,
    credit: nw.credit,
    investments: nw.investments,
    loans: nw.loans,
    net_worth: nw.net_worth,
    counted: nw.accounts_counted,
    total: nw.accounts_total,
  });
  return nw;
}

export function netWorthTrend(db: Database.Database, days = 90): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT local_day, cash, credit, investments, loans, net_worth, accounts_counted, accounts_total
       FROM net_worth_snapshot WHERE local_day >= date('now', 'localtime', @offset)
       ORDER BY local_day`,
    )
    .all({ offset: `-${Math.max(1, days)} days` }) as Record<string, unknown>[];
}

const EXCLUDED_SQL = SPEND_EXCLUDED_CATEGORIES.map((c) => `'${c}'`).join(',');

export interface CategorySpend {
  category: string;
  detailed_top: string | null;
  spent: number;
  txns: number;
}

/**
 * Spending by category over a window. Returns POSITIVE dollars spent — the
 * sign flip from Plaid's convention happens here, once.
 */
export function spendByCategory(db: Database.Database, days = 30, includePending = true): CategorySpend[] {
  return db
    .prepare(
      `SELECT COALESCE(t.category_primary, 'UNCATEGORIZED') AS category,
              (SELECT t2.category_detailed FROM financial_transaction t2
                 JOIN financial_account a2 ON a2.id = t2.account_pk
                WHERE COALESCE(t2.category_primary,'UNCATEGORIZED') = COALESCE(t.category_primary,'UNCATEGORIZED')
                  AND t2.date >= date('now','localtime',@offset) AND a2.hidden = 0
                GROUP BY t2.category_detailed ORDER BY SUM(t2.amount) DESC LIMIT 1) AS detailed_top,
              ROUND(SUM(t.amount), 2) AS spent,
              COUNT(*) AS txns
       FROM financial_transaction t
       JOIN financial_account a ON a.id = t.account_pk
       WHERE t.date >= date('now','localtime',@offset)
         AND a.hidden = 0
         AND t.amount > 0
         AND COALESCE(t.category_primary,'') NOT IN (${EXCLUDED_SQL})
         ${includePending ? '' : 'AND t.pending = 0'}
       GROUP BY category
       ORDER BY spent DESC`,
    )
    .all({ offset: `-${Math.max(1, days)} days` }) as CategorySpend[];
}

export interface TransactionView {
  transaction_id: string;
  date: string;
  /** Positive = spent, negative = received. Flipped from Plaid at this boundary. */
  amount: number;
  merchant: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  account: string | null;
  mask: string | null;
  pending: number;
}

export function recentTransactions(db: Database.Database, opts: { days?: number; limit?: number } = {}): TransactionView[] {
  const { days = 14, limit = 100 } = opts;
  return db
    .prepare(
      `SELECT t.transaction_id, t.date, ROUND(t.amount, 2) AS amount,
              COALESCE(t.merchant_name, t.name) AS merchant,
              t.category_primary, t.category_detailed,
              a.name AS account, a.mask, t.pending
       FROM financial_transaction t
       JOIN financial_account a ON a.id = t.account_pk
       WHERE t.date >= date('now','localtime',@offset) AND a.hidden = 0
       ORDER BY t.date DESC, t.amount DESC
       LIMIT @limit`,
    )
    .all({ offset: `-${Math.max(1, days)} days`, limit: Math.min(Math.max(1, limit), 500) }) as TransactionView[];
}

/**
 * Daily spend totals — the series that joins against food logs, craving events
 * and evening blocks. This is the query the whole money domain exists to make
 * possible: PLAYBOOK P4 says the evening war is won at 2pm, and a delivery
 * charge at 21:40 is the most objective record that it wasn't.
 */
export function spendByDay(db: Database.Database, days = 30): { local_day: string; spent: number; txns: number }[] {
  return db
    .prepare(
      `SELECT t.date AS local_day, ROUND(SUM(t.amount), 2) AS spent, COUNT(*) AS txns
       FROM financial_transaction t
       JOIN financial_account a ON a.id = t.account_pk
       WHERE t.date >= date('now','localtime',@offset)
         AND a.hidden = 0 AND t.amount > 0
         AND COALESCE(t.category_primary,'') NOT IN (${EXCLUDED_SQL})
       GROUP BY t.date ORDER BY t.date`,
    )
    .all({ offset: `-${Math.max(1, days)} days` }) as { local_day: string; spent: number; txns: number }[];
}

/**
 * Food-delivery and restaurant spend, split out by day.
 *
 * Narrow on purpose. Ben's stated failure loop is 8pm-to-midnight Grubhub and
 * the bodega downstairs, and "restaurant + fast food + delivery, by day" is
 * the direct financial fingerprint of that loop — the one money query that
 * feeds an actual behavioural intervention rather than a budget report.
 */
export function foodDeliverySpend(db: Database.Database, days = 30): { local_day: string; spent: number; txns: number }[] {
  return db
    .prepare(
      `SELECT t.date AS local_day, ROUND(SUM(t.amount), 2) AS spent, COUNT(*) AS txns
       FROM financial_transaction t
       JOIN financial_account a ON a.id = t.account_pk
       WHERE t.date >= date('now','localtime',@offset)
         AND a.hidden = 0 AND t.amount > 0
         AND t.category_primary = 'FOOD_AND_DRINK'
         AND COALESCE(t.category_detailed,'') != 'FOOD_AND_DRINK_GROCERIES'
       GROUP BY t.date ORDER BY t.date`,
    )
    .all({ offset: `-${Math.max(1, days)} days` }) as { local_day: string; spent: number; txns: number }[];
}

export interface HoldingView {
  ticker: string | null;
  security: string | null;
  type: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  cost_basis: number | null;
  account: string | null;
  institution: string | null;
}

export function listHoldings(db: Database.Database): HoldingView[] {
  return db
    .prepare(
      `SELECT s.ticker_symbol AS ticker, s.name AS security, s.type,
              h.quantity, h.institution_price AS price, h.institution_value AS value, h.cost_basis,
              a.name AS account, i.institution_name AS institution
       FROM holding h
       JOIN security s ON s.id = h.security_pk
       JOIN financial_account a ON a.id = h.account_pk
       LEFT JOIN plaid_item i ON i.id = a.item_pk
       WHERE a.hidden = 0
       ORDER BY h.institution_value DESC`,
    )
    .all() as HoldingView[];
}

/**
 * The one-call overview: what's linked, what it's worth, what's been spent,
 * and — critically — what is BROKEN. `needs_attention` is first-class because
 * a money dashboard that quietly reports stale numbers is worse than one that
 * reports nothing.
 */
export function moneySummary(db: Database.Database, days = 30): Record<string, unknown> {
  const items = listItems(db);
  const nw = netWorthNow(db);
  const byCat = spendByCategory(db, days);
  const total = byCat.reduce((s, c) => s + c.spent, 0);
  return {
    linked_institutions: items.length,
    needs_attention: items
      .filter((i) => i.status !== 'active')
      .map((i) => ({ institution: i.institution_name, status: i.status, error: i.error_code })),
    last_synced_at: items.reduce<string | null>(
      (latest, i) => (i.last_synced_at && (!latest || i.last_synced_at > latest) ? i.last_synced_at : latest),
      null,
    ),
    net_worth: nw,
    window_days: days,
    total_spent: Math.round(total * 100) / 100,
    by_category: byCat.slice(0, 12),
    accounts: listAccounts(db),
  };
}

/* ==========================================================================
   MANUAL ACCOUNTS AND CSV IMPORT

   Plaid does not cover everything. Whether it covers UBS specifically is
   unresolved as of 2026-08-02 and is answered by a single /institutions/search
   call once API keys exist — but the answer cannot be "then that money is
   invisible." A wealth-management account is the largest number in Ben's
   financial picture, and a net worth that quietly omits it is worse than no
   net worth at all, because it looks authoritative.

   So: manual accounts live in the SAME tables as linked ones, carrying
   source='manual' instead of a plaid_item. Every rollup already includes them
   (the joins to plaid_item are LEFT joins for exactly this reason), and the UI
   can still distinguish them because provenance travels on the row.

   This replaces the CSV importer that lived in domains/misc.ts and wrote to
   001's `transaction_row`. Same idempotence approach (content hash per line),
   with two changes that matter:
     - it writes to the real tables, so imported rows land in the same totals
       as Plaid rows instead of a parallel universe; and
     - it NORMALIZES THE SIGN. Bank exports overwhelmingly use negative for a
       debit; Plaid uses positive for money out. The old importer stored the
       bank's sign verbatim, which was consistent with the old reader and is
       exactly backwards here. Getting this wrong doesn't throw — it reports
       spending as income — so the conversion happens here, once, named.
   ========================================================================== */

export interface ManualAccountInput {
  /** Display name, e.g. 'UBS — Managed Portfolio'. Also the identity key. */
  name: string;
  type?: string;
  subtype?: string;
  current_balance?: number | null;
  mask?: string | null;
  institution?: string | null;
}

/** Stable synthetic account_id for a manual account, derived from its name. */
function manualAccountId(name: string): string {
  return `manual:${name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64)}`;
}

/**
 * Create or update a manual (non-Plaid) account. Idempotent on name, so
 * importing a second UBS statement updates the balance instead of creating
 * "UBS" twice and double-counting it in net worth.
 */
export function upsertManualAccount(db: Database.Database, input: ManualAccountInput): number {
  const accountId = manualAccountId(input.name);
  db.prepare(
    `INSERT INTO financial_account
       (item_pk, account_id, source, name, official_name, mask, type, subtype,
        current_balance, balance_as_of)
     VALUES (NULL, @account_id, 'manual', @name, @institution, @mask, @type, @subtype,
             @current_balance, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET
       name            = excluded.name,
       official_name   = COALESCE(excluded.official_name, financial_account.official_name),
       mask            = COALESCE(excluded.mask, financial_account.mask),
       type            = COALESCE(excluded.type, financial_account.type),
       subtype         = COALESCE(excluded.subtype, financial_account.subtype),
       -- Only overwrite the balance when the caller actually supplied one: a
       -- transaction-only CSV import must not blank out a balance that was
       -- entered by hand last month.
       current_balance = COALESCE(excluded.current_balance, financial_account.current_balance),
       balance_as_of   = CASE WHEN excluded.current_balance IS NULL
                              THEN financial_account.balance_as_of ELSE datetime('now') END,
       updated_at      = datetime('now')`,
  ).run({
    account_id: accountId,
    name: input.name,
    institution: input.institution ?? null,
    mask: input.mask ?? null,
    type: input.type ?? 'investment',
    subtype: input.subtype ?? null,
    current_balance: input.current_balance ?? null,
  });
  const row = db.prepare('SELECT id FROM financial_account WHERE account_id = ?').get(accountId) as { id: number };
  return row.id;
}

/** The account CSV rows land in when the caller doesn't name one. */
const DEFAULT_IMPORT_ACCOUNT = 'Imported (CSV)';

export interface CsvImportOptions {
  /** Existing financial_account.id to import into. */
  accountPk?: number | null;
  /** Or a manual account to create/reuse by name. */
  accountName?: string;
  /**
   * Sign convention of the FILE:
   *   'bank'  (default) — negative means money left the account. Negated on
   *                       the way in to match the Plaid convention.
   *   'plaid'           — positive already means money out. Stored as-is.
   */
  sign?: 'bank' | 'plaid';
}

/**
 * Hand-rolled CSV import: date,amount,merchant[,category].
 *
 * Idempotent via a content hash per row, so re-importing an overlapping
 * statement inserts only what's new — the normal case when a bank exports
 * "last 90 days" every month.
 */
export function importTransactionsCsv(
  db: Database.Database,
  csv: string,
  opts: CsvImportOptions | number | null = null,
): { inserted: number; skipped: number; account_pk: number } {
  // Back-compat: the previous signature took a bare account id as the third
  // argument, and the MCP tool still passes one.
  const options: CsvImportOptions = typeof opts === 'number' ? { accountPk: opts } : (opts ?? {});

  const accountPk =
    options.accountPk ??
    upsertManualAccount(db, {
      name: options.accountName ?? DEFAULT_IMPORT_ACCOUNT,
      type: 'depository',
    });

  const negate = (options.sign ?? 'bank') === 'bank';

  let inserted = 0;
  let skipped = 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO financial_transaction
       (account_pk, transaction_id, source, amount, date, name, merchant_name, category_primary)
     VALUES (@account_pk, @transaction_id, 'csv', @amount, @date, @name, @merchant_name, @category)`,
  );

  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const tx = db.transaction(() => {
    for (const line of lines) {
      if (/^date\s*,/i.test(line)) continue; // header
      const cols = splitCsvLine(line);
      if (cols.length < 3) {
        skipped++;
        continue;
      }
      const [date, amountRaw, merchant, category] = cols;
      const raw = Number(amountRaw!.replace(/[$,]/g, ''));
      if (!date || Number.isNaN(raw)) {
        skipped++;
        continue;
      }
      const amount = negate ? -raw : raw;
      // Hash the file's own values, not the normalized ones, so changing the
      // `sign` option can't make the same line import a second time.
      const transaction_id = `csv:${createHash('sha256')
        .update(`${accountPk}|${date}|${raw}|${merchant ?? ''}`)
        .digest('hex')
        .slice(0, 40)}`;
      const r = stmt.run({
        account_pk: accountPk,
        transaction_id,
        amount,
        date,
        name: merchant ?? null,
        merchant_name: merchant ?? null,
        category: category ? category.toUpperCase() : null,
      });
      if (r.changes > 0) inserted++;
      else skipped++;
    }
  });
  tx();
  return { inserted, skipped, account_pk: accountPk };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/* ==========================================================================
   SURFACE HELPERS

   The dashboard (gateway/surfaces.ts) used to query the money tables directly,
   under the OPPOSITE sign convention: it read amount > 0 as money in. Plaid
   means money out. Repointing those queries at the new tables without
   re-deriving the sign would have printed spending as income — a wrong number
   with a plausible face, which is the worst kind. So the surface no longer
   writes money SQL at all; it calls these, and the flip stays in one file.

   Everything below returns HUMAN convention: inflow positive, outflow
   positive-magnitude, net = in - out.
   ========================================================================== */

export interface Cashflow {
  inflow: number;
  outflow: number;
  net: number;
  txns: number;
}

/** Cash in/out since `sinceDay` (inclusive, YYYY-MM-DD). Excludes transfers. */
export function cashflowSince(db: Database.Database, sinceDay: string): Cashflow {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0) AS inflow,
              COALESCE(SUM(CASE WHEN t.amount > 0 THEN  t.amount ELSE 0 END), 0) AS outflow,
              COUNT(*) AS txns
         FROM financial_transaction t
         JOIN financial_account a ON a.id = t.account_pk
        WHERE t.date >= @since
          AND a.hidden = 0
          AND COALESCE(t.category_primary,'') NOT IN (${EXCLUDED_SQL})`,
    )
    .get({ since: sinceDay }) as { inflow: number; outflow: number; txns: number };
  const inflow = Math.round(r.inflow * 100) / 100;
  const outflow = Math.round(r.outflow * 100) / 100;
  return { inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100, txns: r.txns };
}

/** Daily net (in - out) for the last `days` days, oldest first. */
export function netByDay(db: Database.Database, days = 7): { local_day: string; net: number }[] {
  return db
    .prepare(
      `SELECT t.date AS local_day, ROUND(SUM(-t.amount), 2) AS net
         FROM financial_transaction t
         JOIN financial_account a ON a.id = t.account_pk
        WHERE t.date >= date('now','localtime',@offset)
          AND a.hidden = 0
          AND COALESCE(t.category_primary,'') NOT IN (${EXCLUDED_SQL})
        GROUP BY t.date ORDER BY t.date`,
    )
    .all({ offset: `-${Math.max(1, days) - 1} days` }) as { local_day: string; net: number }[];
}

/**
 * Positive dollars spent in one category since `sinceDay` — the budget
 * denominator. Matches `budget.category` against Plaid's primary category
 * (case-insensitively), so a budget row must name a Plaid category
 * (FOOD_AND_DRINK, TRANSPORTATION, ...) to bind to anything. It returns 0
 * rather than throwing when it doesn't match, which is the honest answer for
 * a budget nothing has been spent against yet.
 */
export function categorySpendSince(db: Database.Database, category: string, sinceDay: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(t.amount), 0) AS spent
         FROM financial_transaction t
         JOIN financial_account a ON a.id = t.account_pk
        WHERE t.date >= @since
          AND a.hidden = 0
          AND t.amount > 0
          AND UPPER(COALESCE(t.category_primary,'')) = UPPER(@category)`,
    )
    .get({ since: sinceDay, category }) as { spent: number };
  return Math.round(r.spent * 100) / 100;
}
