// Schedule triggers in words, and the form's cron builder. The server's cron
// dialect is standard 5-field (server/src/time.ts), evaluated in Ben's zone.
import { dateTime } from './format';
import type { TriggerType } from './types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "18", "5" -> "6:05 PM" */
export function time12(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Expands "1,3-5" to [1,3,4,5]. Null for "*", steps, or anything out of range. */
function values(src: string, lo: number, hi: number): number[] | null {
  if (src === '*') return null;
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

const step = (src: string): number | null => {
  const m = /^\*\/(\d+)$/.exec(src);
  return m ? Number(m[1]) : null;
};

function daysPhrase(dow: number[]): string {
  const set = [...new Set(dow.map((d) => d % 7))].sort((a, b) => a - b);
  const key = set.join(',');
  if (set.length === 7) return 'Every day';
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return list(set.map((d) => `${DAYS[d]}s`));
}

/** A cron expression in words; falls back to the expression itself for the unusual ones. */
export function humanizeCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  const raw = `Cron ${expr.trim()}`;
  if (f.length !== 5) return raw;
  const [mi, h, dom, mon, dow] = f as [string, string, string, string, string];
  const anyDay = dom === '*' && mon === '*' && dow === '*';

  const everyMin = mi === '*' ? 1 : step(mi);
  if (everyMin && h === '*' && anyDay) return everyMin === 1 ? 'Every minute' : `Every ${everyMin} minutes`;

  const minutes = values(mi, 0, 59);
  if (!minutes || minutes.length !== 1) return raw;
  const minute = minutes[0]!;
  const past = `:${String(minute).padStart(2, '0')}`;
  if (h === '*' && anyDay) return minute === 0 ? 'Every hour' : `Every hour at ${past}`;
  const everyHour = step(h);
  if (everyHour && anyDay) return `Every ${everyHour} hours${minute === 0 ? '' : ` at ${past}`}`;

  const hours = values(h, 0, 23);
  if (!hours || hours.length > 4) return raw;
  const at = `at ${list(hours.map((x) => time12(x, minute)))}`;

  const dows = values(dow, 0, 7);
  const doms = values(dom, 1, 31);
  const mons = values(mon, 1, 12);
  if (dow !== '*' && !dows) return raw;
  if (dom !== '*' && !doms) return raw;
  if (mon !== '*' && !mons) return raw;

  if (!doms && !mons) return `${dows ? daysPhrase(dows) : 'Every day'} ${at}`;
  if (doms && !dows) {
    const days = list(doms.map(ordinal));
    if (!mons) return `On the ${days} of every month ${at}`;
    if (mons.length === 1) return `Every ${MONTHS[mons[0]! - 1]} ${days} ${at}`;
    return `On the ${days} of ${list(mons.map((m) => MONTHS[m - 1]!))} ${at}`;
  }
  return raw;
}

export function humanizeInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return 'Interval not set';
  if (minutes === 1) return 'Every minute';
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

/** A schedule's trigger in words. `now` and `timeZone` only matter for one-time triggers. */
export function humanizeTrigger(type: TriggerType | string, value: string, now = new Date(), timeZone?: string): string {
  if (type === 'cron') return humanizeCron(value);
  if (type === 'interval') return humanizeInterval(Number(value));
  if (type === 'once') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? `Once: ${value}` : `Once, ${dateTime(d, now, timeZone)}`;
  }
  return `${type} ${value}`;
}

/** System jobs report "cron 30 3 * * *" or "every 10 min". */
export function humanizeCadence(cadence: string): string {
  const cron = /^cron\s+(.+)$/.exec(cadence);
  if (cron) return humanizeCron(cron[1]!);
  const every = /^every\s+(\d+)\s*min$/.exec(cadence);
  if (every) return humanizeInterval(Number(every[1]));
  return cadence;
}

// ---- the form's cron builder -------------------------------------------------

export type Repeat = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface CronForm {
  repeat: Repeat;
  /** HH:MM, 24-hour, as <input type="time"> gives it. */
  time: string;
  /** weekly: 0 = Sunday … 6 = Saturday */
  days: number[];
  /** monthly: day of the month */
  dayOfMonth: number;
  /** custom: the raw expression */
  expr: string;
}

export const defaultCronForm: CronForm = { repeat: 'daily', time: '09:00', days: [1], dayOfMonth: 1, expr: '0 9 * * *' };

export function cronFromForm(f: CronForm): string {
  if (f.repeat === 'custom') return f.expr.trim();
  const [h, m] = f.time.split(':').map(Number);
  const head = `${m ?? 0} ${h ?? 9}`;
  if (f.repeat === 'weekly') return `${head} * * ${[...new Set(f.days)].sort((a, b) => a - b).join(',') || '*'}`;
  if (f.repeat === 'monthly') return `${head} ${f.dayOfMonth} * *`;
  return `${head} * * *`;
}

/** Reads an expression back into the builder; anything it cannot express becomes "custom". */
export function formFromCron(expr: string): CronForm {
  const custom: CronForm = { ...defaultCronForm, repeat: 'custom', expr: expr.trim() };
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return custom;
  const [mi, h, dom, mon, dow] = f as [string, string, string, string, string];
  if (!/^\d+$/.test(mi) || !/^\d+$/.test(h) || mon !== '*') return custom;
  if (Number(mi) > 59 || Number(h) > 23) return custom;
  const base = { ...defaultCronForm, expr: expr.trim(), time: `${h.padStart(2, '0')}:${mi.padStart(2, '0')}` };
  if (dom === '*' && dow === '*') return { ...base, repeat: 'daily' };
  if (dom === '*') {
    const days = values(dow, 0, 7);
    return days ? { ...base, repeat: 'weekly', days: [...new Set(days.map((d) => d % 7))].sort((a, b) => a - b) } : custom;
  }
  if (dow === '*' && /^\d+$/.test(dom) && Number(dom) >= 1 && Number(dom) <= 31) return { ...base, repeat: 'monthly', dayOfMonth: Number(dom) };
  return custom;
}

/** An ISO time -> the value an <input type="datetime-local"> shows (browser's zone). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The reverse: the field's local wall-clock time as an absolute ISO time. */
export function localInputToIso(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

