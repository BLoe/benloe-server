import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpsEntry, OpsFeed, OpsKind, UsageView, UsageRollingView } from '../src/lib/contracts.js';

const { opsMock, revertMock, usageMock, usageRollingMock } = vi.hoisted(() => ({
  opsMock: vi.fn<(filter?: { kind?: OpsKind; domain?: string }) => Promise<OpsFeed>>(),
  revertMock: vi.fn<(id: string) => Promise<{ ok: boolean }>>(),
  usageMock: vi.fn<() => Promise<UsageView>>(),
  usageRollingMock: vi.fn<() => Promise<UsageRollingView>>(),
}));

// Stub the data module: keep the real types/exports, swap api.ops + api.revertOp
// + api.usage/usageRolling (the usage card fetches both, unconditionally, on mount).
vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return {
    ...actual,
    api: { ...actual.api, ops: opsMock, revertOp: revertMock, usage: usageMock, usageRolling: usageRollingMock },
  };
});

import { Ops } from '../src/surfaces/Ops.js';

const ENTRIES: OpsEntry[] = [
  {
    id: 'o1',
    at: '2026-07-08T05:41:00-04:00',
    tool: 'backup',
    action: 'snapshot databases',
    reason: 'nightly maintenance',
    tier: 3,
    kind: 'cron',
    result: 'integrity ok',
    chatId: null,
    reversible: false,
  },
  {
    id: 'o2',
    at: '2026-07-08T02:14:00-04:00',
    tool: 'Write',
    action: 'title chat',
    reason: 'auto-title untitled chat',
    tier: 4,
    kind: 'heartbeat',
    result: '"Cabinet Systems Status Report"',
    chatId: 't-5dd8',
    reversible: true,
    diff: 'title: null → "Cabinet Systems Status Report"',
  },
];

beforeEach(() => {
  opsMock.mockReset();
  revertMock.mockReset();
  usageMock.mockReset();
  usageRollingMock.mockReset();
  opsMock.mockImplementation((filter) =>
    Promise.resolve({ entries: filter?.kind ? ENTRIES.filter((e) => e.kind === filter.kind) : ENTRIES }),
  );
  revertMock.mockResolvedValue({ ok: true });
  // Default: no usage data — the ledger tests below don't care about the
  // usage card and shouldn't have to render it.
  usageMock.mockResolvedValue({ authMode: 'subscription', byDay: [] });
  usageRollingMock.mockResolvedValue({ authMode: 'subscription', windows: [] });
});
afterEach(cleanup);

describe('Ops surface', () => {
  it('renders the feed reverse-chronological with reason, chips, diff, result', async () => {
    render(<Ops />);
    await waitFor(() => expect(opsMock).toHaveBeenCalledWith(undefined));

    expect(await screen.findByText('snapshot databases')).toBeTruthy();
    expect(screen.getByText('title chat')).toBeTruthy();
    expect(screen.getByText('auto-title untitled chat')).toBeTruthy();
    // diff shown inline
    expect(screen.getByText(/title: null →/)).toBeTruthy();
    // kind + tier chips
    expect(screen.getByText('cron')).toBeTruthy();
    expect(screen.getByText('heartbeat')).toBeTruthy();
    expect(screen.getByText('T4')).toBeTruthy();

    // reverse-chron: 05:41 row before 02:14 row in DOM order
    const rows = document.querySelectorAll('.ops-row');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('snapshot databases');
    expect(rows[1]?.textContent).toContain('title chat');
  });

  it('shows a Revert only on reversible rows', async () => {
    render(<Ops />);
    await screen.findByText('title chat');
    const reverts = screen.getAllByRole('button', { name: 'Revert' });
    expect(reverts.length).toBe(1);
  });

  it('the kind filter refetches with that kind', async () => {
    const user = userEvent.setup();
    render(<Ops />);
    await screen.findByText('snapshot databases');

    await user.click(screen.getByRole('button', { name: 'Heartbeat' }));

    await waitFor(() => expect(opsMock).toHaveBeenCalledWith({ kind: 'heartbeat' }));
    // cron row is gone after refetch
    await waitFor(() => expect(screen.queryByText('snapshot databases')).toBeNull());
    expect(screen.getByText('title chat')).toBeTruthy();
  });

  it('clicking Revert calls api.revertOp(id) and marks the row reverted', async () => {
    const user = userEvent.setup();
    render(<Ops />);
    await screen.findByText('title chat');

    await user.click(screen.getByRole('button', { name: 'Revert' }));

    await waitFor(() => expect(revertMock).toHaveBeenCalledWith('o2'));
    expect(await screen.findByText('reverted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revert' })).toBeNull();
  });

  it('renders voice empty-state copy when a filter has no entries', async () => {
    opsMock.mockResolvedValue({ entries: [] });
    render(<Ops />);
    expect(await screen.findByText(/Nothing on the ledger yet\./i)).toBeTruthy();
  });
});

describe('Ops surface — usage card', () => {
  it('renders nothing when there is no rolling-window data', async () => {
    render(<Ops />);
    await screen.findByText('snapshot databases'); // wait for the ledger to settle
    expect(screen.queryByLabelText('Usage')).toBeNull();
  });

  it('shows the cache-health headline, rolling windows, and the labeled cost proxy', async () => {
    usageMock.mockResolvedValue({
      authMode: 'subscription',
      byDay: [
        { day: '2026-07-09', model: 'claude-sonnet-5', input: 480, output: 360, cache_read: 29200, cache_write: 245, cost_usd: 0.06, turns: 3 },
        { day: '2026-07-08', model: 'claude-sonnet-5', input: 8300, output: 4150, cache_read: 40500, cache_write: 41000, cost_usd: 1.43, turns: 21 },
      ],
    });
    usageRollingMock.mockResolvedValue({
      authMode: 'subscription',
      windows: [
        { window: '5h', input: 480, output: 360, cache_read: 29200, cache_write: 245, cost_usd: 0.06, turns: 3, cacheReadWriteRatio: 119.18 },
        { window: '24h', input: 1200, output: 900, cache_read: 58000, cache_write: 780, cost_usd: 0.31, turns: 9, cacheReadWriteRatio: 74.36 },
        { window: '7d', input: 50700, output: 25650, cache_read: 304000, cache_write: 245380, cost_usd: 8.95, turns: 139, cacheReadWriteRatio: 1.24 },
      ],
    });

    render(<Ops />);

    const usage = await screen.findByLabelText('Usage');
    expect(usage.textContent).toContain('119×'); // headline ratio, rounded (≥100 drops the decimal)
    expect(usage.textContent).toContain('reusing well'); // ok-tone tag at ratio ≥ 20
    expect(usage.textContent).toContain('5h window');
    expect(usage.textContent).toContain('24h window');
    expect(usage.textContent).toContain('7d window');
    // cost proxy present, explicitly labeled, and never the headline number
    expect(screen.getByText(/API-rate equivalent \(24h\): \$0\.31 — you're on Max, not billed per-token\./)).toBeTruthy();
  });

  it('tags a collapsing ratio as churning (crit) instead of healthy', async () => {
    usageMock.mockResolvedValue({ authMode: 'subscription', byDay: [] });
    usageRollingMock.mockResolvedValue({
      authMode: 'subscription',
      windows: [
        { window: '5h', input: 500, output: 300, cache_read: 1000, cache_write: 900, cost_usd: 0.02, turns: 4, cacheReadWriteRatio: 1.11 },
        { window: '24h', input: 2000, output: 1200, cache_read: 4000, cache_write: 3600, cost_usd: 0.08, turns: 16, cacheReadWriteRatio: 1.11 },
        { window: '7d', input: 14000, output: 8400, cache_read: 28000, cache_write: 25200, cost_usd: 0.56, turns: 112, cacheReadWriteRatio: 1.11 },
      ],
    });

    render(<Ops />);
    const usage = await screen.findByLabelText('Usage');
    expect(usage.textContent).toContain('1.1×');
    expect(usage.textContent).toContain('churning');
  });
});
