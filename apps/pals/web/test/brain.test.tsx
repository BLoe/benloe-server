import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemoryView, RecallResponse } from '../src/lib/cabinet.js';

// Stub the data module before importing the surface.
const memory = vi.fn();
const recall = vi.fn();
const saveMemoryFile = vi.fn();
vi.mock('../src/lib/cabinet.js', () => ({
  api: {
    memory: (...a: unknown[]) => memory(...a),
    recall: (...a: unknown[]) => recall(...a),
    saveMemoryFile: (...a: unknown[]) => saveMemoryFile(...a),
  },
}));

import { Brain } from '../src/surfaces/Brain.js';

afterEach(() => {
  cleanup();
  memory.mockReset();
  recall.mockReset();
  saveMemoryFile.mockReset();
});

const MEMORY: MemoryView = {
  files: [
    { name: 'USER.md', content: '# USER — Ben\n\nSenior engineer.', updatedAt: '2026-07-07T12:00:00-04:00', editable: true },
    { name: 'LEDGER.md', content: '# LEDGER\n\nSystem of record.', updatedAt: null, editable: false },
  ],
  lessons: [
    { id: 1, text: 'Ben’s usual breakfast is 3 eggs and 2 toast.', domain: 'nutrition', confidence: 0.92 },
  ],
};

const RECALL: RecallResponse = {
  query: 'breakfast',
  results: [
    { source: 'fact', title: 'Breakfast', snippet: '3 eggs and 2 toast', provenance: 'facts · nutrition', score: 0.94, ref: 'fact:breakfast' },
  ],
};

describe('Brain', () => {
  it('renders an editable file, a read-only file, and a lesson', async () => {
    memory.mockResolvedValue(MEMORY);
    render(<Brain />);

    // editable file → a textarea labelled with its name
    expect(await screen.findByLabelText('Contents of USER.md')).toBeTruthy();
    // read-only file has no editable textarea
    expect(screen.queryByLabelText('Contents of LEDGER.md')).toBeNull();
    expect(screen.getByText('LEDGER.md')).toBeTruthy();
    // lesson text + domain + confidence
    expect(screen.getByText(/usual breakfast/)).toBeTruthy();
    expect(screen.getByText('nutrition')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
  });

  it('calls api.recall on submit and renders a provenance-tagged result', async () => {
    memory.mockResolvedValue(MEMORY);
    recall.mockResolvedValue(RECALL);
    render(<Brain />);

    await screen.findByLabelText('Contents of USER.md');
    await userEvent.type(
      screen.getByLabelText('Search everything Cabinet remembers'),
      'breakfast',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));

    expect(recall).toHaveBeenCalledWith('breakfast');
    expect(await screen.findByText('3 eggs and 2 toast')).toBeTruthy();
    // provenance + source chip + score on the record
    expect(screen.getByText('facts · nutrition')).toBeTruthy();
    expect(screen.getByText('Fact')).toBeTruthy();
    expect(screen.getByText('94%')).toBeTruthy();
  });

  it('saves an edited file through api.saveMemoryFile', async () => {
    memory.mockResolvedValue(MEMORY);
    saveMemoryFile.mockResolvedValue({ ok: true });
    render(<Brain />);

    const box = await screen.findByLabelText('Contents of USER.md');
    // Save is disabled until the draft is dirty.
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(box, ' Updated.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveMemoryFile).toHaveBeenCalledWith('USER.md', expect.stringContaining('Updated.')),
    );
  });

  it('shows the empty recall line when nothing matches', async () => {
    memory.mockResolvedValue(MEMORY);
    recall.mockResolvedValue({ query: 'ferrari', results: [] });
    render(<Brain />);

    await screen.findByLabelText('Contents of USER.md');
    await userEvent.type(screen.getByLabelText('Search everything Cabinet remembers'), 'ferrari');
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));

    expect(await screen.findByText(/Nothing on/)).toBeTruthy();
  });
});
