/**
 * Charts.
 *
 * All of these are plain SVG/HTML — no chart library. Each one exists because a
 * column of numbers was making the reader do arithmetic in their head.
 *
 * Conventions across the file: thin marks, recessive axes, 2px gaps between
 * adjacent fills, direct labels rather than a number on every mark, and a hover
 * tooltip on every mark (title elements — native, keyboard reachable, no JS).
 */
import type { GameResult } from './api';

const WIN = 'var(--win)';
const LOSS = 'var(--loss)';

/* ------------------------------------------------------------------ *
 * Season tape — result and margin for every week, in one row.
 *
 * Job: change over time + polarity. Bars grow up for a win and down for a
 * loss from a shared midline, so the shape of a season is legible without
 * reading a single number.
 * ------------------------------------------------------------------ */
export function SeasonTape({
  results,
  height = 36,
  barWidth = 10,
  onSelect,
}: {
  results: GameResult[];
  height?: number;
  barWidth?: number;
  onSelect?: (week: number) => void;
}) {
  if (!results.length) {
    return <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>No games yet</span>;
  }

  const gap = 3;
  const mid = height / 2;
  const maxMargin = Math.max(...results.map((r) => Math.abs(r.points - r.opponentPoints)), 1);
  const width = results.length * (barWidth + gap) - gap;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Weekly results: ${results.map((r) => `week ${r.week} ${r.result}`).join(', ')}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line x1={0} y1={mid} x2={width} y2={mid} stroke="#33465A" strokeWidth={1} />
      {results.map((r, i) => {
        const margin = Math.abs(r.points - r.opponentPoints);
        // Square-root scale: most fantasy margins are small, and a linear scale
        // squashed nearly every week into a 3px stub. Sqrt keeps the blowouts
        // tallest while letting an ordinary week still read as a bar.
        const t = Math.sqrt(margin / maxMargin);
        const h = Math.max(5, t * (mid - 3));
        const win = r.result === 'W';
        const x = i * (barWidth + gap);
        return (
          <g
            key={r.week}
            onClick={onSelect ? () => onSelect(r.week) : undefined}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            <rect
              x={x}
              y={win ? mid - h : mid + 1}
              width={barWidth}
              height={h}
              rx={2}
              fill={r.result === 'T' ? '#93A2B2' : win ? WIN : LOSS}
            />
            <title>
              {`Week ${r.week}: ${r.result === 'W' ? 'Won' : r.result === 'L' ? 'Lost' : 'Tied'} ${r.points.toFixed(1)}–${r.opponentPoints.toFixed(1)}`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Magnitude bar — one value against the league's range.
 *
 * Job: magnitude. Twelve numbers in a column force the reader to find the
 * max themselves; a bar does it for them. Sequential, single hue.
 * ------------------------------------------------------------------ */
export function MagnitudeBar({
  value,
  min,
  max,
  label,
  width = 96,
  tone = 'neutral',
}: {
  value: number;
  min: number;
  max: number;
  label?: string;
  width?: number;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  // Scale against the league's spread, not zero — every team scores a lot, so
  // a zero-based bar would make all twelve look identical.
  const span = Math.max(max - min, 1);
  const t = Math.max(0, Math.min(1, (value - min) / span));
  const fill =
    tone === 'good' ? WIN : tone === 'bad' ? LOSS : 'linear-gradient(90deg,#24506B,#4A8FC7)';

  return (
    <div className="flex items-center gap-2.5" title={label}>
      <div
        className="relative rounded-[2px] overflow-hidden shrink-0"
        style={{ width, height: 8, background: '#1E2A36' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[2px]"
          style={{ width: `${Math.max(3, t * 100)}%`, background: fill }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Luck gauge — actual record against all-play record.
 *
 * Job: polarity. A diverging bar from a neutral centre: right of centre the
 * schedule helped, left of centre it hurt.
 * ------------------------------------------------------------------ */
export function LuckGauge({
  actual,
  allPlay,
  played = true,
  width = 84,
}: {
  actual: number;
  allPlay: number;
  played?: boolean;
  width?: number;
}) {
  if (!played) {
    return <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>—</span>;
  }

  const deltaPts = Math.round((actual - allPlay) * 100);
  const magnitude = Math.min(Math.abs(deltaPts) / 25, 1); // ±25pp saturates
  const lucky = deltaPts >= 0;
  const color = Math.abs(deltaPts) < 2 ? '#6E7E8D' : lucky ? WIN : LOSS;
  const half = width / 2;

  return (
    <div
      className="flex items-center gap-2.5"
      title={`Actual ${(actual * 100).toFixed(0)}% vs all-play ${(allPlay * 100).toFixed(0)}%`}
    >
      <svg width={width} height={14} style={{ display: 'block' }} aria-hidden="true">
        <line x1={0} y1={7} x2={width} y2={7} stroke="#1E2A36" strokeWidth={8} strokeLinecap="round" />
        <line x1={half} y1={1} x2={half} y2={13} stroke="#3A4A59" strokeWidth={1} />
        {magnitude > 0.02 && (
          <rect
            x={lucky ? half + 1 : half - magnitude * (half - 2) - 1}
            y={3}
            width={Math.max(3, magnitude * (half - 2))}
            height={8}
            rx={2}
            fill={color}
          />
        )}
      </svg>
      <span
        className="font-display font-semibold tabular-nums"
        style={{ color, fontSize: 'var(--t-meta)', minWidth: 30 }}
      >
        {deltaPts > 0 ? '+' : deltaPts < 0 ? '−' : ''}
        {Math.abs(deltaPts)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Efficiency meter — points scored as a share of the best available lineup.
 * ------------------------------------------------------------------ */
export function EfficiencyMeter({ value, width = 76 }: { value: number; width?: number }) {
  if (value <= 0) {
    return <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>—</span>;
  }
  // Managers land roughly between 70% and 95%; stretch that so the differences
  // that matter are visible rather than five near-identical full bars.
  const t = Math.max(0.04, Math.min(1, (value - 0.68) / 0.3));
  return (
    <div className="flex items-center gap-2.5" title={`${(value * 100).toFixed(1)}% of best possible`}>
      <div className="rounded-[2px] overflow-hidden shrink-0" style={{ width, height: 8, background: '#1E2A36' }}>
        <div className="h-full rounded-[2px]" style={{ width: `${t * 100}%`, background: 'linear-gradient(90deg,#2A6B4C,#3FBF7F)' }} />
      </div>
      <span className="font-display font-semibold tabular-nums text-muted" style={{ fontSize: 'var(--t-meta)', minWidth: 38 }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Weekly scoring — a team's or player's points, week by week.
 *
 * Job: change over time. For a team the opponent's score rides along as a
 * tick, so a win and a loss are visible without a second chart. One axis
 * only: both series are fantasy points.
 * ------------------------------------------------------------------ */
export function WeeklyBars({
  weeks,
  height = 168,
  onSelect,
  emptyLabel = 'No games played yet',
}: {
  weeks: Array<{ week: number; points: number; opponentPoints?: number | null; result?: 'W' | 'L' | 'T' | null }>;
  height?: number;
  onSelect?: (week: number) => void;
  emptyLabel?: string;
}) {
  if (!weeks.length) {
    return (
      <div className="grid place-items-center text-dim" style={{ height, fontSize: 'var(--t-meta)' }}>
        {emptyLabel}
      </div>
    );
  }

  // Laid out in HTML rather than a fixed-width SVG so the chart uses the whole
  // panel instead of stranding two thirds of it as empty space.
  const max = Math.max(...weeks.flatMap((w) => [w.points, w.opponentPoints ?? 0]), 1);
  const plot = height - 22;

  return (
    <div>
      <div className="relative flex items-end gap-1.5" style={{ height: plot }}>
        {/* Two recessive gridlines are enough to read magnitude. */}
        {[0.5, 1].map((f) => (
          <div
            key={f}
            className="absolute left-0 right-0 border-t border-line pointer-events-none"
            style={{ bottom: f * plot }}
            aria-hidden="true"
          />
        ))}

        {weeks.map((w) => {
          const barH = Math.max(3, (w.points / max) * plot);
          const color =
            w.result === 'W' ? WIN : w.result === 'L' ? LOSS : '#4A8FC7';
          const Tag = onSelect ? 'button' : 'div';
          return (
            <Tag
              key={w.week}
              type={onSelect ? 'button' : undefined}
              onClick={onSelect ? () => onSelect(w.week) : undefined}
              className="relative flex-1 min-w-0 group"
              style={{ height: plot, cursor: onSelect ? 'pointer' : 'default', background: 'none', border: 0, padding: 0 }}
              title={`Week ${w.week}: ${w.points.toFixed(1)}${w.opponentPoints != null ? ` vs ${w.opponentPoints.toFixed(1)}` : ''}`}
              aria-label={`Week ${w.week}, ${w.points.toFixed(1)} points`}
            >
              <span
                className="absolute bottom-0 left-0 right-0 rounded-t-[3px] transition-opacity group-hover:opacity-100"
                style={{ height: barH, background: color, opacity: 0.9 }}
              />
              {w.opponentPoints != null && (
                <span
                  className="absolute left-[-2px] right-[-2px]"
                  style={{
                    bottom: Math.max(2, (w.opponentPoints / max) * plot),
                    height: 2,
                    background: '#E8EDF2',
                    opacity: 0.8,
                  }}
                  aria-hidden="true"
                />
              )}
            </Tag>
          );
        })}
      </div>

      <div className="flex gap-1.5 mt-1.5">
        {weeks.map((w) => (
          <div
            key={w.week}
            className="flex-1 min-w-0 text-center font-display text-dim"
            style={{ fontSize: 'var(--t-label)' }}
          >
            {w.week}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legend for WeeklyBars. Identity is never colour alone. */
export function WeeklyBarsLegend({ showOpponent = true }: { showOpponent?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-dim" style={{ fontSize: 'var(--t-meta)' }}>
      <Key color={WIN} label="Won" />
      <Key color={LOSS} label="Lost" />
      {showOpponent && (
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="14" y2="4" stroke="#E8EDF2" strokeWidth="2" opacity="0.75" />
          </svg>
          Opponent
        </span>
      )}
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block rounded-[2px]" style={{ width: 10, height: 10, background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Positional comparison — where a matchup was actually won.
 *
 * Job: polarity, per category. A diverging bar per lineup slot: the side
 * that outscored the other takes that slot's row.
 * ------------------------------------------------------------------ */
export function PositionalCompare({
  rows,
  homeLabel,
  awayLabel,
}: {
  rows: Array<{ slot: string; home: number; away: number }>;
  homeLabel: string;
  awayLabel: string;
}) {
  if (!rows.length) return null;
  const maxDiff = Math.max(...rows.map((r) => Math.abs(r.home - r.away)), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-2" style={{ fontSize: 'var(--t-meta)' }}>
        <span className="truncate text-muted" style={{ maxWidth: '45%' }}>{homeLabel}</span>
        <span className="stat-label">Edge by slot</span>
        <span className="truncate text-muted text-right" style={{ maxWidth: '45%' }}>{awayLabel}</span>
      </div>

      <div className="space-y-1">
        {rows.map((r, i) => {
          const diff = r.home - r.away;
          const t = Math.min(Math.abs(diff) / maxDiff, 1);
          const homeSide = diff > 0;
          return (
            <div key={`${r.slot}-${i}`} className="grid grid-cols-[1fr_54px_1fr] items-center gap-2">
              <div className="flex justify-end">
                {homeSide && (
                  <div className="rounded-[2px]" style={{ width: `${Math.max(4, t * 100)}%`, height: 12, background: WIN, opacity: 0.85 }}
                       title={`${r.slot}: ${homeLabel} by ${Math.abs(diff).toFixed(1)}`} />
                )}
              </div>
              <div className="text-center font-display font-semibold uppercase text-muted"
                   style={{ fontSize: 'var(--t-label)', letterSpacing: '.06em' }}>
                {r.slot === 'SUPER_FLEX' ? 'SFLX' : r.slot}
              </div>
              <div className="flex justify-start">
                {!homeSide && Math.abs(diff) > 0 && (
                  <div className="rounded-[2px]" style={{ width: `${Math.max(4, t * 100)}%`, height: 12, background: '#4A8FC7', opacity: 0.85 }}
                       title={`${r.slot}: ${awayLabel} by ${Math.abs(diff).toFixed(1)}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
