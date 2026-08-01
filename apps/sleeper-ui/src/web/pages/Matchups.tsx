import { Link, useParams } from 'react-router-dom';
import { fmt1, useApi, type LeagueBundle, type Matchup, type MatchupSide, type RosterSlot } from '../api';
import { Empty, ErrorState, Loading, Panel, Pos, TeamBadge } from '../components';

export default function Matchups({ bundle }: { bundle: LeagueBundle }) {
  const { week: weekParam } = useParams();
  const { league, currentWeek, myRosterId } = bundle;
  const week = Number(weekParam) || currentWeek;

  const { data, loading, error } = useApi<{ week: number; matchups: Matchup[] }>(
    `/api/league/${league.leagueId}/matchups/${week}`
  );

  const lastWeek = league.status === 'complete' ? league.playoffWeekStart + 2 : currentWeek;
  const weeks = Array.from({ length: Math.max(1, lastWeek) }, (_, i) => i + 1);

  return (
    <div className="pt-4 space-y-4">
      <nav className="panel flex items-center gap-1 px-2 py-1.5 overflow-x-auto" aria-label="Weeks">
        <span className="stat-label px-2 shrink-0">Week</span>
        {weeks.map((w) => (
          <Link
            key={w}
            to={`/l/${league.leagueId}/matchups/${w}`}
            className="font-display font-semibold text-[13px] px-2 py-1 rounded-[3px] shrink-0 transition-colors"
            style={
              w === week
                ? { background: '#3FBF7F', color: '#0A0E13' }
                : { color: w >= league.playoffWeekStart ? '#F5C518' : '#8494A5' }
            }
            aria-current={w === week ? 'page' : undefined}
          >
            {w}
          </Link>
        ))}
        {league.playoffWeekStart <= lastWeek && (
          <span className="text-dim text-[11px] pl-2 shrink-0">gold = playoffs</span>
        )}
      </nav>

      {loading && <Loading label={`Loading week ${week}`} />}
      {error && <ErrorState message={error} />}
      {data && !data.matchups.length && (
        <Panel title={`Week ${week}`}>
          <Empty title="No matchups this week" hint="Nothing has been scheduled yet." />
        </Panel>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        {data?.matchups.map((m) => (
          <MatchupCard key={m.matchupId} matchup={m} myRosterId={myRosterId} />
        ))}
      </div>
    </div>
  );
}

/**
 * Side-by-side lineups on one screen. On Sleeper's desktop site this takes a tap
 * into the matchup and a lot of vertical scrolling; the whole point of a laptop
 * layout is that both rosters fit at once.
 */
function MatchupCard({ matchup, myRosterId }: { matchup: Matchup; myRosterId: number | null }) {
  const { home, away } = matchup;
  if (!away) {
    return (
      <Panel title={`Matchup ${matchup.matchupId}`}>
        <div className="p-4">
          <TeamBadge team={home.team} size={28} showManager />
          <p className="text-dim text-[12px] mt-2">No opponent scheduled.</p>
        </div>
      </Panel>
    );
  }

  const rows = Math.max(home.lineup.length, away.lineup.length);
  const starters = (side: MatchupSide) => side.lineup.filter((s) => s.kind === 'starter');
  const homeStarters = starters(home);
  const awayStarters = starters(away);
  const slotCount = Math.max(homeStarters.length, awayStarters.length);

  return (
    <section className="panel">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-3 border-b border-line">
        <div className="min-w-0">
          <TeamBadge team={home.team} size={30} showManager highlight={home.rosterId === myRosterId} />
        </div>
        <div className="text-center px-2">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-bold text-[24px] tabular-nums leading-none">
              {fmt1(home.points)}
            </span>
            <span className="text-dim text-[12px]">–</span>
            <span
              className="font-display font-bold text-[24px] tabular-nums leading-none"
              style={{ color: '#5B6977' }}
            >
              {fmt1(away.points)}
            </span>
          </div>
          <div className="stat-label mt-1">
            {matchup.margin === 0 ? 'Tied' : `by ${fmt1(matchup.margin)}`}
          </div>
        </div>
        <div className="min-w-0 flex justify-end">
          <div className="text-right">
            <TeamBadge team={away.team} size={30} showManager highlight={away.rosterId === myRosterId} />
          </div>
        </div>
      </header>

      <div>
        {Array.from({ length: slotCount }, (_, i) => {
          const h = homeStarters[i];
          const a = awayStarters[i];
          const slot = h?.slot ?? a?.slot ?? '';
          const hp = h?.points ?? 0;
          const ap = a?.points ?? 0;
          return (
            <div
              key={i}
              className="grid grid-cols-[1fr_54px_1fr] items-center gap-2 px-3 py-1.5 border-b border-line/50 last:border-b-0"
            >
              <PlayerLine slot={h} points={hp} better={hp > ap} align="left" />
              <div className="text-center">
                <span className="chip text-dim" style={{ background: '#161F29' }}>
                  {slot === 'SUPER_FLEX' ? 'SFLX' : slot}
                </span>
              </div>
              <PlayerLine slot={a} points={ap} better={ap > hp} align="right" />
            </div>
          );
        })}
      </div>

      <footer className="px-3 py-2 border-t border-line flex justify-between text-dim text-[11px]">
        <span>Bench not shown</span>
        <span>{fmt1(matchup.total)} combined</span>
      </footer>
    </section>
  );
}

function PlayerLine({
  slot,
  points,
  better,
  align,
}: {
  slot: RosterSlot | undefined;
  points: number;
  better: boolean;
  align: 'left' | 'right';
}) {
  if (!slot?.player) {
    return (
      <div className={align === 'right' ? 'text-right' : ''}>
        <span className="text-dim text-[12px]">Empty</span>
      </div>
    );
  }
  const p = slot.player;
  // The centre column already names the slot. Only show a position chip when it
  // adds something — a flex slot, where which position filled it is the story.
  const flexish = slot.slot === 'FLEX' || slot.slot === 'SUPER_FLEX';
  const content = (
    <>
      <span className="truncate text-[13px]">{p.name}</span>
      <span className="text-dim text-[11px] shrink-0">{p.team ?? 'FA'}</span>
      {flexish && <Pos pos={p.pos} />}
    </>
  );

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span
        className="font-display font-bold tabular-nums text-[14px] w-11 shrink-0"
        style={{
          color: better ? '#E8EDF2' : '#8494A5',
          textAlign: align === 'right' ? 'left' : 'right',
        }}
      >
        {points ? fmt1(points) : '—'}
      </span>
      <span
        className={`flex items-center gap-1.5 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {content}
      </span>
    </div>
  );
}
