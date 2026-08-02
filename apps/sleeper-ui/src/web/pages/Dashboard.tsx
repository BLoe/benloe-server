import { Link } from 'react-router-dom';
import { fmt1, record, useApi, type LeagueBundle, type Matchup, type StandingsRow } from '../api';
import {
  Empty,
  Panel,
  Stat,
  TeamBadge,
  TeamLink,
  matchupHref,
  weekHref,
} from '../components';
import { EfficiencyMeter, LuckGauge, MagnitudeBar, SeasonTape } from '../charts';

export default function Dashboard({ bundle }: { bundle: LeagueBundle }) {
  const { league, standings, myRosterId, currentWeek } = bundle;
  const me = standings.find((s) => s.rosterId === myRosterId) ?? null;

  const week = useApi<{ week: number; matchups: Matchup[] }>(
    `/api/league/${league.leagueId}/matchups/${currentWeek}`
  );

  return (
    <div className="pt-5 space-y-5">
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
 * The one panel that answers "how am I doing" without a click.
 *
 * Record is the headline and gets the largest figure on the page; everything
 * else is context for it and steps down a size.
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
  const rankBy = (key: (s: StandingsRow) => number) =>
    [...standings].sort((a, b) => key(b) - key(a)).findIndex((s) => s.rosterId === row.rosterId) + 1;

  const pfRank = rankBy((s) => s.pointsFor);
  const effRank = rankBy((s) => s.efficiency);
  const inPlayoffs = row.rank <= league.playoffTeams;
  const pointsLeft = Math.round((row.maxPoints - row.pointsFor) * 10) / 10;
  const played = row.wins + row.losses + row.ties > 0;

  if (!played) {
    return (
      <section className="panel flex flex-col lg:flex-row lg:items-stretch">
        <div className="flex items-center gap-3 p-4 lg:w-[300px] shrink-0 border-b lg:border-b-0 lg:border-r border-line">
          <TeamBadge team={row} size={48} showManager nameSize="var(--t-h1)" />
        </div>
        <div className="flex flex-wrap divide-x divide-line flex-1">
          <Stat label="Season" value={league.season} sub="Not started" />
          <Stat label="FAAB" value={`$${league.waiverBudget - row.waiverBudgetUsed}`} sub={`of $${league.waiverBudget}`} />
          <Stat label="League size" value={`${standings.length}`} sub={`top ${league.playoffTeams} make playoffs`} />
          <Stat label="Playoffs start" value={`Week ${league.playoffWeekStart}`} />
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        <div className="flex items-center gap-3.5 p-4 lg:w-[300px] shrink-0 border-b lg:border-b-0 lg:border-r border-line">
          <TeamBadge team={row} size={48} showManager nameSize="var(--t-h1)" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap divide-x divide-y lg:divide-y-0 divide-line flex-1">
          <Stat
            label="Record"
            size="lg"
            value={record(row.wins, row.losses, row.ties)}
            sub={
              <>
                {ordinal(row.rank)} of {standings.length} · {row.streak} streak
              </>
            }
            tone={row.winPct >= 0.5 ? 'win' : 'loss'}
          />
          <Stat label="Points for" value={fmt1(row.pointsFor)} sub={`${ordinal(pfRank)} in league`} />
          <Stat
            label="Lineup efficiency"
            value={`${(row.efficiency * 100).toFixed(0)}%`}
            sub={`${fmt1(pointsLeft)} left on the bench`}
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
  if (Math.abs(delta) < 0.03) return 'Schedule was neutral';
  return delta > 0 ? 'Schedule helped' : 'Schedule hurt';
}

/** Every game in the week at a glance. Each game is a link to its own page. */
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
        <Link to={weekHref(leagueId, week)} className="eyebrow link hover:text-ink">
          All matchups →
        </Link>
      }
    >
      {loading && <Empty title="Loading scores" />}
      {!loading && !matchups.length && (
        <Empty title="No games scheduled" hint="Matchups appear once the season starts." />
      )}
      {!!matchups.length && (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
          {matchups.map((m, i) => (
            <Link
              key={m.matchupId}
              to={matchupHref(leagueId, week, m.matchupId)}
              className="block p-3.5 hover:bg-raised transition-colors border-b border-line last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 2xl:[&:nth-child(2n)]:border-r 2xl:[&:nth-child(3n)]:border-r-0"
              style={{ borderColor: '#1E2A36' }}
            >
              <GameLine side={m.home} opponent={m.away?.points ?? 0} mine={myRosterId} />
              <div className="h-1.5" />
              {m.away && <GameLine side={m.away} opponent={m.home.points} mine={myRosterId} />}
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
}: {
  side: Matchup['home'];
  opponent: number;
  mine: number | null;
}) {
  const isMe = side.rosterId === mine;
  const won = side.points > opponent;
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="w-[3px] h-6 shrink-0 rounded-full"
        style={{ background: won ? 'var(--win)' : 'transparent' }}
        aria-hidden="true"
      />
      <span className="flex-1 min-w-0">
        <TeamBadge team={side.team} size={24} highlight={isMe} link={false} />
      </span>
      <span
        className="font-display font-bold tabular-nums shrink-0"
        style={{ fontSize: 'var(--t-h1)', color: won ? '#E8EDF2' : '#93A2B2' }}
      >
        {fmt1(side.points)}
      </span>
    </div>
  );
}

/**
 * Standings.
 *
 * Nine columns is a lot, so they are banded into three ideas — who they are,
 * how much they scored, and what the numbers say underneath — and the primary
 * keys (rank, team, record) carry the largest type on the row.
 */
function Standings({ bundle }: { bundle: LeagueBundle }) {
  const { standings, league, myRosterId } = bundle;
  const playoffCut = league.playoffTeams;
  const anyPlayed = standings.some((s) => s.wins + s.losses + s.ties > 0);

  const pfValues = standings.map((s) => s.pointsFor);
  const pfMin = Math.min(...pfValues);
  const pfMax = Math.max(...pfValues);

  return (
    <Panel
      title="Standings"
      action={<span className="eyebrow">Regular season</span>}
      note={
        <div className="flex flex-wrap gap-x-7 gap-y-1.5">
          <span>The green rule marks the playoff cut.</span>
          <span>Season bars run up for a win, down for a loss, sized by margin.</span>
          <span>Schedule luck is your win rate minus your all-play win rate, in points.</span>
          <span>Efficiency is points scored against your best possible lineup.</span>
        </div>
      }
    >
      {/* Cards on a phone. The table's nine columns cannot survive 390px — the
          season tape and the underlying numbers simply scroll out of sight,
          which loses the whole reason the table exists. */}
      <ul className="lg:hidden divide-y divide-line">
        {standings.map((row) => {
          const isMe = row.rosterId === myRosterId;
          const played = row.wins + row.losses + row.ties > 0;
          return (
            <li
              key={row.rosterId}
              className="p-3.5"
              style={{
                background: isMe ? 'rgba(63,191,127,.07)' : undefined,
                borderBottom:
                  row.rank === playoffCut && anyPlayed ? '2px solid var(--win)' : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="font-display font-bold shrink-0 text-center"
                  style={{
                    fontSize: 'var(--t-h1)',
                    width: 24,
                    color: row.rank <= playoffCut ? 'var(--win)' : '#6E7E8D',
                  }}
                >
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <TeamBadge team={row} size={30} showManager highlight={isMe} />
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-bold leading-none" style={{ fontSize: 'var(--t-h1)' }}>
                    {record(row.wins, row.losses, row.ties)}
                  </div>
                  <div
                    className="font-display font-semibold leading-tight mt-0.5"
                    style={{
                      fontSize: 'var(--t-meta)',
                      color: !played
                        ? '#6E7E8D'
                        : row.streak.startsWith('W')
                          ? 'var(--win)'
                          : 'var(--loss)',
                    }}
                  >
                    {row.streak}
                  </div>
                </div>
              </div>

              {!played && (
                <div className="text-dim mt-2" style={{ fontSize: 'var(--t-meta)' }}>
                  No games yet
                </div>
              )}

              {played && (
                <>
                  <div className="mt-3">
                    <SeasonTape results={row.results} height={30} barWidth={9} />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                    <MobileStat label="Points for" value={fmt1(row.pointsFor)} />
                    <MobileStat label="Against" value={fmt1(row.pointsAgainst)} muted />
                    <MobileStat
                      label="Schedule luck"
                      value={<LuckGauge actual={row.winPct} allPlay={row.allPlay.pct} width={56} />}
                    />
                    <MobileStat
                      label="Efficiency"
                      value={<EfficiencyMeter value={row.efficiency} width={48} />}
                    />
                  </dl>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse">
          <thead>
            {/* Band row: turns nine columns into three groups the eye can hold. */}
            <tr>
              <th className="th-band" colSpan={2} />
              <th className="th-band" colSpan={2}>Record</th>
              <th className="th-band" colSpan={3}>Scoring</th>
              <th className="th-band" colSpan={2}>Underlying</th>
            </tr>
            <tr className="border-b border-line2">
              <th className="th w-11 text-right pr-0">#</th>
              <th className="th min-w-[230px]">Team</th>
              <th className="th w-[92px]">W–L</th>
              <th className="th w-[74px]">Streak</th>
              <th className="th w-[150px]">Points for</th>
              <th className="th w-[92px] text-right">Against</th>
              <th className="th w-[190px]">Week by week</th>
              <th className="th w-[150px]" title="Actual win rate minus all-play win rate">
                Schedule luck
              </th>
              <th className="th w-[150px]" title="Points scored as a share of the best possible lineup">
                Efficiency
              </th>
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
                  className="border-b border-line/70 hover:bg-raised transition-colors"
                  style={{
                    background: isMe ? 'rgba(63,191,127,.07)' : undefined,
                    borderBottom: cut && anyPlayed ? '2px solid var(--win)' : undefined,
                  }}
                >
                  <td className="td text-right pr-0">
                    <span
                      className="font-display font-bold"
                      style={{
                        fontSize: 'var(--t-h1)',
                        color: row.rank <= playoffCut ? 'var(--win)' : '#6E7E8D',
                      }}
                    >
                      {row.rank}
                    </span>
                  </td>

                  <td className="td">
                    <TeamBadge team={row} size={30} showManager highlight={isMe} />
                  </td>

                  <td className="td">
                    <span className="font-display font-bold" style={{ fontSize: 'var(--t-h1)' }}>
                      {record(row.wins, row.losses, row.ties)}
                    </span>
                  </td>

                  <td className="td">
                    <span
                      className="font-display font-semibold"
                      style={{
                        fontSize: 'var(--t-h2)',
                        color: !played
                          ? '#6E7E8D'
                          : row.streak.startsWith('W')
                            ? 'var(--win)'
                            : 'var(--loss)',
                      }}
                    >
                      {row.streak}
                    </span>
                  </td>

                  <td className="td">
                    <div className="flex items-center gap-3">
                      <span className="font-display font-semibold tabular-nums" style={{ fontSize: 'var(--t-h2)', minWidth: 62 }}>
                        {fmt1(row.pointsFor)}
                      </span>
                      <MagnitudeBar value={row.pointsFor} min={pfMin} max={pfMax} width={64} />
                    </div>
                  </td>

                  <td className="td text-right">
                    <span className="tabular-nums text-muted" style={{ fontSize: 'var(--t-body)' }}>
                      {fmt1(row.pointsAgainst)}
                    </span>
                  </td>

                  <td className="td">
                    <SeasonTape results={row.results} />
                  </td>

                  <td className="td">
                    <LuckGauge actual={row.winPct} allPlay={row.allPlay.pct} played={played} />
                  </td>

                  <td className="td">
                    <EfficiencyMeter value={row.efficiency} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Label/value pair for the phone standings card. */
function MobileStat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="stat-label">{label}</dt>
      <dd
        className="font-display font-semibold tabular-nums mt-0.5"
        style={{ fontSize: 'var(--t-h2)', color: muted ? '#93A2B2' : undefined }}
      >
        {value}
      </dd>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
