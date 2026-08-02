import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmt1, useApi, type LeagueBundle, type PlayerDetail } from '../api';
import {
  Avatar,
  Crumb,
  Empty,
  ErrorState,
  Loading,
  Panel,
  Pos,
  Stat,
  TeamLink,
  teamHref,
  weekHref,
} from '../components';
import { WeeklyBars } from '../charts';

const HEADSHOT = (id: string) => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;

export default function PlayerPage({ bundle }: { bundle: LeagueBundle }) {
  const { playerId } = useParams();
  const { league } = bundle;
  const navigate = useNavigate();

  const { data, loading, error } = useApi<PlayerDetail>(
    playerId ? `/api/league/${league.leagueId}/player/${playerId}` : null
  );

  if (loading) return <Loading label="Loading player" />;
  if (error || !data) return <ErrorState message={error ?? 'Player not found.'} />;

  const p = data.player;
  const status = data.onIr ? 'Injured reserve' : data.onTaxi ? 'Taxi squad' : data.isStarter ? 'Starting' : null;

  return (
    <div className="pt-5 space-y-5">
      <div>
        <Crumb to={data.owner ? teamHref(league.leagueId, data.owner.rosterId) : `/l/${league.leagueId}`}>
          {data.owner ? data.owner.teamName : league.name}
        </Crumb>
      </div>

      <section className="panel">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex items-center gap-4 p-4 lg:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-line">
            {/* A headshot that fails to load falls back to initials rather than a broken frame. */}
            <PlayerFace id={p.id} name={p.name} />
            <div className="min-w-0">
              <h1 className="headline truncate" style={{ fontSize: 'var(--t-display)' }}>
                {p.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Pos pos={p.pos} />
                <span className="text-muted" style={{ fontSize: 'var(--t-body)' }}>
                  {p.team ?? 'Free agent'}
                  {p.no ? ` · #${p.no}` : ''}
                </span>
                {p.status && (
                  <span className="chip" style={{ color: 'var(--loss)', background: 'rgba(229,72,77,.14)' }}>
                    {p.status}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap divide-x divide-y lg:divide-y-0 divide-line flex-1">
            <Stat label="Season points" value={fmt1(data.totals.points)} size="lg" />
            <Stat label="Per game" value={fmt1(data.totals.average)} sub={`${data.totals.games} games`} />
            <Stat label="Best week" value={fmt1(data.totals.best)} />
            <Stat
              label="Rostered by"
              value={
                data.owner ? (
                  <TeamLink rosterId={data.owner.rosterId} style={{ fontSize: 'var(--t-h2)' }}>
                    {data.owner.teamName}
                  </TeamLink>
                ) : (
                  'Free agent'
                )
              }
              sub={status ?? data.owner?.managerName}
            />
            {p.bye != null && <Stat label="Bye" value={`Week ${p.bye}`} />}
            {p.age != null && <Stat label="Age" value={String(p.age)} />}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <Panel
          title="Points by week"
          action={<span className="eyebrow">Click a week to open that matchup</span>}
          note="Bar height is this player's fantasy points that week. Click a bar to open the matchup."
        >
          <div className="p-4">
            <WeeklyBars
              weeks={data.weeks.map((w) => ({ week: w.week, points: w.points, result: null }))}
              height={200}
              onSelect={(week) => navigate(weekHref(league.leagueId, week))}
              emptyLabel="No scoring recorded for this player yet"
            />
          </div>
        </Panel>

        {/* The chart shows the shape; the log answers "what exactly did he do in week 9". */}
        <Panel title="Game log">
          {!data.weeks.length && <Empty title="No games yet" />}
          <ul className="max-h-[320px] overflow-y-auto">
            {[...data.weeks].reverse().map((w) => (
              <li key={w.week} className="flex items-center gap-3 px-4 py-2 border-b border-line/60 last:border-b-0">
                <Link
                  to={weekHref(league.leagueId, w.week)}
                  className="link stat-label hover:text-ink"
                  style={{ minWidth: 52 }}
                >
                  Week {w.week}
                </Link>
                <span className="flex-1" />
                {!w.started && (
                  <span className="chip text-dim" style={{ background: '#161F29' }}>Bench</span>
                )}
                <span
                  className="font-display font-bold tabular-nums"
                  style={{ fontSize: 'var(--t-h2)', color: w.started ? undefined : '#93A2B2', minWidth: 52, textAlign: 'right' }}
                >
                  {fmt1(w.points)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {!!data.news.length && (
        <Panel title="Latest news">
          <ul>
            {data.news.map((n, i) => (
              <li key={i} className="px-4 py-3 border-b border-line/60 last:border-b-0">
                <p style={{ fontSize: 'var(--t-body)' }}>{n.title}</p>
                <p className="text-dim mt-1" style={{ fontSize: 'var(--t-meta)' }}>
                  {n.source ?? 'Sleeper'}
                  {n.published ? ` · ${new Date(n.published).toLocaleDateString()}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function PlayerFace({ id, name }: { id: string; name: string }) {
  return (
    <span className="relative shrink-0" style={{ width: 72, height: 72 }}>
      <Avatar url={null} name={name} size={72} rounded={4} />
      <img
        src={HEADSHOT(id)}
        alt=""
        width={72}
        height={72}
        loading="lazy"
        className="absolute inset-0 object-cover"
        style={{ width: 72, height: 72, borderRadius: 4 }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    </span>
  );
}
