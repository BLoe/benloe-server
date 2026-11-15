// Formatters shared by every page. All take explicit inputs (and an optional
// time zone / "now") so they can be tested without a clock.

const LOCALE = 'en-US';

/** $1,234.56 — or $1,235 with `cents: false`. Negative amounts read "-$12.00". */
export function money(amount: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const digits = opts.cents === false ? 0 : 2;
  const abs = Math.abs(amount).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${amount < 0 ? '-' : ''}$${abs}`;
}

/** What a model call cost: small amounts keep the digits that matter. */
export function cost(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.001) return '<$0.001';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;
}

/** 1.2 s, 340 ms, 2 min 5 s */
export function duration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const min = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${min} min ${s} s` : `${min} min`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));

/** 6:05 PM */
export function clock(v: string | Date, timeZone?: string): string {
  return toDate(v).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone });
}

/** Sat, Nov 14 (with the year when it is not this year) */
export function shortDate(v: string | Date, timeZone?: string, now = new Date()): string {
  const d = toDate(v);
  const sameYear = d.toLocaleDateString(LOCALE, { year: 'numeric', timeZone }) === now.toLocaleDateString(LOCALE, { year: 'numeric', timeZone });
  return d.toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone });
}

/** Saturday, November 14 */
export function longDate(v: string | Date, timeZone?: string): string {
  return toDate(v).toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', timeZone });
}

const dayKey = (d: Date, timeZone?: string): string => d.toLocaleDateString('en-CA', { timeZone });

/** Calendar days from `now` to `v` in the given zone: 0 today, 1 tomorrow, -1 yesterday. */
export function dayDiff(v: string | Date, now = new Date(), timeZone?: string): number {
  const a = Date.parse(`${dayKey(toDate(v), timeZone)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(now, timeZone)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** "Today 6:05 PM", "Tomorrow 9:00 AM", "Yesterday 6:05 PM", else "Sat, Nov 14, 6:05 PM". */
export function dateTime(v: string | Date | null | undefined, now = new Date(), timeZone?: string): string {
  if (!v) return '—';
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = dayDiff(d, now, timeZone);
  const t = clock(d, timeZone);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  if (diff === -1) return `Yesterday ${t}`;
  return `${shortDate(d, timeZone, now)}, ${t}`;
}

/** "just now", "5 min ago", "in 3 hr", "2 days ago"; beyond a week, the date. */
export function relativeTime(v: string | Date | null | undefined, now = new Date(), timeZone?: string): string {
  if (!v) return '—';
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return '—';
  const ms = d.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const wrap = (s: string) => (ms < 0 ? `${s} ago` : `in ${s}`);
  if (abs < 45_000) return ms <= 0 ? 'just now' : 'in a moment';
  if (abs < 3_600_000) return wrap(`${Math.max(1, Math.round(abs / 60_000))} min`);
  if (abs < 86_400_000) return wrap(`${Math.round(abs / 3_600_000)} hr`);
  if (abs < 7 * 86_400_000) {
    const days = Math.round(abs / 86_400_000);
    return wrap(`${days} ${days === 1 ? 'day' : 'days'}`);
  }
  return shortDate(d, timeZone, now);
}

/** relativeTime for something that has already happened: a clock a few seconds behind never makes it read "in 1 min". */
export function ago(v: string | Date | null | undefined, now = new Date(), timeZone?: string): string {
  if (!v) return '—';
  const d = toDate(v);
  return relativeTime(d, d.getTime() > now.getTime() ? d : now, timeZone);
}

/** A calendar date stored as YYYY-MM-DD: "Today", "Tomorrow", "Yesterday", else "Sat, Nov 14". */
export function calendarDay(day: string | null | undefined, today: string): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—';
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

/** Today's date as YYYY-MM-DD in a zone (the server stores calendar dates in Ben's). */
export function localDay(now = new Date(), timeZone?: string): string {
  return dayKey(now, timeZone);
}

export function greeting(now = new Date(), timeZone?: string): string {
  const hour = Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone }).slice(0, 2)) % 24;
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** `pantry_update` -> "Pantry update" */
export function toolLabel(name: string): string {
  const s = name.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Model ids are long; the family name is what Ben recognises. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return '';
  const m = /(opus|sonnet|haiku|fable)/i.exec(model);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : model;
}
