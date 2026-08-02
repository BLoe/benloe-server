import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

// Mock the API so the console mounts against deterministic data. Keep the real
// contract exports (DOMAINS, types) via importOriginal; override only `api`.
vi.mock('../src/lib/cabinet.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/cabinet.js')>();
  const today = {
    greeting: 'Good morning, Ben.', greetingAccent: 'A quiet day', read: 'All set today.',
    attention: [], vitals: [{ kind: 'dial', label: 'Nutrition · today', value: 1, max: 2 }],
    overnight: null, sweptAt: '2026-07-08T06:06:00-04:00',
    briefing: null, checkin: null,
  };
  const api = {
    health: async () => ({ ok: true, authMode: 'subscription', presence: 'idle', presenceMeta: 'idle · queue 0' }),
    today: async () => today,
    domain: async (id: string) => ({ id, label: id, instruments: [], narrative: 'x', log: [] }),
    ops: async () => ({ entries: [] }),
    revertOp: async () => ({ ok: true }),
    usage: async () => ({ authMode: 'subscription', byDay: [] }),
    usageRolling: async () => ({ authMode: 'subscription', windows: [] }),
    // Ops fetches this unconditionally on mount; without it, every test that
    // navigates to Ops dies in an effect with "api.perf is not a function".
    perf: async () => ({ enabled: false, window: '7d', turns: 0, byPhase: [], byTool: [], recent: [] }),
    memory: async () => ({ files: [], lessons: [] }),
    saveMemoryFile: async () => ({ ok: true }),
    recall: async (q: string) => ({ query: q, results: [] }),
    chats: async () => ({ chats: [] }),
    messages: async () => ({ messages: [] }),
    command: async () => ({ chatId: 't' }),
    // Credentials: a store with no encryption key — the state the surface has
    // to render as a banner rather than as a broken page.
    credentials: async () => ({
      configured: false, credentials: [], env: [], managed: [], unrecognised: [],
      slots: [{
        name: 'plaid-client-id', group: 'Plaid', label: 'Client ID', description: 'Identifies this install.',
        where: 'Plaid Dashboard → Developers → Keys', required: true, stored: false, meta: null,
      }],
    }),
    saveCredential: async () => ({ ok: true, created: true, credential: null }),
    deleteCredential: async (name: string) => ({ ok: true, deleted: name }),
    // Settings share the Credentials surface and are fetched on the same mount,
    // from a different endpoint. Empty is a valid payload — the section renders
    // its lede and nothing else.
    settings: async () => ({ settings: [] }),
    saveSetting: async (key: string, value: string) => ({ setting: { key, value } }),
    revertSetting: async (key: string) => ({ setting: { key } }),
    // Money: enough for the surface to mount if a test ever routes to it.
    plaidStatus: async () => ({
      configured: false, environment: 'sandbox', redirect_uri: '/plaid/oauth', webhook_url: '/api/plaid/webhook',
      items: [], accounts: [],
      net_worth: { cash: 0, credit: 0, investments: 0, loans: 0, net_worth: 0, accounts_counted: 0, accounts_total: 0, stalest_balance_at: null },
    }),
    plaidLinkToken: async () => ({ link_token: 'link-test', environment: 'sandbox' }),
    plaidExchange: async () => ({ ok: true, item: { id: 1, institution: null, status: 'active' }, syncing: true }),
    plaidSync: async () => ({ reports: [] }),
    plaidUnlinkItem: async (id: number) => ({ ok: true, deleted: id }),
    plaidSetAccountHidden: async (id: number, hidden: boolean) => ({ ok: true, id, hidden }),
    moneySummary: async () => ({
      linked_institutions: 0, needs_attention: [], last_synced_at: null,
      net_worth: { cash: 0, credit: 0, investments: 0, loans: 0, net_worth: 0, accounts_counted: 0, accounts_total: 0, stalest_balance_at: null },
      window_days: 30, total_spent: 0, by_category: [], accounts: [],
    }),
    moneyTransactions: async () => ({ transactions: [] }),
    moneyTrend: async () => ({ net_worth: [], spend_by_day: [] }),
    moneyCategories: async () => ({ categories: [] }),
    moneyHoldings: async () => ({ holdings: [] }),
  };
  return { ...actual, api, usingMock: true };
});

const App = (await import('../src/App.js')).default;

afterEach(cleanup);

// Exposes the router's live pathname alongside <App/> for assertions — a
// sibling inside the same MemoryRouter context, not a prop App accepts.
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderApp(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe('Cabinet v2 console — integration', () => {
  it('boots to Today inside the shell', async () => {
    renderApp();
    expect(await screen.findByText('CABINET')).toBeTruthy();
    expect(await screen.findByText(/Good morning, Ben/)).toBeTruthy();
    // the rail marks Today active
    expect(screen.getByRole('button', { name: /Today/ }).getAttribute('aria-current')).toBe('page');
  });

  it('routes between surfaces from the rail', async () => {
    renderApp();
    await screen.findByText(/Good morning, Ben/);
    await userEvent.click(screen.getByRole('button', { name: /Ops/ }));
    // Today unmounts, Ops becomes the active surface
    await waitFor(() => expect(screen.queryByText(/Good morning, Ben/)).toBeNull());
    expect(screen.getByRole('button', { name: /Ops/ }).getAttribute('aria-current')).toBe('page');
  });

  it('navigating updates the URL', async () => {
    renderApp(['/today']);
    await screen.findByText(/Good morning, Ben/);
    expect(screen.getByTestId('location').textContent).toBe('/today');
    await userEvent.click(screen.getByRole('button', { name: /Ops/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/ops'));
  });

  it('deep-links to the right surface on load', async () => {
    renderApp(['/domains']);
    expect(screen.getByTestId('location').textContent).toBe('/domains');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Domains/ }).getAttribute('aria-current')).toBe('page'),
    );
  });

  it('deep-links to Money and mounts it inside the shell', async () => {
    renderApp(['/money']);
    expect(screen.getByTestId('location').textContent).toBe('/money');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Money/ }).getAttribute('aria-current')).toBe('page'),
    );
    // configured: false in the mock above — the setup panel, not a blank surface.
    expect(await screen.findByLabelText('Plaid setup')).toBeTruthy();
  });

  it('deep-links to Credentials and mounts it inside the shell', async () => {
    renderApp(['/credentials']);
    expect(screen.getByTestId('location').textContent).toBe('/credentials');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Credentials/ }).getAttribute('aria-current')).toBe('page'),
    );
    // configured: false in the mock above — the "no encryption key" banner.
    expect((await screen.findByRole('alert')).textContent).toContain('No encryption key on the server');
  });

  it('renders /plaid/oauth bare — outside the rail and topbar', async () => {
    renderApp(['/plaid/oauth']);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull());
    // The landing page finds no stashed link token in a fresh jsdom.
    expect(await screen.findByRole('link', { name: /Back to Money/ })).toBeTruthy();
  });

  it('redirects unknown paths and the root to /today', async () => {
    renderApp(['/nope']);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/today'));
    expect(await screen.findByText(/Good morning, Ben/)).toBeTruthy();
  });
});
