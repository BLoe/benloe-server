import { Link, useParams } from 'react-router-dom';
import { fmt1, record, useApi, type LeagueBundle, type RosterSlot, type Team } from '../api';
import { Avatar, Empty, ErrorState, Loading, Panel, Pos, TeamBadge } from '../components';

interface RosterResponse {
  team: Team;
  settings: Record<string, number>;
  slots: RosterSlot[];
}

export default function TeamPage({ bundle }: { bundle: LeagueBundle }) {
  const { rosterId } = useParams();
  const { league, standings, myRosterId } = bundle;
  const selected = Number(rosterId) || myRosterId || standings[0]?.rosterId;

  const { data, loading, error } = useApi<RosterResponse>(
    selected ? `/api/league/${league.leagueId}/roster/${selected}` : null
  );

  const row = standings.find((s) => s.rosterId === selected);

  return (
    <div className="pt-4 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
      {/* Team picker stays visible so comparing rosters is one click, not a back button. */}
      <Panel title="Teams" className="lg:sticky lg:top-[68px]">
        <ul className="max-h-[70vh] overflow-y-auto">
          {standings.map((s) => {
            const active = s.rosterId === selected;
            return (
              <li key={s.rosterId}>
                <Link
                  to={`/l/${league.leagueId}/teams/${s.rosterId}`}
                  className="flex items-center gap-2 px-3 py-2 border-b border-line/50 hover:bg-raised transition-colors"
                  style={{ background: active ? 'rgba(63,191,127,.10)' : undefined }}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="font-display font-semibold text-[11px] text-dim w-4 shrink-0">
                    {s.rank}
                  </span>
                  <Avatar url={s.avatar} name={s.teamName} size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display font-semibold uppercase text-[12px] truncate leading-tight">
                      {s.teamName}
                    </span>
                    <span className="block text-dim text-[10px] leading-tight">
                      {record(s.wins, s.losses, s.ties)}
                    </span>
                  </span>
                  {s.rosterId === myRosterId && (
                    <span className="chip shrink-0" style={{ color: '#3FBF7F', background: 'rgba(63,191,127,.14)' }}>
                      You
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="space-y-4 min-w-0">
        {loading && <Loading label="Loading roster" />}
        {error && <ErrorState message={error} />}
        {data && (
          <>
            <section className="panel flex flex-wrap items-center gap-4 p-4">
              <TeamBadge team={data.team} size={44} showManager />
              {row && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 ml-auto">
                  <MiniStat label="Record" value={record(row.wins, row.losses, row.ties)} />
                  <MiniStat label="Rank" value={`#${row.rank}`} />
                  <MiniStat label="Points for" value={fmt1(row.pointsFor)} />
                  <MiniStat label="Efficiency" value={`${(row.efficiency * 100).toFixed(1)}%`} />
                  <MiniStat
                    label="FAAB left"
                    value={`$${league.waiverBudget - row.waiverBudgetUsed}`}
                  />
                </div>
              )}
            </section>

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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="font-display font-semibold text-[17px] leading-tight">{value}</div>
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
    // Taxi and IR are legitimately empty most of the time; don't clutter the page.
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
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) ||
          (a.player?.name ?? '').localeCompare(b.player?.name ?? '');
      })
    : slots;

  return (
    <Panel title={title} action={<span className="eyebrow">{slots.length}</span>}>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((slot, i) => (
          <PlayerRow key={`${slot.slot}-${slot.player?.id ?? i}`} slot={slot} />
        ))}
      </div>
    </Panel>
  );
}

function PlayerRow({ slot }: { slot: RosterSlot }) {
  const p = slot.player;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-r border-line/50">
      <span
        className="chip shrink-0"
        style={{ background: '#161F29', color: '#8494A5', minWidth: 34 }}
      >
        {slot.slot === 'SUPER_FLEX' ? 'SFLX' : slot.slot}
      </span>
      {p ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] truncate leading-tight">{p.name}</span>
            <span className="block text-dim text-[10px] leading-tight">
              {p.team ?? 'Free agent'}
              {p.no ? ` · #${p.no}` : ''}
              {p.age ? ` · ${p.age}y` : ''}
              {p.bye ? ` · bye ${p.bye}` : ''}
            </span>
          </span>
          {p.status && (
            <span
              className="chip shrink-0"
              style={{ color: '#E5484D', background: 'rgba(229,72,77,.12)' }}
              title={`Injury status: ${p.status}`}
            >
              {p.status.slice(0, 3)}
            </span>
          )}
          <Pos pos={p.pos} />
        </>
      ) : (
        <span className="text-dim text-[12px]">Empty slot</span>
      )}
    </div>
  );
}
