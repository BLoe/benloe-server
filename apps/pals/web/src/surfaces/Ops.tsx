import { useEffect, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { OpsEntry, OpsKind } from '../lib/cabinet.js';
import { SectionLabel } from '../components/instruments/index.js';
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

export function Ops() {
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<OpsEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<Record<string, boolean>>({});

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
