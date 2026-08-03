import { useState } from 'react';
import { Pos, posColor } from './components';

/**
 * The Board — a roster as a field rather than a list.
 *
 * A roster table tells you who you have. It cannot tell you what you *are*,
 * because the shape of a roster is a two-dimensional fact: how much value, held
 * at what age. A contender is a cluster of expensive players in their late
 * twenties. A rebuild is a cluster of cheap players at twenty-two with one or
 * two big assets. Those are visibly different pictures and completely
 * indistinguishable in a sorted list.
 *
 * Age runs left to right because time does. Value runs bottom to top because
 * more is up. The mark is sized by weekly projection, so a player who is
 * expensive and produces reads heavier than one who is only expensive — which
 * is the difference between an asset and a hope.
 *
 * The plot is a chart, so it wears a chart's obligations: a hover readout, an
 * always-present legend, and a table underneath carrying the same numbers for
 * anyone who cannot use the plot.
 */

export interface BoardPlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  perWeek: number;
  dynasty: number | null;
  redraft: number | null;
  trend7Day: number | null;
  onTaxi: boolean;
  onIr: boolean;
}

export type ValueMode = 'dynasty' | 'redraft';

const W = 720;
const H = 380;
// Right padding clears the largest mark radius, so a player at the age
// ceiling is drawn whole rather than sliced by the plot edge.
const PAD = { top: 16, right: 30, bottom: 34, left: 46 };

/**
 * Age bounds.
 *
 * The top end is 40 rather than the 38 a fantasy-relevant player usually
 * reaches, because quarterbacks do not retire on schedule — Aaron Rodgers at 42
 * was being clamped onto the axis and drawn half outside the plot.
 */
const AGE_MIN = 20;
const AGE_MAX = 40;

export function Board({
  players,
  mode,
  onModeChange,
  onSelect,
}: {
  players: BoardPlayer[];
  mode: ValueMode;
  onModeChange: (m: ValueMode) => void;
  onSelect?: (p: BoardPlayer) => void;
}) {
  const [hover, setHover] = useState<BoardPlayer | null>(null);

  const value = (p: BoardPlayer) => (mode === 'dynasty' ? p.dynasty : p.redraft);
  const priced = players.filter((p) => value(p) != null && p.age != null);
  const unpriced = players.length - priced.length;

  const maxValue = Math.max(1, ...priced.map((p) => value(p) ?? 0));
  const maxWeekly = Math.max(1, ...priced.map((p) => p.perWeek));

  const x = (age: number) =>
    PAD.left + ((age - AGE_MIN) / (AGE_MAX - AGE_MIN)) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / maxValue) * (H - PAD.top - PAD.bottom);
  // Area, not radius, tracks the projection — a radius-scaled mark exaggerates
  // the big ones by the square.
  const r = (weekly: number) => 3 + Math.sqrt(Math.max(0, weekly) / maxWeekly) * 9;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-[var(--rule)]">
        <fieldset className="flex items-center gap-0">
          <legend className="sr-only">Which market to plot</legend>
          {(['dynasty', 'redraft'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
              className="fig px-2.5 py-1 border"
              style={{
                fontSize: 'var(--t-tick)',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                borderColor: mode === m ? 'var(--ink)' : 'var(--rule)',
                background: mode === m ? 'var(--ink)' : 'transparent',
                color: mode === m ? 'var(--vellum)' : 'var(--graphite)',
              }}
            >
              {m}
            </button>
          ))}
        </fieldset>

        {/* Legend is always present: identity must never be colour alone. */}
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {['QB', 'RB', 'WR', 'TE'].map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                style={{ width: 9, height: 9, borderRadius: 9, background: posColor(p), display: 'block' }}
              />
              <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--graphite)' }}>
                {p}
              </span>
            </li>
          ))}
        </ul>

        <span className="fig ml-auto" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
          MARK SIZE = PROJECTED POINTS
        </span>
      </div>

      <div className="relative px-2 pt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={describe(priced, mode)}>
          {/* Grid: recessive, and only where a reader needs to land a value. */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                y1={y(maxValue * f)}
                x2={W - PAD.right}
                y2={y(maxValue * f)}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={y(maxValue * f) + 3}
                textAnchor="end"
                className="fig"
                style={{ fontSize: 9, fill: 'var(--faint)' }}
              >
                {Math.round((maxValue * f) / 1000)}k
              </text>
            </g>
          ))}

          {[22, 26, 30, 34].map((age) => (
            <g key={age}>
              <line
                x1={x(age)}
                y1={PAD.top}
                x2={x(age)}
                y2={H - PAD.bottom}
                stroke="var(--rule)"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <text
                x={x(age)}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="fig"
                style={{ fontSize: 9, fill: 'var(--faint)' }}
              >
                {age}
              </text>
            </g>
          ))}

          <text
            x={(W + PAD.left) / 2}
            y={H - 4}
            textAnchor="middle"
            className="fig"
            style={{ fontSize: 10, fill: 'var(--graphite)', letterSpacing: '.1em' }}
          >
            AGE
          </text>

          {priced.map((p) => {
            const cx = x(Math.min(AGE_MAX, Math.max(AGE_MIN, p.age!)));
            const cy = y(value(p)!);
            const active = hover?.id === p.id;
            return (
              <g key={p.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r(p.perWeek)}
                  fill={posColor(p.position)}
                  fillOpacity={p.onTaxi || p.onIr ? 0.3 : 0.75}
                  stroke="var(--vellum)"
                  strokeWidth="1.5"
                />
                {/* Hit target larger than the mark, per the interaction rules. */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(14, r(p.perWeek) + 6)}
                  fill="transparent"
                  style={{ cursor: onSelect ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
                  onClick={() => onSelect?.(p)}
                />
                {active && <circle cx={cx} cy={cy} r={r(p.perWeek) + 3} fill="none" stroke="var(--alarm)" strokeWidth="1.5" />}
              </g>
            );
          })}
        </svg>

        {/* Readout, fixed rather than floating: a tooltip that follows the
            cursor over a dense scatter covers the marks either side of it. */}
        <div
          className="flex items-baseline gap-3 px-2 py-2 border-t border-[var(--rule)] min-h-[38px]"
          aria-live="polite"
        >
          {hover ? (
            <>
              <Pos pos={hover.position} />
              <span className="slab" style={{ fontSize: 'var(--t-body)' }}>
                {hover.name}
              </span>
              <span className="fig" style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)' }}>
                {hover.team ?? 'FA'} · {hover.age}y · {hover.perWeek.toFixed(1)}/wk
              </span>
              <span className="fig ml-auto" style={{ fontSize: 'var(--t-meta)' }}>
                {(value(hover) ?? 0).toLocaleString()}
                {hover.trend7Day ? (
                  <span
                    style={{ color: hover.trend7Day > 0 ? 'var(--gain)' : 'var(--loss)', marginLeft: 8 }}
                  >
                    {hover.trend7Day > 0 ? '+' : ''}
                    {hover.trend7Day} / 7d
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <span className="fig" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
              Point at a mark to read it.
            </span>
          )}
        </div>

        {unpriced > 0 && (
          <p className="px-2 pb-2" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
            {unpriced} rostered {unpriced === 1 ? 'player is' : 'players are'} not plotted — no market
            price or no age on file.
          </p>
        )}
      </div>
    </div>
  );
}

/** What the plot says, for a reader who cannot see it. */
function describe(players: BoardPlayer[], mode: ValueMode): string {
  if (!players.length) return 'No players with a market price.';
  const value = (p: BoardPlayer) => (mode === 'dynasty' ? p.dynasty : p.redraft) ?? 0;
  const top = [...players].sort((a, b) => value(b) - value(a)).slice(0, 3);
  const meanAge = players.reduce((s, p) => s + (p.age ?? 0), 0) / players.length;
  return `${players.length} players plotted by ${mode} value against age. Average age ${meanAge.toFixed(
    1
  )}. Most valuable: ${top.map((p) => `${p.name} at ${value(p).toLocaleString()}`).join(', ')}.`;
}

/** The same numbers as a table, which the plot is not a substitute for. */
export function BoardTable({ players, mode }: { players: BoardPlayer[]; mode: ValueMode }) {
  const value = (p: BoardPlayer) => (mode === 'dynasty' ? p.dynasty : p.redraft);
  const rows = [...players].sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0));

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ fontSize: 'var(--t-meta)' }}>
        <thead>
          <tr className="border-b border-[var(--rule)]">
            <th className="label text-left px-4 py-1.5">Player</th>
            <th className="label text-left px-2 py-1.5">Pos</th>
            <th className="label text-right px-2 py-1.5">Age</th>
            <th className="label text-right px-2 py-1.5">Proj / wk</th>
            <th className="label text-right px-4 py-1.5">{mode}</th>
          </tr>
        </thead>
        <tbody className="banded">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-1 truncate" style={{ maxWidth: 220 }}>
                {p.name}
                {p.onTaxi && <span className="label ml-2">taxi</span>}
                {p.onIr && <span className="label ml-2">ir</span>}
              </td>
              <td className="px-2 py-1">
                <Pos pos={p.position} />
              </td>
              <td className="fig px-2 py-1 text-right">{p.age ?? '—'}</td>
              <td className="fig px-2 py-1 text-right">{p.perWeek.toFixed(1)}</td>
              <td className="fig px-4 py-1 text-right">{value(p)?.toLocaleString() ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
