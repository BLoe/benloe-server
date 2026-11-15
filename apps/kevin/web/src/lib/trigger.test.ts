import { describe, expect, it } from 'vitest';
import { cronFromForm, defaultCronForm, formFromCron, humanizeCadence, humanizeCron, humanizeInterval, humanizeTrigger, isoToLocalInput, localInputToIso, time12 } from './trigger';

describe('humanizeCron', () => {
  const cases: [string, string][] = [
    ['0 18 * * *', 'Every day at 6:00 PM'],
    ['30 7 * * 1-5', 'Weekdays at 7:30 AM'],
    ['0 9 * * 0,6', 'Weekends at 9:00 AM'],
    ['0 9 * * 6,7', 'Weekends at 9:00 AM'],
    ['0 18 * * 0', 'Sundays at 6:00 PM'],
    ['0 18 * * 7', 'Sundays at 6:00 PM'],
    ['15 6 * * 1,4', 'Mondays and Thursdays at 6:15 AM'],
    ['0 8 * * 1,3,5', 'Mondays, Wednesdays and Fridays at 8:00 AM'],
    ['0 9 * * 0-6', 'Every day at 9:00 AM'],
    ['0 0 * * *', 'Every day at 12:00 AM'],
    ['0 12 * * *', 'Every day at 12:00 PM'],
    ['0 8,20 * * *', 'Every day at 8:00 AM and 8:00 PM'],
    ['0 9 1 * *', 'On the 1st of every month at 9:00 AM'],
    ['0 9 1,15 * *', 'On the 1st and 15th of every month at 9:00 AM'],
    ['0 9 22 * *', 'On the 22nd of every month at 9:00 AM'],
    ['0 9 13 * *', 'On the 13th of every month at 9:00 AM'],
    ['0 9 15 4 *', 'Every April 15th at 9:00 AM'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['* * * * *', 'Every minute'],
    ['0 * * * *', 'Every hour'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['30 */6 * * *', 'Every 6 hours at :30'],
    ['30 3 * * *', 'Every day at 3:30 AM'],
  ];
  it.each(cases)('%s -> %s', (expr, words) => {
    expect(humanizeCron(expr)).toBe(words);
  });

  it('falls back to the expression for what it cannot say', () => {
    expect(humanizeCron('0 9 1 * 1')).toBe('Cron 0 9 1 * 1');
    expect(humanizeCron('0,30 9 * * *')).toBe('Cron 0,30 9 * * *');
    expect(humanizeCron('0 9-17/2 * * *')).toBe('Cron 0 9-17/2 * * *');
    expect(humanizeCron('nonsense')).toBe('Cron nonsense');
    expect(humanizeCron('61 25 * * *')).toBe('Cron 61 25 * * *');
  });
});

describe('humanizeInterval and humanizeTrigger', () => {
  it('uses the largest whole unit', () => {
    expect(humanizeInterval(1)).toBe('Every minute');
    expect(humanizeInterval(45)).toBe('Every 45 minutes');
    expect(humanizeInterval(60)).toBe('Every hour');
    expect(humanizeInterval(90)).toBe('Every 90 minutes');
    expect(humanizeInterval(120)).toBe('Every 2 hours');
    expect(humanizeInterval(1440)).toBe('Every day');
    expect(humanizeInterval(4320)).toBe('Every 3 days');
    expect(humanizeInterval(NaN)).toBe('Interval not set');
  });

  it('describes each trigger type', () => {
    const now = new Date('2026-11-14T15:00:00Z');
    expect(humanizeTrigger('cron', '0 18 * * 0')).toBe('Sundays at 6:00 PM');
    expect(humanizeTrigger('interval', '120')).toBe('Every 2 hours');
    expect(humanizeTrigger('once', '2026-11-15T18:00:00-05:00', now, 'America/New_York')).toBe('Once, Tomorrow 6:00 PM');
    expect(humanizeTrigger('once', '2026-11-14T18:00:00-05:00', now, 'America/New_York')).toBe('Once, Today 6:00 PM');
    expect(humanizeTrigger('once', '2026-12-25T08:30:00-05:00', now, 'America/New_York')).toBe('Once, Fri, Dec 25, 8:30 AM');
    expect(humanizeTrigger('once', 'garbage')).toBe('Once: garbage');
  });

  it('reads the cadence strings the server reports for system jobs', () => {
    expect(humanizeCadence('cron 30 3 * * *')).toBe('Every day at 3:30 AM');
    expect(humanizeCadence('every 10 min')).toBe('Every 10 minutes');
    expect(humanizeCadence('something else')).toBe('something else');
  });

  it('formats 12-hour times', () => {
    expect(time12(0, 5)).toBe('12:05 AM');
    expect(time12(12, 0)).toBe('12:00 PM');
    expect(time12(23, 59)).toBe('11:59 PM');
  });
});

describe('the cron builder', () => {
  it('builds expressions', () => {
    expect(cronFromForm({ ...defaultCronForm, repeat: 'daily', time: '18:05' })).toBe('5 18 * * *');
    expect(cronFromForm({ ...defaultCronForm, repeat: 'weekly', time: '07:30', days: [5, 1, 1] })).toBe('30 7 * * 1,5');
    expect(cronFromForm({ ...defaultCronForm, repeat: 'monthly', time: '09:00', dayOfMonth: 15 })).toBe('0 9 15 * *');
    expect(cronFromForm({ ...defaultCronForm, repeat: 'custom', expr: ' */5 * * * * ' })).toBe('*/5 * * * *');
  });

  it('reads back what it built', () => {
    for (const expr of ['5 18 * * *', '30 7 * * 1,5', '0 9 15 * *']) expect(cronFromForm(formFromCron(expr))).toBe(expr);
    expect(formFromCron('30 7 * * 1-5')).toMatchObject({ repeat: 'weekly', time: '07:30', days: [1, 2, 3, 4, 5] });
    expect(formFromCron('0 18 * * 7')).toMatchObject({ repeat: 'weekly', days: [0] });
  });

  it('keeps what it cannot express as a custom expression', () => {
    for (const expr of ['*/15 * * * *', '0 9 1 * 1', '0 8,20 * * *', '0 9 1 6 *', '0 9 1,15 * *', 'bad']) {
      expect(formFromCron(expr)).toMatchObject({ repeat: 'custom', expr });
    }
  });
});

describe('datetime-local conversion', () => {
  it('round-trips a local wall-clock time', () => {
    const iso = localInputToIso('2026-11-15T18:00');
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso!)).toBe('2026-11-15T18:00');
  });
  it('rejects junk', () => {
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput('junk')).toBe('');
  });
});
