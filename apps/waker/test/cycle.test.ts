import { describe, it, expect } from 'vitest';
import {
  easternParts,
  humanDuration,
  msUntil,
  phaseAdvice,
  readCycle,
  tidePath,
} from '../src/lib/analysis/cycle.js';

/** A known instant: Wednesday 2025-09-10 14:00 UTC = 10:00 Eastern (EDT). */
const WED_10AM_ET = new Date('2025-09-10T14:00:00Z');
/** Sunday 2025-09-14 15:00 UTC = 11:00 Eastern — two hours before lock. */
const SUN_11AM_ET = new Date('2025-09-14T15:00:00Z');
/** Sunday 2025-09-14 20:00 UTC = 16:00 Eastern — games under way. */
const SUN_4PM_ET = new Date('2025-09-14T20:00:00Z');
/** Tuesday 2025-09-16 14:00 UTC = 10:00 Eastern — after games, before waivers. */
const TUE_10AM_ET = new Date('2025-09-16T14:00:00Z');

describe('easternParts', () => {
  it('reads the weekday and hour in Eastern, not UTC', () => {
    expect(easternParts(WED_10AM_ET)).toEqual({ day: 3, hour: 10, minute: 0 });
  });

  it('handles daylight saving, so a lock time is never an hour wrong', () => {
    // Same clock time either side of the November change.
    const edt = easternParts(new Date('2025-10-15T17:00:00Z')); // UTC-4
    const est = easternParts(new Date('2025-12-15T18:00:00Z')); // UTC-5
    expect(edt.hour).toBe(13);
    expect(est.hour).toBe(13);
  });

  it('reports midnight as hour zero', () => {
    expect(easternParts(new Date('2025-09-11T04:00:00Z')).hour).toBe(0);
  });
});

describe('msUntil', () => {
  it('counts forward to a gate later the same week', () => {
    // Wednesday 10am -> Sunday 1pm is 4 days and 3 hours.
    expect(msUntil(WED_10AM_ET, 0, 13)).toBe((4 * 24 + 3) * 3_600_000);
  });

  it('wraps to next week for a gate that has passed', () => {
    // Wednesday 10am -> Wednesday 3am already went, so it is nearly a week.
    const ms = msUntil(WED_10AM_ET, 3, 3);
    expect(ms).toBeGreaterThan(6 * 86_400_000);
    expect(ms).toBeLessThan(7 * 86_400_000);
  });

  it('never returns a negative', () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(msUntil(WED_10AM_ET, day, 13)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('readCycle', () => {
  const base = { gamesScheduled: true, periodLabel: 'Week 2' };

  it('knows lineups are open midweek', () => {
    const c = readCycle({ ...base, now: WED_10AM_ET });
    expect(c.phase).toBe('open');
    expect(c.agency).toBe(1);
    expect(c.nextGate?.label).toBe('Lineups lock');
  });

  it('knows the crunch on Sunday morning', () => {
    const c = readCycle({ ...base, now: SUN_11AM_ET });
    expect(c.phase).toBe('closing');
    expect(c.title).toMatch(/lock today/);
    expect(c.nextGate?.inMs).toBeLessThan(3 * 3_600_000);
  });

  it('knows nothing can be changed once games start', () => {
    const c = readCycle({ ...base, now: SUN_4PM_ET });
    expect(c.phase).toBe('live');
    expect(c.agency).toBe(0);
  });

  it('knows claims are open again before the waiver run', () => {
    const c = readCycle({ ...base, now: TUE_10AM_ET });
    expect(c.phase).toBe('claims');
    expect(c.nextGate?.label).toBe('Waivers clear');
  });

  it('treats the offseason as slack water, not a dead zone', () => {
    // Most of a dynasty year is here, and it is when trades happen.
    const c = readCycle({
      now: WED_10AM_ET,
      gamesScheduled: false,
      periodLabel: 'Preseason',
      daysToKickoff: 34,
    });
    expect(c.phase).toBe('offseason');
    expect(c.agency).toBe(1);
    expect(c.title).toMatch(/34 days/);
    expect(c.nextGate).toBeNull();
  });

  it('places the marker somewhere on the curve in every phase', () => {
    for (const now of [WED_10AM_ET, SUN_11AM_ET, SUN_4PM_ET, TUE_10AM_ET]) {
      const c = readCycle({ ...base, now });
      expect(c.at).toBeGreaterThanOrEqual(0);
      expect(c.at).toBeLessThanOrEqual(1);
      expect(c.agency).toBeGreaterThanOrEqual(0);
      expect(c.agency).toBeLessThanOrEqual(1);
    }
  });

  it('always names the next gate while games are scheduled', () => {
    for (const now of [WED_10AM_ET, SUN_11AM_ET, SUN_4PM_ET, TUE_10AM_ET]) {
      expect(readCycle({ ...base, now }).nextGate).not.toBeNull();
    }
  });

  it('gives advice for every phase', () => {
    for (const p of ['claims', 'open', 'closing', 'live', 'settled', 'offseason'] as const) {
      expect(phaseAdvice(p).length).toBeGreaterThan(20);
    }
  });
});

describe('humanDuration', () => {
  it('reads naturally at each scale', () => {
    expect(humanDuration(40 * 60_000)).toBe('40m');
    expect(humanDuration(6 * 3_600_000 + 30 * 60_000)).toBe('6h 30m');
    expect(humanDuration((2 * 24 + 4) * 3_600_000)).toBe('2d 4h');
  });

  it('says now rather than a negative', () => {
    expect(humanDuration(0)).toBe('now');
    expect(humanDuration(-5000)).toBe('now');
  });
});

describe('tidePath', () => {
  it('produces a path across the full width', () => {
    const d = tidePath(600, 60);
    expect(d.startsWith('M 0.0')).toBe(true);
    expect(d).toContain('600.0');
  });

  it('stays inside the box', () => {
    const d = tidePath(600, 60);
    const numbers = d.match(/-?\d+\.\d/g)!.map(Number);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(601);
    }
  });

  it('is deterministic', () => {
    expect(tidePath(600, 60)).toBe(tidePath(600, 60));
  });
});
