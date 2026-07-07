/** Data widgets — hand-rolled SVG, no charting library (§12.3). */

export function MacroRing({ data }: { data: Record<string, unknown> }) {
  const kcal = Number(data.kcal ?? 0);
  const rows = [
    { label: 'protein', value: Number(data.protein_g ?? 0), target: Number(data.protein_target ?? 185), color: 'var(--amber)' },
    { label: 'carbs', value: Number(data.carbs_g ?? 0), target: Number(data.carbs_target ?? 250), color: 'var(--ok)' },
    { label: 'fat', value: Number(data.fat_g ?? 0), target: Number(data.fat_target ?? 80), color: 'var(--dim)' },
  ];
  const R = [44, 34, 24];
  return (
    <div className="widget">
      <div className="w-title">Macros — {String(data.local_day ?? 'today')}</div>
      <div className="macro-ring">
        <svg width="110" height="110" viewBox="0 0 110 110" role="img" aria-label="macro progress rings">
          {rows.map((r, i) => {
            const radius = R[i]!;
            const c = 2 * Math.PI * radius;
            const frac = Math.min(1, r.target > 0 ? r.value / r.target : 0);
            return (
              <g key={r.label}>
                <circle cx="55" cy="55" r={radius} fill="none" stroke="var(--ink-2)" strokeWidth="7" />
                <circle
                  cx="55" cy="55" r={radius} fill="none" stroke={r.color} strokeWidth="7"
                  strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round" transform="rotate(-90 55 55)"
                />
              </g>
            );
          })}
        </svg>
        <div className="legend">
          {rows.map((r) => (
            <span key={r.label}>
              <span style={{ color: r.color }}>■</span> {r.label} {Math.round(r.value)}/{r.target}g
            </span>
          ))}
          <span style={{ color: 'var(--dim)' }}>{Math.round(kcal)} kcal</span>
        </div>
      </div>
    </div>
  );
}

export function WeightChart({ data }: { data: Record<string, unknown> }) {
  const points = (data.points ?? []) as { local_day: string; value: number; trend: number }[];
  if (points.length === 0) return null;
  const values = points.flatMap((p) => [p.value, p.trend]);
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const W = 320;
  const H = 110;
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 16) + 8);
  const y = (v: number) => H - 14 - ((v - min) / (max - min)) * (H - 28);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  return (
    <div className="widget weight-chart">
      <div className="w-title">
        Weight — trend {String(data.trend ?? '')} lb{data.weeklyDelta != null ? ` (${Number(data.weeklyDelta) > 0 ? '+' : ''}${data.weeklyDelta}/wk)` : ''}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="weight trend chart">
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="2" fill="var(--dim)" opacity="0.6" />
        ))}
        <path d={path} fill="none" stroke="var(--amber)" strokeWidth="2" />
        <text x="8" y={H - 2} fontSize="9" fill="var(--dim)" fontFamily="var(--mono)">{points[0]!.local_day}</text>
        <text x={W - 8} y={H - 2} fontSize="9" fill="var(--dim)" textAnchor="end" fontFamily="var(--mono)">
          {points.at(-1)!.local_day}
        </text>
      </svg>
    </div>
  );
}

export function BriefingCard({ data }: { data: Record<string, unknown> }) {
  const sections = (data.sections ?? []) as { title: string; body?: string; items?: string[] }[];
  return (
    <div className="widget">
      <div className="w-title">{String(data.title ?? 'Briefing')}</div>
      {sections.map((s, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', letterSpacing: '0.08em' }}>{s.title}</div>
          {s.body && <div style={{ fontSize: 13 }}>{s.body}</div>}
          {s.items && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {s.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export function GroceryChecklist({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as { name: string; quantity?: number; unit?: string; checked?: boolean }[];
  return (
    <div className="widget grocery">
      <div className="w-title">Grocery list</div>
      {items.map((it, i) => (
        <label key={i}>
          <input type="checkbox" defaultChecked={!!it.checked} />
          <span>{it.name}{it.quantity ? ` — ${it.quantity}${it.unit ?? ''}` : ''}</span>
        </label>
      ))}
    </div>
  );
}

export function MoodCheckin({ data, onSubmit }: { data: Record<string, unknown>; onSubmit?: (kind: string, value: number) => void }) {
  const scales: [string, string][] = [['mood', 'Mood'], ['energy', 'Energy'], ['stress', 'Stress']];
  return (
    <div className="widget">
      <div className="w-title">{String(data.prompt ?? 'Evening check-in')}</div>
      {scales.map(([kind, label]) => (
        <div key={kind} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', marginBottom: 3 }}>{label}</div>
          <div className="checkin-row">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} onClick={() => onSubmit?.(kind, v)}>{v}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Widget({ widgetType, data, onCheckin }: { widgetType: string; data: Record<string, unknown>; onCheckin?: (k: string, v: number) => void }) {
  switch (widgetType) {
    case 'macro-ring': return <MacroRing data={data} />;
    case 'weight-chart': return <WeightChart data={data} />;
    case 'briefing': return <BriefingCard data={data} />;
    case 'grocery': return <GroceryChecklist data={data} />;
    case 'checkin': return <MoodCheckin data={data} onSubmit={onCheckin} />;
    default:
      return (
        <div className="widget">
          <div className="w-title">{widgetType}</div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(data, null, 2)}</pre>
        </div>
      );
  }
}
