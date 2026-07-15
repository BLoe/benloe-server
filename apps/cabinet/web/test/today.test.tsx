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
  overnight: { count: 3, summary: 'backed up your data, titled a chat' },
  sweptAt: '2026-07-08T06:06:00-04:00',
  briefing: null,
  checkin: null,
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
    command.mockResolvedValue({ chatId: 't1' });
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

  it('absent briefing (null): renders the exact fallback template, no eyebrow, no stale tag', async () => {
    today.mockResolvedValue(VIEW); // briefing: null
    render(<Today />);

    expect(await screen.findByText(/Good morning, Ben\./)).toBeTruthy();
    expect(screen.getByText(/Protein three mornings straight/)).toBeTruthy();
    expect(screen.queryByText(/Briefing ·/)).toBeNull();
    expect(screen.queryByText(/last briefing/)).toBeNull();
  });

  it('fresh briefing (isCurrent: true): real narrative + timestamp eyebrow replace the template, no stale tag', async () => {
    today.mockResolvedValue({
      ...VIEW,
      briefing: { at: '2026-07-09T10:32:00.000Z', isCurrent: true, narrative: 'Quiet start — nothing urgent today.' },
    });
    render(<Today />);

    expect(await screen.findByText(/Quiet start — nothing urgent today\./)).toBeTruthy();
    expect(screen.getByText(/^Briefing ·/)).toBeTruthy();
    expect(screen.queryByText(/Good morning, Ben\./)).toBeNull(); // template must not also render
    expect(screen.queryByText(/last briefing/)).toBeNull();
  });

  it('stale briefing (isCurrent: false): narrative still shown, plus an explicit "days ago" label — never silently presented as fresh', async () => {
    today.mockResolvedValue({
      ...VIEW,
      briefing: { at: '2026-07-06T10:32:00.000Z', isCurrent: false, narrative: 'Three days old now.' },
    });
    render(<Today />);

    expect(await screen.findByText(/Three days old now\./)).toBeTruthy();
    expect(screen.getByText(/last briefing: \d+ days? ago/)).toBeTruthy();
  });

  it('checkin card is omitted entirely when absent (null) — no placeholder competing for attention', async () => {
    today.mockResolvedValue(VIEW); // checkin: null
    render(<Today />);

    await screen.findByText(/Good morning, Ben\./);
    expect(screen.queryByText('Check-in')).toBeNull();
  });

  it('checkin card renders its vitals + prompt, with a clock tag when current', async () => {
    today.mockResolvedValue({
      ...VIEW,
      checkin: {
        at: '2026-07-09T00:32:00.000Z',
        isCurrent: true,
        vitals: [{ kind: 'stat', label: 'Protein · tonight', big: '162', unit: 'g', sub: '2,180 kcal · 4 meals' }],
        prompt: 'How was today? Tap mood / energy / stress.',
      },
    });
    render(<Today />);

    expect(await screen.findByText('Check-in')).toBeTruthy();
    expect(screen.getByText('Protein · tonight')).toBeTruthy(); // Instrument card cap
    expect(screen.getByText(/How was today\?/)).toBeTruthy();
  });

  it('checkin card omits the clock tag when stale (isCurrent: false) but still shows the (stale) content', async () => {
    today.mockResolvedValue({
      ...VIEW,
      checkin: {
        at: '2026-07-07T00:32:00.000Z',
        isCurrent: false,
        vitals: [{ kind: 'stat', label: 'Protein · tonight', big: '90', unit: 'g' }],
        prompt: 'How was today?',
      },
    });
    render(<Today />);

    expect(await screen.findByText('Check-in')).toBeTruthy();
    expect(screen.getByText('Protein · tonight')).toBeTruthy();
    // no clock-shaped tag rendered next to the label when stale
    expect(screen.queryByText(/^\d{1,2}:\d{2}/)).toBeNull();
  });

  describe('checkin card ordering (cosmetic, wall-clock only)', () => {
    afterEach(() => vi.useRealTimers());

    const withCheckin = {
      ...VIEW,
      checkin: {
        at: '2026-07-09T00:32:00.000Z',
        isCurrent: true,
        vitals: [{ kind: 'stat' as const, label: 'Protein · tonight', big: '162', unit: 'g' }],
        prompt: 'How was today?',
      },
    };

    it('promotes the checkin card directly under the hero after 5pm local', async () => {
      // Fake only Date, not timers — findByText/waitFor poll via real
      // setTimeout internally and hang forever under a fully-faked clock.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-09T23:00:00.000Z')); // 7pm America/New_York
      today.mockResolvedValue(withCheckin);
      render(<Today />);

      await screen.findByText('Check-in');
      // .textContent is recursive and would also pick up "Need you today"'s
      // count-badge sibling span — label by container instead of raw text.
      const order = screen
        .getAllByText(/^(Check-in|Need you today)$/)
        .map((el) => (el.closest('.today__checkin') ? 'Check-in' : 'Need you today'));
      expect(order).toEqual(['Check-in', 'Need you today']);
    });

    it('keeps the checkin card after Vitals earlier in the day', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-09T14:00:00.000Z')); // 10am America/New_York
      today.mockResolvedValue(withCheckin);
      render(<Today />);

      await screen.findByText('Check-in');
      const order = screen
        .getAllByText(/^(Check-in|Need you today)$/)
        .map((el) => (el.closest('.today__checkin') ? 'Check-in' : 'Need you today'));
      expect(order).toEqual(['Need you today', 'Check-in']);
    });
  });
});
