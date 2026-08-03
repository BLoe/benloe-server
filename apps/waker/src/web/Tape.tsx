import { Pos } from './components';

/**
 * The tape — a player's usage drawn week by week, beside what it produced.
 *
 * A divergence is an assertion: "he is being used more than he is scoring."
 * The sparkline is the evidence for it, and the two have to sit on the same
 * line or the assertion is just a number a manager has to take on trust.
 *
 * Three rules govern the drawing, and all three exist because a sparkline is
 * the easiest chart in the world to lie with.
 *
 *   The x-axis is shared.  Every row is drawn across the same weeks, so two
 *   shapes can be compared. A per-player domain would silently rescale a
 *   four-game rookie to look like a sixteen-game starter.
 *
 *   Gaps stay gaps.  A missed week breaks the line rather than being drawn
 *   through. A straight segment across a bye asserts a snap share nobody
 *   recorded.
 *
 *   One game is not a line.  A player with a single week is drawn as a single
 *   dot and says so in words, because a flat line across a chart is the most
 *   confident thing a chart can say and he has not earned it.
 */

export interface SparkPoint {
  week: number;
  /** Null means no game that week. Never interpolated. */
  value: number | null;
}

export type Trend = 'rising' | 'falling' | 'steady' | 'unknown';

/**
 * Split a series into runs of consecutive observed weeks.
 *
 * Anything that breaks the run — a null, or a week number that skips — starts a
 * new segment, so the drawn line only ever spans weeks that were actually
 * measured back to back.
 */
export function segments(points: SparkPoint[]): Array<Array<{ week: number; value: number }>> {
  const out: Array<Array<{ week: number; value: number }>> = [];
  let run: Array<{ week: number; value: number }> = [];

  for (const p of points) {
    if (p.value == null) {
      if (run.length) out.push(run);
      run = [];
      continue;
    }
    const last = run[run.length - 1];
    if (last && p.week !== last.week + 1) {
      out.push(run);
      run = [];
    }
    run.push({ week: p.week, value: p.value });
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * Which way the series is going, in a word.
 *
 * First half of the observed games against the second half — the same shape as
 * `usageTrend` on the server, and for the same reason: a role that arrived in
 * October is a different proposition from one that has been steady all year,
 * and only the direction tells them apart.
 *
 * The default threshold of five share points is the level below which a snap
 * count is just rotation and game script.
 */
export function trendWord(points: SparkPoint[], threshold = 0.05): Trend {
  const seen = points.filter((p) => p.value != null).map((p) => p.value as number);
  if (seen.length < 2) return 'unknown';
  const half = Math.floor(seen.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(seen.slice(seen.length - half)) - mean(seen.slice(0, half));
  if (delta > threshold) return 'rising';
  if (delta < -threshold) return 'falling';
  return 'steady';
}

/**
 * What the sparkline says, for a reader who cannot see it.
 *
 * Deliberately says how *many* games it is drawn from. A reader who cannot see
 * the chart cannot see that it is two dots, and "rising" off two games is a
 * sentence that would mislead them.
 */
export function describeSeries(
  label: string,
  points: SparkPoint[],
  format: (v: number) => string
): string {
  const seen = points.filter((p) => p.value != null) as Array<{ week: number; value: number }>;
  if (!seen.length) return `${label}: no weekly data on file.`;
  if (seen.length === 1) {
    return `${label}: one game only — ${format(seen[0].value)} in week ${seen[0].week}. One game is not a trend.`;
  }

  const first = seen[0];
  const last = seen[seen.length - 1];
  const high = seen.reduce((a, b) => (b.value > a.value ? b : a));
  const low = seen.reduce((a, b) => (b.value < a.value ? b : a));
  const t = trendWord(points);

  // Weeks inside the span with no game. A sighted reader sees these as breaks
  // in the line; a listener would otherwise hear an unbroken run of games.
  const missed = last.week - first.week + 1 - seen.length;

  return (
    `${label}: ${seen.length} games, weeks ${first.week} to ${last.week} — ` +
    `${format(first.value)} at the start, ${format(last.value)} at the end, ${t}. ` +
    `High ${format(high.value)} in week ${high.week}, low ${format(low.value)} in week ${low.week}.` +
    (missed > 0 ? ` ${missed} week${missed === 1 ? '' : 's'} in that span with no game.` : '')
  );
}

const PAD_X = 3;
const PAD_Y = 4;

/**
 * A sparkline. Small, unlabelled, and honest about what it does not know.
 *
 * `from`/`to` are the shared week domain rather than the series' own extent —
 * pass the same pair to every sparkline on a page and the column becomes
 * comparable, which is the only reason to draw sixty of them.
 */
export function Sparkline({
  points,
  from,
  to,
  max = 1,
  label,
  format = (v) => `${Math.round(v * 100)}%`,
  width = 158,
  height = 30,
  markWeek,
  emptyNote = 'no data',
}: {
  points: SparkPoint[];
  from: number;
  to: number;
  /** Top of the y range. Shared, like the x domain. */
  max?: number;
  /** What the series is, in words. Opens the aria description. */
  label: string;
  format?: (v: number) => string;
  width?: number;
  height?: number;
  /** Draws a hairline where the judging window begins. */
  markWeek?: number;
  emptyNote?: string;
}) {
  const runs = segments(points);
  const seen = runs.flat();

  const span = Math.max(1, to - from);
  const x = (week: number) => PAD_X + ((week - from) / span) * (width - PAD_X * 2);
  const y = (v: number) =>
    height - PAD_Y - (Math.max(0, Math.min(max, v)) / max) * (height - PAD_Y * 2);

  const description = describeSeries(label, points, format);
  const band = Math.max(7, (width - PAD_X * 2) / (span + 1));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={description}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Baseline. Dashed when there is nothing to draw, so an empty series
          never reads as a run of zeroes. */}
      <line
        x1={PAD_X}
        y1={height - PAD_Y}
        x2={width - PAD_X}
        y2={height - PAD_Y}
        stroke="var(--rule)"
        strokeWidth="1"
        strokeDasharray={seen.length ? undefined : '2 3'}
      />

      {markWeek != null && markWeek > from && markWeek <= to && (
        <line
          x1={x(markWeek)}
          y1={PAD_Y - 2}
          x2={x(markWeek)}
          y2={height - PAD_Y}
          stroke="var(--rule-strong)"
          strokeWidth="1"
          strokeDasharray="1 3"
        />
      )}

      {runs.map((run, i) =>
        run.length > 1 ? (
          <polyline
            key={i}
            points={run.map((p) => `${x(p.week)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke="var(--depth)"
            strokeWidth="1.25"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null
      )}

      {seen.map((p, i) => (
        <circle
          key={p.week}
          cx={x(p.week)}
          cy={y(p.value)}
          r={i === seen.length - 1 ? 2.2 : 1.4}
          fill={i === seen.length - 1 ? 'var(--ink)' : 'var(--depth)'}
        />
      ))}

      {/* Hit targets, wider than the marks, carrying the reading. */}
      {seen.map((p) => (
        <rect
          key={`hit-${p.week}`}
          x={x(p.week) - band / 2}
          y={0}
          width={band}
          height={height}
          fill="transparent"
        >
          <title>{`Week ${p.week} — ${format(p.value)}`}</title>
        </rect>
      ))}

      {!seen.length && (
        <text
          x={width / 2}
          y={height / 2 + 3}
          textAnchor="middle"
          className="fig"
          style={{ fontSize: 9, fill: 'var(--faint)' }}
        >
          {emptyNote}
        </text>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * The divergence row
 * ------------------------------------------------------------------ */

export interface TapeWeek {
  week: number;
  snap: number | null;
  target: number | null;
  points: number | null;
}

export interface TapeRow {
  id: string;
  name: string;
  position: string;
  team: string | null;
  weeks: TapeWeek[];
  divergence: {
    snapShare: number | null;
    targetShare: number | null;
    pointsPerGame: number;
    expectedPointsPerGame: number;
    pointsGap: number;
    usageRank: number;
    productionRank: number;
    divergence: number;
    games: number;
    verdict: 'buy' | 'sell' | 'fair';
  };
  trend: number | null;
  rostered: boolean;
  rosterId: number | null;
  teamName: string | null;
  mine: boolean;
  value: number | null;
  valueTrend: number | null;
  projected: number | null;
}

/**
 * Verdict marks.
 *
 * A triangle up means "expect more than the box score" and down means "expect
 * less", which is the direction the points are about to move. Every verdict
 * carries its word as well as its mark, so the distinction survives a reader
 * who cannot separate the greens from the browns — colour is the third signal
 * here, never the first.
 */
export const VERDICT = {
  buy: { mark: '▲', word: 'Buy', ink: 'var(--gain)' },
  sell: { mark: '▼', word: 'Sell', ink: 'var(--loss)' },
  // Graphite rather than a paler grey: this ink also prints the points gap,
  // which is a figure a reader has to be able to read.
  fair: { mark: '·', word: 'In line', ink: 'var(--graphite)' },
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const one = (v: number) => v.toFixed(1);
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

export function TapeRowView({
  row,
  from,
  to,
  windowFrom,
  season,
  open,
  onToggle,
}: {
  row: TapeRow;
  from: number;
  to: number;
  windowFrom: number;
  season: string;
  open: boolean;
  onToggle: () => void;
}) {
  const d = row.divergence;
  const v = VERDICT[d.verdict];
  const snapPoints: SparkPoint[] = row.weeks.map((w) => ({ week: w.week, value: w.snap }));

  return (
    <article className="border-b border-[var(--rule)] last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-2.5">
        <span
          aria-hidden="true"
          className="fig select-none shrink-0 pt-0.5"
          style={{ width: 12, fontSize: 12, color: v.ink }}
        >
          {v.mark}
        </span>

        <div className="min-w-0 flex-1" style={{ flexBasis: '17rem' }}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <Pos pos={row.position} />
            <span className="slab truncate" style={{ fontSize: 'var(--t-body)' }}>
              {row.name}
            </span>
            <span className="label" style={{ color: v.ink, letterSpacing: '.12em' }}>
              {v.word}
            </span>
            <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
              {row.team ?? 'FA'} · {row.mine ? 'YOURS' : row.rostered ? (row.teamName ?? 'ROSTERED') : 'FREE AGENT'}
            </span>
          </div>

          <p
            className="mt-0.5"
            style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)', lineHeight: 1.5, maxWidth: '62ch' }}
          >
            {sentence(row)}
          </p>

          <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap mt-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="label hover:text-[var(--ink)]"
              style={{ letterSpacing: '.12em' }}
            >
              {open ? 'Hide the weeks ▴' : 'Week by week ▾'}
            </button>
            <Context row={row} />
          </div>
        </div>

        <div className="flex items-center gap-4 ml-auto shrink-0">
          <Sparkline
            points={snapPoints}
            from={from}
            to={to}
            markWeek={windowFrom}
            label={`${row.name}, snap share by week, ${season} season`}
            format={pct}
            emptyNote="no snaps on file"
          />

          <Figure value={one(d.pointsPerGame)} unit="PTS / G" />
          <Figure value={signed(d.pointsGap)} unit="GAP / G" ink={v.ink} />
        </div>
      </div>

      {open && <WeekTable row={row} season={season} />}
    </article>
  );
}

/**
 * What everyone else already thinks, in one line.
 *
 * A buy signal on a player whose trade value has been climbing for a week is a
 * buy signal you are late to, and there is no way to know that from the usage
 * alone. The seven-day move carries its own sign, so the direction survives
 * without the colour. Anything the sources did not price is simply absent —
 * a dash in this line would imply the market said nothing when in fact nobody
 * asked it.
 */
function Context({ row }: { row: TapeRow }) {
  const bits: string[] = [];
  if (row.value != null) {
    bits.push(
      `${row.value.toLocaleString()} dynasty${
        row.valueTrend ? ` ${row.valueTrend > 0 ? '+' : ''}${row.valueTrend} in 7d` : ''
      }`
    );
  }
  if (row.projected != null && row.projected > 0) bits.push(`projected ${one(row.projected)} / wk`);
  if (!bits.length) return null;

  return (
    <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
      {bits.join(' · ')}
    </span>
  );
}

function Figure({ value, unit, ink = 'var(--ink)' }: { value: string; unit: string; ink?: string }) {
  return (
    <div className="text-right" style={{ minWidth: 60 }}>
      <div className="fig leading-none" style={{ fontSize: 'var(--t-lede)', fontWeight: 600, color: ink }}>
        {value}
      </div>
      <div className="label mt-1" style={{ letterSpacing: '.1em' }}>
        {unit}
      </div>
    </div>
  );
}

/**
 * The claim, in a sentence.
 *
 * The points gap is the whole finding, so it is said in plain words as well as
 * printed in the figure column — a manager acts on "he should be returning
 * thirteen", not on a percentile.
 */
export function sentence(row: TapeRow): string {
  const d = row.divergence;
  const parts: string[] = [];

  parts.push(
    `${one(d.pointsPerGame)} a game — usage like that normally returns ${one(d.expectedPointsPerGame)}.`
  );

  const usage: string[] = [];
  if (d.snapShare != null) usage.push(`${pct(d.snapShare)} of snaps`);
  if (d.targetShare != null) usage.push(`${pct(d.targetShare)} of targets`);
  if (usage.length) parts.push(`${usage.join(', ')} over ${d.games} games.`);
  else parts.push(`${d.games} games.`);

  // A role that only just arrived is worth much more than the same gap on
  // steady usage, so the trend is said out loud when it is big enough to mean
  // something rather than left for the reader to find in the line.
  if (row.trend != null && Math.abs(row.trend) >= 0.05) {
    parts.push(
      `Snaps ${row.trend > 0 ? 'up' : 'down'} ${Math.abs(Math.round(row.trend * 100))} points across the window.`
    );
  }

  if (d.games <= 3) parts.push(`Only ${d.games} games — thin evidence.`);

  return parts.join(' ');
}

/** The same numbers the sparkline draws, as a table. The chart is not a substitute. */
export function WeekTable({ row, season }: { row: TapeRow; season: string }) {
  if (!row.weeks.length) {
    return (
      <p className="px-4 pb-3" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
        No weekly rows on file for {row.name} in {season}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto px-4 pb-3">
      <table className="w-full" style={{ fontSize: 'var(--t-meta)', maxWidth: 520 }}>
        <caption className="label text-left pb-1">
          {row.name} — week by week, {season}
        </caption>
        <thead>
          <tr className="border-b border-[var(--rule)]">
            <th className="label text-left py-1">Wk</th>
            <th className="label text-right py-1">Snap %</th>
            <th className="label text-right py-1">Tgt %</th>
            <th className="label text-right py-1">Pts</th>
          </tr>
        </thead>
        <tbody className="banded">
          {row.weeks.map((w) => (
            <tr key={w.week}>
              <td className="fig py-0.5">{w.week}</td>
              <td className="fig py-0.5 text-right">{w.snap == null ? '—' : pct(w.snap)}</td>
              <td className="fig py-0.5 text-right">{w.target == null ? '—' : pct(w.target)}</td>
              <td className="fig py-0.5 text-right">{w.points == null ? '—' : one(w.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
