import { useEffect, useState } from 'react';
import { api, DOMAINS } from '../lib/cabinet.js';
import type { DomainId, DomainView } from '../lib/cabinet.js';
import { Instrument, SectionLabel } from '../components/instruments/index.js';
import './domains.css';

/**
 * DOMAINS surface — the seven standing domains, each rendered to one template:
 * instruments up top, the agent's written read in the middle, the log at the
 * bottom. A brass pill row switches between them.
 */
export function Domains() {
  const [selected, setSelected] = useState<DomainId>('nutrition');
  const [view, setView] = useState<DomainView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .domain(selected)
      .then((v) => {
        if (live) {
          setView(v);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selected]);

  return (
    <section className="dom" aria-label="Domains">
      <nav className="dom-switch" aria-label="Domain switcher">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`dom-pill${d.id === selected ? ' active' : ''}`}
            aria-pressed={d.id === selected}
            onClick={() => setSelected(d.id)}
          >
            {d.label}
          </button>
        ))}
      </nav>

      {loading && !view ? (
        <p className="dom-loading data">Reading {DOMAINS.find((d) => d.id === selected)?.label ?? selected}…</p>
      ) : view ? (
        <div className={`dom-body${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          <SectionLabel n="01">Vitals</SectionLabel>
          {view.instruments.length > 0 ? (
            <div className="dom-instruments">
              {view.instruments.map((spec, i) => (
                <Instrument key={`${view.id}-${i}`} spec={spec} />
              ))}
            </div>
          ) : (
            <p className="dom-empty voice">No instruments standing for this domain yet.</p>
          )}

          <SectionLabel n="02">Read</SectionLabel>
          {view.narrative ? (
            <div className="dom-narrative">
              <p className="voice">{view.narrative}</p>
            </div>
          ) : (
            <p className="dom-empty voice">Nothing to read here — quiet on this front.</p>
          )}

          <SectionLabel n="03">Log</SectionLabel>
          {view.log.length > 0 ? (
            <ul className="dom-log">
              {view.log.map((row) => (
                <li key={row.id} className="dom-log-row">
                  <span className="dom-log-at data">{row.at}</span>
                  <span className="dom-log-text">{row.text}</span>
                  {row.meta && <span className="dom-log-meta data">{row.meta}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dom-empty voice">Nothing logged here yet.</p>
          )}
        </div>
      ) : (
        <p className="dom-empty voice">Couldn't reach that domain. It'll be here when the line's back.</p>
      )}
    </section>
  );
}
