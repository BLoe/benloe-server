import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fmt1,
  posInk,
  record,
  useApi,
  type DepthEntry,
  type LeagueBundle,
  type PositionGroup,
  type ProjectionMap,
  type RosterSlot,
  type Team,
} from '../api';
import {
  Avatar,
  ErrorState,
  Loading,
  Panel,
  Pos,
  PlayerLink,
  Stat,
  TeamBadge,
  teamHref,
  weekHref,
} from '../components';
import { WeeklyBars, WeeklyBarsLegend } from '../charts';

interface RosterResponse {
  team: Team;
  settings: Record<string, number>;
  slots: RosterSlot[];
  depth: PositionGroup[];
  /** Rotowire projections keyed by player id — weekly in season, season totals before it. */
  projections: ProjectionMap;
  /** "Week 3" or "2026 season" — what the projection numbers actually cover. */
  projectionScope: string;
}

export default function TeamPage({ bundle }: { bundle: LeagueBundle }) {
  const { rosterId } = useParams();
  const { league, standings, myRosterId } = bundle;
  const navigate = useNavigate();
  const selected = Number(rosterId) || myRosterId || standings[0]?.rosterId;

  const { data, loading, error } = useApi<RosterResponse>(
    selected ? `/api/league/${league.leagueId}/roster/${selected}` : null
  );

  const row = standings.find((s) => s.rosterId === selected);

  // What the current starting lineup is projected to score. Summed here rather
  // than on the server so it always matches the numbers shown on the rows.
  const projectedStarters = data
    ? data.slots.reduce(
        (sum, s) =>
          s.kind === 'starter' && s.player ? sum + (data.projections[s.player.id]?.points ?? 0) : sum,
        0
      ) || null
    : null;

  return (
    <div className="pt-5 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 lg:gap-5 items-start">
      {/* On a phone the twelve-team list pushed the roster you came to see below
          the fold, so it collapses to a switcher and the roster leads. */}
      <label className="lg:hidden panel flex items-center gap-2 px-3 py-2.5 relative">
        <span className="stat-label shrink-0">Team</span>
        <select
          aria-label="Choose a team"
          value={selected ?? ''}
          onChange={(e) => navigate(teamHref(league.leagueId, Number(e.target.value)))}
          className="flex-1 min-w-0 appearance-none bg-transparent text-ink font-display font-semibold uppercase truncate pr-5 outline-none"
          style={{ fontSize: 'var(--t-h2)', letterSpacing: '.02em' }}
        >
          {standings.map((s) => (
            <option key={s.rosterId} value={s.rosterId} style={{ background: '#111820' }}>
              {s.rank}. {s.teamName} ({record(s.wins, s.losses, s.ties)})
              {s.rosterId === myRosterId ? ' — you' : ''}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 text-dim" aria-hidden="true">▾</span>
      </label>

      <Panel title="Teams" className="hidden lg:block lg:sticky lg:top-[72px]">
        <ul className="max-h-[70vh] overflow-y-auto">
          {standings.map((s) => {
            const active = s.rosterId === selected;
            return (
              <li key={s.rosterId}>
                <Link
                  to={teamHref(league.leagueId, s.rosterId)}
                  className="flex items-center gap-2.5 px-3 py-2.5 border-b border-line/50 hover:bg-raised transition-colors"
                  style={{ background: active ? 'rgba(63,191,127,.10)' : undefined }}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="font-display font-semibold text-dim w-4 shrink-0" style={{ fontSize: 'var(--t-meta)' }}>
                    {s.rank}
                  </span>
                  <Avatar url={s.avatar} name={s.teamName} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block entity truncate" style={{ fontSize: 'var(--t-body)' }}>
                      {s.teamName}
                    </span>
                    <span className="block text-dim leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
                      {record(s.wins, s.losses, s.ties)}
                    </span>
                  </span>
                  {s.rosterId === myRosterId && (
                    <span className="chip shrink-0" style={{ color: 'var(--win)', background: 'rgba(63,191,127,.16)' }}>
                      You
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="space-y-5 min-w-0">
        {loading && <Loading label="Loading roster" />}
        {error && <ErrorState message={error} />}
        {data && (
          <>
            <section className="panel">
              <div className="flex flex-col xl:flex-row xl:items-stretch">
                <div className="flex items-center gap-3.5 p-4 xl:w-[320px] shrink-0 border-b xl:border-b-0 xl:border-r border-line">
                  <TeamBadge team={data.team} size={48} showManager link={false} nameSize="var(--t-h1)" />
                </div>
                {row && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:flex xl:flex-wrap divide-x divide-y xl:divide-y-0 divide-line flex-1">
                    <Stat label="Record" value={record(row.wins, row.losses, row.ties)} size="lg" sub={`${ordinal(row.rank)} in league`} />
                    <Stat label="Points for" value={fmt1(row.pointsFor)} sub={`${fmt1(row.pointsAgainst)} against`} />
                    <Stat label="Efficiency" value={`${(row.efficiency * 100).toFixed(0)}%`} sub={`${fmt1(row.maxPoints - row.pointsFor)} left on bench`} />
                    <Stat label="All-play" value={record(row.allPlay.wins, row.allPlay.losses, row.allPlay.ties)} />
                    <Stat label="FAAB left" value={`$${league.waiverBudget - row.waiverBudgetUsed}`} sub={`of $${league.waiverBudget}`} />
                    {projectedStarters != null && (
                      <Stat
                        label="Projected"
                        value={fmt1(projectedStarters)}
                        sub={`starters · ${data.projectionScope.toLowerCase()}`}
                      />
                    )}
                  </div>
                )}
              </div>
            </section>

            {row && !!row.results.length && (
              <Panel
                title="Season by week"
                action={<WeeklyBarsLegend />}
                note="Bar height is this team's score. The white tick is what their opponent scored that week."
              >
                <div className="p-4">
                  <WeeklyBars
                    weeks={row.results.map((r) => ({
                      week: r.week,
                      points: r.points,
                      opponentPoints: r.opponentPoints,
                      result: r.result,
                    }))}
                    height={168}
                    onSelect={(week) => navigate(weekHref(league.leagueId, week))}
                  />
                </div>
              </Panel>
            )}

            {data.depth.map((group) => (
              <DepthGroup
                key={group.pos}
                group={group}
                projections={data.projections}
                scope={data.projectionScope}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One position, whole depth chart.
 *
 * A dynasty manager asks "how deep am I at running back", and the answer is
 * spread across the starting lineup, the flex, the bench and the taxi squad.
 * Grouping by position puts all of it in one place, with each player carrying
 * where they currently sit — so a flex RB stays with the other RBs rather than
 * disappearing into a separate lineup panel.
 */
function DepthGroup({
  group,
  projections,
  scope,
}: {
  group: PositionGroup;
  projections: ProjectionMap;
  scope: string;
}) {
  const c = group.counts;
  const hasProjections = group.entries.some((e) => projections[e.player.id]);
  const summary = [
    c.starting ? `${c.starting} starting` : null,
    c.flex ? `${c.flex} in flex` : null,
    c.bench ? `${c.bench} on bench` : null,
    c.taxi ? `${c.taxi} taxi` : null,
    c.ir ? `${c.ir} IR` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Panel
      title={
        <span className="flex items-baseline gap-2.5">
          <span style={{ color: posInk(group.pos), fontSize: 'var(--t-h2)' }}>{group.pos}</span>
          <span className="text-dim normal-case tracking-normal" style={{ fontSize: 'var(--t-meta)' }}>
            {summary || 'nobody'}
          </span>
        </span>
      }
      action={
        <span className="eyebrow">
          {hasProjections ? `proj · ${scope.toLowerCase()}` : group.entries.length}
        </span>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
        {group.entries.map((e) => (
          <DepthRow key={e.player.id} entry={e} projection={projections[e.player.id] ?? null} />
        ))}
        {group.emptySlots.map((slot, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 px-3.5 py-2.5 border-b border-r border-line/50"
          >
            <StatusBadge slot={slot} kind="starter" isFlex={false} />
            <span className="text-dim" style={{ fontSize: 'var(--t-body)' }}>
              Nobody in this slot
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DepthRow({
  entry,
  projection,
}: {
  entry: DepthEntry;
  projection: { points: number; games: number | null } | null;
}) {
  const p = entry.player;
  const starting = entry.kind === 'starter';
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-2.5 border-b border-r border-line/50"
      style={{ background: starting ? 'rgba(63,191,127,.05)' : undefined }}
    >
      {/* A green rail is the fastest read of "is this player in my lineup". */}
      <span
        className="w-[3px] self-stretch shrink-0 rounded-full"
        style={{ background: starting ? 'var(--win)' : 'transparent' }}
        aria-hidden="true"
      />
      <StatusBadge slot={entry.slot} kind={entry.kind} isFlex={entry.isFlex} />
      <span className="min-w-0 flex-1">
        <PlayerLink
          id={p.id}
          name={p.name}
          className="block truncate leading-tight"
          style={{ fontSize: 'var(--t-body)', color: starting ? undefined : '#93A2B2' }}
        />
        <span className="block text-dim leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
          {p.team ?? 'Free agent'}
          {p.no ? ` · #${p.no}` : ''}
          {p.age ? ` · ${p.age}y` : ''}
          {p.bye ? ` · bye ${p.bye}` : ''}
        </span>
      </span>
      {p.status && (
        <span
          className="chip shrink-0"
          style={{ color: 'var(--loss)', background: 'rgba(229,72,77,.14)' }}
          title={`Injury status: ${p.status}`}
        >
          {p.status.slice(0, 3)}
        </span>
      )}
      {/* Projected points sit at the end of the row so a column of numbers
          reads down the depth chart — the whole point of grouping by position
          is comparing the players you could start against each other. */}
      <span
        className="font-display font-bold tabular-nums shrink-0 text-right"
        style={{
          fontSize: 'var(--t-h2)',
          width: 48,
          color: projection ? (starting ? '#E8EDF2' : '#93A2B2') : '#4B5A68',
        }}
        title={projection ? `Projected ${fmt1(projection.points)} points` : 'No projection'}
      >
        {projection ? fmt1(projection.points) : '—'}
      </span>
    </div>
  );
}

/**
 * Where this player sits. Colour separates the three ideas: green for a lineup
 * slot, amber for a flex slot (starting, but filling in elsewhere), grey for
 * everything not playing this week.
 */
function StatusBadge({
  slot,
  kind,
  isFlex,
}: {
  slot: string;
  kind: DepthEntry['kind'];
  isFlex: boolean;
}) {
  const label = slot === 'SUPER_FLEX' ? 'SFLX' : slot;
  const style =
    kind !== 'starter'
      ? { color: '#93A2B2', background: '#161F29' }
      : isFlex
        ? { color: 'var(--pos-flex-ink)', background: 'color-mix(in srgb, var(--pos-flex) 22%, transparent)' }
        : { color: 'var(--win)', background: 'rgba(63,191,127,.16)' };

  return (
    <span className="chip shrink-0" style={{ ...style, minWidth: 48 }}>
      {label}
    </span>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
