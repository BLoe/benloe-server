import { describe, expect, it } from 'vitest';
import { ago, bytes, calendarDay, clock, compactNumber, cost, dateTime, dayDiff, duration, greeting, localDay, longDate, modelLabel, money, plural, relativeTime, shortDate, toolLabel } from './format';

const NY = 'America/New_York';
const now = new Date('2026-11-14T20:30:00Z'); // Saturday 3:30 PM in New York

describe('money and cost', () => {
  it('formats dollars', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(-12)).toBe('-$12.00');
    expect(money(0)).toBe('$0.00');
    expect(money(1234.5, { cents: false })).toBe('$1,235');
    expect(money(null)).toBe('—');
    expect(money(NaN)).toBe('—');
  });
  it('keeps the digits that matter for small costs', () => {
    expect(cost(0)).toBe('$0');
    expect(cost(0.0004)).toBe('<$0.001');
    expect(cost(0.0123)).toBe('$0.012');
    expect(cost(0.5)).toBe('$0.500');
    expect(cost(3.456)).toBe('$3.46');
    expect(cost(undefined)).toBe('—');
  });
});

describe('small formatters', () => {
  it('plural', () => {
    expect(plural(1, 'device')).toBe('1 device');
    expect(plural(0, 'device')).toBe('0 devices');
    expect(plural(1200, 'entry', 'entries')).toBe('1,200 entries');
  });
  it('duration', () => {
    expect(duration(340)).toBe('340 ms');
    expect(duration(1234)).toBe('1.2 s');
    expect(duration(12_400)).toBe('12 s');
    expect(duration(125_000)).toBe('2 min 5 s');
    expect(duration(120_000)).toBe('2 min');
    expect(duration(null)).toBe('');
  });
  it('bytes and compact numbers', () => {
    expect(bytes(900)).toBe('900 B');
    expect(bytes(20_480)).toBe('20 KB');
    expect(bytes(3_250_000)).toBe('3.1 MB');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1500)).toBe('1.5k');
    expect(compactNumber(45_000)).toBe('45k');
    expect(compactNumber(2_300_000)).toBe('2.3M');
  });
  it('labels', () => {
    expect(toolLabel('pantry_update')).toBe('Pantry update');
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet');
    expect(modelLabel('claude-opus-5')).toBe('Opus');
    expect(modelLabel('mystery')).toBe('mystery');
    expect(modelLabel(null)).toBe('');
  });
});

describe('dates', () => {
  it('formats in the given zone', () => {
    expect(clock('2026-11-14T23:05:00Z', NY)).toBe('6:05 PM');
    expect(longDate(now, NY)).toBe('Saturday, November 14');
    expect(shortDate('2026-11-14T23:05:00Z', NY, now)).toBe('Sat, Nov 14');
    expect(shortDate('2027-01-02T17:00:00Z', NY, now)).toBe('Sat, Jan 2, 2027');
    expect(localDay(new Date('2026-11-15T03:00:00Z'), NY)).toBe('2026-11-14');
  });

  it('counts calendar days in the zone, not 24-hour spans', () => {
    expect(dayDiff('2026-11-15T04:30:00Z', now, NY)).toBe(0); // 11:30 PM the same evening
    expect(dayDiff('2026-11-15T05:30:00Z', now, NY)).toBe(1); // half past midnight
    expect(dayDiff('2026-11-13T23:00:00Z', now, NY)).toBe(-1);
  });

  it('dateTime names today, tomorrow and yesterday', () => {
    expect(dateTime('2026-11-14T23:00:00Z', now, NY)).toBe('Today 6:00 PM');
    expect(dateTime('2026-11-15T14:00:00Z', now, NY)).toBe('Tomorrow 9:00 AM');
    expect(dateTime('2026-11-13T14:00:00Z', now, NY)).toBe('Yesterday 9:00 AM');
    expect(dateTime('2026-11-20T14:00:00Z', now, NY)).toBe('Fri, Nov 20, 9:00 AM');
    expect(dateTime(null, now, NY)).toBe('—');
    expect(dateTime('nope', now, NY)).toBe('—');
  });

  it('relativeTime in both directions', () => {
    const at = (ms: number) => new Date(now.getTime() + ms);
    expect(relativeTime(at(-10_000), now)).toBe('just now');
    expect(relativeTime(at(20_000), now)).toBe('in a moment');
    expect(relativeTime(at(-5 * 60_000), now)).toBe('5 min ago');
    expect(relativeTime(at(3 * 3_600_000), now)).toBe('in 3 hr');
    expect(relativeTime(at(-26 * 3_600_000), now)).toBe('1 day ago');
    expect(relativeTime(at(-3 * 86_400_000), now)).toBe('3 days ago');
    expect(relativeTime(at(-30 * 86_400_000), now, NY)).toBe('Thu, Oct 15');
    expect(relativeTime(null, now)).toBe('—');
  });

  it('ago never reads as the future', () => {
    expect(ago(new Date(now.getTime() + 50_000), now)).toBe('just now');
    expect(ago(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 min ago');
    expect(ago(null, now)).toBe('—');
  });

  it('calendarDay for stored YYYY-MM-DD dates', () => {
    expect(calendarDay('2026-11-14', '2026-11-14')).toBe('Today');
    expect(calendarDay('2026-11-15', '2026-11-14')).toBe('Tomorrow');
    expect(calendarDay('2026-11-13', '2026-11-14')).toBe('Yesterday');
    expect(calendarDay('2026-11-20', '2026-11-14')).toBe('Fri, Nov 20');
    expect(calendarDay('2027-01-02', '2026-11-14')).toBe('Sat, Jan 2, 2027');
    expect(calendarDay(null, '2026-11-14')).toBe('—');
    expect(calendarDay('14/11/2026', '2026-11-14')).toBe('—');
  });

  it('greets by the hour in the zone', () => {
    expect(greeting(new Date('2026-11-14T12:00:00Z'), NY)).toBe('Good morning'); // 7 AM
    expect(greeting(now, NY)).toBe('Good afternoon');
    expect(greeting(new Date('2026-11-15T00:30:00Z'), NY)).toBe('Good evening'); // 7:30 PM
    expect(greeting(new Date('2026-11-14T07:00:00Z'), NY)).toBe('Up late'); // 2 AM
  });
});
