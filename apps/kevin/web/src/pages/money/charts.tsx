// The Money page's three charts, hand-drawn SVG and divs. Geometry comes from
// logic.ts (tested); these only place it.
import { useState, type PointerEvent } from 'react';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { barLayout, dayLabel, lineLayout, monthLabel, nearestIndex, stackSegments } from './logic';

/** Spending per month as bars. The selected month is solid; tapping another selects it. */
export function MonthBars({ series, selected, onSelect, thisYear }: { series: { month: string; spent: number }[]; selected: string; onSelect: (month: string) => void; thisYear: string }) {
  const W = 600;
  const H = 132;
  const { bars, max } = barLayout(series.map((s) => s.spent), { width: W, height: H, top: 6 });
  return (
    <div>
      <div className="flex">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spending for the last ${series.length} months`} className="block h-32 min-w-0 flex-1 touch-pan-y" preserveAspectRatio="none">
          <line x1={0} x2={W} y1={6} y2={6} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H / 2 + 3} y2={H / 2 + 3} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          {series.map((s, i) => {
            const b = bars[i]!;
            const on = s.month === selected;
            return (
              <g key={s.month} onClick={() => onSelect(s.month)} className="cursor-pointer">
                <rect x={b.slotX} y={0} width={b.slotWidth} height={H} fill="transparent" />
                <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={3} fill="var(--primary)" opacity={on ? 1 : 0.38} />
              </g>
            );
          })}
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="tabular flex h-32 w-12 shrink-0 flex-col justify-between pl-2 text-xs text-muted-foreground">
          <span>{compact(max)}</span>
          <span>{compact(max / 2)}</span>
          <span>$0</span>
        </div>
      </div>
      <div className="mr-12 mt-1.5 flex">
        {series.map((s) => (
          <button key={s.month} type="button" onClick={() => onSelect(s.month)} aria-pressed={s.month === selected} className={cn('tabular min-w-0 flex-1 py-1 text-center text-xs', s.month === selected ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            <span className="block">{monthLabel(s.month, { short: true, thisYear })}</span>
            <span className="block">{compact(s.spent)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** $1.2k, $840, $12k, $1.3M: axis and bar labels where the cents and the hundreds do not matter. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a < 1000) return `${sign}$${Math.round(a)}`;
  if (a < 1_000_000) return `${sign}$${(a / 1000).toFixed(a < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${sign}$${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

/** Net worth over time as a line; pointing at it reads out that date. */
export function TrendLine({ points, today }: { points: { date: string; net_worth: number; assets: number; liabilities: number }[]; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 600;
  const H = 140;
  const chart = lineLayout(points.map((p) => p.net_worth), { width: W, height: H, padX: 6, padY: 12 });
  const shown = points[active ?? points.length - 1]!;
  const dot = chart.points[active ?? points.length - 1]!;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(chart.points, ((e.clientX - box.left) / box.width) * W));
  };
  return (
    <div>
      <div className="tabular mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="text-muted-foreground">{dayLabel(shown.date, today)}</span>
        <span>
          <span className="font-medium">{money(shown.net_worth, { cents: false })}</span>
          <span className="text-muted-foreground">
            {' '}
            = {money(shown.assets, { cents: false })} − {money(shown.liabilities, { cents: false })} owed
          </span>
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Net worth from ${dayLabel(points[0]!.date, today)} to ${dayLabel(points[points.length - 1]!.date, today)}`} className="block h-36 w-full touch-pan-y" preserveAspectRatio="none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setActive(null)}>
          {chart.area && <path d={chart.area} fill="var(--primary)" opacity={0.08} />}
          <path d={chart.path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {active != null && <line x1={dot.x} x2={dot.x} y1={0} y2={H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* The marker is HTML so it stays round while the SVG stretches. */}
        <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary" style={{ left: `${(dot.x / W) * 100}%`, top: `${(dot.y / H) * 100}%` }} />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{dayLabel(points[0]!.date, today)}</span>
        <span>
          {compact(chart.min)} to {compact(chart.max)}
        </span>
        <span>{dayLabel(points[points.length - 1]!.date, today)}</span>
      </div>
    </div>
  );
}

// Mid-tone hues that hold up on both the light and the dark card. Each segment is also named with its value in the legend.
export const CLASS_COLORS: Record<string, string> = {
  us_stock: '#2f8f76', intl_stock: '#4f7fb5', bond: '#c0903f', cash: '#8d9a94', crypto: '#9a6fb8', real_estate: '#c26a57', other: '#6f7a86',
};

/** One bar split by share, with a legend that carries the names and numbers. */
export function StackedBar({ items }: { items: { key: string; label: string; share: number; value: number; color: string }[] }) {
  const segs = stackSegments(items);
  return (
    <div>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={items.map((i) => `${i.label} ${(i.share * 100).toFixed(0)}%`).join(', ')}>
        {segs.map((s) => s.widthPct > 0 && <span key={s.key} className="block h-full min-w-1" style={{ width: `${s.widthPct}%`, background: s.color }} />)}
      </div>
      <ul className="mt-3 grid gap-y-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
            <span className="tabular shrink-0 text-muted-foreground">{money(i.value, { cents: false })}</span>
            <span className="tabular w-11 shrink-0 text-right font-medium">{(i.share * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
