import { useEffect, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { OpsEntry, OpsKind, UsageDay, UsageWindow, InstrumentSpec } from '../lib/cabinet.js';
import { Instrument, SectionLabel } from '../components/instruments/index.js';
import './ops.css';

/**
 * OPS surface — the trust ledger. Every action Cabinet takes is on the record
 * here: reverse-chronological, with the reason it acted, what tripped it
 * (user / heartbeat / cron), the tier it ran at, and the result. Reversible
 * actions carry a Revert. This is what makes "no approval gates" legible —
 * the accountability lives after the fact, not in a wall of confirmations.
 */

type Filter = 'all' | OpsKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'cron', label: 'Cron' },
];

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse the wall-clock time literally from the ISO string (deterministic —
 *  no dependence on the runner's timezone). */
function stamp(iso: string): { day: string; time: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return { day: '', time: iso };
  const mo = MONTHS[Number(m[2])] ?? '';
  const day = Number(m[3]);
  return { day: `${mo} ${day}`, time: `${m[4]}:${m[5]}` };
}

const EMPTY_COPY: Record<Filter, string> = {
  all: 'Nothing on the ledger yet. When I act, it lands here.',
  user: 'No actions from you on the record — nothing you kicked off has run.',
  heartbeat: 'The heartbeat has done nothing worth logging.',
  cron: 'No scheduled work has run in this window.',
};

/* ---------- usage card: "is the system healthy" + "are we near a wall" ---------- */

const WINDOW_LABEL: Record<UsageWindow['window'], string> = { '5h': '5h window', '24h': '24h window', '7d': '7d window' };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtRatio(r: number | null): string {
  if (r === null) return '—';
  return r >= 100 ? `${Math.round(r)}×` : `${r.toFixed(1)}×`;
}

/** High read:write is healthy (reusing a stable prefix); collapsing toward
 *  1 is the regression signal — the cache is being busted every turn. */
function ratioTone(r: number | null): 'default' | 'ok' | 'warn' | 'crit' {
  if (r === null) return 'default';
  if (r >= 20) return 'ok';
  if (r >= 5) return 'warn';
  return 'crit';
}

/** Sum multi-model rows per day, then the last 7 distinct days oldest→newest
 *  — chronological so the sparkline reads left-to-right and today lands on
 *  the emphasized final point. */
function cacheWriteTrend(byDay: UsageDay[]): number[] {
  const perDay = new Map<string, number>();
  for (const row of byDay) perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.cache_write);
  return [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([, v]) => v);
}

function buildUsageSpecs(byDay: UsageDay[], windows: UsageWindow[]): { specs: InstrumentSpec[]; costLine: string } | null {
  if (windows.length === 0) return null;
  const byId = Object.fromEntries(windows.map((w) => [w.window, w])) as Record<UsageWindow['window'], UsageWindow>;
  // Headline ratio: prefer the freshest window that actually has data.
  const headline = byId['5h']?.cacheReadWriteRatio ?? byId['24h']?.cacheReadWriteRatio ?? byId['7d']?.cacheReadWriteRatio ?? null;
  const tone = ratioTone(headline);
  const trend = cacheWriteTrend(byDay);
  const headlineWindow = byId['5h'] ?? byId['24h'] ?? byId['7d'];

  const specs: InstrumentSpec[] = [
    {
      kind: 'stat',
      label: 'Cache health',
      tag: headline === null ? undefined : tone === 'ok' ? 'reusing well' : tone === 'warn' ? 'watch it' : 'churning',
      tagTone: tone === 'default' ? undefined : tone,
      big: fmtRatio(headline),
      unit: 'read : write',
      sub: headlineWindow ? `${fmtTokens(headlineWindow.cache_read)} read / ${fmtTokens(headlineWindow.cache_write)} write` : 'no data yet',
      tone,
      points: trend.length > 1 ? trend : undefined,
      pointsColor: tone === 'ok' ? 'var(--patina)' : tone === 'crit' ? 'var(--vermilion)' : 'var(--brass)',
    },
    ...(['5h', '24h', '7d'] as const).map((id): InstrumentSpec => {
      const w = byId[id];
      const fresh = w ? w.input + w.output + w.cache_write : 0;
      return {
        kind: 'stat',
        label: WINDOW_LABEL[id],
        big: fmtTokens(fresh),
        unit: 'tokens fresh',
        sub: w ? `${fmtTokens(w.cache_read)} reused via cache · ${w.turns} turn${w.turns === 1 ? '' : 's'}` : 'no data yet',
      };
    }),
  ];

  const dayCost = byId['24h']?.cost_usd ?? 0;
  const costLine = `API-rate equivalent (24h): $${dayCost.toFixed(2)} — you're on Max, not billed per-token.`;
  return { specs, costLine };
}

export function Ops() {
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<OpsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<Record<string, boolean>>({});
  const [usage, setUsage] = useState<{ specs: InstrumentSpec[]; costLine: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.usage(), api.usageRolling()])
      .then(([byDayView, rollingView]) => {
        if (!live) return;
        setUsage(buildUsageSpecs(byDayView.byDay, rollingView.windows));
      })
      .catch(() => {
        if (live) setUsage(null);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .ops(filter === 'all' ? undefined : { kind: filter })
      .then((feed) => {
        if (!live) return;
        // Guarantee reverse-chronological regardless of source ordering.
        const sorted = [...feed.entries].sort((a, b) => b.at.localeCompare(a.at));
        setEntries(sorted);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setEntries(null);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [filter]);

  async function revert(id: string) {
    setReverting((r) => ({ ...r, [id]: true }));
    try {
      const res = await api.revertOp(id);
      if (res.ok) {
        setEntries((prev) =>
          prev ? prev.map((e) => (e.id === id ? { ...e, reverted: true } : e)) : prev,
        );
      }
    } finally {
      setReverting((r) => {
        const { [id]: _drop, ...rest } = r;
        return rest;
      });
    }
  }

  return (
    <section className="ops" aria-label="Operations ledger">
      <header className="ops-head">
        <div>
          <SectionLabel n="00">On the record</SectionLabel>
          <p className="ops-lede voice">
            Every action I take, in order. No gate up front — the accountability is here.
          </p>
        </div>
        <nav className="ops-filter" aria-label="Filter by trigger">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`ops-fpill${f.id === filter ? ' active' : ''}`}
              aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </nav>
      </header>

      {usage && (
        <section className="ops-usage" aria-label="Usage">
          <SectionLabel>Usage</SectionLabel>
          <div className="ops-usage-grid">
            {usage.specs.map((spec, i) => (
              <Instrument key={`usage-${i}`} spec={spec} />
            ))}
          </div>
          <p className="ops-usage-cost data">{usage.costLine}</p>
        </section>
      )}

      {loading && !entries ? (
        <p className="ops-loading data">Pulling the ledger…</p>
      ) : entries && entries.length > 0 ? (
        <ol className={`ops-feed${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          {entries.map((e) => {
            const { day, time } = stamp(e.at);
            const busy = Boolean(reverting[e.id]);
            return (
              <li key={e.id} className={`ops-row${e.reverted ? ' reverted' : ''}`}>
                <div className="ops-when data" aria-label={`${day} ${time}`}>
                  <span className="ops-time">{time}</span>
                  <span className="ops-day">{day}</span>
                </div>

                <div className="ops-main">
                  <div className="ops-action">
                    <span className="ops-tool data">{e.tool}</span>
                    <span className="ops-verb">{e.action}</span>
                  </div>
                  <p className="ops-reason">{e.reason}</p>
                  {e.diff && (
                    <pre className="ops-diff data" aria-label="change">
                      {e.diff}
                    </pre>
                  )}
                  <p className="ops-result data">{e.result}</p>
                </div>

                <div className="ops-side">
                  <div className="ops-chips">
                    <span className={`ops-chip kind ${e.kind}`}>{e.kind}</span>
                    <span className="ops-chip tier" title={`Tier ${e.tier}`}>
                      T{e.tier}
                    </span>
                  </div>
                  {e.reversible &&
                    (e.reverted ? (
                      <span className="ops-reverted data">reverted</span>
                    ) : (
                      <button
                        type="button"
                        className="ops-revert"
                        disabled={busy}
                        onClick={() => revert(e.id)}
                      >
                        {busy ? 'Reverting…' : 'Revert'}
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>
      ) : entries ? (
        <p className="ops-empty voice">{EMPTY_COPY[filter]}</p>
      ) : (
        <p className="ops-empty voice">Couldn't reach the ledger. It'll be here when the line's back.</p>
      )}
    </section>
  );
}
