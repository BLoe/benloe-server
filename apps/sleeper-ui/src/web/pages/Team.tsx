import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fmt1,
  ordinal,
  posColor,
  posInk,
  record,
  useApi,
  type AgeProfile,
  type DepthEntry,
  type LeagueBundle,
  type LineupCompare,
  type PositionGroup,
  type PositionStrength,
  type ProjectionMap,
  type RosterSlot,
  type Team,
} from '../api';
import {
  Avatar,
  ErrorState,
  Loading,
  Panel,
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
  projections: ProjectionMap;
  projectionScope: string;
  compare: LineupCompare | null;
  positions: PositionStrength[];
  ages: AgeProfile | null;
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
  const starters = data?.slots.filter((s) => s.kind === 'starter') ?? [];
  const projectedStarters = data
    ? starters.reduce(
        (sum, s) => sum + (s.player ? (data.projections[s.player.id]?.points ?? 0) : 0),
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

            {data.compare && data.compare.gain > 0 && <LineupCheck compare={data.compare} />}

            {/* The lineup and the players who could replace it, side by side —
                which is how the decision actually gets made. A roster is always
                far deeper than it is wide, so the depth list runs the full
                height of the right column and the analysis stacks under the
                lineup rather than leaving half the page empty. DOM order keeps
                lineup and depth adjacent, which is what a phone gets. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
              <LineupCard
                className="xl:col-start-1 xl:row-start-1"
                starters={starters}
                projections={data.projections}
                scope={data.projectionScope}
                total={projectedStarters}
                sitting={new Set(data.compare?.sitDown.map((m) => m.player.id) ?? [])}
              />
              <DepthPanel
                className="xl:col-start-2 xl:row-start-1 xl:row-span-3"
                depth={data.depth}
                projections={data.projections}
                promote={new Set(data.compare?.bringIn.map((m) => m.player.id) ?? [])}
              />
              {!!data.positions.length && (
                <PositionalStrength
                  className="xl:col-start-1 xl:row-start-2"
                  rows={data.positions}
                  teams={standings.length}
                />
              )}
              {data.ages && (
                <AgeCurve className="xl:col-start-1 xl:row-start-3" profile={data.ages} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the current lineup costs against the best one available.
 *
 * Shown as two lists rather than a set of swaps: moving one player reshuffles
 * which slot everyone else fills, so pairing them off would invent a
 * relationship that is not there.
 */
function LineupCheck({ compare }: { compare: LineupCompare }) {
  return (
    <section
      className="panel px-4 py-3.5"
      style={{ borderColor: 'color-mix(in srgb, var(--live) 45%, transparent)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="stat-label" style={{ color: 'var(--live)' }}>
          Lineup check
        </span>
        <span
          className="font-display font-bold tabular-nums"
          style={{ fontSize: 'var(--t-h2)', color: 'var(--live)' }}
        >
          +{fmt1(compare.gain)}
        </span>
        <span className="text-muted" style={{ fontSize: 'var(--t-body)' }}>
          projected points available from players already on this roster
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-2.5">
        <MoveList label="Start" moves={compare.bringIn} tone="var(--win)" />
        <MoveList label="Sit" moves={compare.sitDown} tone="#93A2B2" />
      </div>
    </section>
  );
}

function MoveList({
  label,
  moves,
  tone,
}: {
  label: string;
  moves: LineupCompare['bringIn'];
  tone: string;
}) {
  if (!moves.length) return null;
  return (
    <div className="flex gap-2.5">
      <span className="stat-label shrink-0" style={{ color: tone, minWidth: 34 }}>
        {label}
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 min-w-0">
        {moves.map((m) => (
          <span key={m.player.id} className="inline-flex items-baseline gap-1.5">
            <PlayerLink id={m.player.id} name={m.player.name} style={{ fontSize: 'var(--t-body)' }} />
            <span className="text-dim tabular-nums" style={{ fontSize: 'var(--t-meta)' }}>
              {fmt1(m.points)}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** The lineup slots, in order, as one readable column. */
function LineupCard({
  className,
  starters,
  projections,
  scope,
  total,
  sitting,
}: {
  className?: string;
  starters: RosterSlot[];
  projections: ProjectionMap;
  scope: string;
  total: number | null;
  sitting: Set<string>;
}) {
  const filled = starters.filter((s) => s.player).length;

  return (
    <Panel
      className={className}
      title="Starting lineup"
      action={total != null && <span className="eyebrow">proj · {scope.toLowerCase()}</span>}
    >
      <div>
        {starters.map((s, i) => {
          const proj = s.player ? projections[s.player.id] : null;
          const flagged = s.player ? sitting.has(s.player.id) : false;
          return (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-line/50"
              style={{ background: flagged ? 'rgba(245,197,24,.06)' : undefined }}
            >
              <span
                className="w-[3px] self-stretch shrink-0 rounded-full"
                style={{ background: flagged ? 'var(--live)' : 'transparent' }}
                aria-hidden="true"
              />
              <span
                className="chip shrink-0"
                style={{
                  minWidth: 48,
                  color: posInk(s.slot),
                  background: `color-mix(in srgb, ${posColor(s.slot)} 20%, transparent)`,
                }}
              >
                {s.slot === 'SUPER_FLEX' ? 'SFLX' : s.slot}
              </span>

              {s.player ? (
                <span className="min-w-0 flex-1">
                  <PlayerLink
                    id={s.player.id}
                    name={s.player.name}
                    className="block truncate leading-tight"
                    style={{ fontSize: 'var(--t-body)' }}
                  />
                  <span className="block text-dim leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
                    {s.player.team ?? 'Free agent'}
                    {s.player.age ? ` · ${s.player.age}y` : ''}
                    {s.player.bye ? ` · bye ${s.player.bye}` : ''}
                  </span>
                </span>
              ) : (
                <span className="flex-1 text-dim" style={{ fontSize: 'var(--t-body)' }}>
                  Nobody in this slot
                </span>
              )}

              {s.player?.status && (
                <span
                  className="chip shrink-0"
                  style={{ color: 'var(--loss)', background: 'rgba(229,72,77,.14)' }}
                  title={`Injury status: ${s.player.status}`}
                >
                  {s.player.status.slice(0, 3)}
                </span>
              )}
              <span
                className="font-display font-bold tabular-nums shrink-0 text-right"
                style={{ fontSize: 'var(--t-h2)', width: 56, color: proj ? undefined : '#4B5A68' }}
              >
                {proj ? fmt1(proj.points) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 flex items-baseline justify-between border-t border-line">
        <span className="stat-label">
          {filled} of {starters.length} slots filled
        </span>
        {total != null && (
          <span className="font-display font-bold tabular-nums" style={{ fontSize: 'var(--t-h1)' }}>
            {fmt1(total)}
          </span>
        )}
      </div>
    </Panel>
  );
}

/** Everyone not in the lineup, still grouped by position. */
function DepthPanel({
  className,
  depth,
  projections,
  promote,
}: {
  className?: string;
  depth: PositionGroup[];
  projections: ProjectionMap;
  promote: Set<string>;
}) {
  const groups = depth
    .map((g) => ({ ...g, entries: g.entries.filter((e) => e.kind !== 'starter') }))
    .filter((g) => g.entries.length);

  return (
    <Panel
      className={className}
      title="Depth"
      action={<span className="eyebrow">not in the lineup</span>}
      note="Bench, taxi and injured reserve, kept in position order. A green rail marks a player the projections would start."
    >
      {!groups.length && (
        <div className="px-4 py-4 text-dim" style={{ fontSize: 'var(--t-body)' }}>
          Every rostered player is in the lineup.
        </div>
      )}
      {groups.map((group) => (
        <div key={group.pos}>
          <div className="flex items-baseline gap-2 px-4 py-1.5 bg-raised border-y border-line/60">
            <span className="stat-label" style={{ color: posInk(group.pos) }}>
              {group.pos}
            </span>
            <span className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>
              {group.entries.length} deep
            </span>
          </div>
          {group.entries.map((e) => (
            <DepthRow
              key={e.player.id}
              entry={e}
              projection={projections[e.player.id] ?? null}
              promote={promote.has(e.player.id)}
            />
          ))}
        </div>
      ))}
    </Panel>
  );
}

function DepthRow({
  entry,
  projection,
  promote,
}: {
  entry: DepthEntry;
  projection: { points: number } | null;
  promote: boolean;
}) {
  const p = entry.player;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b border-line/50"
      style={{ background: promote ? 'rgba(63,191,127,.06)' : undefined }}
    >
      <span
        className="w-[3px] self-stretch shrink-0 rounded-full"
        style={{ background: promote ? 'var(--win)' : 'transparent' }}
        aria-hidden="true"
      />
      <span
        className="chip shrink-0"
        style={{ color: '#93A2B2', background: '#161F29', minWidth: 44 }}
        title={
          entry.kind === 'taxi' ? 'Taxi squad' : entry.kind === 'ir' ? 'Injured reserve' : 'Bench'
        }
      >
        {entry.slot}
      </span>
      <span className="min-w-0 flex-1">
        <PlayerLink
          id={p.id}
          name={p.name}
          className="block truncate leading-tight"
          style={{ fontSize: 'var(--t-body)', color: promote ? undefined : '#93A2B2' }}
        />
        <span className="block text-dim leading-tight" style={{ fontSize: 'var(--t-meta)' }}>
          {p.team ?? 'Free agent'}
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
      <span
        className="font-display font-bold tabular-nums shrink-0 text-right"
        style={{ fontSize: 'var(--t-h2)', width: 56, color: projection ? '#93A2B2' : '#4B5A68' }}
      >
        {projection ? fmt1(projection.points) : '—'}
      </span>
    </div>
  );
}

/**
 * Where this roster is strong.
 *
 * Measured by what each position contributes to the best available lineup, not
 * by everything rostered there — thirteen mediocre receivers are depth, and
 * only three of them can play at once.
 */
function PositionalStrength({
  className,
  rows,
  teams,
}: {
  className?: string;
  rows: PositionStrength[];
  teams: number;
}) {
  const cut = Math.ceil(teams / 3);
  return (
    <Panel
      className={className}
      title="Positional strength"
      action={<span className="eyebrow">vs the league</span>}
      note="Bar is expected points per week from this position in the best available lineup, against the league's best at that position. Flex slots count toward whichever position fills them."
    >
      <div className="p-4 space-y-3">
        {rows.map((r) => {
          const t = r.leagueBest ? r.startingPoints / r.leagueBest : 0;
          const good = r.rank <= cut;
          const poor = r.rank > teams - cut;
          return (
            <div key={r.pos} className="flex items-center gap-3">
              <span
                className="chip shrink-0"
                style={{
                  minWidth: 44,
                  color: posInk(r.pos),
                  background: `color-mix(in srgb, ${posColor(r.pos)} 20%, transparent)`,
                }}
              >
                {r.pos}
              </span>
              <div
                className="relative rounded-[2px] overflow-hidden flex-1"
                style={{ height: 10, background: '#1E2A36' }}
                role="img"
                aria-label={`${r.pos}: ${fmt1(r.startingPoints)} points per week, ${ordinal(r.rank)} of ${teams}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-[2px]"
                  style={{ width: `${Math.max(2, t * 100)}%`, background: posColor(r.pos) }}
                />
              </div>
              <span
                className="font-display font-bold tabular-nums shrink-0 text-right"
                style={{ fontSize: 'var(--t-h2)', width: 54 }}
              >
                {fmt1(r.startingPoints)}
              </span>
              <span
                className="font-display font-semibold shrink-0 text-right"
                style={{
                  fontSize: 'var(--t-meta)',
                  width: 80,
                  color: good ? 'var(--win)' : poor ? 'var(--loss)' : '#93A2B2',
                }}
              >
                {ordinal(r.rank)} of {teams}
              </span>
              <span
                className="text-dim shrink-0 text-right hidden sm:block"
                style={{ fontSize: 'var(--t-meta)', width: 74 }}
              >
                {r.rostered} rostered
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const AGE_COLORS = ['var(--age-young)', 'var(--age-prime)', 'var(--age-old)'];

/**
 * The dynasty question: is this roster scoring now or later?
 *
 * Weighted by projected points rather than counted by head — a roster is not
 * young because it stashed four 22-year-olds who will not score.
 */
function AgeCurve({ className, profile }: { className?: string; profile: AgeProfile }) {
  const total = profile.bands.reduce((s, b) => s + b.points, 0);
  if (!total) return null;

  const delta =
    profile.weightedAge != null && profile.leagueWeightedAge != null
      ? profile.weightedAge - profile.leagueWeightedAge
      : null;

  return (
    <Panel
      className={className}
      title="Age curve"
      action={
        profile.weightedAge != null && (
          <span className="eyebrow">
            {profile.weightedAge.toFixed(1)}y average
            {delta != null && (
              <span
                style={{ color: delta < 0 ? 'var(--win)' : delta > 0 ? 'var(--live)' : undefined }}
              >
                {' · '}
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)} vs league
              </span>
            )}
          </span>
        )
      }
      note="Share of this roster's projected points by age, weighted so a stashed prospect who will not score does not read as youth. Injured reserve is excluded."
    >
      <div className="p-4 space-y-3">
        {/* One stacked bar: the roster's production, split by age. */}
        <div className="flex gap-[2px]" style={{ height: 14 }}>
          {profile.bands.map((b, i) =>
            b.share > 0 ? (
              <div
                key={b.label}
                className="rounded-[2px]"
                style={{ width: `${b.share * 100}%`, background: AGE_COLORS[i] }}
                title={`${b.label}: ${(b.share * 100).toFixed(0)}%`}
              />
            ) : null
          )}
        </div>

        {/* One band per row. Three across squeezed every label onto five lines
            once this panel moved into the narrow column. */}
        <div className="space-y-1.5">
          {profile.bands.map((b, i) => (
            <div key={b.label} className="flex items-baseline gap-2.5">
              <span
                className="shrink-0 rounded-[2px] self-center"
                style={{ width: 10, height: 10, background: AGE_COLORS[i] }}
                aria-hidden="true"
              />
              <span className="text-muted shrink-0" style={{ fontSize: 'var(--t-body)', width: 104 }}>
                {b.label}
              </span>
              {/* Four columns do not fit a phone. The share and the league
                  comparison are the point; the raw counts step aside. */}
              <span
                className="text-dim flex-1 min-w-0 truncate hidden sm:block"
                style={{ fontSize: 'var(--t-meta)' }}
              >
                {b.players} player{b.players === 1 ? '' : 's'} · {fmt1(b.points)}/wk
              </span>
              <span className="flex-1 sm:hidden" />
              <span
                className="text-dim shrink-0 tabular-nums text-right"
                style={{ fontSize: 'var(--t-meta)', width: 76 }}
              >
                league {(profile.leagueShares[i] * 100).toFixed(0)}%
              </span>
              <span
                className="font-display font-bold tabular-nums shrink-0 text-right"
                style={{ fontSize: 'var(--t-h2)', width: 44 }}
              >
                {(b.share * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
