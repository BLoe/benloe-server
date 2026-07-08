import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the API so the console mounts against deterministic data. Keep the real
// contract exports (DOMAINS, types) via importOriginal; override only `api`.
vi.mock('../src/lib/cabinet.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/cabinet.js')>();
  const today = {
    greeting: 'Good morning, Ben.', greetingAccent: 'A quiet day', read: 'All set today.',
    attention: [], vitals: [{ kind: 'dial', label: 'Nutrition · today', value: 1, max: 2 }],
    overnight: null, sweptAt: '2026-07-08T06:06:00-04:00',
  };
  const api = {
    health: async () => ({ ok: true, authMode: 'subscription', presence: 'idle', presenceMeta: 'idle · queue 0' }),
    today: async () => today,
    domain: async (id: string) => ({ id, label: id, instruments: [], narrative: 'x', log: [] }),
    ops: async () => ({ entries: [] }),
    revertOp: async () => ({ ok: true }),
    memory: async () => ({ files: [], lessons: [] }),
    saveMemoryFile: async () => ({ ok: true }),
    recall: async (q: string) => ({ query: q, results: [] }),
    threads: async () => ({ threads: [] }),
    messages: async () => ({ messages: [] }),
    command: async () => ({ threadId: 't' }),
  };
  return { ...actual, api, usingMock: true };
});

const App = (await import('../src/App.js')).default;

afterEach(cleanup);

describe('Cabinet v2 console — integration', () => {
  it('boots to Today inside the shell', async () => {
    render(<App />);
    expect(await screen.findByText('CABINET')).toBeTruthy();
    expect(await screen.findByText(/Good morning, Ben/)).toBeTruthy();
    // the rail marks Today active
    expect(screen.getByRole('button', { name: /Today/ }).getAttribute('aria-current')).toBe('page');
  });

  it('routes between surfaces from the rail', async () => {
    render(<App />);
    await screen.findByText(/Good morning, Ben/);
    await userEvent.click(screen.getByRole('button', { name: /Ops/ }));
    // Today unmounts, Ops becomes the active surface
    await waitFor(() => expect(screen.queryByText(/Good morning, Ben/)).toBeNull());
    expect(screen.getByRole('button', { name: /Ops/ }).getAttribute('aria-current')).toBe('page');
  });
});
