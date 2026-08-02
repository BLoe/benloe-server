import { useState } from 'react';
import {
  fmt1,
  ordinal,
  pct,
  posInk,
  projectedRecord,
  useApi,
  type LeagueBundle,
  type ProjectedMatchup,
  type ProjectedTeam,
  type SeasonProjection,
} from '../api';
import {
  Avatar,
  Empty,
  ErrorState,
  Loading,
  Panel,
  PlayerLink,
  Stat,
  TeamLink,
  weekHref,
} from '../components';
import { MagnitudeBar } from '../charts';
import { Link } from 'react-router-dom';

/**
 * The season, before it happens.
 *
 * Every roster is put into its best possible lineup by projection, that lineup
 * becomes an expected weekly score, and the real published schedule is resolved
 * against it. Weekly scoring is noisy, so results come out as probabilities —
 * which is why records here are fractional rather than a tidy 10-4.
 */
export default function Projections({ bundle }: { bundle: LeagueBundle }) {
  const { league } = bundle;
  const { data, loading, error } = useApi<SeasonProjection>(
    `/api/league/${league.leagueId}/projections`
  );

  if (loading) return <Loading label="Projecting the season" />;
  if (error) return <ErrorState message={error} />;
  if (!data?.available || !data.teams.length) {
    return (
      <div className="pt-5">
        <Panel title="Projected season">
          <Empty
            title="No projections available"
            hint="Sleeper has not published projections for this season yet."
          />
        </Panel>
      </div>
    );
  }

  const teams = data.teams;
  const mine = teams.find((t) => t.rosterId === data.myRosterId) ?? null;
  const best = teams[0];
  const spread = teams[0].weeklyPoints - teams[teams.length - 1].weeklyPoints;
  const playoffTeams = data.playoffTeams ?? 6;

  return (
    <div className="pt-5 space-y-5">
      <section className="panel">
        <div className="flex flex-col xl:flex-row xl:items-stretch">
          <div className="p-4 xl:w-[320px] shrink-0 border-b xl:border-b-0 xl:border-r border-line">
            <div className="eyebrow">{data.season} projection</div>
            <h1 className="headline mt-1.5" style={{ fontSize: 'var(--t-display)' }}>
              How the season looks
            </h1>
            <p className="text-muted mt-2" style={{ fontSize: 'var(--t-meta)', lineHeight: 1.5 }}>
              Best available lineup for every roster, resolved against the real schedule over{' '}
              {data.weeksProjected} weeks. Records are expected wins, not predictions.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:flex xl:flex-wrap divide-x divide-y xl:divide-y-0 divide-line flex-1">
            {mine && (
              <Stat
                label="Your team"
                value={projectedRecord(mine.wins, mine.losses)}
                size="lg"
                sub={`${ordinal(mine.rank)} · ${fmt1(mine.weeklyPoints)}/wk`}
              />
            )}
            <Stat
              label="Projected best"
              value={best.teamName}
              sub={`${fmt1(best.weeklyPoints)}/wk`}
            />
            <Stat label="Top to bottom" value={fmt1(spread)} sub="points per week" />
            <Stat label="Playoff spots" value={String(playoffTeams)} sub={`of ${teams.length} teams`} />
          </div>
        </div>
      </section>

      <Panel
        title="Projected standings"
        action={<span className="eyebrow">ordered by expected wins</span>}
        note="Ordered by expected wins, so a soft schedule can outrank a stronger roster. Bar length is expected points per week, scaled against the league's own spread. Click a team for its projected lineup."
      >
        <ProjectedTable
          teams={teams}
          myRosterId={data.myRosterId ?? null}
          playoffTeams={playoffTeams}
        />
      </Panel>

      <Panel
        title="Week by week"
        note="Each bar is the chance the favourite wins, given how much weekly scoring bounces around."
      >
        <WeekSchedule
          matchups={data.matchups}
          leagueId={league.leagueId}
          myRosterId={data.myRosterId ?? null}
        />
      </Panel>
    </div>
  );
}

function ProjectedTable({
  teams,
  myRosterId,
  playoffTeams,
}: {
  teams: ProjectedTeam[];
  myRosterId: number | null;
  playoffTeams: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const max = teams[0].weeklyPoints;
  const min = teams[teams.length - 1].weeklyPoints;

  return (
    <div>
      {teams.map((t) => {
        const isMine = t.rosterId === myRosterId;
        const expanded = open === t.rosterId;
        return (
          <div key={t.rosterId}>
            {/* The playoff line is the single most-read fact in a standings
                table, so it is drawn rather than left to be counted. */}
            {t.rank === playoffTeams + 1 && (
              <div className="flex items-center gap-2 px-4 py-1 border-y border-line/60 bg-raised">
                <span className="stat-label">Playoff line</span>
                <span className="flex-1 h-px" style={{ background: 'var(--line)' }} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : t.rosterId)}
              aria-expanded={expanded}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-line/50 hover:bg-raised transition-colors"
              style={{ background: isMine ? 'rgba(63,191,127,.07)' : undefined }}
            >
              <span
                className="font-display font-bold text-dim w-5 shrink-0 tabular-nums"
                style={{ fontSize: 'var(--t-body)' }}
              >
                {t.rank}
              </span>
              <Avatar url={t.avatar} name={t.teamName} size={26} />
              <span className="min-w-0 flex-1">
                <TeamLink
                  rosterId={t.rosterId}
                  className="block truncate leading-tight"
                  style={{ fontSize: 'var(--t-body)' }}
                >
                  {t.teamName}
                </TeamLink>
                <span className="block text-dim leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
                  {/* On a phone the points column is dropped, so it rides along
                      here — the name needs the width more than the number does. */}
                  <span className="sm:hidden tabular-nums">{fmt1(t.weeklyPoints)}/wk · </span>
                  {t.managerName}
                  {t.unfilled ? ` · ${t.unfilled} empty slot${t.unfilled > 1 ? 's' : ''}` : ''}
                </span>
              </span>
              <span className="hidden sm:block shrink-0">
                <MagnitudeBar
                  value={t.weeklyPoints}
                  min={min}
                  max={max}
                  width={120}
                  label={`${fmt1(t.weeklyPoints)} points per week`}
                />
              </span>
              <span
                className="hidden sm:block font-display font-bold tabular-nums shrink-0 text-right"
                style={{ fontSize: 'var(--t-h2)', width: 62 }}
              >
                {fmt1(t.weeklyPoints)}
              </span>
              <span
                className="font-display font-semibold tabular-nums shrink-0 text-right text-muted"
                style={{ fontSize: 'var(--t-body)', width: 68 }}
              >
                {projectedRecord(t.wins, t.losses)}
              </span>
              <span className="text-dim shrink-0" aria-hidden="true">
                {expanded ? '▾' : '▸'}
              </span>
            </button>

            {expanded && <ProjectedLineup team={t} />}
          </div>
        );
      })}
    </div>
  );
}

/** The lineup the projection actually used — otherwise the number is a black box. */
function ProjectedLineup({ team }: { team: ProjectedTeam }) {
  return (
    <div className="px-4 py-3 border-b border-line/50 bg-raised">
      <div className="stat-label mb-2">Best available lineup</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5">
        {team.lineup.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1">
            <span
              className="chip shrink-0"
              style={{
                minWidth: 46,
                color: posInk(s.slot),
                background: `color-mix(in srgb, ${posColorOf(s.slot)} 18%, transparent)`,
              }}
            >
              {s.slot === 'SUPER_FLEX' ? 'SFLX' : s.slot}
            </span>
            <PlayerLink
              id={s.player.id}
              name={s.player.name}
              className="truncate flex-1"
              style={{ fontSize: 'var(--t-body)' }}
            />
            <span
              className="font-display font-bold tabular-nums shrink-0 text-muted"
              style={{ fontSize: 'var(--t-body)' }}
              title={`${fmt1(s.points)} projected over the season`}
            >
              {fmt1(s.perWeek)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const posColorOf = (slot: string) =>
  `var(--pos-${slot === 'SUPER_FLEX' ? 'flex' : slot.toLowerCase()})`;

function WeekSchedule({
  matchups,
  leagueId,
  myRosterId,
}: {
  matchups: ProjectedMatchup[];
  leagueId: string;
  myRosterId: number | null;
}) {
  const weeks = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b);
  const [week, setWeek] = useState(weeks[0] ?? 1);
  const shown = matchups.filter((m) => m.week === week);

  return (
    <div>
      <nav className="flex items-center gap-1 px-3 py-2 overflow-x-auto border-b border-line" aria-label="Projected weeks">
        <span className="stat-label px-1 shrink-0">Week</span>
        {weeks.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeek(w)}
            aria-current={w === week ? 'true' : undefined}
            className="font-display font-semibold px-2.5 py-1 rounded-[3px] shrink-0 transition-colors"
            style={
              w === week
                ? { background: 'var(--win)', color: '#0A0E13', fontSize: 'var(--t-body)' }
                : { color: '#93A2B2', fontSize: 'var(--t-body)' }
            }
          >
            {w}
          </button>
        ))}
      </nav>

      {shown.map((m, i) => {
        const mine = m.home.rosterId === myRosterId || m.away.rosterId === myRosterId;
        return (
          <div
            key={i}
            className="px-4 py-3 border-b border-line/50 last:border-b-0"
            style={{ background: mine ? 'rgba(63,191,127,.07)' : undefined }}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <TeamLink rosterId={m.home.rosterId} style={{ fontSize: 'var(--t-body)' }}>
                {m.home.teamName}
              </TeamLink>
              <span className="font-display font-bold tabular-nums" style={{ fontSize: 'var(--t-h2)' }}>
                {fmt1(m.home.points)}
              </span>
              <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>
                over
              </span>
              <TeamLink
                rosterId={m.away.rosterId}
                style={{ fontSize: 'var(--t-body)', color: '#93A2B2' }}
              >
                {m.away.teamName}
              </TeamLink>
              <span
                className="font-display font-bold tabular-nums text-muted"
                style={{ fontSize: 'var(--t-h2)' }}
              >
                {fmt1(m.away.points)}
              </span>
              <span className="ml-auto text-dim shrink-0" style={{ fontSize: 'var(--t-meta)' }}>
                by {fmt1(m.margin)}
              </span>
            </div>

            {/* One bar, split at the favourite's win chance. */}
            <div className="flex items-center gap-3 mt-2">
              <div
                className="relative rounded-[2px] overflow-hidden flex-1"
                style={{ height: 8, background: '#1E2A36' }}
                role="img"
                aria-label={`${m.home.teamName} has a ${pct(m.favouriteWinChance)} chance`}
              >
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${m.favouriteWinChance * 100}%`,
                    background: 'linear-gradient(90deg,#24506B,#4A8FC7)',
                  }}
                />
              </div>
              <span
                className="font-display font-semibold tabular-nums shrink-0 text-muted"
                style={{ fontSize: 'var(--t-meta)', width: 96, textAlign: 'right' }}
              >
                {pct(m.favouriteWinChance)} to win
              </span>
            </div>
          </div>
        );
      })}

      <div className="px-4 py-2.5 border-t border-line">
        <Link to={weekHref(leagueId, week)} className="link eyebrow hover:text-ink">
          Open week {week} →
        </Link>
      </div>
    </div>
  );
}
