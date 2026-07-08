import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TodayView } from '../src/lib/cabinet.js';

// Stub the data module before importing the surface.
const today = vi.fn();
const command = vi.fn();
vi.mock('../src/lib/cabinet.js', () => ({
  api: { today: (...a: unknown[]) => today(...a), command: (...a: unknown[]) => command(...a) },
}));

import { Today } from '../src/surfaces/Today.js';

afterEach(() => {
  cleanup();
  today.mockReset();
  command.mockReset();
});

const VIEW: TodayView = {
  greeting: 'Good morning, Ben.',
  greetingAccent: 'A quiet day',
  read: 'Protein three mornings straight and weight still drifting down.',
  attention: [
    {
      id: 'att-1',
      severity: 'crit',
      badge: '℞',
      title: 'Metformin runs out Saturday',
      meta: '4 days · 2×/day',
      detail: 'Eight tablets left. I can reorder before you run dry.',
      actions: [
        { label: 'Reorder now', intent: 'reorder metformin', primary: true },
        { label: 'Snooze', intent: 'snooze metformin refill' },
      ],
    },
  ],
  vitals: [
    { kind: 'dial', label: 'Nutrition · today', tag: 'on track', value: 142, max: 185, unit: '/ 185 g protein' },
  ],
  overnight: { count: 3, summary: 'backed up your data, titled a thread' },
  sweptAt: '2026-07-08T06:06:00-04:00',
};

describe('Today', () => {
  it('renders greeting, accent, briefing, an attention title, and vitals', async () => {
    today.mockResolvedValue(VIEW);
    render(<Today />);

    // greeting + italic brass accent
    expect(await screen.findByText(/Good morning, Ben\./)).toBeTruthy();
    expect(screen.getByText('A quiet day')).toBeTruthy();
    // the voice read
    expect(screen.getByText(/Protein three mornings straight/)).toBeTruthy();
    // attention item title
    expect(screen.getByText('Metformin runs out Saturday')).toBeTruthy();
    // vitals instrument (its card cap label)
    expect(screen.getByText('Nutrition · today')).toBeTruthy();
    // overnight line links to Ops
    expect(screen.getByRole('button', { name: /See Ops/ })).toBeTruthy();
  });

  it('fires the action intent through api.command', async () => {
    today.mockResolvedValue(VIEW);
    command.mockResolvedValue({ threadId: 't1' });
    render(<Today />);

    const primary = await screen.findByRole('button', { name: 'Reorder now' });
    await userEvent.click(primary);
    expect(command).toHaveBeenCalledWith('reorder metformin');
  });

  it('routes the overnight link to Ops', async () => {
    today.mockResolvedValue(VIEW);
    const onNavigate = vi.fn();
    render(<Today onNavigate={onNavigate} />);

    await userEvent.click(await screen.findByRole('button', { name: /See Ops/ }));
    expect(onNavigate).toHaveBeenCalledWith('ops');
  });

  it('shows the calm empty line when nothing needs Ben', async () => {
    today.mockResolvedValue({ ...VIEW, attention: [] });
    render(<Today />);

    await waitFor(() => expect(screen.getByText(/Nothing needs you\./)).toBeTruthy());
  });
});
