import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpsEntry, OpsFeed, OpsKind } from '../src/lib/contracts.js';

const { opsMock, revertMock } = vi.hoisted(() => ({
  opsMock: vi.fn<(filter?: { kind?: OpsKind; domain?: string }) => Promise<OpsFeed>>(),
  revertMock: vi.fn<(id: string) => Promise<{ ok: boolean }>>(),
}));

// Stub the data module: keep the real types/exports, swap api.ops + api.revertOp.
vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return { ...actual, api: { ...actual.api, ops: opsMock, revertOp: revertMock } };
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
    threadId: null,
    reversible: false,
  },
  {
    id: 'o2',
    at: '2026-07-08T02:14:00-04:00',
    tool: 'Write',
    action: 'title thread',
    reason: 'auto-title untitled thread',
    tier: 4,
    kind: 'heartbeat',
    result: '"Cabinet Systems Status Report"',
    threadId: 't-5dd8',
    reversible: true,
    diff: 'title: null → "Cabinet Systems Status Report"',
  },
];

beforeEach(() => {
  opsMock.mockReset();
  revertMock.mockReset();
  opsMock.mockImplementation((filter) =>
    Promise.resolve({ entries: filter?.kind ? ENTRIES.filter((e) => e.kind === filter.kind) : ENTRIES }),
  );
  revertMock.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('Ops surface', () => {
  it('renders the feed reverse-chronological with reason, chips, diff, result', async () => {
    render(<Ops />);
    await waitFor(() => expect(opsMock).toHaveBeenCalledWith(undefined));

    expect(await screen.findByText('snapshot databases')).toBeTruthy();
    expect(screen.getByText('title thread')).toBeTruthy();
    expect(screen.getByText('auto-title untitled thread')).toBeTruthy();
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
    expect(rows[1]?.textContent).toContain('title thread');
  });

  it('shows a Revert only on reversible rows', async () => {
    render(<Ops />);
    await screen.findByText('title thread');
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
    expect(screen.getByText('title thread')).toBeTruthy();
  });

  it('clicking Revert calls api.revertOp(id) and marks the row reverted', async () => {
    const user = userEvent.setup();
    render(<Ops />);
    await screen.findByText('title thread');

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
