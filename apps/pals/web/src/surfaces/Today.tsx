import { useCallback, useEffect, useState } from 'react';
import { api, type TodayView, type AttentionItem, type AttentionAction } from '../lib/cabinet.js';
import { Instrument, Card, SectionLabel } from '../components/instruments/index.js';
import './today.css';

/** How long ago the last sweep ran, in Cabinet's terse register. */
function sweptAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'a moment ago';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'moments ago';
  if (mins === 1) return 'a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? 'an hour ago' : `${hrs} hours ago`;
}

/**
 * TODAY — the home "what needs you" view. Briefing in Cabinet's voice, the
 * short list of things that actually need Ben, then the day's vitals and an
 * overnight line. Not a dashboard for its own sake: a triage.
 */
export function Today({ onNavigate }: { onNavigate?: (surface: 'ops') => void }) {
  const [view, setView] = useState<TodayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .today()
      .then((v) => {
        if (alive) setView(v);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not reach the desk.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const runAction = useCallback((action: AttentionAction) => {
    setFiring(action.intent);
    api
      .command(action.intent)
      .catch(() => {
        /* command failures surface in the thread, not here */
      })
      .finally(() => setFiring(null));
  }, []);

  if (error) {
    return (
      <div className="today today--message">
        <p className="today__nothing voice">Can't reach the desk right now. {error}</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="today today--message">
        <p className="today__loading label">Pulling the day together…</p>
      </div>
    );
  }

  const { greeting, greetingAccent, read, attention, vitals, overnight, sweptAt } = view;

  return (
    <div className="today">
      {/* 1 — the briefing */}
      <header className="today__briefing">
        <h1>
          {greeting}
          {greetingAccent && <em className="today__accent"> {greetingAccent}</em>}
        </h1>
        <p className="today__read voice">{read}</p>
      </header>

      {/* 2 — what needs you */}
      <section className="today__section">
        <SectionLabel n={attention.length}>Need you today</SectionLabel>
        {attention.length === 0 ? (
          <p className="today__nothing voice">
            Nothing needs you. Swept everything {sweptAgo(sweptAt)}.
          </p>
        ) : (
          <div className="today__attention">
            {attention.map((item) => (
              <AttentionCard key={item.id} item={item} firing={firing} onAction={runAction} />
            ))}
          </div>
        )}
      </section>

      {/* 3 — the day's vitals */}
      {vitals.length > 0 && (
        <section className="today__section">
          <SectionLabel>Vitals</SectionLabel>
          <div className="today__vitals">
            {vitals.map((spec, i) => (
              <Instrument key={`${spec.kind}-${spec.label}-${i}`} spec={spec} />
            ))}
          </div>
        </section>
      )}

      {/* 4 — overnight */}
      {overnight && (
        <p className="today__overnight">
          <span className="today__overnight-count">{overnight.count}</span> overnight —{' '}
          {overnight.summary}.{' '}
          <button type="button" className="today__oplink" onClick={() => onNavigate?.('ops')}>
            See Ops →
          </button>
        </p>
      )}
    </div>
  );
}

function AttentionCard({
  item,
  firing,
  onAction,
}: {
  item: AttentionItem;
  firing: string | null;
  onAction: (action: AttentionAction) => void;
}) {
  return (
    <Card severity={item.severity} className="attn">
      <div className="attn__head">
        {item.badge && <span className="attn__badge" aria-hidden="true">{item.badge}</span>}
        <div className="attn__headline">
          <div className="attn__title">{item.title}</div>
          {item.meta && <div className="attn__meta">{item.meta}</div>}
        </div>
      </div>
      <p className="attn__detail voice">{item.detail}</p>
      {item.actions.length > 0 && (
        <div className="attn__actions">
          {item.actions.map((action) => (
            <button
              key={action.intent}
              type="button"
              className={`attn__action${action.primary ? ' primary' : ''}`}
              disabled={firing === action.intent}
              onClick={() => onAction(action)}
            >
              {firing === action.intent ? 'Working…' : action.label}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
