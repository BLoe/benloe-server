import { useState } from 'react';
import { cost } from '@/lib/format';

export interface Day {
  day: string;
  cost_usd: number;
}

/** The last `count` UTC days ending today, with zero for days that had no spend. */
export function fillDays(rows: Day[], now: Date, count = 30): Day[] {
  const byDay = new Map(rows.map((r) => [r.day, r.cost_usd]));
  const out: Day[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, cost_usd: byDay.get(day) ?? 0 });
  }
  return out;
}

const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Spend per day as bars. Hand-drawn SVG: thirty rectangles do not need a chart library. */
export function DailyBars({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cost_usd), 0);
  const W = 600;
  const H = 120;
  const slot = W / days.length;
  const barW = slot * 0.7;
  const shown = active != null ? days[active] : null;
  if (max === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No spend in the last 30 days.</p>;
  return (
    <div>
      <div className="tabular mb-2 flex h-5 items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{shown ? label(shown.day) : `Highest day ${cost(max)}`}</span>
        {shown && <span className="font-medium">{cost(shown.cost_usd)}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily spend for the last ${days.length} days; the highest day was ${cost(max)}`} className="block h-28 w-full touch-pan-y" preserveAspectRatio="none" onPointerLeave={() => setActive(null)}>
        {days.map((d, i) => {
          const h = d.cost_usd > 0 ? Math.max(2, (d.cost_usd / max) * (H - 4)) : 0;
          return (
            <g key={d.day} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
              {/* The full-height slot is the hit target, so short bars are as easy to point at as tall ones. */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              <rect x={i * slot + (slot - barW) / 2} y={H - h} width={barW} height={h} rx={2} fill={active === i ? 'var(--foreground)' : 'var(--primary)'} opacity={active === null || active === i ? 1 : 0.55} />
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{label(days[0]!.day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
