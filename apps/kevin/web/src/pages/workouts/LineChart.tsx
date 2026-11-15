// A small line chart in plain SVG: one or two series over sessions, round
// y ticks, a few dates along the bottom, and a readout for the point under
// the finger. Drawn at the container's real width so text is never scaled.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { axisFor, labelIndices, linePath, nearestIndex, points, xAt, yAt, type Box } from './chart';
import { monthDay } from './logic';

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  /** The main series is drawn solid in the accent colour; the other dashed and quiet. */
  tone: 'primary' | 'muted';
}

export function LineChart({ dates, series, format, invert = false, height = 220, details }: {
  /** One YYYY-MM-DD per session, oldest first. */
  dates: string[];
  series: ChartSeries[];
  /** Formats an axis tick or a readout value. */
  format: (v: number) => string;
  /** Smaller is better (pace): small values are drawn at the top. */
  invert?: boolean;
  height?: number;
  /** An extra line in the readout for the i-th session. */
  details?: (i: number) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const axis = axisFor(all, 4);
  const tickText = axis.ticks.map(format);
  const left = Math.max(34, Math.max(...tickText.map((t) => t.length)) * 7.2 + 10);
  const box: Box = { left, top: 10, width: Math.max(10, width - left - 14), height: height - 10 - 26 };
  const plotted = series.map((s) => ({ ...s, pts: points(s.values, axis, box, invert) }));
  const i = picked != null && picked < n ? picked : n - 1;
  const labels = labelIndices(n, Math.max(2, Math.floor(box.width / 72)));

  const pick = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPicked(nearestIndex(clientX - r.left, n, box));
  };

  return (
    <div>
      <div className="mb-1 flex min-h-11 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{n ? monthDay(dates[i]!) : ''}{picked == null && n ? ' · latest' : ''}</p>
          <p className="tabular flex flex-wrap gap-x-4 font-semibold">
            {series.map((s) => {
              const v = s.values[i];
              return (
                <span key={s.label} className={cn('flex items-center gap-1.5', s.tone === 'muted' && 'font-medium text-muted-foreground')}>
                  <svg width="18" height="8" aria-hidden="true">
                    <line x1="1" x2="17" y1="4" y2="4" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={s.tone === 'muted' ? '4 4' : undefined} className={s.tone === 'primary' ? 'stroke-primary' : 'stroke-muted-foreground'} />
                  </svg>
                  {s.label} {v != null ? format(v) : '—'}
                </span>
              );
            })}
          </p>
        </div>
        {details && n > 0 && <p className="tabular text-sm text-muted-foreground">{details(i)}</p>}
      </div>
      <div
        ref={wrap}
        className="touch-pan-y select-none"
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons > 0 || e.pointerType === 'touch') && pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setPicked(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.label).join(' and ')} over ${n} sessions`} className="block">
            {axis.ticks.map((t, k) => {
              const y = yAt(t, axis, box, invert);
              return (
                <g key={t}>
                  <line x1={box.left} x2={box.left + box.width} y1={y} y2={y} className="stroke-border" strokeWidth="1" />
                  <text x={box.left - 8} y={y + 4} textAnchor="end" className="tabular fill-muted-foreground text-[11px]">
                    {tickText[k]}
                  </text>
                </g>
              );
            })}
            {labels.map((k) => (
              <text key={k} x={xAt(k, n, box)} y={height - 6} textAnchor={k === 0 && n > 1 ? 'start' : k === n - 1 && n > 1 ? 'end' : 'middle'} className="tabular fill-muted-foreground text-[11px]">
                {monthDay(dates[k]!)}
              </text>
            ))}
            {n > 0 && plotted[0]?.pts.length ? <line x1={xAt(i, n, box)} x2={xAt(i, n, box)} y1={box.top} y2={box.top + box.height} className="stroke-muted-foreground/40" strokeWidth="1" /> : null}
            {[...plotted].reverse().map((s) => (
              <g key={s.label}>
                <path d={linePath(s.pts)} fill="none" strokeWidth={s.tone === 'primary' ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.tone === 'muted' ? '5 5' : undefined} className={s.tone === 'primary' ? 'stroke-primary' : 'stroke-muted-foreground'} />
                {s.pts.map((p) => (
                  <circle key={p.i} cx={p.x} cy={p.y} r={p.i === i ? 5 : s.pts.length > 30 ? 0 : 3} strokeWidth="2" className={cn('stroke-card', s.tone === 'primary' ? 'fill-primary' : 'fill-muted-foreground')} />
                ))}
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
