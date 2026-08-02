import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CategorySpend, FinancialAccount, Holding, MoneyTransaction, MoneyTrend, PlaidItemSummary, PlaidStatus,
} from '../src/lib/contracts.js';

const {
  statusMock, linkTokenMock, exchangeMock, syncMock, unlinkMock, hideMock,
  txnsMock, catsMock, holdingsMock, trendMock, openLinkMock,
} = vi.hoisted(() => ({
  statusMock: vi.fn<() => Promise<PlaidStatus>>(),
  linkTokenMock: vi.fn<(itemId?: number) => Promise<{ link_token: string; environment: 'sandbox' | 'production' }>>(),
  exchangeMock: vi.fn(),
  syncMock: vi.fn(),
  unlinkMock: vi.fn(),
  hideMock: vi.fn(),
  txnsMock: vi.fn<() => Promise<{ transactions: MoneyTransaction[] }>>(),
  catsMock: vi.fn<() => Promise<{ categories: CategorySpend[] }>>(),
  holdingsMock: vi.fn<() => Promise<{ holdings: Holding[] }>>(),
  trendMock: vi.fn<() => Promise<MoneyTrend>>(),
  openLinkMock: vi.fn(),
}));

vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      plaidStatus: statusMock,
      plaidLinkToken: linkTokenMock,
      plaidExchange: exchangeMock,
      plaidSync: syncMock,
      plaidUnlinkItem: unlinkMock,
      plaidSetAccountHidden: hideMock,
      moneyTransactions: txnsMock,
      moneyCategories: catsMock,
      moneyHoldings: holdingsMock,
      moneyTrend: trendMock,
    },
  };
});

// Plaid Link is a third-party script on a CDN — never loaded in a test run.
vi.mock('../src/lib/plaidLink.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/plaidLink.js')>();
  return { ...actual, openPlaidLink: openLinkMock, loadPlaid: vi.fn() };
});

import userEvent from '@testing-library/user-event';
import { Money } from '../src/surfaces/Money.js';

const ITEMS: PlaidItemSummary[] = [
  { id: 1, institution: 'Chase', status: 'active', error_code: null, last_synced_at: '2026-08-02 06:10:41', consent_expiration_time: null },
  { id: 2, institution: 'Bank of America', status: 'login_required', error_code: 'ITEM_LOGIN_REQUIRED', last_synced_at: '2026-07-29 04:12:07', consent_expiration_time: null },
];

const ACCOUNTS: FinancialAccount[] = [
  { id: 11, account_id: 'a11', institution_name: 'Chase', name: 'Total Checking', mask: '4417', type: 'depository', subtype: 'checking', current_balance: 8412.19, available_balance: 8412.19, limit_amount: null, balance_as_of: '2026-08-02 06:10:41', item_status: 'active', hidden: 0 },
  { id: 21, account_id: 'a21', institution_name: 'Bank of America', name: 'Advantage Plus', mask: '0088', type: 'depository', subtype: 'checking', current_balance: null, available_balance: null, limit_amount: null, balance_as_of: '2026-07-29 04:12:07', item_status: 'login_required', hidden: 0 },
];

const TRANSACTIONS: MoneyTransaction[] = [
  // POSITIVE = spent.
  { transaction_id: 'tx_1', date: '2026-08-02', amount: 126.31, merchant: 'Whole Foods', category_primary: 'FOOD_AND_DRINK', category_detailed: 'FOOD_AND_DRINK_GROCERIES', account: 'Total Checking', mask: '4417', pending: 1 },
  // NEGATIVE = received.
  { transaction_id: 'tx_2', date: '2026-07-31', amount: -4820, merchant: 'Payroll', category_primary: 'INCOME', category_detailed: 'INCOME_WAGES', account: 'Total Checking', mask: '4417', pending: 0 },
];

function status(overrides: Partial<PlaidStatus> = {}): PlaidStatus {
  return {
    configured: true,
    state: 'ready',
    detail: null,
    environment: 'sandbox',
    redirect_uri: 'https://cabinet.benloe.com/plaid/oauth',
    webhook_url: 'https://cabinet.benloe.com/api/plaid/webhook',
    items: ITEMS,
    accounts: ACCOUNTS,
    net_worth: {
      cash: 8412.19, credit: 0, investments: 0, loans: 0, net_worth: 8412.19,
      accounts_counted: 1, accounts_total: 2, stalest_balance_at: '2026-07-29 04:12:07',
    },
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of [statusMock, linkTokenMock, exchangeMock, syncMock, unlinkMock, hideMock, txnsMock, catsMock, holdingsMock, trendMock, openLinkMock]) {
    m.mockReset();
  }
  statusMock.mockResolvedValue(status());
  linkTokenMock.mockResolvedValue({ link_token: 'link-sandbox-abc', environment: 'sandbox' });
  exchangeMock.mockResolvedValue({ ok: true, item: { id: 3, institution: 'Chase', status: 'active' }, syncing: true });
  syncMock.mockResolvedValue({ reports: [] });
  unlinkMock.mockResolvedValue({ ok: true, deleted: 1 });
  hideMock.mockResolvedValue({ ok: true, id: 11, hidden: true });
  txnsMock.mockResolvedValue({ transactions: TRANSACTIONS });
  catsMock.mockResolvedValue({ categories: [{ category: 'FOOD_AND_DRINK', detailed_top: 'FOOD_AND_DRINK_GROCERIES', spent: 126.31, txns: 1 }] });
  holdingsMock.mockResolvedValue({ holdings: [] });
  trendMock.mockResolvedValue({ net_worth: [], spend_by_day: [] });
  openLinkMock.mockResolvedValue({ open: () => {}, exit: () => {}, destroy: () => {} });
});
afterEach(cleanup);

describe('Money surface', () => {
  it('renders setup guidance — not a secret form — when Plaid is unconfigured', async () => {
    statusMock.mockResolvedValue(status({ configured: false, state: 'unconfigured', items: [], accounts: [] }));
    render(<Money />);

    const setup = await screen.findByLabelText('Plaid setup');
    // Names the two credentials, and points at the service that actually holds
    // them rather than offering a field of its own.
    expect(within(setup).getByText('plaid-client-id')).toBeTruthy();
    expect(within(setup).getByText('plaid-secret')).toBeTruthy();
    expect(setup.querySelectorAll('input, textarea, form').length).toBe(0);

    // The destination is a real link, and it is the broker's dashboard. The old
    // text sent Ben to POST at /api/credentials — an endpoint whose store lost
    // its encryption key in the split, so following that instruction would have
    // put a Plaid secret on his clipboard and then refused it with a 503.
    const dash = within(setup).getByRole('link', { name: 'https://secrets.benloe.com' });
    expect(dash.getAttribute('href')).toBe('https://secrets.benloe.com');
    expect(setup.textContent).not.toContain('/api/credentials');

    // Both dashboard URLs are present and click-to-copy.
    expect(within(setup).getByText('https://cabinet.benloe.com/plaid/oauth')).toBeTruthy();
    expect(within(setup).getByText('https://cabinet.benloe.com/api/plaid/webhook')).toBeTruthy();
    expect(within(setup).getByRole('button', { name: /Copy redirect_uri/ })).toBeTruthy();
    expect(within(setup).getByRole('button', { name: /Copy webhook_url/ })).toBeTruthy();

    // Nothing that implies real, complete data is on screen.
    expect(screen.queryByLabelText('Net worth')).toBeNull();
  });

  it('an unreachable secrets service is not rendered as "add your keys"', async () => {
    // The whole reason `state` exists alongside `configured`. An outage reports
    // configured: false, and showing the setup steps would tell Ben to re-paste
    // credentials that were never the problem — then leave him unable to tell
    // whether he had pasted them wrong when it still didn't work.
    statusMock.mockResolvedValue(
      status({
        configured: false,
        state: 'unreachable',
        detail: 'no socket at /run/cabinet-secrets/broker.sock — the cabinet-secrets service is not running',
        items: [],
        accounts: [],
      }),
    );
    render(<Money />);

    const panel = await screen.findByLabelText('Plaid setup');
    expect(panel.textContent).toMatch(/can.t get to the service/i);
    // No setup instructions at all — not the slugs, not the dashboard link.
    expect(within(panel).queryByText('plaid-client-id')).toBeNull();
    expect(within(panel).queryByRole('link', { name: 'https://secrets.benloe.com' })).toBeNull();
    // The diagnosis is shown rather than swallowed: it names a system, never a
    // secret, and this route is owner-only.
    expect(panel.textContent).toContain('/run/cabinet-secrets/broker.sock');
  });

  it('an unknown status still reads as setup, not as an outage', async () => {
    // Cold start, before the first successful poll. Erring toward the setup
    // steps is right: they are harmless if the keys turn out to be there, and
    // "the secrets service is down" would be a false alarm about my own health.
    statusMock.mockResolvedValue(status({ configured: false, state: 'unknown', items: [], accounts: [] }));
    render(<Money />);

    const panel = await screen.findByLabelText('Plaid setup');
    expect(within(panel).getByText('plaid-client-id')).toBeTruthy();
  });

  it('marks the environment so sandbox data can never read as real', async () => {
    render(<Money />);
    expect(await screen.findByText('sandbox')).toBeTruthy();
    expect(screen.getByText(/not your money/i)).toBeTruthy();
  });

  it('renders the counted-vs-total caveat and the as-of stamp beside net worth', async () => {
    render(<Money />);
    const nw = await screen.findByLabelText('Net worth');

    expect(nw.textContent).toContain('$8,412');
    // The shortfall is stated in the same eyeline as the figure.
    expect(nw.textContent).toContain('1 of 2 accounts');
    expect(within(nw).getByText(/Computed from 1 of 2 accounts/)).toBeTruthy();
    expect(within(nw).getByText(/1 have no current balance|1 has no current balance/)).toBeTruthy();
    // …and the oldest balance feeding it, parsed as UTC rather than shifted.
    expect(within(nw).getByText(/Balances as of Jul 29 · 04:12 UTC/)).toBeTruthy();
  });

  it('drops the caveat when every account is counted', async () => {
    statusMock.mockResolvedValue(
      status({
        net_worth: { cash: 100, credit: 0, investments: 0, loans: 0, net_worth: 100, accounts_counted: 2, accounts_total: 2, stalest_balance_at: '2026-08-02 06:10:41' },
      }),
    );
    render(<Money />);
    const nw = await screen.findByLabelText('Net worth');
    expect(within(nw).queryByText(/Computed from/)).toBeNull();
    expect(within(nw).getByText(/Balances as of Aug 2 · 06:10 UTC/)).toBeTruthy();
  });

  it('offers a Reconnect that opens Link in update mode for a login_required item', async () => {
    render(<Money />);
    const accounts = await screen.findByLabelText('Accounts');

    // The broken item is named, with its error code, and says why the numbers are wrong.
    expect(within(accounts).getByText('needs sign-in')).toBeTruthy();
    expect(within(accounts).getByText('ITEM_LOGIN_REQUIRED')).toBeTruthy();

    const reconnect = within(accounts).getByRole('button', { name: 'Reconnect' });
    await userEvent.click(reconnect);

    // Update mode == the link token is minted against THAT item id.
    await waitFor(() => expect(linkTokenMock).toHaveBeenCalledWith(2));
    await waitFor(() => expect(openLinkMock).toHaveBeenCalled());
    expect(openLinkMock.mock.calls[0]?.[0]).toMatchObject({ token: 'link-sandbox-abc' });
    // The token is stashed before Link opens so an OAuth redirect can resume it.
    expect(window.localStorage.getItem('cabinet.plaid.link_token')).toBe('link-sandbox-abc');
  });

  it('mints a create-mode token (no item id) for a fresh link', async () => {
    render(<Money />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link an account' }));
    await waitFor(() => expect(linkTokenMock).toHaveBeenCalledWith(undefined));
  });

  it('marks a pending transaction as provisional', async () => {
    render(<Money />);
    const txns = await screen.findByLabelText('Recent transactions');

    const pendingRow = within(txns).getByText('Whole Foods').closest('tr');
    expect(pendingRow).toBeTruthy();
    expect(pendingRow?.className).toContain('is-pending');
    expect(within(pendingRow as HTMLElement).getByText('pending')).toBeTruthy();

    // The settled row carries no such mark.
    const settled = within(txns).getByText('Payroll').closest('tr');
    expect(settled?.className ?? '').not.toContain('is-pending');
    expect(within(settled as HTMLElement).queryByText('pending')).toBeNull();
  });

  it('does not invert transaction signs: positive amount = money out', async () => {
    render(<Money />);
    const txns = await screen.findByLabelText('Recent transactions');

    // amount 126.31 (POSITIVE = spent) reads as an outflow, never "+".
    const spend = within(txns).getByText('Whole Foods').closest('tr') as HTMLElement;
    const spendCell = spend.querySelector('.money-amt');
    expect(spendCell?.textContent).toBe('−$126.31');
    expect(spendCell?.className).toContain('out');

    // amount -4820 (NEGATIVE = received) reads as an inflow.
    const income = within(txns).getByText('Payroll').closest('tr') as HTMLElement;
    const incomeCell = income.querySelector('.money-amt');
    expect(incomeCell?.textContent).toBe('+$4,820.00');
    expect(incomeCell?.className).toContain('in');
  });

  it('reports spending by category as positive dollars out', async () => {
    render(<Money />);
    const cats = await screen.findByLabelText('Spending by category');
    expect(within(cats).getByText('Food and drink')).toBeTruthy();
    expect(within(cats).getByText('$126.31')).toBeTruthy();
    expect(cats.textContent).not.toContain('-$126.31');
  });

  it('keeps the empty holdings state calm', async () => {
    render(<Money />);
    const holdings = await screen.findByLabelText('Holdings');
    expect(within(holdings).getByText(/No investment accounts linked/)).toBeTruthy();
    expect(holdings.querySelector('table')).toBeNull();
  });

  it('syncs on demand and summarises what moved', async () => {
    syncMock.mockResolvedValue({
      reports: [
        { item_id: 1, institution: 'Chase', ok: true, accounts: 3, transactions: { added: 12, modified: 2, removed: 0, skipped: 0 }, holdings: 0 },
        { item_id: 2, institution: 'Bank of America', ok: false, accounts: 0, transactions: { added: 0, modified: 0, removed: 0, skipped: 0 }, holdings: 0, error: 'ITEM_LOGIN_REQUIRED' },
      ],
    });
    render(<Money />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(syncMock).toHaveBeenCalledWith(undefined));
    const result = await screen.findByLabelText('Sync result');
    expect(result.textContent).toContain('12 new, 2 updated');
    expect(result.textContent).toContain('ITEM_LOGIN_REQUIRED');
  });

  it('confirms before unlinking an institution', async () => {
    render(<Money />);
    const accounts = await screen.findByLabelText('Accounts');
    await userEvent.click(within(accounts).getAllByRole('button', { name: 'Unlink' })[0] as HTMLElement);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Chase');
    expect(unlinkMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(unlinkMock).toHaveBeenCalledWith(1));
  });

  it('toggles an account out of the rollups without unlinking it', async () => {
    render(<Money />);
    const accounts = await screen.findByLabelText('Accounts');
    const row = within(accounts).getByText('Total Checking').closest('li') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(hideMock).toHaveBeenCalledWith(11, true));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Show' })).toBeTruthy());
    expect(row.className).toContain('is-hidden');
    expect(row.textContent).toContain('hidden from totals');
  });
});
