import { useCallback, useEffect, useState } from 'react';
import { api, type TodayView, type AttentionItem, type AttentionAction, type BriefingOutput, type CheckinOutput } from '../lib/cabinet.js';
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
 * NY-local clock, e.g. "6:32 AM" — the always-on timestamp that anchors the
 * real briefing/checkin as a fact about a specific moment, not a silent
 * stand-in for "right now" (mentorship: Today surface durability, staleness
 * as a first-class visual state). Deliberately duplicates surfaces.ts's
 * formatClock rather than sharing it — this file's own header note on
 * TodayView documents the server/web boundary as hand-mirrored on purpose.
 */
function formatClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function daysAgo(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(1, Math.round((Date.now() - then) / 86_400_000));
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
        /* command failures surface in the chat, not here */
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

  const { greeting, greetingAccent, read, attention, vitals, overnight, sweptAt, briefing, checkin } = view;

  // Cosmetic ordering only (no correctness dependency, unlike briefing/checkin's
  // server-computed isCurrent) — the checkin card is promoted directly under
  // the hero once evening's underway, otherwise it sits after Vitals.
  const evening = new Date().getHours() >= 17;
  const checkinCard = checkin && <CheckinCard checkin={checkin} />;

  return (
    <div className="today">
      {/* 1 — the hero: real briefing when it exists, template as the true empty state */}
      <BriefingHero briefing={briefing} greeting={greeting} greetingAccent={greetingAccent} read={read} />

      {evening && checkinCard}

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

      {!evening && checkinCard}

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

/**
 * The hero narrative zone. Three explicit states, never a silent/faked one
 * (mentorship: Today surface durability):
 *  - real + current  → the actual briefing narrative, always-on timestamp eyebrow
 *  - real + stale     → same narrative, demoted color + an explicit "days ago" label
 *  - absent           → today's original template block, byte-for-byte — the
 *                        true empty state; never silently swapped in for real content.
 */
function BriefingHero({
  briefing,
  greeting,
  greetingAccent,
  read,
}: {
  briefing: BriefingOutput | null;
  greeting: string;
  greetingAccent?: string;
  read: string;
}) {
  if (!briefing) {
    return (
      <header className="today__briefing">
        <h1>
          {greeting}
          {greetingAccent && <em className="today__accent"> {greetingAccent}</em>}
        </h1>
        <p className="today__read voice">{read}</p>
      </header>
    );
  }
  const stale = !briefing.isCurrent;
  return (
    <header className={`today__briefing today__briefing--real${stale ? ' is-stale' : ''}`}>
      <div className="today__briefing-cap label">
        <span>Briefing · {formatClock(briefing.at)}</span>
        {stale && (
          <span className="today__stale-tag">
            last briefing: {daysAgo(briefing.at)} day{daysAgo(briefing.at) === 1 ? '' : 's'} ago
          </span>
        )}
      </div>
      <p className="today__read voice today__briefing-narrative">{briefing.narrative}</p>
    </header>
  );
}

/**
 * Supporting card, not a second hero (checkin is a metrics widget, not a
 * narrative — confirmed against scheduler/jobs.ts before this shape was
 * agreed). Omitted entirely by the caller when absent — a "no check-in yet"
 * placeholder would compete for attention a supporting element hasn't earned.
 */
function CheckinCard({ checkin }: { checkin: CheckinOutput }) {
  return (
    <section className="today__section today__checkin">
      <div className="section-label">
        <span>Check-in</span>
        {checkin.isCurrent && <span className="today__checkin-time">{formatClock(checkin.at)}</span>}
      </div>
      <div className="today__vitals">
        {checkin.vitals.map((spec, i) => (
          <Instrument key={`${spec.kind}-${spec.label}-${i}`} spec={spec} />
        ))}
      </div>
      <p className="today__checkin-prompt voice">{checkin.prompt}</p>
    </section>
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
