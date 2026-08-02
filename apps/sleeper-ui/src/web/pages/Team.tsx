import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmt1, record, useApi, type LeagueBundle, type RosterSlot, type Team } from '../api';
import {
  Avatar,
  Empty,
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

  return (
    <div className="pt-5 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
      {/* The picker stays put so comparing two rosters is one click, not a back button. */}
      <Panel title="Teams" className="lg:sticky lg:top-[72px]">
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
                  <div className="flex flex-wrap divide-x divide-line flex-1">
                    <Stat label="Record" value={record(row.wins, row.losses, row.ties)} size="lg" sub={`${ordinal(row.rank)} in league`} />
                    <Stat label="Points for" value={fmt1(row.pointsFor)} sub={`${fmt1(row.pointsAgainst)} against`} />
                    <Stat label="Efficiency" value={`${(row.efficiency * 100).toFixed(0)}%`} sub={`${fmt1(row.maxPoints - row.pointsFor)} left on bench`} />
                    <Stat label="All-play" value={record(row.allPlay.wins, row.allPlay.losses, row.allPlay.ties)} />
                    <Stat label="FAAB left" value={`$${league.waiverBudget - row.waiverBudgetUsed}`} sub={`of $${league.waiverBudget}`} />
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

            <RosterGroup title="Starting lineup" slots={data.slots.filter((s) => s.kind === 'starter')} />
            <RosterGroup title="Bench" slots={data.slots.filter((s) => s.kind === 'bench')} sortByPos />
            <RosterGroup title="Taxi squad" slots={data.slots.filter((s) => s.kind === 'taxi')} sortByPos />
            <RosterGroup title="Injured reserve" slots={data.slots.filter((s) => s.kind === 'ir')} sortByPos />
          </>
        )}
      </div>
    </div>
  );
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function RosterGroup({
  title,
  slots,
  sortByPos = false,
}: {
  title: string;
  slots: RosterSlot[];
  sortByPos?: boolean;
}) {
  if (!slots.length) {
    if (title === 'Taxi squad' || title === 'Injured reserve') return null;
    return (
      <Panel title={title}>
        <Empty title="Nobody here" />
      </Panel>
    );
  }

  const rows = sortByPos
    ? [...slots].sort((a, b) => {
        const ai = POS_ORDER.indexOf(a.player?.pos ?? '');
        const bi = POS_ORDER.indexOf(b.player?.pos ?? '');
        return (
          (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) ||
          (a.player?.name ?? '').localeCompare(b.player?.name ?? '')
        );
      })
    : slots;

  return (
    <Panel title={title} action={<span className="eyebrow">{slots.length}</span>}>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((slot, i) => (
          <PlayerCard key={`${slot.slot}-${slot.player?.id ?? i}`} slot={slot} />
        ))}
      </div>
    </Panel>
  );
}

function PlayerCard({ slot }: { slot: RosterSlot }) {
  const p = slot.player;
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-r border-line/50">
      <span
        className="chip shrink-0"
        style={{ background: '#161F29', color: '#93A2B2', minWidth: 44 }}
      >
        {slot.slot === 'SUPER_FLEX' ? 'SFLX' : slot.slot}
      </span>
      {p ? (
        <>
          <span className="min-w-0 flex-1">
            <PlayerLink
              id={p.id}
              name={p.name}
              className="block truncate leading-tight"
              style={{ fontSize: 'var(--t-body)' }}
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
          <Pos pos={p.pos} />
        </>
      ) : (
        <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>Empty slot</span>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
