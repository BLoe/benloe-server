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
    memory: async () => ({ files: [], lessons: [] }),
    saveMemoryFile: async () => ({ ok: true }),
    recall: async (q: string) => ({ query: q, results: [] }),
    chats: async () => ({ chats: [] }),
    messages: async () => ({ messages: [] }),
    command: async () => ({ chatId: 't' }),
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

  it('redirects unknown paths and the root to /today', async () => {
    renderApp(['/nope']);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/today'));
    expect(await screen.findByText(/Good morning, Ben/)).toBeTruthy();
  });
});
