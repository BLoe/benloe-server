/**
 * Account rate-limit telemetry — one source, four consumers.
 *
 * Cabinet runs on Ben's Claude Max subscription, so the scarce resource is not
 * dollars, it is the plan's rolling windows: a 5-hour window, a 7-day window,
 * and per-model 7-day windows. Before this module Cabinet had no visibility
 * into any of them and gated on a hardcoded 500,000-token threshold that
 * nobody derived from the plan. That number was an invented denominator, and
 * inventing denominators is how a system ends up confidently wrong.
 *
 * TWO INGEST PATHS, deliberately:
 *   1. PUSH (primary) — `rate_limit_event` messages arrive on the turn stream
 *      during turns Cabinet is already running. Free: no extra request, no
 *      dependency on an experimental control method. Each event carries ONE
 *      window.
 *   2. PULL (supplement) — the SDK's usage control method returns every window
 *      at once. It is flagged EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API
 *      and can vanish in any release, so every call site feature-detects and
 *      degrades to "unknown" rather than to a number.
 *
 * The cardinal rule for everything below: when the data is missing or stale,
 * SAY UNKNOWN. A stale utilization figure is worse than none, because a wrong
 * number does not stay a wrong number — it becomes wrong reasoning about
 * capacity, the same way a UTC timestamp read as local time once became a
 * confabulated two-hour errand.
 */
import type Database from 'better-sqlite3';

/** Windows the SDK reports. Anything unrecognised is stored verbatim anyway. */
export type WindowKey = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage' | (string & {});

export interface WindowState {
  windowKey: WindowKey;
  /** Percentage 0-100, or null when the provider did not report one. */
  utilization: number | null;
  /** ISO 8601, verbatim from the provider. Never recomputed locally. */
  resetsAt: string | null;
  status: string | null;
  source: 'event' | 'poll';
  observedAt: string;
  /** Minutes since observation, computed at read time. */
  ageMinutes: number;
}

/**
 * Past this age a reading is not evidence any more. 90 minutes is three
 * heartbeat ticks: long enough that a quiet stretch does not flap the gate,
 * short enough that a 5-hour window cannot have reset unnoticed.
 */
export const STALE_AFTER_MINUTES = 90;

/**
 * Below this, the per-turn context line stays SILENT.
 *
 * This threshold is a behavioural safeguard, not a display preference. An
 * agent that sees "5h window: 18%" on every single turn starts rationing,
 * hedging, and declining work it has ample capacity for — manufactured
 * caution, which is the exact failure STANDING_ORDERS SO-1 exists to prevent.
 * Resource awareness should alter behaviour only when the resource is
 * genuinely scarce; the rest of the time it is noise that costs judgment.
 */
export const INJECT_FLOOR = 60;

/** Ordering for display: most-likely-to-bind first. */
const WINDOW_ORDER: string[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];

function clampPct(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // The SDK documents utilization as a percentage. Guard the 0-1 fraction case
  // rather than silently reporting 0.71 as "0.71% used".
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    // SDKRateLimitInfo.resetsAt is epoch-based; seconds vs ms is not documented
    // stably, so normalise on magnitude rather than trusting a unit.
    const ms = v > 1e11 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const s = String(v);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : s;
}

function upsert(
  db: Database.Database,
  row: { windowKey: string; utilization: number | null; resetsAt: string | null; status: string | null; source: 'event' | 'poll' },
): void {
  db.prepare(
    `INSERT INTO rate_limit_state (window_key, utilization, resets_at, status, source, observed_at)
     VALUES (@windowKey, @utilization, @resetsAt, @status, @source, datetime('now'))
     ON CONFLICT(window_key) DO UPDATE SET
       utilization = excluded.utilization,
       resets_at   = excluded.resets_at,
       status      = excluded.status,
       source      = excluded.source,
       observed_at = excluded.observed_at`,
  ).run(row);
  db.prepare(
    `INSERT INTO rate_limit_sample (window_key, utilization, resets_at, status, source)
     VALUES (@windowKey, @utilization, @resetsAt, @status, @source)`,
  ).run(row);
}

/**
 * Ingest one `rate_limit_event` off the turn stream (SDKRateLimitInfo).
 *
 * Shaped defensively: this runs inside the hot message loop of every turn, so
 * a surprising payload must never throw and kill the turn. An event with no
 * recognisable window is dropped rather than stored under a guessed key.
 */
export function recordRateLimitEvent(db: Database.Database, info: unknown): void {
  try {
    const i = info as Record<string, unknown> | null;
    if (!i || typeof i !== 'object') return;
    const windowKey = typeof i.rateLimitType === 'string' ? i.rateLimitType : null;
    if (!windowKey) return;
    upsert(db, {
      windowKey,
      utilization: clampPct(i.utilization),
      resetsAt: isoOrNull(i.resetsAt),
      status: typeof i.status === 'string' ? i.status : null,
      source: 'event',
    });
    // Overage is a separate ceiling with its own reset clock; when the payload
    // carries it, it is a distinct window rather than a property of this one.
    if (i.isUsingOverage || i.overageInUse || i.overageStatus) {
      upsert(db, {
        windowKey: 'overage',
        utilization: clampPct((i as Record<string, unknown>).overageUtilization),
        resetsAt: isoOrNull(i.overageResetsAt),
        status: typeof i.overageStatus === 'string' ? i.overageStatus : null,
        source: 'event',
      });
    }
  } catch {
    /* telemetry must never break a turn */
  }
}

/**
 * Ingest a full usage snapshot from the experimental pull.
 *
 * `rate_limits_available` is false for API-key / Bedrock / Vertex auth, in
 * which case there is genuinely nothing to record and we must not invent a
 * zero. Returns whether anything was stored, so callers can distinguish
 * "polled, no limits on this auth mode" from "poll failed".
 */
export function recordUsageSnapshot(db: Database.Database, usage: unknown): boolean {
  try {
    const u = usage as Record<string, any> | null;
    if (!u || u.rate_limits_available === false || !u.rate_limits) return false;
    const limits = u.rate_limits as Record<string, any>;
    let wrote = false;
    for (const [key, val] of Object.entries(limits)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      if (key === 'extra_usage') {
        if (val.is_enabled) {
          upsert(db, {
            windowKey: 'overage',
            utilization: clampPct(val.utilization),
            resetsAt: null,
            status: null,
            source: 'poll',
          });
          wrote = true;
        }
        continue;
      }
      upsert(db, {
        windowKey: key,
        utilization: clampPct(val.utilization),
        resetsAt: isoOrNull(val.resets_at),
        status: null,
        source: 'poll',
      });
      wrote = true;
    }
    for (const m of (limits.model_scoped as any[] | undefined) ?? []) {
      if (!m?.display_name) continue;
      upsert(db, {
        windowKey: `model:${m.display_name}`,
        utilization: clampPct(m.utilization),
        resetsAt: isoOrNull(m.resets_at),
        status: null,
        source: 'poll',
      });
      wrote = true;
    }
    return wrote;
  } catch {
    return false;
  }
}

export function readWindows(db: Database.Database, now = new Date()): WindowState[] {
  const rows = db
    .prepare(`SELECT window_key, utilization, resets_at, status, source, observed_at FROM rate_limit_state`)
    .all() as Array<Record<string, any>>;
  return rows
    .map((r) => {
      // observed_at is written by SQLite's datetime('now'), which is UTC
      // without a zone marker; parsing it as local would skew the age by the
      // UTC offset and quietly make fresh readings look stale.
      const observed = new Date(`${String(r.observed_at).replace(' ', 'T')}Z`);
      const ageMinutes = Math.max(0, (now.getTime() - observed.getTime()) / 60000);
      return {
        windowKey: r.window_key as string,
        utilization: r.utilization == null ? null : Number(r.utilization),
        resetsAt: r.resets_at ?? null,
        status: r.status ?? null,
        source: (r.source as 'event' | 'poll') ?? 'event',
        observedAt: r.observed_at as string,
        ageMinutes,
      };
    })
    .sort((a, b) => {
      const ai = WINDOW_ORDER.indexOf(a.windowKey);
      const bi = WINDOW_ORDER.indexOf(b.windowKey);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.windowKey.localeCompare(b.windowKey);
    });
}

export interface Capacity {
  windows: WindowState[];
  /** Highest utilization across fresh windows, or null when nothing is fresh. */
  worst: number | null;
  worstWindow: string | null;
  /** True when there is no usable reading at all (never observed, or all stale). */
  unknown: boolean;
  /** True when any fresh window reports a warning/rejected status. */
  warned: boolean;
}

export function capacity(db: Database.Database, now = new Date()): Capacity {
  const windows = readWindows(db, now);
  const fresh = windows.filter((w) => w.ageMinutes <= STALE_AFTER_MINUTES);
  const scored = fresh.filter((w) => w.utilization != null);
  let worst: number | null = null;
  let worstWindow: string | null = null;
  for (const w of scored) {
    if (worst == null || (w.utilization as number) > worst) {
      worst = w.utilization as number;
      worstWindow = w.windowKey;
    }
  }
  return {
    windows,
    worst,
    worstWindow,
    unknown: worst == null,
    warned: fresh.some((w) => w.status === 'allowed_warning' || w.status === 'rejected'),
  };
}

function resetHint(resetsAt: string | null, now: Date): string {
  if (!resetsAt) return '';
  const d = new Date(resetsAt);
  if (!Number.isFinite(d.getTime())) return '';
  if (d.getTime() <= now.getTime()) return ' (reset due)';
  return ` (resets ${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)})`;
}

/**
 * The per-turn context line, or null when there is nothing worth saying.
 *
 * Silent below INJECT_FLOOR by design (see that constant). Always carries
 * observation age, because the number without its freshness is exactly the
 * kind of confident-but-stale fact that produces bad reasoning downstream.
 */
export function capacityLine(db: Database.Database, now = new Date()): string | null {
  const cap = capacity(db, now);
  if (cap.unknown) return null; // nothing observed yet — say nothing rather than guess
  if (!cap.warned && (cap.worst ?? 0) < INJECT_FLOOR) return null;
  const parts = cap.windows
    .filter((w) => w.utilization != null && w.ageMinutes <= STALE_AFTER_MINUTES)
    .slice(0, 4)
    .map((w) => `${w.windowKey} ${Math.round(w.utilization as number)}%${resetHint(w.resetsAt, now)}`);
  const age = Math.round(Math.min(...cap.windows.map((w) => w.ageMinutes)));
  const warn = cap.warned ? ' — provider reports a warning state.' : '';
  return `Account limits: ${parts.join(', ')}. Observed ${age}m ago.${warn} Stated as fact, not as an instruction to conserve.`;
}
