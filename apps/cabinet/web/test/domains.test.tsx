import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DomainId, DomainView } from '../src/lib/contracts.js';

const { domainMock } = vi.hoisted(() => ({ domainMock: vi.fn<(id: DomainId) => Promise<DomainView>>() }));

// Stub the data module: keep the real DOMAINS list + types, swap api.domain.
vi.mock('../src/lib/cabinet.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/cabinet.js')>();
  return { ...actual, api: { ...actual.api, domain: domainMock } };
});

import { Domains } from '../src/surfaces/Domains.js';

function view(id: DomainId, over: Partial<DomainView> = {}): DomainView {
  return {
    id,
    label: id,
    instruments: [{ kind: 'dial', label: 'Protein · today', value: 142, max: 185 }],
    narrative: `Read for ${id}.`,
    log: [{ id: `${id}-1`, at: '08:10', text: '3 eggs', meta: '~34 g' }],
    ...over,
  };
}

beforeEach(() => {
  domainMock.mockReset();
  domainMock.mockImplementation((id) => Promise.resolve(view(id)));
});
afterEach(cleanup);

describe('Domains surface', () => {
  it('defaults to nutrition and renders instruments, narrative, and log', async () => {
    render(<Domains />);

    await waitFor(() => expect(domainMock).toHaveBeenCalledWith('nutrition'));
    // narrative (voice prose)
    expect(await screen.findByText('Read for nutrition.')).toBeTruthy();
    // instrument dispatched through the captioned card
    expect(screen.getByText('Protein · today')).toBeTruthy();
    // log row: at · text · meta
    expect(screen.getByText('3 eggs')).toBeTruthy();
    expect(screen.getByText('~34 g')).toBeTruthy();
  });

  it('shows a loading read before data lands', async () => {
    let resolve!: (v: DomainView) => void;
    domainMock.mockImplementationOnce(() => new Promise<DomainView>((r) => (resolve = r)));
    render(<Domains />);
    expect(screen.getByText(/Reading Nutrition/i)).toBeTruthy();
    resolve(view('nutrition'));
    await screen.findByText('Read for nutrition.');
  });

  it('clicking another pill fetches that domain', async () => {
    const user = userEvent.setup();
    render(<Domains />);
    await screen.findByText('Read for nutrition.');

    await user.click(screen.getByRole('button', { name: 'Training' }));

    await waitFor(() => expect(domainMock).toHaveBeenCalledWith('training'));
    expect(await screen.findByText('Read for training.')).toBeTruthy();
    // the active pill reflects the selection
    expect(screen.getByRole('button', { name: 'Training' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('renders empty-state copy when a domain has no log', async () => {
    domainMock.mockImplementation((id) => Promise.resolve(view(id, { log: [] })));
    render(<Domains />);
    expect(await screen.findByText(/Nothing logged here yet\./i)).toBeTruthy();
  });
});
