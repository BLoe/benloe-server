import { Link, useParams } from 'react-router-dom';
import { posColor, posInk, type Team } from './api';

/* ------------------------------------------------------------------ *
 * Entity links
 *
 * Every named thing in this app is a place you can go. These wrappers make
 * that the default rather than something each page remembers to do.
 * ------------------------------------------------------------------ */

/** Current league id, so link helpers do not have to be passed it everywhere. */
export function useLeagueId(): string {
  const { leagueId } = useParams();
  return leagueId ?? '';
}

export const teamHref = (leagueId: string, rosterId: number) =>
  `/l/${leagueId}/teams/${rosterId}`;
export const playerHref = (leagueId: string, playerId: string) =>
  `/l/${leagueId}/players/${playerId}`;
export const matchupHref = (leagueId: string, week: number, matchupId: number) =>
  `/l/${leagueId}/matchups/${week}/${matchupId}`;
export const weekHref = (leagueId: string, week: number) => `/l/${leagueId}/matchups/${week}`;

/** A player's name, always navigable. */
export function PlayerLink({
  id,
  name,
  className = '',
  style,
}: {
  id: string | null | undefined;
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const leagueId = useLeagueId();
  if (!id) return <span className={className} style={style}>{name}</span>;
  return (
    <Link to={playerHref(leagueId, id)} className={`link ${className}`} style={style}>
      {name}
    </Link>
  );
}

/** A team's name, always navigable. */
export function TeamLink({
  rosterId,
  children,
  className = '',
  style,
}: {
  rosterId: number | null | undefined;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const leagueId = useLeagueId();
  if (rosterId == null) return <span className={className} style={style}>{children}</span>;
  return (
    <Link to={teamHref(leagueId, rosterId)} className={`link ${className}`} style={style}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Position chip — the sport's own colour vernacular, used as data.
 * The text is always present, which is the secondary encoding that keeps
 * these readable for colour-blind readers.
 * ------------------------------------------------------------------ */
export function Pos({ pos, muted = false }: { pos: string | null | undefined; muted?: boolean }) {
  if (!pos) return <span className="chip text-dim">—</span>;
  const label = pos === 'SUPER_FLEX' ? 'SFLX' : pos;
  return (
    <span
      className="chip"
      style={{
        color: muted ? 'var(--pos-def-ink)' : posInk(pos),
        background: muted ? 'rgba(123,135,148,.12)' : `color-mix(in srgb, ${posColor(pos)} 22%, transparent)`,
        minWidth: 34,
      }}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Team identity
 * ------------------------------------------------------------------ */
export function TeamBadge({
  team,
  size = 26,
  showManager = false,
  highlight = false,
  link = true,
  nameSize,
}: {
  team: Team;
  size?: number;
  showManager?: boolean;
  highlight?: boolean;
  link?: boolean;
  nameSize?: string;
}) {
  const name = (
    <span
      className="entity block truncate"
      style={{ fontSize: nameSize ?? 'var(--t-h2)', color: highlight ? 'var(--win)' : undefined }}
    >
      {team.teamName}
    </span>
  );

  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <Avatar url={team.avatar} name={team.teamName} size={size} />
      <span className="min-w-0">
        {link ? (
          <TeamLink rosterId={team.rosterId} className="block min-w-0">
            {name}
          </TeamLink>
        ) : (
          name
        )}
        {showManager && (
          <span className="block text-dim truncate leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
            {team.managerName}
          </span>
        )}
      </span>
    </span>
  );
}

export function Avatar({
  url,
  name,
  size = 26,
  rounded = 3,
}: {
  url: string | null;
  name: string;
  size?: number;
  rounded?: number;
}) {
  if (!url) {
    return (
      <span
        className="shrink-0 grid place-items-center bg-raised border border-line font-display font-semibold text-dim"
        style={{ width: size, height: size, borderRadius: rounded, fontSize: size * 0.45 }}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
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
      style={{ width: size, height: size, borderRadius: rounded }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces and states
 * ------------------------------------------------------------------ */
export function Panel({
  title,
  action,
  children,
  className = '',
  note,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  note?: React.ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </header>
      {children}
      {note && (
        <footer className="px-4 py-2.5 border-t border-line text-dim" style={{ fontSize: 'var(--t-meta)' }}>
          {note}
        </footer>
      )}
    </section>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid place-items-center py-20 text-muted">
      <div className="eyebrow">{label}…</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="grid place-items-center gap-3 py-16 px-6 text-center">
      <div className="eyebrow" style={{ color: 'var(--loss)' }}>Could not load</div>
      <p className="text-muted max-w-md" style={{ fontSize: 'var(--t-body)' }}>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="tab border border-line2 hover:border-dim">
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
      {hint && <p className="text-dim max-w-sm" style={{ fontSize: 'var(--t-meta)' }}>{hint}</p>}
    </div>
  );
}

/** Labelled figure. The label sits above at a readable size, not a whisper. */
export function Stat({
  label,
  value,
  tone,
  sub,
  size = 'md',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'win' | 'loss';
  sub?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="px-4 py-3">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value mt-1.5"
        style={{
          fontSize: size === 'lg' ? 'var(--t-hero)' : 'var(--t-h1)',
          color: tone === 'win' ? 'var(--win)' : tone === 'loss' ? 'var(--loss)' : undefined,
        }}
      >
        {value}
      </div>
      {sub && <div className="stat-sub mt-1">{sub}</div>}
    </div>
  );
}

/** A back/context line above a page title. */
export function Crumb({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="eyebrow link inline-flex items-center gap-1.5 hover:text-ink">
      ← {children}
    </Link>
  );
}
