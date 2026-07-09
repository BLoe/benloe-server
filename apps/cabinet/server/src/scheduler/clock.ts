/**
 * DST-safe wall-clock math for America/New_York (§11). Hand-rolled on Intl:
 * convert a NY wall time to the UTC instant by iterative correction — two
 * passes converge for any real offset, including across DST transitions.
 * Spring-forward nonexistent times resolve to the corrected later instant;
 * fall-back ambiguous times resolve to one consistent occurrence.
 */

const NY = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

export interface NyParts {
  y: number; m: number; d: number; hh: number; mm: number; ss: number;
  /** 0=Sunday … 6=Saturday */
  dow: number;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nyParts(date: Date): NyParts {
  const map: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(date)) map[p.type] = p.value;
  return {
    y: Number(map.year), m: Number(map.month), d: Number(map.day),
    hh: Number(map.hour), mm: Number(map.minute), ss: Number(map.second),
    dow: DOW[map.weekday!] ?? 0,
  };
}

/** UTC instant for a NY wall time (y,m,d may overflow — Date.UTC normalizes). */
export function nyWallToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  for (let i = 0; i < 3; i++) {
    const p = nyParts(guess);
    const gotAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    const wantAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
    const diff = wantAsUtc - gotAsUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Next occurrence of hh:mm NY time strictly after `from`. */
export function nextDaily(hh: number, mm: number, from: Date): Date {
  const p = nyParts(from);
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = nyWallToUtc(p.y, p.m, p.d + offset, hh, mm);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  /* c8 ignore next */
  throw new Error('nextDaily failed to converge');
}

/** Next occurrence of dow (0=Sun) at hh:mm NY time strictly after `from`. */
export function nextWeekly(dow: number, hh: number, mm: number, from: Date): Date {
  const p = nyParts(from);
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = nyWallToUtc(p.y, p.m, p.d + offset, hh, mm);
    if (candidate.getTime() > from.getTime() && nyParts(candidate).dow === dow) return candidate;
  }
  /* c8 ignore next */
  throw new Error('nextWeekly failed to converge');
}

/** Next heartbeat tick: every `intervalMin` inside 07:00–23:00 NY, else 07:00. */
export function nextHeartbeat(intervalMin: number, from: Date): Date {
  const naive = new Date(from.getTime() + intervalMin * 60_000);
  const p = nyParts(naive);
  if (p.hh >= 7 && p.hh < 23) return naive;
  // outside active hours → next 07:00 NY
  return nextDaily(7, 0, naive.getTime() > from.getTime() ? new Date(naive.getTime() - 1) : from);
}
