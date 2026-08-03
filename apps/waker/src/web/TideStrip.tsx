import { humanDuration, tidePath, type CyclePosition } from '../lib/analysis/cycle';

/**
 * The signature: the fantasy week as a tide.
 *
 * This is the app's whole argument in one band. Agency floods after waivers
 * clear, holds while the week is open, ebbs hard into Sunday lock, and sits at
 * slack water while the games decide themselves. The marker says where you are
 * standing; the flat stretch on the right is the part of the week where nothing
 * you do matters, and it is drawn flat so it looks like it.
 *
 * Two things learned from looking at it rendered rather than imagining it:
 *
 *   The curve must keep its aspect. Stretched across 1440px with
 *   preserveAspectRatio="none" it flattened into a nearly straight line and
 *   stopped reading as a tide at all. It now holds a fixed ratio and centres.
 *
 *   The weekly gates are a lie in the offseason. "Lineups lock" is not a fact
 *   about August, and drawing it there would be the exact sin this app exists
 *   to avoid. The offseason gets its own band — slack water, no gates.
 */
export function TideStrip({ cycle }: { cycle: CyclePosition }) {
  if (cycle.phase === 'offseason') return <SlackWater cycle={cycle} />;

  const W = 1000;
  const H = 132;
  const LABELS = 20;
  const d = tidePath(W, H);
  const markX = cycle.at * W;
  const markY = H - cycle.agency * H;

  return (
    <div className="sheet">
      <Head cycle={cycle} />
      <div className="px-4 pb-3 pt-1">
        <svg
          viewBox={`0 0 ${W} ${H + LABELS}`}
          className="w-full"
          style={{ maxHeight: 168 }}
          role="img"
          aria-label={`${cycle.title}. ${Math.round(
            cycle.agency * 100
          )} percent of this week's decisions are still open.`}
        >
          {/* Datum: the level below which nothing can be changed. */}
          <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule)" strokeWidth="1" />

          {/* The water, filled below the curve as a tide chart is drawn. */}
          <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill="var(--depth)" opacity="0.13" />
          <path d={d} fill="none" stroke="var(--depth)" strokeWidth="1.75" />

          {cycle.gates.map((g) => (
            <g key={g.label}>
              <line
                x1={g.at * W}
                y1="6"
                x2={g.at * W}
                y2={H}
                stroke="var(--rule-strong)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <text
                x={g.at * W}
                y={H + 14}
                textAnchor={g.at > 0.85 ? 'end' : g.at < 0.08 ? 'start' : 'middle'}
                className="fig"
                style={{ fontSize: 11, fill: 'var(--faint)', letterSpacing: '.08em' }}
              >
                {g.label.toUpperCase()}
              </text>
            </g>
          ))}

          {/* You are here. */}
          <line x1={markX} y1={markY} x2={markX} y2={H} stroke="var(--alarm)" strokeWidth="2" />
          <circle cx={markX} cy={markY} r="5.5" fill="var(--alarm)" />
        </svg>
      </div>
    </div>
  );
}

function Head({ cycle }: { cycle: CyclePosition }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
      <h1 className="slab" style={{ fontSize: 'var(--t-lede)' }}>
        {cycle.title}
      </h1>
      {cycle.nextGate?.inMs != null && (
        <span className="fig" style={{ fontSize: 'var(--t-meta)', color: 'var(--alarm)' }}>
          {cycle.nextGate.label.toLowerCase()} in {humanDuration(cycle.nextGate.inMs)}
        </span>
      )}
      <span
        className="fig ml-auto"
        style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)', letterSpacing: '.1em' }}
      >
        {Math.round(cycle.agency * 100)}% STILL OPEN
      </span>
    </div>
  );
}

/**
 * The offseason band.
 *
 * No weekly gates, because none apply — but this is not a dead zone either. It
 * is when trades and rookie picks happen, which in a dynasty league is most of
 * the work. So the tide is drawn at full slack: everything is open, nothing is
 * closing, and the only clock that matters is the one counting to week one.
 */
function SlackWater({ cycle }: { cycle: CyclePosition }) {
  const W = 1000;
  const H = 44;

  return (
    <div className="sheet">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h1 className="slab" style={{ fontSize: 'var(--t-lede)' }}>
          {cycle.title}
        </h1>
        <span
          className="fig ml-auto"
          style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)', letterSpacing: '.1em' }}
        >
          SLACK WATER · EVERYTHING OPEN
        </span>
      </div>

      <div className="px-4 pb-3 pt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 56 }} aria-hidden="true">
          <path d={`M 0 8 L ${W} 8 L ${W} ${H} L 0 ${H} Z`} fill="var(--depth)" opacity="0.13" />
          <line x1="0" y1="8" x2={W} y2="8" stroke="var(--depth)" strokeWidth="1.75" />
          <line x1="0" y1={H} x2={W} y2={H} stroke="var(--rule)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
