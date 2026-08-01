import { Link } from 'react-router-dom';
import { fmt1, record, useApi, type LeagueBundle, type Matchup, type StandingsRow } from '../api';
import {
  Empty,
  EfficiencyMeter,
  LuckBar,
  Panel,
  SeasonTape,
  Stat,
  TeamBadge,
} from '../components';

export default function Dashboard({ bundle }: { bundle: LeagueBundle }) {
  const { league, standings, myRosterId, currentWeek } = bundle;
  const me = standings.find((s) => s.rosterId === myRosterId) ?? null;

  const week = useApi<{ week: number; matchups: Matchup[] }>(
    `/api/league/${league.leagueId}/matchups/${currentWeek}`
  );

  return (
    <div className="pt-4 space-y-4">
      {me && <MyTeamStrip row={me} league={league} standings={standings} />}

      <Scoreboard
        matchups={week.data?.matchups ?? []}
        week={currentWeek}
        leagueId={league.leagueId}
        myRosterId={myRosterId}
        loading={week.loading}
      />

      <Standings bundle={bundle} />
    </div>
  );
}

/**
 * The one panel that answers "how am I doing" without a click. Everything here is
 * about my team relative to the field, which is the question you actually open a
 * fantasy site to answer.
 */
function MyTeamStrip({
  row,
  league,
  standings,
}: {
  row: StandingsRow;
  league: LeagueBundle['league'];
  standings: StandingsRow[];
}) {
  const pfRank = [...standings].sort((a, b) => b.pointsFor - a.pointsFor).findIndex((s) => s.rosterId === row.rosterId) + 1;
  const effRank = [...standings].sort((a, b) => b.efficiency - a.efficiency).findIndex((s) => s.rosterId === row.rosterId) + 1;
  const inPlayoffs = row.rank <= league.playoffTeams;
  const pointsLeft = Math.round((row.maxPoints - row.pointsFor) * 10) / 10;
  const played = row.wins + row.losses + row.ties > 0;

  // Before kickoff every derived stat is either zero or meaningless. Say what is
  // actually true — the season has not started — instead of ranking nothing.
  if (!played) {
    return (
      <section className="panel">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex items-center gap-3 p-4 lg:w-[280px] shrink-0 border-b lg:border-b-0 lg:border-r border-line">
            <TeamBadge team={row} size={44} showManager />
          </div>
          <div className="flex flex-wrap divide-x divide-line flex-1">
            <Stat label="Season" value={league.season} sub="not started" />
            <Stat
              label="FAAB"
              value={`$${league.waiverBudget - row.waiverBudgetUsed}`}
              sub={`of $${league.waiverBudget}`}
            />
            <Stat label="League" value={`${standings.length} teams`} sub={`top ${league.playoffTeams} make playoffs`} />
            <Stat label="Playoffs start" value={`Wk ${league.playoffWeekStart}`} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div className="flex items-center gap-3 p-4 lg:w-[280px] shrink-0 border-b lg:border-b-0 lg:border-r border-line">
          <TeamBadge team={row} size={44} showManager />
        </div>

        <div className="flex flex-wrap divide-x divide-line flex-1">
          <Stat
            label="Record"
            value={record(row.wins, row.losses, row.ties)}
            sub={`${row.streak} · ${ordinal(row.rank)} of ${standings.length}`}
            tone={row.winPct >= 0.5 ? 'win' : 'loss'}
          />
          <Stat label="Points for" value={fmt1(row.pointsFor)} sub={`${ordinal(pfRank)} in league`} />
          <Stat
            label="Left on bench"
            value={fmt1(pointsLeft)}
            sub={`${ordinal(effRank)} best lineups`}
            tone={effRank <= standings.length / 2 ? 'win' : 'loss'}
          />
          <Stat
            label="All-play"
            value={record(row.allPlay.wins, row.allPlay.losses, row.allPlay.ties)}
            sub={luckLabel(row)}
          />
          <Stat
            label="FAAB left"
            value={`$${league.waiverBudget - row.waiverBudgetUsed}`}
            sub={`of $${league.waiverBudget}`}
          />
          <Stat
            label="Playoffs"
            value={inPlayoffs ? 'In' : 'Out'}
            tone={inPlayoffs ? 'win' : 'loss'}
            sub={`top ${league.playoffTeams} qualify`}
          />
        </div>
      </div>
    </section>
  );
}

function luckLabel(row: StandingsRow): string {
  const delta = row.winPct - row.allPlay.pct;
  if (Math.abs(delta) < 0.03) return 'schedule neutral';
  return delta > 0 ? 'schedule helped' : 'schedule hurt';
}

/** Every game in the week at a glance, like a broadcast score bug. */
function Scoreboard({
  matchups,
  week,
  leagueId,
  myRosterId,
  loading,
}: {
  matchups: Matchup[];
  week: number;
  leagueId: string;
  myRosterId: number | null;
  loading: boolean;
}) {
  return (
    <Panel
      title={`Week ${week} scoreboard`}
      action={
        <Link to={`/l/${leagueId}/matchups/${week}`} className="eyebrow hover:text-ink">
          All matchups →
        </Link>
      }
    >
      {loading && <Empty title="Loading scores" />}
      {!loading && !matchups.length && (
        <Empty title="No games scheduled" hint="Matchups appear once the season starts." />
      )}
      {!!matchups.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 divide-y sm:divide-y-0 divide-line">
          {matchups.map((m, i) => (
            <Link
              key={m.matchupId}
              to={`/l/${leagueId}/matchups/${week}`}
              className="block p-3 hover:bg-raised transition-colors"
              style={{
                borderRight: (i + 1) % 3 === 0 ? undefined : '1px solid #1E2A36',
                borderTop: i >= 3 ? '1px solid #1E2A36' : undefined,
              }}
            >
              <GameLine side={m.home} opponent={m.away?.points ?? 0} mine={myRosterId} winner />
              <div className="h-1" />
              {m.away && (
                <GameLine side={m.away} opponent={m.home.points} mine={myRosterId} winner={false} />
              )}
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function GameLine({
  side,
  opponent,
  mine,
  winner,
}: {
  side: Matchup['home'];
  opponent: number;
  mine: number | null;
  winner: boolean;
}) {
  const isMe = side.rosterId === mine;
  const won = side.points > opponent;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <TeamBadge team={side.team} size={20} highlight={isMe} />
      </div>
      <span
        className="font-display font-bold tabular-nums text-[17px] shrink-0"
        style={{ color: won ? '#E8EDF2' : '#5B6977' }}
      >
        {fmt1(side.points)}
      </span>
      <span
        className="w-1 h-4 shrink-0 rounded-[1px]"
        style={{ background: won ? '#3FBF7F' : 'transparent' }}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Standings, but carrying the three things Sleeper hides: how the season actually
 * went week to week, whether the schedule was kind, and how well the manager set
 * their lineup.
 */
function Standings({ bundle }: { bundle: LeagueBundle }) {
  const { standings, league, myRosterId } = bundle;
  const playoffCut = league.playoffTeams;

  return (
    <Panel title="Standings" action={<span className="eyebrow">Regular season</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <Th className="w-8 text-right pr-1">#</Th>
              <Th className="min-w-[190px]">Team</Th>
              <Th className="w-20">Record</Th>
              <Th className="w-14">Streak</Th>
              <Th className="w-20 text-right">Points</Th>
              <Th className="w-20 text-right">Against</Th>
              <Th className="w-[150px]">Season</Th>
              <Th className="w-28" title="Actual win% minus all-play win%">
                Schedule luck
              </Th>
              <Th className="w-32" title="Points scored as a share of the best possible lineup">
                Lineup efficiency
              </Th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => {
              const isMe = row.rosterId === myRosterId;
              const cut = row.rank === playoffCut;
              const played = row.wins + row.losses + row.ties > 0;
              return (
                <tr
                  key={row.rosterId}
                  className="border-b border-line/60 hover:bg-raised transition-colors"
                  style={{
                    background: isMe ? 'rgba(63,191,127,.06)' : undefined,
                    // The playoff cut is the most consequential line in the table.
                    // Draw it like one.
                    borderBottom: cut ? '2px solid #3FBF7F' : undefined,
                  }}
                >
                  <Td className="text-right pr-1">
                    <span
                      className="font-display font-semibold text-[13px]"
                      style={{ color: row.rank <= playoffCut ? '#3FBF7F' : '#5B6977' }}
                    >
                      {row.rank}
                    </span>
                  </Td>
                  <Td>
                    <Link to={`/l/${league.leagueId}/teams/${row.rosterId}`} className="block">
                      <TeamBadge team={row} size={26} showManager highlight={isMe} />
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-display font-semibold text-[14px]">
                      {record(row.wins, row.losses, row.ties)}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="font-display font-semibold text-[13px]"
                      style={{
                        color: !played
                          ? '#5B6977'
                          : row.streak.startsWith('W')
                            ? '#3FBF7F'
                            : '#E5484D',
                      }}
                    >
                      {row.streak}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums text-[13px]">{fmt1(row.pointsFor)}</Td>
                  <Td className="text-right tabular-nums text-[13px] text-muted">
                    {fmt1(row.pointsAgainst)}
                  </Td>
                  <Td>
                    <SeasonTape results={row.results} />
                  </Td>
                  <Td>
                    <LuckBar actual={row.winPct} allPlay={row.allPlay.pct} played={played} />
                  </Td>
                  <Td>
                    <EfficiencyMeter value={row.efficiency} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="px-4 py-2.5 border-t border-line flex flex-wrap gap-x-6 gap-y-1 text-dim text-[11px]">
        <span>The green rule marks the playoff cut.</span>
        <span>Season bars are sized by margin of victory.</span>
        <span>Schedule luck compares your record to playing everyone every week.</span>
        <span>Efficiency is points scored against your best possible lineup.</span>
      </footer>
    </Panel>
  );
}

function Th({
  children,
  className = '',
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <th className={`stat-label text-left px-3 py-2 font-semibold ${className}`} title={title}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
