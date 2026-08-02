import { Link, useParams } from 'react-router-dom';
import {
  fmt1,
  useApi,
  type LeagueBundle,
  type Matchup,
  type MatchupSide,
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
  const { league, currentWeek, myRosterId } = bundle;
  const week = Number(weekParam) || currentWeek;

  const { data, loading, error } = useApi<{ week: number; matchups: Matchup[] }>(
    `/api/league/${league.leagueId}/matchups/${week}`
  );

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
        <MatchupCard matchup={focused} myRosterId={myRosterId} leagueId={league.leagueId} detail />
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
          {data?.matchups.map((m) => (
            <MatchupCard
              key={m.matchupId}
              matchup={m}
              myRosterId={myRosterId}
              leagueId={league.leagueId}
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
  detail = false,
}: {
  matchup: Matchup;
  myRosterId: number | null;
  leagueId: string;
  detail?: boolean;
}) {
  const { home, away, week } = matchup;

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

  const compareRows = Array.from({ length: slotCount }, (_, i) => ({
    slot: homeStarters[i]?.slot ?? awayStarters[i]?.slot ?? '',
    home: homeStarters[i]?.points ?? 0,
    away: awayStarters[i]?.points ?? 0,
  }));

  return (
    <section className="panel">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 border-b border-line">
        <div className="min-w-0">
          <TeamBadge team={home.team} size={34} showManager highlight={home.rosterId === myRosterId} />
        </div>

        <div className="text-center px-2">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display font-bold tabular-nums leading-none" style={{ fontSize: 'var(--t-hero)' }}>
              {fmt1(home.points)}
            </span>
            <span className="text-dim">–</span>
            <span
              className="font-display font-bold tabular-nums leading-none"
              style={{ fontSize: 'var(--t-hero)', color: '#93A2B2' }}
            >
              {fmt1(away.points)}
            </span>
          </div>
          <div className="stat-label mt-1.5">
            {matchup.margin === 0 ? 'Tied' : `Won by ${fmt1(matchup.margin)}`}
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
            <div
              key={i}
              className="grid grid-cols-[1fr_58px_1fr] items-center gap-2 px-4 py-2 border-b border-line/50 last:border-b-0"
            >
              <PlayerRow slot={h} points={hp} better={hp > ap} align="left" />
              <div className="text-center">
                <span
                  className="chip text-muted"
                  style={{ background: '#161F29', minWidth: 44 }}
                >
                  {slot === 'SUPER_FLEX' ? 'SFLX' : slot}
                </span>
              </div>
              <PlayerRow slot={a} points={ap} better={ap > hp} align="right" />
            </div>
          );
        })}
      </div>

      {detail && <BenchRows home={home} away={away} />}

      <footer className="px-4 py-2.5 border-t border-line flex justify-between text-dim" style={{ fontSize: 'var(--t-meta)' }}>
        <span>{detail ? `${fmt1(matchup.total)} combined` : 'Starters only'}</span>
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
        <div
          key={i}
          className="grid grid-cols-[1fr_58px_1fr] items-center gap-2 px-4 py-1.5 border-b border-line/40 last:border-b-0"
        >
          <PlayerRow slot={h[i]} points={h[i]?.points ?? 0} better={false} align="left" dim />
          <div className="text-center">
            <span className="chip text-dim" style={{ background: '#161F29', minWidth: 44 }}>
              {h[i]?.player?.pos ?? a[i]?.player?.pos ?? 'BN'}
            </span>
          </div>
          <PlayerRow slot={a[i]} points={a[i]?.points ?? 0} better={false} align="right" dim />
        </div>
      ))}
    </div>
  );
}

function PlayerRow({
  slot,
  points,
  better,
  align,
  dim = false,
}: {
  slot: RosterSlot | undefined;
  points: number;
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
      <span
        className="font-display font-bold tabular-nums shrink-0"
        style={{
          color: dim ? '#6E7E8D' : better ? '#E8EDF2' : '#93A2B2',
          fontSize: dim ? 'var(--t-body)' : 'var(--t-h2)',
          width: 46,
          textAlign: align === 'right' ? 'left' : 'right',
        }}
      >
        {points ? fmt1(points) : '—'}
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
