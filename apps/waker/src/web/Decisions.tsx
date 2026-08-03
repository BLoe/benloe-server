import type { Decision, DecisionKind } from '../lib/analysis/decisions';
import { Pos, posColor } from './components';

/**
 * A decision, as an almanac entry.
 *
 * Not a card: a ruled row with a mark in the margin, a claim, the magnitude in
 * the figure column, and its evidence set underneath. The margin mark is the
 * almanac's own device — a printed table uses a glyph to say what kind of thing
 * a row is without spending a whole column on it.
 *
 * The magnitude is always in the same place and always in the figure face, so a
 * column of them can be scanned down and compared, which is the entire reason
 * the feed is ranked by a number rather than by kind.
 */

/** Margin marks. Each says what kind of decision this is at a glance. */
const MARK: Record<DecisionKind, string> = {
  'dead-weight': '⊘',
  hole: '□',
  'start-sit': '⇄',
  injury: '✚',
  market: '⇅',
  wire: '＋',
  'roster-rule': '⌛',
  orientation: '⚓',
  trade: '⇌',
};

const KIND_LABEL: Record<DecisionKind, string> = {
  'dead-weight': 'Stranded',
  hole: 'Empty slot',
  'start-sit': 'Start / sit',
  injury: 'Injury',
  market: 'Market',
  wire: 'Waiver wire',
  'roster-rule': 'Roster rule',
  orientation: 'Direction',
  trade: 'Trade',
};

/** Which decisions the alarm ink is reserved for: the ones with a live clock. */
const URGENT = new Set(['lock', 'waivers']);

export function DecisionRow({ decision }: { decision: Decision }) {
  const urgent = URGENT.has(decision.clock);
  const figure = formatStake(decision);

  return (
    <article
      className="grid gap-x-3 px-4 py-3 border-b border-[var(--rule)] last:border-b-0"
      style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
    >
      {/* Margin mark */}
      <span
        aria-hidden="true"
        className="fig select-none pt-0.5"
        style={{ fontSize: 15, color: urgent ? 'var(--alarm)' : 'var(--rule-strong)', width: 16 }}
      >
        {MARK[decision.kind]}
      </span>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="label" style={{ color: urgent ? 'var(--alarm)' : 'var(--faint)' }}>
            {KIND_LABEL[decision.kind]}
          </span>
          {decision.players.slice(0, 2).map((p) => (
            <Pos key={p.id} pos={p.position} />
          ))}
        </div>

        <h3 className="slab mt-1" style={{ fontSize: 'var(--t-lede)', lineHeight: 1.25 }}>
          {decision.claim}
        </h3>

        <div className="mt-1.5 space-y-0.5">
          {decision.evidence.map((line, i) => (
            <p
              key={i}
              style={{
                fontSize: 'var(--t-meta)',
                color: 'var(--graphite)',
                lineHeight: 1.5,
                maxWidth: '68ch',
              }}
            >
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* The magnitude, always in the same column so a page of them can be
          compared by running an eye down it. */}
      <div className="text-right shrink-0" style={{ minWidth: 96 }}>
        <div
          className="fig leading-none"
          style={{
            fontSize: 'var(--t-figure)',
            fontWeight: 600,
            color: urgent ? 'var(--alarm)' : 'var(--ink)',
          }}
        >
          {figure.value}
        </div>
        <div className="label mt-1" style={{ letterSpacing: '.1em' }}>
          {figure.unit}
        </div>
      </div>
    </article>
  );
}

/**
 * How a stake reads.
 *
 * Three different quantities share this column, so each one says its own unit
 * rather than leaving the reader to guess whether 296 is points, dollars or a
 * rank.
 */
function formatStake(d: Decision): { value: string; unit: string } {
  switch (d.stakeUnit) {
    case 'season':
      return { value: Math.round(d.stake).toLocaleString(), unit: 'PTS / YR' };
    case 'value':
      return { value: `${(d.stake / 1000).toFixed(1)}k`, unit: 'ON ROSTER' };
    default:
      return { value: d.stake.toFixed(1), unit: 'PTS / WK' };
  }
}

/** The whole feed. */
export function DecisionFeed({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) {
    return (
      <div className="px-4 py-8">
        <p className="slab" style={{ fontSize: 'var(--t-lede)' }}>
          Nothing needs you.
        </p>
        <p className="mt-1" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
          Your lineup is filled, nobody is stranded, and the market agrees with your roster.
        </p>
      </div>
    );
  }
  return (
    <div>
      {decisions.map((d) => (
        <DecisionRow key={d.id} decision={d} />
      ))}
    </div>
  );
}

/** Colour a legend swatch, so the margin marks are learnable. */
export const markColor = (kind: DecisionKind) => posColor(kind === 'injury' ? 'QB' : null);
