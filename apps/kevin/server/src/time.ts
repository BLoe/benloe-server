// Time in Ben's timezone, and the three schedule triggers. Hand-rolled on
// Intl; covered by test/time.test.ts.
import { config } from './config.js';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(d: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; dow: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!),
  };
}

/** YYYY-MM-DD in Ben's timezone. */
export function localDay(d = new Date(), tz = config.timezone): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** "Saturday, November 14, 2026, 4:22 PM EST" */
export function localStamp(d = new Date(), tz = config.timezone): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d) +
    ' ' + (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '');
}

type Field = Set<number>;
export interface Cron { minute: Field; hour: Field; dom: Field; month: Field; dow: Field; domStar: boolean; dowStar: boolean }

function field(src: string, lo: number, hi: number): Field {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad cron field "${src}"`);
    const step = m[2] ? Number(m[2]) : 1;
    let a = lo;
    let b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1]!.split('-').map(Number);
      a = x!;
      b = y ?? (m[2] ? hi : x!);
    }
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`cron field "${src}" out of range ${lo}-${hi}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

/** Standard 5-field cron: minute hour day-of-month month day-of-week (0 or 7 = Sunday). */
export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error('cron needs 5 fields: minute hour day-of-month month day-of-week');
  const dow = field(f[4]!, 0, 7);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return { minute: field(f[0]!, 0, 59), hour: field(f[1]!, 0, 23), dom: field(f[2]!, 1, 31), month: field(f[3]!, 1, 12), dow, domStar: f[2] === '*', dowStar: f[4] === '*' };
}

function cronMatches(c: Cron, d: Date, tz: string): boolean {
  const p = parts(d, tz);
  if (!c.minute.has(p.mi) || !c.hour.has(p.h) || !c.month.has(p.mo)) return false;
  const dom = c.dom.has(p.d);
  const dow = c.dow.has(p.dow);
  // Cron's rule: when both day fields are restricted, either may match.
  return c.domStar || c.dowStar ? dom && dow : dom || dow;
}

/** The first minute strictly after `after` that matches, searching up to 366 days. */
export function nextCron(expr: string, after: Date, tz = config.timezone): Date | null {
  const c = parseCron(expr);
  const t = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(c, t, tz)) return t;
    t.setTime(t.getTime() + 60_000);
  }
  return null;
}

export type TriggerType = 'once' | 'cron' | 'interval';

/** Validates a trigger and returns its next run after `after` (null: never again). */
export function nextRun(type: TriggerType, value: string, after: Date, lastRun: Date | null, tz = config.timezone): Date | null {
  if (type === 'once') {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) throw new Error('a one-time trigger needs an ISO 8601 time, e.g. 2026-11-15T18:00:00-05:00');
    return lastRun ? null : at;
  }
  if (type === 'interval') {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 1) throw new Error('an interval trigger is a number of minutes, at least 1');
    return new Date((lastRun ?? after).getTime() + minutes * 60_000);
  }
  if (type === 'cron') return nextCron(value, after, tz);
  throw new Error(`unknown trigger type "${type as string}"`);
}
