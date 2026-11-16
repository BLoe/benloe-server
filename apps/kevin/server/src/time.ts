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

function dayMatches(c: Cron, p: { d: number; dow: number }): boolean {
  const dom = c.dom.has(p.d);
  const dow = c.dow.has(p.dow);
  // Cron's rule: when both day fields are restricted, either may match.
  return c.domStar || c.dowStar ? dom && dow : dom || dow;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A wall-clock time as a number: the UTC timestamp that would show these same fields. */
const wallOf = (t: number, tz: string): number => {
  const p = parts(new Date(t), tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
};
/** The zone's offset from UTC at instant `t`, in milliseconds (negative west of Greenwich). */
const offsetAt = (t: number, tz: string): number => wallOf(t, tz) - Math.floor(t / MIN) * MIN;

/**
 * The instant at which a wall-clock time happens in `tz`.
 *
 * - It happens once on almost every day: that instant.
 * - It happens twice when clocks go back: the first of the two.
 * - It never happens when clocks go forward over it: the first minute after
 *   the gap (02:30 on a US spring-forward day gives 03:00 daylight time).
 *
 * Assumes at most one offset change within a day either side of the time.
 */
export function wallToInstant(wall: number, tz: string): number {
  const before = offsetAt(wall - DAY, tz);
  const after = offsetAt(wall + DAY, tz);
  const hits = [wall - before, wall - after].filter((t) => wallOf(t, tz) === wall);
  if (hits.length) return Math.min(...hits);
  // In a gap. `lo` is still on the old offset and `hi` is on the new one; the change is between them.
  let lo = Math.min(wall - before, wall - after);
  let hi = Math.max(wall - before, wall - after);
  const old = offsetAt(lo, tz);
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / MIN / 2) * MIN;
    if (offsetAt(mid, tz) === old) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The first minute strictly after `after` that matches, searching up to 366 days.
 *
 * Across a daylight-saving change, an expression that names its hours ("30 1 * * *")
 * is matched against the wall clock and fires once per wall-clock time: at the first
 * 01:30 when the hour repeats, and at the first minute after the gap when its time is
 * skipped (several matches inside one gap are that same single minute). An expression
 * whose hour field covers every hour ("0 * * * *", "0,30 * * * *") is an interval in
 * disguise and is matched against real elapsed minutes, so it keeps its rhythm through
 * a repeated hour.
 */
export function nextCron(expr: string, after: Date, tz = config.timezone): Date | null {
  const c = parseCron(expr);
  let t = Math.floor(after.getTime() / MIN) * MIN + MIN;
  const end = t + 366 * 24 * 60 * MIN;
  if (c.hour.size < 24) {
    const hours = [...c.hour].sort((a, b) => a - b);
    const minutes = [...c.minute].sort((a, b) => a - b);
    const start = parts(after, tz);
    // Wall times more than a day before `after` cannot map to an instant after it.
    const floor = wallOf(after.getTime(), tz) - DAY;
    // One day before the local date of `after`, because `after` may sit in a repeated hour.
    for (let i = -1; i <= 368; i++) {
      const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
      if (!c.month.has(day.getUTCMonth() + 1) || !dayMatches(c, { d: day.getUTCDate(), dow: day.getUTCDay() })) continue;
      for (const h of hours) {
        for (const mi of minutes) {
          const wall = day.getTime() + (h * 60 + mi) * MIN;
          if (wall < floor) continue;
          const at = wallToInstant(wall, tz);
          if (at > end) return null;
          // Wall times are visited in order and map to instants in the same order, so the first one past `after` is the next.
          if (at >= t) return new Date(at);
        }
      }
    }
    return null;
  }
  // Skips whole days that cannot match, so an expression that never
  // fires costs a few thousand steps, not half a million.
  while (t <= end) {
    const p = parts(new Date(t), tz);
    if (!c.month.has(p.mo) || !dayMatches(c, p)) {
      // To just before the next local midnight; an hour early, so a DST shift cannot carry us past it.
      t += Math.max(1, (23 - p.h) * 60 - p.mi) * MIN + (p.h === 23 ? (59 - p.mi) * MIN : 0);
      continue;
    }
    if (c.minute.has(p.mi)) return new Date(t);
    t += MIN;
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
