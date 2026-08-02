/* ============================================================================
   domains/money.ts — the arithmetic that has to be right.

   These tests exist because every bug this module can have is a QUIET one. A
   flipped sign, a double-counted card payment, a sold position that lingers:
   none of them throw, none of them fail a build, and all of them produce a
   confident wrong number that Cabinet would then reason from out loud.
   ========================================================================== */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type CabinetDb } from '../src/db/index.js';
import {
  applyTransactionSync,
  listAccounts,
  listHoldings,
  moneySummary,
  netWorthNow,
  recentTransactions,
  replaceHoldings,
  setAccountHidden,
  setItemStatus,
  snapshotNetWorth,
  spendByCategory,
  spendByDay,
  foodDeliverySpend,
  upsertAccounts,
  upsertItem,
  upsertSecurities,
  listItems,
  setItemCursor,
  getItemByItemId,
  utcIso,
  upsertManualAccount,
  cashflowSince,
  categorySpendSince,
  netByDay,
} from '../src/domains/money.js';

let dir: string;
let cabinet: CabinetDb;

/** 'YYYY-MM-DD' n days before today, matching the local_day convention. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function seedItemWithAccounts() {
  const item = upsertItem(cabinet.db, {
    item_id: 'item-boa',
    institution_id: 'ins_1',
    institution_name: 'Bank of America',
  });
  upsertAccounts(cabinet.db, item.id, [
    {
      account_id: 'acct-checking',
      name: 'Adv Plus Banking',
      mask: '4421',
      type: 'depository',
      subtype: 'checking',
      current_balance: 5200,
      available_balance: 5100,
    },
    {
      account_id: 'acct-card',
      name: 'Customized Cash Rewards',
      mask: '9987',
      type: 'credit',
      subtype: 'credit card',
      current_balance: 1430.55,
      limit_amount: 12000,
    },
  ]);
  return item;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-money-'));
  cabinet = openDb(join(dir, 'cabinet.db'));
});
afterEach(() => {
  cabinet.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('items', () => {
  it('re-linking the same institution rotates one row instead of creating two', () => {
    const a = upsertItem(cabinet.db, { item_id: 'item-boa', institution_name: 'Bank of America' });
    setItemStatus(cabinet.db, a.id, 'login_required', { code: 'ITEM_LOGIN_REQUIRED' });
    const b = upsertItem(cabinet.db, { item_id: 'item-boa', institution_name: 'Bank of America' });

    expect(b.id).toBe(a.id);
    expect(listItems(cabinet.db)).toHaveLength(1);
    // A successful re-link must clear the error, or the UI keeps showing a
    // "reconnect" button for a connection that is already healthy.
    expect(b.status).toBe('active');
    expect(b.error_code).toBeNull();
  });

  it('preserves the sync cursor across a re-link', () => {
    const a = upsertItem(cabinet.db, { item_id: 'item-boa' });
    setItemCursor(cabinet.db, a.id, 'cursor-abc');
    upsertItem(cabinet.db, { item_id: 'item-boa' });
    expect(getItemByItemId(cabinet.db, 'item-boa')?.transactions_cursor).toBe('cursor-abc');
  });

  it('deleting an item cascades to its accounts and transactions', () => {
    const item = seedItemWithAccounts();
    applyTransactionSync(cabinet.db, {
      added: [
        { transaction_id: 't1', account_id: 'acct-checking', amount: 12, date: daysAgo(1), category_primary: 'FOOD_AND_DRINK' },
      ],
    });
    cabinet.db.prepare('DELETE FROM plaid_item WHERE id = ?').run(item.id);
    expect(listAccounts(cabinet.db)).toHaveLength(0);
    expect(cabinet.db.prepare('SELECT COUNT(*) c FROM financial_transaction').get()).toEqual({ c: 0 });
  });
});

describe('transaction sync', () => {
  beforeEach(seedItemWithAccounts);

  it('is idempotent — applying the same page twice changes nothing', () => {
    const page = {
      added: [
        { transaction_id: 't1', account_id: 'acct-card', amount: 42.5, date: daysAgo(2), merchant_name: 'Grubhub' },
        { transaction_id: 't2', account_id: 'acct-card', amount: 8.25, date: daysAgo(2), merchant_name: 'Bodega' },
      ],
    };
    applyTransactionSync(cabinet.db, page);
    applyTransactionSync(cabinet.db, page);
    expect(cabinet.db.prepare('SELECT COUNT(*) c FROM financial_transaction').get()).toEqual({ c: 2 });
  });

  it('counts transactions for unknown accounts as skipped rather than dropping them silently', () => {
    const counts = applyTransactionSync(cabinet.db, {
      added: [
        { transaction_id: 't1', account_id: 'acct-card', amount: 10, date: daysAgo(1) },
        { transaction_id: 't2', account_id: 'acct-never-linked', amount: 10, date: daysAgo(1) },
      ],
    });
    expect(counts.added).toBe(1);
    expect(counts.skipped).toBe(1);
  });

  it('removes a superseded pending transaction when the settled one arrives', () => {
    applyTransactionSync(cabinet.db, {
      added: [
        { transaction_id: 'pending-1', account_id: 'acct-card', amount: 40.0, date: daysAgo(1), pending: true, merchant_name: 'Grubhub' },
      ],
    });
    applyTransactionSync(cabinet.db, {
      added: [
        {
          transaction_id: 'settled-1',
          account_id: 'acct-card',
          amount: 43.17,
          date: daysAgo(1),
          pending: false,
          pending_transaction_id: 'pending-1',
          merchant_name: 'Grubhub',
        },
      ],
    });
    const rows = recentTransactions(cabinet.db, { days: 7 });
    // The purchase must appear ONCE, at the settled amount. Leaving both would
    // report $83 of delivery on a $43 night.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(43.17);
    expect(rows[0]!.pending).toBe(0);
  });

  it('applies modifications and removals', () => {
    applyTransactionSync(cabinet.db, {
      added: [{ transaction_id: 't1', account_id: 'acct-card', amount: 10, date: daysAgo(1) }],
    });
    const mod = applyTransactionSync(cabinet.db, {
      modified: [{ transaction_id: 't1', account_id: 'acct-card', amount: 11.5, date: daysAgo(1) }],
    });
    expect(mod.modified).toBe(1);
    expect(recentTransactions(cabinet.db, { days: 7 })[0]!.amount).toBe(11.5);

    const del = applyTransactionSync(cabinet.db, { removed: ['t1'] });
    expect(del.removed).toBe(1);
    expect(recentTransactions(cabinet.db, { days: 7 })).toHaveLength(0);
  });
});

describe('spending arithmetic', () => {
  beforeEach(() => {
    seedItemWithAccounts();
    applyTransactionSync(cabinet.db, {
      added: [
        // Real consumption.
        { transaction_id: 'd1', account_id: 'acct-card', amount: 43.17, date: daysAgo(1), merchant_name: 'Grubhub', category_primary: 'FOOD_AND_DRINK', category_detailed: 'FOOD_AND_DRINK_FAST_FOOD' },
        { transaction_id: 'd2', account_id: 'acct-card', amount: 61.2, date: daysAgo(3), merchant_name: 'Whole Foods', category_primary: 'FOOD_AND_DRINK', category_detailed: 'FOOD_AND_DRINK_GROCERIES' },
        { transaction_id: 'd3', account_id: 'acct-card', amount: 130.0, date: daysAgo(4), merchant_name: 'Emanuel', category_primary: 'PERSONAL_CARE' },
        // Paycheck — money IN, so Plaid reports it negative.
        { transaction_id: 'p1', account_id: 'acct-checking', amount: -3200.0, date: daysAgo(5), merchant_name: 'Summus', category_primary: 'INCOME' },
        // Card payment: leaves checking, arrives at the card. Both legs are
        // real cash movements and NEITHER is consumption — the purchases they
        // settle were already counted on the card.
        { transaction_id: 'x1', account_id: 'acct-checking', amount: 900.0, date: daysAgo(6), category_primary: 'TRANSFER_OUT' },
        { transaction_id: 'x2', account_id: 'acct-card', amount: -900.0, date: daysAgo(6), category_primary: 'TRANSFER_IN' },
      ],
    });
  });

  it('excludes transfers so card payments do not double-count spending', () => {
    const cats = spendByCategory(cabinet.db, 30);
    const names = cats.map((c) => c.category);
    expect(names).not.toContain('TRANSFER_IN');
    expect(names).not.toContain('TRANSFER_OUT');
    // 43.17 + 61.20 + 130.00 — the paycheck is negative so it never enters a
    // spend rollup, and the $900 transfer is excluded by category.
    const total = cats.reduce((s, c) => s + c.spent, 0);
    expect(total).toBeCloseTo(234.37, 2);
  });

  it('reports spend as positive dollars without inverting the sign', () => {
    const food = spendByCategory(cabinet.db, 30).find((c) => c.category === 'FOOD_AND_DRINK');
    expect(food!.spent).toBeCloseTo(104.37, 2);
    expect(food!.txns).toBe(2);
  });

  it('separates delivery/restaurant spend from groceries', () => {
    const days = foodDeliverySpend(cabinet.db, 30);
    const total = days.reduce((s, d) => s + d.spent, 0);
    // Only the Grubhub charge. Whole Foods is groceries and is deliberately
    // excluded — conflating them would make the one behavioural signal in the
    // money domain useless.
    expect(total).toBeCloseTo(43.17, 2);
    expect(days).toHaveLength(1);
  });

  it('groups spend by day', () => {
    const byDay = spendByDay(cabinet.db, 30);
    const one = byDay.find((d) => d.local_day === daysAgo(1));
    expect(one!.spent).toBeCloseTo(43.17, 2);
    expect(byDay.find((d) => d.local_day === daysAgo(6))).toBeUndefined();
  });

  it('omits hidden accounts from rollups', () => {
    const card = listAccounts(cabinet.db).find((a) => a.mask === '9987')!;
    setAccountHidden(cabinet.db, card.id, true);
    const total = spendByCategory(cabinet.db, 30).reduce((s, c) => s + c.spent, 0);
    expect(total).toBe(0);
    expect(listAccounts(cabinet.db)).toHaveLength(1);
    expect(listAccounts(cabinet.db, true)).toHaveLength(2);
  });
});

describe('net worth', () => {
  it('treats credit balances as debt, not as an asset', () => {
    seedItemWithAccounts();
    const nw = netWorthNow(cabinet.db);
    expect(nw.cash).toBe(5200);
    expect(nw.credit).toBe(1430.55);
    expect(nw.net_worth).toBeCloseTo(5200 - 1430.55, 2);
    expect(nw.accounts_counted).toBe(2);
    expect(nw.accounts_total).toBe(2);
  });

  it('reports counted vs total so a partial sync cannot masquerade as a real drop', () => {
    const item = seedItemWithAccounts();
    // An account that has never reported a balance — exactly what a
    // login_required item looks like on first link.
    upsertAccounts(cabinet.db, item.id, [
      { account_id: 'acct-savings', name: 'Savings', type: 'depository', subtype: 'savings', current_balance: null },
    ]);
    const nw = netWorthNow(cabinet.db);
    expect(nw.accounts_total).toBe(3);
    expect(nw.accounts_counted).toBe(2);
    expect(nw.net_worth).toBeCloseTo(3769.45, 2);
  });

  it('snapshots idempotently — twice in one day updates rather than duplicates', () => {
    seedItemWithAccounts();
    snapshotNetWorth(cabinet.db);
    snapshotNetWorth(cabinet.db);
    const rows = cabinet.db.prepare('SELECT COUNT(*) c FROM net_worth_snapshot').get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('counts investment accounts toward net worth', () => {
    const item = upsertItem(cabinet.db, { item_id: 'item-brokerage', institution_name: 'Somewhere' });
    upsertAccounts(cabinet.db, item.id, [
      { account_id: 'acct-ira', name: 'IRA', type: 'investment', subtype: 'ira', current_balance: 84000 },
    ]);
    expect(netWorthNow(cabinet.db).investments).toBe(84000);
    expect(netWorthNow(cabinet.db).net_worth).toBe(84000);
  });
});

describe('holdings', () => {
  it('drops positions that are no longer held instead of leaving them at their last quantity', () => {
    const item = upsertItem(cabinet.db, { item_id: 'item-brokerage', institution_name: 'Somewhere' });
    upsertAccounts(cabinet.db, item.id, [
      { account_id: 'acct-ira', name: 'IRA', type: 'investment', subtype: 'ira', current_balance: 84000 },
    ]);
    upsertSecurities(cabinet.db, [
      { security_id: 'sec-vti', ticker_symbol: 'VTI', name: 'Vanguard Total Market' },
      { security_id: 'sec-bnd', ticker_symbol: 'BND', name: 'Vanguard Total Bond' },
    ]);
    replaceHoldings(cabinet.db, ['acct-ira'], [
      { account_id: 'acct-ira', security_id: 'sec-vti', quantity: 100, institution_value: 30000 },
      { account_id: 'acct-ira', security_id: 'sec-bnd', quantity: 500, institution_value: 40000 },
    ]);
    expect(listHoldings(cabinet.db)).toHaveLength(2);

    // Ben sells all the BND. The next sync simply doesn't mention it.
    replaceHoldings(cabinet.db, ['acct-ira'], [
      { account_id: 'acct-ira', security_id: 'sec-vti', quantity: 120, institution_value: 36000 },
    ]);
    const held = listHoldings(cabinet.db);
    expect(held).toHaveLength(1);
    expect(held[0]!.ticker).toBe('VTI');
    expect(held[0]!.quantity).toBe(120);
  });
});

describe('moneySummary', () => {
  it('surfaces broken connections as needs_attention', () => {
    const item = seedItemWithAccounts();
    setItemStatus(cabinet.db, item.id, 'login_required', { code: 'ITEM_LOGIN_REQUIRED' });
    const s = moneySummary(cabinet.db) as {
      needs_attention: { status: string; error: string }[];
      linked_institutions: number;
    };
    expect(s.linked_institutions).toBe(1);
    expect(s.needs_attention).toHaveLength(1);
    expect(s.needs_attention[0]!.status).toBe('login_required');
  });

  it('reports zeroes rather than throwing when nothing is linked yet', () => {
    const s = moneySummary(cabinet.db) as { linked_institutions: number; total_spent: number };
    expect(s.linked_institutions).toBe(0);
    expect(s.total_spent).toBe(0);
  });
});

describe('utcIso', () => {
  it("adds the zone marker SQLite's datetime('now') omits", () => {
    // Without this, a browser reads "2026-08-02 04:41:09" as LOCAL time and a
    // sync that just finished renders four hours in the future.
    expect(utcIso('2026-08-02 04:41:09')).toBe('2026-08-02T04:41:09Z');
  });

  it('passes an already-zoned timestamp through untouched', () => {
    // Plaid's own timestamps arrive like this. Double-stamping would corrupt them.
    expect(utcIso('2026-08-02T04:41:09Z')).toBe('2026-08-02T04:41:09Z');
    expect(utcIso('2026-08-02T04:41:09+00:00')).toBe('2026-08-02T04:41:09+00:00');
    expect(utcIso('2026-08-02T00:41:09-04:00')).toBe('2026-08-02T00:41:09-04:00');
  });

  it('passes null, undefined and unrecognised strings through without throwing', () => {
    expect(utcIso(null)).toBeNull();
    expect(utcIso(undefined)).toBeNull();
    expect(utcIso('')).toBeNull();
    expect(utcIso('not a date')).toBe('not a date');
  });
});

describe('account provenance for the UI', () => {
  it('carries item_pk so two accounts at the same bank are individually targetable', () => {
    // Ben has a BofA checking AND a BofA card. Keyed by institution name they
    // are the same row, and "reconnect this one" would hit the wrong one.
    const itemA = upsertItem(cabinet.db, { item_id: 'item-A', institution_id: 'ins_1', institution_name: 'Bank of America' });
    const itemB = upsertItem(cabinet.db, { item_id: 'item-B', institution_id: 'ins_1', institution_name: 'Bank of America' });
    upsertAccounts(cabinet.db, itemA.id, [{ account_id: 'acc-check', name: 'Checking', type: 'depository', current_balance: 100 }]);
    upsertAccounts(cabinet.db, itemB.id, [{ account_id: 'acc-card', name: 'Card', type: 'credit', current_balance: 50 }]);

    const accounts = listAccounts(cabinet.db);
    expect(accounts.find((a) => a.account_id === 'acc-check')!.item_pk).toBe(itemA.id);
    expect(accounts.find((a) => a.account_id === 'acc-card')!.item_pk).toBe(itemB.id);
  });

  it('reports item_pk null for a manual account', () => {
    upsertManualAccount(cabinet.db, { name: 'UBS — Managed Portfolio', type: 'investment', current_balance: 250_000 });
    const acct = listAccounts(cabinet.db).find((a) => a.name === 'UBS — Managed Portfolio')!;
    expect(acct.item_pk).toBeNull();
    expect(acct.source).toBe('manual');
    expect(acct.item_status).toBe('manual');
  });

  it('zones balance_as_of on the way out', () => {
    upsertManualAccount(cabinet.db, { name: 'Manual Cash', type: 'depository', current_balance: 10 });
    const acct = listAccounts(cabinet.db).find((a) => a.name === 'Manual Cash')!;
    expect(acct.balance_as_of).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(acct.balance_as_of!))).toBe(false);
  });
});

describe('surface helpers', () => {
  function seed(): void {
    const item = upsertItem(cabinet.db, { item_id: 'item-s', institution_name: 'BofA' });
    upsertAccounts(cabinet.db, item.id, [{ account_id: 'acc-s', name: 'Checking', type: 'depository', current_balance: 500 }]);
    applyTransactionSync(cabinet.db, {
      added: [
        // Plaid convention: positive = money OUT.
        { transaction_id: 't-out', account_id: 'acc-s', amount: 42.5, date: '2026-08-01', name: 'Grubhub', category_primary: 'FOOD_AND_DRINK' },
        { transaction_id: 't-in', account_id: 'acc-s', amount: -3000, date: '2026-08-01', name: 'Payroll', category_primary: 'INCOME' },
        // Excluded: a card payment is not spending, it is the same coffee twice.
        { transaction_id: 't-xfer', account_id: 'acc-s', amount: 900, date: '2026-08-01', name: 'Card payment', category_primary: 'TRANSFER_OUT' },
      ],
    });
  }

  it('cashflowSince returns human convention: in positive, out positive, net = in - out', () => {
    seed();
    const flow = cashflowSince(cabinet.db, '2026-01-01');
    expect(flow.inflow).toBe(3000);
    expect(flow.outflow).toBe(42.5);
    expect(flow.net).toBe(2957.5);
  });

  it('cashflowSince excludes transfers from both sides', () => {
    seed();
    // The $900 card payment must appear in neither inflow nor outflow.
    const flow = cashflowSince(cabinet.db, '2026-01-01');
    expect(flow.outflow).not.toBe(942.5);
    expect(flow.txns).toBe(2);
  });

  it('cashflowSince honours the since bound', () => {
    seed();
    expect(cashflowSince(cabinet.db, '2026-08-02').txns).toBe(0);
  });

  it('categorySpendSince returns positive dollars and is case-insensitive', () => {
    seed();
    expect(categorySpendSince(cabinet.db, 'FOOD_AND_DRINK', '2026-01-01')).toBe(42.5);
    expect(categorySpendSince(cabinet.db, 'food_and_drink', '2026-01-01')).toBe(42.5);
  });

  it('categorySpendSince returns 0 for a budget category nothing matches', () => {
    // A budget naming a category Plaid never emits must read as "nothing spent",
    // not throw and not silently sum everything.
    seed();
    expect(categorySpendSince(cabinet.db, 'GROCERIES', '2026-01-01')).toBe(0);
  });

  it('categorySpendSince ignores inflows', () => {
    seed();
    expect(categorySpendSince(cabinet.db, 'INCOME', '2026-01-01')).toBe(0);
  });

  it('netByDay reports a spending day as negative net', () => {
    // The sign that surfaces.ts used to get backwards. A day where money only
    // left must not chart as a gain.
    const item = upsertItem(cabinet.db, { item_id: 'item-n', institution_name: 'BofA' });
    upsertAccounts(cabinet.db, item.id, [{ account_id: 'acc-n', name: 'Checking', type: 'depository', current_balance: 500 }]);
    const today = daysAgo(0);
    applyTransactionSync(cabinet.db, {
      added: [{ transaction_id: 't-n', account_id: 'acc-n', amount: 60, date: today, name: 'Bodega', category_primary: 'FOOD_AND_DRINK' }],
    });
    const days = netByDay(cabinet.db, 7);
    expect(days.find((d) => d.local_day === today)!.net).toBe(-60);
  });
});
