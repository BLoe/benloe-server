import { Link, useParams } from 'react-router-dom';
import {
  fmt1,
  useApi,
  type LeagueBundle,
  type Matchup,
  type MatchupSide,
  type ProjectionMap,
  type RosterSlot,
} from '../api';
import {
  Crumb,
  Empty,
  ErrorState,
  Loading,
  Panel,
  Pos,
  PlayerLink,
  TeamBadge,
  matchupHref,
  weekHref,
} from '../components';
import { PositionalCompare } from '../charts';

export default function Matchups({ bundle }: { bundle: LeagueBundle }) {
  const { week: weekParam, matchupId } = useParams();
  const { league, currentWeek, myRosterId, period } = bundle;
  const week = Number(weekParam) || period.week || currentWeek;

  const { data, loading, error } = useApi<{
    week: number;
    matchups: Matchup[];
    projections: ProjectionMap;
  }>(`/api/league/${league.leagueId}/matchups/${week}`);

  const lastWeek = league.status === 'complete' ? league.playoffWeekStart + 2 : currentWeek;
  const weeks = Array.from({ length: Math.max(1, lastWeek) }, (_, i) => i + 1);

  const focused = matchupId
    ? data?.matchups.find((m) => String(m.matchupId) === matchupId)
    : null;

  return (
    <div className="pt-5 space-y-5">
      {focused && (
        <Crumb to={weekHref(league.leagueId, week)}>All week {week} matchups</Crumb>
      )}

      {!focused && (
        <nav className="panel flex items-center gap-1 px-3 py-2 overflow-x-auto" aria-label="Weeks">
          <span className="stat-label px-2 shrink-0">Week</span>
          {weeks.map((w) => (
            <Link
              key={w}
              to={weekHref(league.leagueId, w)}
              className="font-display font-semibold px-2.5 py-1 rounded-[3px] shrink-0 transition-colors"
              style={
                w === week
                  ? { background: 'var(--win)', color: '#0A0E13', fontSize: 'var(--t-body)' }
                  : {
                      color: w >= league.playoffWeekStart ? 'var(--live)' : '#93A2B2',
                      fontSize: 'var(--t-body)',
                    }
              }
              aria-current={w === week ? 'page' : undefined}
            >
              {w}
            </Link>
          ))}
          {league.playoffWeekStart <= lastWeek && (
            <span className="text-dim pl-2 shrink-0" style={{ fontSize: 'var(--t-meta)' }}>
              gold = playoffs
            </span>
          )}
        </nav>
      )}

      {loading && <Loading label={`Loading week ${week}`} />}
      {error && <ErrorState message={error} />}
      {data && !data.matchups.length && (
        <Panel title={`Week ${week}`}>
          <Empty title="No matchups this week" hint="Nothing has been scheduled yet." />
        </Panel>
      )}

      {focused ? (
        <MatchupCard
          matchup={focused}
          myRosterId={myRosterId}
          leagueId={league.leagueId}
          projections={data?.projections ?? {}}
          detail
        />
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
          {data?.matchups.map((m) => (
            <MatchupCard
              key={m.matchupId}
              matchup={m}
              myRosterId={myRosterId}
              leagueId={league.leagueId}
              projections={data.projections ?? {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchupCard({
  matchup,
  myRosterId,
  leagueId,
  projections,
  detail = false,
}: {
  matchup: Matchup;
  myRosterId: number | null;
  leagueId: string;
  projections: ProjectionMap;
  detail?: boolean;
}) {
  const { home, away, week } = matchup;
  const proj = (slot: RosterSlot | undefined) =>
    slot?.player ? (projections[slot.player.id]?.points ?? null) : null;

  if (!away) {
    return (
      <Panel title={`Matchup ${matchup.matchupId}`}>
        <div className="p-4">
          <TeamBadge team={home.team} size={32} showManager />
          <p className="text-dim mt-2" style={{ fontSize: 'var(--t-meta)' }}>
            No opponent scheduled.
          </p>
        </div>
      </Panel>
    );
  }

  const starters = (side: MatchupSide) => side.lineup.filter((s) => s.kind === 'starter');
  const homeStarters = starters(home);
  const awayStarters = starters(away);
  const slotCount = Math.max(homeStarters.length, awayStarters.length);

  const projTotal = (slots: RosterSlot[]) =>
    slots.reduce((sum, s) => sum + (proj(s) ?? 0), 0);
  const homeProj = projTotal(homeStarters);
  const awayProj = projTotal(awayStarters);
  // Before kickoff every score is zero, and a 0.0–0.0 scoreboard is useless.
  // The projection stands in until there is something real to show.
  const notPlayed = home.points === 0 && away.points === 0;
  const showProjectedScore = notPlayed && homeProj + awayProj > 0;

  const compareRows = Array.from({ length: slotCount }, (_, i) => ({
    slot: homeStarters[i]?.slot ?? awayStarters[i]?.slot ?? '',
    home: homeStarters[i]?.points ?? 0,
    away: awayStarters[i]?.points ?? 0,
  }));

  return (
    <section className="panel">
      {/* Phones get the two teams stacked with their scores beside them; the
          side-by-side header squeezed both names to three characters. */}
      <header className="sm:hidden p-3.5 border-b border-line space-y-2">
        {[home, away].map((side, i) => {
          const mine = i === 0 ? homeProj : awayProj;
          const theirs = i === 0 ? awayProj : homeProj;
          const won = showProjectedScore
            ? mine >= theirs
            : side.points >= (i === 0 ? away.points : home.points);
          return (
            <div key={side.rosterId} className="flex items-center gap-2.5">
              <span
                className="w-[3px] h-7 shrink-0 rounded-full"
                style={{ background: won ? 'var(--win)' : 'transparent' }}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0">
                <TeamBadge team={side.team} size={28} showManager highlight={side.rosterId === myRosterId} />
              </span>
              <span
                className="font-display font-bold tabular-nums shrink-0"
                style={{ fontSize: 'var(--t-h1)', color: won ? '#E8EDF2' : '#93A2B2' }}
              >
                {fmt1(showProjectedScore ? mine : side.points)}
              </span>
            </div>
          );
        })}
        <div className="stat-label pl-[13px]">
          {showProjectedScore
            ? `Projected · ${fmt1(Math.abs(homeProj - awayProj))} apart`
            : matchup.margin === 0
              ? 'Tied'
              : `Won by ${fmt1(matchup.margin)}`}
        </div>
      </header>

      <header className="hidden sm:grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 border-b border-line">
        <div className="min-w-0">
          <TeamBadge team={home.team} size={34} showManager highlight={home.rosterId === myRosterId} />
        </div>

        <div className="text-center px-2">
          <div className="flex items-baseline gap-2.5">
            <span
              className="font-display font-bold tabular-nums leading-none"
              style={{
                fontSize: 'var(--t-hero)',
                color: showProjectedScore && homeProj < awayProj ? '#93A2B2' : undefined,
              }}
            >
              {fmt1(showProjectedScore ? homeProj : home.points)}
            </span>
            <span className="text-dim">–</span>
            <span
              className="font-display font-bold tabular-nums leading-none"
              style={{
                fontSize: 'var(--t-hero)',
                color: showProjectedScore && awayProj < homeProj ? undefined : '#93A2B2',
              }}
            >
              {fmt1(showProjectedScore ? awayProj : away.points)}
            </span>
          </div>
          <div className="stat-label mt-1.5">
            {showProjectedScore
              ? `Projected · ${fmt1(Math.abs(homeProj - awayProj))} apart`
              : matchup.margin === 0
                ? 'Tied'
                : `Won by ${fmt1(matchup.margin)}`}
          </div>
        </div>

        <div className="min-w-0 flex justify-end text-right">
          <TeamBadge team={away.team} size={34} showManager highlight={away.rosterId === myRosterId} />
        </div>
      </header>

      {detail && (
        <div className="p-4 border-b border-line">
          <PositionalCompare
            rows={compareRows}
            homeLabel={home.team.teamName}
            awayLabel={away.team.teamName}
          />
        </div>
      )}

      <div>
        {Array.from({ length: slotCount }, (_, i) => {
          const h = homeStarters[i];
          const a = awayStarters[i];
          const slot = h?.slot ?? a?.slot ?? '';
          const hp = h?.points ?? 0;
          const ap = a?.points ?? 0;
          return (
            <div key={i} className="border-b border-line/50 last:border-b-0">
              {/* Phone: slot label, then one player per line. Three columns at
                  390px truncated every name to three characters. */}
              <div className="sm:hidden px-3.5 py-2">
                <div className="stat-label mb-1">{slot === 'SUPER_FLEX' ? 'SFLX' : slot}</div>
                <div className="space-y-1">
                  <PlayerRow slot={h} points={hp} projected={proj(h)} preGame={notPlayed} better={hp > ap} align="left" />
                  <PlayerRow slot={a} points={ap} projected={proj(a)} preGame={notPlayed} better={ap > hp} align="left" />
                </div>
              </div>

              <div className="hidden sm:grid grid-cols-[1fr_58px_1fr] items-center gap-2 px-4 py-2">
                <PlayerRow slot={h} points={hp} projected={proj(h)} preGame={notPlayed} better={hp > ap} align="left" />
                <div className="text-center">
                  <span className="chip text-muted" style={{ background: '#161F29', minWidth: 44 }}>
                    {slot === 'SUPER_FLEX' ? 'SFLX' : slot}
                  </span>
                </div>
                <PlayerRow slot={a} points={ap} projected={proj(a)} preGame={notPlayed} better={ap > hp} align="right" />
              </div>
            </div>
          );
        })}
      </div>

      {detail && <BenchRows home={home} away={away} />}

      <footer className="px-4 py-2.5 border-t border-line flex justify-between text-dim" style={{ fontSize: 'var(--t-meta)' }}>
        <span>
          {detail ? `${fmt1(matchup.total)} combined` : 'Starters only'}
          {homeProj + awayProj > 0 &&
            (notPlayed ? ' · numbers are projections' : ' · faint number is the projection')}
        </span>
        {!detail && (
          <Link to={matchupHref(leagueId, week, matchup.matchupId)} className="link hover:text-ink">
            Full breakdown →
          </Link>
        )}
      </footer>
    </section>
  );
}

/** Bench points, so "what was left on the bench" is answerable on this page. */
function BenchRows({ home, away }: { home: MatchupSide; away: MatchupSide }) {
  const bench = (side: MatchupSide) =>
    side.lineup.filter((s) => s.kind === 'bench').sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const h = bench(home);
  const a = bench(away);
  const rows = Math.max(h.length, a.length);
  if (!rows) return null;

  return (
    <div className="border-t border-line">
      <div className="px-4 py-2 stat-label border-b border-line/60">Bench</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-line/40 last:border-b-0">
          <div className="sm:hidden px-3.5 py-1.5 space-y-1">
            <PlayerRow slot={h[i]} points={h[i]?.points ?? 0} better={false} align="left" dim />
            <PlayerRow slot={a[i]} points={a[i]?.points ?? 0} better={false} align="left" dim />
          </div>
          <div className="hidden sm:grid grid-cols-[1fr_58px_1fr] items-center gap-2 px-4 py-1.5">
            <PlayerRow slot={h[i]} points={h[i]?.points ?? 0} better={false} align="left" dim />
            <div className="text-center">
              <span className="chip text-dim" style={{ background: '#161F29', minWidth: 44 }}>
                {h[i]?.player?.pos ?? a[i]?.player?.pos ?? 'BN'}
              </span>
            </div>
            <PlayerRow slot={a[i]} points={a[i]?.points ?? 0} better={false} align="right" dim />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerRow({
  slot,
  points,
  projected = null,
  preGame = false,
  better,
  align,
  dim = false,
}: {
  slot: RosterSlot | undefined;
  points: number;
  projected?: number | null;
  /** Nothing has kicked off yet, so there is no actual score to lead with. */
  preGame?: boolean;
  better: boolean;
  align: 'left' | 'right';
  dim?: boolean;
}) {
  if (!slot?.player) {
    return <div aria-hidden="true" />;
  }
  const p = slot.player;
  // The centre column already names the slot; only a flex slot needs the chip.
  const flexish = slot.slot === 'FLEX' || slot.slot === 'SUPER_FLEX';

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      {/* Actual over projected: the two numbers answer different questions, and
          stacking them keeps the row on one line. Before kickoff there is no
          actual, so the projection takes the top line rather than sitting under
          a column of dashes. */}
      <span
        className="shrink-0"
        style={{ width: 46, textAlign: align === 'right' ? 'left' : 'right' }}
      >
        <span
          className="block font-display font-bold tabular-nums leading-tight"
          style={{
            color: dim ? '#6E7E8D' : better ? '#E8EDF2' : '#93A2B2',
            fontSize: dim ? 'var(--t-body)' : 'var(--t-h2)',
          }}
          title={preGame && projected != null ? `Projected ${fmt1(projected)}` : undefined}
        >
          {preGame ? (projected != null ? fmt1(projected) : '—') : points ? fmt1(points) : '—'}
        </span>
        {projected != null && !dim && !preGame && (
          <span
            className="block tabular-nums leading-tight text-dim"
            style={{ fontSize: 'var(--t-meta)' }}
            title={`Projected ${fmt1(projected)}`}
          >
            {fmt1(projected)}
          </span>
        )}
      </span>
      <span className={`flex items-center gap-2 min-w-0 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <PlayerLink
          id={p.id}
          name={p.name}
          className="truncate"
          style={{ fontSize: dim ? 'var(--t-meta)' : 'var(--t-body)', color: dim ? '#93A2B2' : undefined }}
        />
        <span className="text-dim shrink-0" style={{ fontSize: 'var(--t-meta)' }}>
          {p.team ?? 'FA'}
        </span>
        {flexish && <Pos pos={p.pos} />}
      </span>
    </div>
  );
}
