import { posColor, type GameResult, type Team } from './api';

/* ------------------------------------------------------------------ *
 * Position chip — the sport's own colour vernacular, used as data.
 * ------------------------------------------------------------------ */
export function Pos({ pos, muted = false }: { pos: string | null | undefined; muted?: boolean }) {
  if (!pos) return <span className="chip text-dim">—</span>;
  const c = posColor(pos);
  const label = pos === 'SUPER_FLEX' ? 'SFLX' : pos;
  return (
    <span
      className="chip"
      style={{
        color: muted ? 'var(--pos-def)' : c,
        background: muted ? 'rgba(123,135,148,.10)' : `color-mix(in srgb, ${c} 16%, transparent)`,
        minWidth: 30,
      }}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Season tape — the signature element.
 *
 * One cell per regular-season week, coloured by result and sized by margin.
 * Reading across a row you see the whole season: streaks, blowouts, the week
 * everything fell apart. Sleeper makes you click through 14 screens for this.
 * ------------------------------------------------------------------ */
export function SeasonTape({
  results,
  onSelect,
}: {
  results: GameResult[];
  onSelect?: (week: number) => void;
}) {
  if (!results.length) return <span className="text-dim text-xs">No games yet</span>;

  const margins = results.map((r) => Math.abs(r.points - r.opponentPoints));
  const maxMargin = Math.max(...margins, 1);

  return (
    <div className="flex items-end gap-[2px]" role="img" aria-label="Weekly results">
      {results.map((r) => {
        const margin = Math.abs(r.points - r.opponentPoints);
        // Height encodes margin: a nail-biter reads visibly different from a rout.
        const h = 8 + Math.round((margin / maxMargin) * 12);
        const color = r.result === 'W' ? '#3FBF7F' : r.result === 'L' ? '#E5484D' : '#8494A5';
        return (
          <button
            key={r.week}
            type="button"
            onClick={() => onSelect?.(r.week)}
            title={`Week ${r.week}: ${r.result} ${r.points.toFixed(1)}–${r.opponentPoints.toFixed(1)}`}
            aria-label={`Week ${r.week}, ${r.result === 'W' ? 'win' : r.result === 'L' ? 'loss' : 'tie'}, ${r.points.toFixed(1)} to ${r.opponentPoints.toFixed(1)}`}
            className="w-[7px] rounded-[1px] transition-opacity hover:opacity-100"
            style={{ height: h, background: color, opacity: 0.82 }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Schedule luck — real record against all-play record.
 *
 * All-play asks "what if you played everyone every week", which strips the
 * schedule out. The gap between the two is luck, and it is the single most
 * argued-about thing in any league.
 * ------------------------------------------------------------------ */
export function LuckBar({
  actual,
  allPlay,
  played = true,
}: {
  actual: number;
  allPlay: number;
  played?: boolean;
}) {
  // Before any game is played there is no luck to measure, and a full red bar
  // reading "−50" for every team is worse than showing nothing.
  if (!played) return <span className="text-dim text-[11px]">—</span>;

  const delta = actual - allPlay;
  const magnitude = Math.min(Math.abs(delta) / 0.25, 1); // ±25pp saturates the bar
  const lucky = delta >= 0;
  const color = lucky ? '#3FBF7F' : '#E5484D';

  return (
    <div className="flex items-center gap-2" title={`Actual ${(actual * 100).toFixed(0)}% vs all-play ${(allPlay * 100).toFixed(0)}%`}>
      <div className="relative h-[6px] w-14 bg-line rounded-[1px]">
        <div className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line2" />
        <div
          className="absolute top-0 h-full rounded-[1px]"
          style={{
            background: color,
            width: `${magnitude * 50}%`,
            left: lucky ? '50%' : `${50 - magnitude * 50}%`,
            opacity: 0.9,
          }}
        />
      </div>
      <span
        className="font-display font-semibold text-[11px] tabular-nums w-9"
        style={{ color: Math.abs(delta) < 0.02 ? '#5B6977' : color }}
      >
        {delta >= 0 ? '+' : '−'}
        {Math.abs(delta * 100).toFixed(0)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Efficiency meter — points scored against the best lineup available.
 * ------------------------------------------------------------------ */
export function EfficiencyMeter({ value }: { value: number }) {
  if (value <= 0) return <span className="text-dim text-[11px]">—</span>;

  // Real managers land between roughly 80% and 95%; stretch that range so the
  // differences that matter are actually visible.
  const t = Math.max(0, Math.min(1, (value - 0.75) / 0.25));
  return (
    <div className="flex items-center gap-2">
      <div className="h-[6px] w-16 bg-line rounded-[1px] overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${Math.max(4, t * 100)}%`,
            background: `linear-gradient(90deg, #2A6B4C, #3FBF7F)`,
          }}
        />
      </div>
      <span className="font-display font-semibold text-[11px] text-muted tabular-nums w-9">
        {(value * 100).toFixed(1)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Team identity
 * ------------------------------------------------------------------ */
export function TeamBadge({
  team,
  size = 24,
  showManager = false,
  highlight = false,
}: {
  team: Team;
  size?: number;
  showManager?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar url={team.avatar} name={team.teamName} size={size} />
      <div className="min-w-0">
        <div
          className="font-display font-semibold uppercase truncate leading-tight"
          style={{ fontSize: 14, letterSpacing: '.02em', color: highlight ? '#3FBF7F' : undefined }}
        >
          {team.teamName}
        </div>
        {showManager && (
          <div className="text-dim truncate leading-tight" style={{ fontSize: 11 }}>
            {team.managerName}
          </div>
        )}
      </div>
    </div>
  );
}

export function Avatar({
  url,
  name,
  size = 24,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (!url) {
    return (
      <div
        className="shrink-0 grid place-items-center bg-raised border border-line font-display font-semibold text-dim"
        style={{ width: size, height: size, borderRadius: 3, fontSize: size * 0.45 }}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 object-cover bg-raised border border-line"
      style={{ width: size, height: size, borderRadius: 3 }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid place-items-center py-16 text-dim">
      <div className="eyebrow">{label}…</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="grid place-items-center gap-3 py-16 px-6 text-center">
      <div className="eyebrow" style={{ color: '#E5484D' }}>
        Could not load
      </div>
      <p className="text-muted max-w-sm text-[13px]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="tab border border-line2 hover:border-dim"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-2 py-14 px-6 text-center">
      <div className="eyebrow">{title}</div>
      {hint && <p className="text-dim max-w-xs text-[12px]">{hint}</p>}
    </div>
  );
}

/** Small labelled figure, used across the header strip. */
export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'win' | 'loss';
  sub?: string;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value mt-1"
        style={{ color: tone === 'win' ? '#3FBF7F' : tone === 'loss' ? '#E5484D' : undefined }}
      >
        {value}
      </div>
      {sub && <div className="text-dim text-[11px] mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}
