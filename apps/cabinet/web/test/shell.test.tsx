import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../src/components/shell/index.js';

afterEach(cleanup);

describe('AppShell', () => {
  it('renders the rail, the active surface, and the presence strip', () => {
    render(
      <AppShell active="today" onNavigate={() => {}} datestamp={<b>7 Jul</b>} presence="working" presenceMeta="last swept 06:06">
        <div>surface body</div>
      </AppShell>,
    );
    expect(screen.getByText('CABINET')).toBeTruthy();
    expect(screen.getByText('surface body')).toBeTruthy();
    // presence reflects state
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText(/last swept 06:06/)).toBeTruthy();
  });

  it('marks the active surface and routes navigation clicks', async () => {
    const onNavigate = vi.fn();
    render(<AppShell active="today" onNavigate={onNavigate}><div /></AppShell>);
    const today = screen.getByRole('button', { name: /Today/ });
    expect(today.getAttribute('aria-current')).toBe('page');
    await userEvent.click(screen.getByRole('button', { name: /Ops/ }));
    expect(onNavigate).toHaveBeenCalledWith('ops');
  });

  it('does not render the numeric hotkey hints in the rail (removed, 2026-07-17 — decorative only, never wired to keys)', () => {
    render(<AppShell active="today" onNavigate={() => {}}><div /></AppShell>);
    for (const name of [/Today/, /Domains/, /Ops/, /Brain/, /Chat/]) {
      expect(screen.getByRole('button', { name }).textContent).not.toMatch(/[0-9]/);
    }
  });
});

describe('CommandBar', () => {
  it('opens on ⌘K, submits an intent on Enter, and closes on Esc', async () => {
    const onCommand = vi.fn();
    render(<AppShell active="today" onNavigate={() => {}} onCommand={onCommand}><div /></AppShell>);
    // closed initially
    expect(screen.queryByRole('dialog')).toBeNull();
    // ⌘K opens
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByLabelText('Command input') as HTMLInputElement;
    await userEvent.type(input, 'log two eggs');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledWith('log two eggs');
    // closed after submit
    expect(screen.queryByRole('dialog')).toBeNull();
    // reopen then Esc closes
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the top-bar trigger also opens the command bar', async () => {
    render(<AppShell active="today" onNavigate={() => {}}><div /></AppShell>);
    await userEvent.click(screen.getByRole('button', { name: /Open command bar/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
