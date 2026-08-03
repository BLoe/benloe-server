import { Fragment } from 'react';
import { useApi } from '../api';
import { Empty, ErrorNote, Loading, Sheet } from '../components';

/**
 * SEASON — the playoff path, and the games that decide it.
 *
 * A standings table is a record of the past. It tells you that you are 4-3; it
 * cannot tell you that the week 11 game is the one you cannot lose. That only
 * appears once the rest of the season has been played out enough times to count
 * the outcomes, so this page leads with the odds and then spends its second half
 * on the thing no standings table can say: which of your own remaining games
 * carries the most.
 *
 * The odds are simulated and the page says so plainly, every time, with the run
 * count on the panel. They are also seeded — refreshing does not move them,
 * which is what makes them worth arguing with.
 */

interface Odds {
  rosterId: number;
  playoffs: number;
  firstSeed: number;
  lastPlace: number;
  expectedWins: number;
  expectedLosses: number;
}

interface SeasonTeam {
  rosterId: number;
  teamName: string;
  mine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  weeklyPoints: number;
  emptySlots: string[];
  unprojected: number;
  odds: Odds | null;
}

interface Game {
  week: number;
  homeRosterId: number;
  awayRosterId: number;
  played: boolean;
}

interface Leverage {
  week: number;
  opponentRosterId: number;
  opponentName: string;
  ifWon: number;
  ifLost: number;
  swing: number;
}

interface SeasonResponse {
  season: string;
  preseason: boolean;
  weeksPlayed: number;
  playoffWeekStart: number;
  playoffTeams: number;
  runs: number;
  leverageRuns: number;
  seed: number;
  myRosterId: number | null;
  teams: SeasonTeam[];
  schedule: Game[];
  remainingGames: number;
  missingWeeks: number[];
  leverage: Leverage[];
}

/** Odds, honestly rounded. A rounded-to-zero chance is not the same as none. */
function odds(n: number): string {
  if (n <= 0) return '0%';
  if (n < 0.005) return '<1%';
  if (n >= 0.995 && n < 1) return '>99%';
  return `${Math.round(n * 100)}%`;
}

export default function Season({ league }: { league: { leagueId: string } }) {
  const season = useApi<SeasonResponse>(`/api/league/${league.leagueId}/season`);

  if (season.loading) return <Loading label="Playing the season out" />;
  if (season.error) return <ErrorNote message={season.error} />;
  if (!season.data) return null;

  const d = season.data;
  const mine = d.teams.find((t) => t.mine) ?? null;

  return (
    <>
      <p
        className="px-1"
        style={{ fontSize: 'var(--t-body)', color: 'var(--graphite)', maxWidth: '68ch', lineHeight: 1.5 }}
      >
        {standingLine(d)}
      </p>

      <Sheet
        title="Playoff odds"
        count={d.runs ? `${d.runs.toLocaleString()} seasons simulated` : 'not simulated'}
        note={oddsNote(d)}
      >
        {d.teams.length ? (
          <OddsTable teams={d.teams} playoffTeams={d.playoffTeams} simulated={d.runs > 0} />
        ) : (
          <Empty
            title="No rosters came back for this league."
            hint="Sleeper returned an empty roster list, so there is nothing to simulate."
          />
        )}
      </Sheet>

      <Sheet
        title="Which games decide your season"
        count={d.leverage.length ? `${d.leverage.length} left` : undefined}
        note={
          d.leverage.length
            ? `Each game is forced won and forced lost, and the season replayed ${d.leverageRuns.toLocaleString()} times each way. The gap between the two is what that single result is worth to you. Fewer runs than the odds above, because this is a comparison between games rather than a headline number.`
            : undefined
        }
      >
        <LeverageList
          leverage={d.leverage}
          hasRoster={d.myRosterId != null}
          remaining={d.remainingGames}
        />
      </Sheet>

      <Sheet
        title="The rest of the schedule"
        count={
          d.remainingGames
            ? `${d.remainingGames} ${d.remainingGames === 1 ? 'game' : 'games'} to play`
            : 'nothing left'
        }
        note={scheduleNote(d)}
      >
        <ScheduleTable
          schedule={d.schedule}
          teams={d.teams}
          myRosterId={d.myRosterId}
          missingWeeks={d.missingWeeks}
          lastWeek={d.playoffWeekStart - 1}
        />
      </Sheet>

      {mine && mine.emptySlots.length > 0 && (
        <p className="px-1" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)', maxWidth: '68ch' }}>
          Your best available lineup leaves {mine.emptySlots.join(', ')} empty, so your expected
          weekly score is what the roster can actually field, not what a full lineup would give you.
        </p>
      )}
    </>
  );
}

/** The one-line state of the season, in plain words. */
function standingLine(d: SeasonResponse): string {
  const weeks = d.playoffWeekStart - 1;
  if (d.preseason) {
    return `Nothing has been played. Every team is 0-0, so these odds come from projected roster strength alone — ${weeks} weeks of it — and from nothing that has happened on a field. Treat them as a read on rosters, not as a forecast with evidence behind it.`;
  }
  if (!d.remainingGames) {
    return `All ${weeks} regular-season weeks are in the books. There is nothing left to simulate, so the table below is the finished order rather than a projection.`;
  }
  return `${d.weeksPlayed} of ${weeks} weeks played, ${d.remainingGames} games left before the playoffs open in week ${d.playoffWeekStart}. Records carry forward; everything still to come is simulated.`;
}

function oddsNote(d: SeasonResponse): string {
  if (!d.runs) {
    return 'No games are scheduled and none have been played, so there is nothing to simulate. The rosters are ranked by projected weekly score instead, which is the only signal available.';
  }
  return `Simulated, not calculated: ${d.runs.toLocaleString()} seasons played out from a fixed seed (${d.seed}), so a refresh does not change the number. Each team scores around its best available lineup with real weekly variance, and ties break on points for, as Sleeper does. A week still being played is simulated from zero rather than from Sunday's half-finished scores. The model does not know about injuries, trades or a manager who stops setting a lineup in November.`;
}

function scheduleNote(d: SeasonResponse): string {
  if (d.missingWeeks.length) {
    return `Sleeper returned no matchups for ${d.missingWeeks.length === 1 ? 'week' : 'weeks'} ${d.missingWeeks.join(', ')}, so ${d.missingWeeks.length === 1 ? 'that week is' : 'those weeks are'} missing from the simulation entirely. Every other week is the league's real fixture list.`;
  }
  return "The league's real fixture list, straight from Sleeper. Weeks already scored are marked as played and are not simulated again.";
}

/* ------------------------------------------------------------------ *
 * Playoff odds
 * ------------------------------------------------------------------ */

/**
 * The odds table, with the playoff line drawn rather than left to be counted.
 *
 * A reader should never have to work out where sixth place is. The line is the
 * whole point of the table: everything above it is playing for seeding and
 * everything below is playing for something else.
 */
function OddsTable({
  teams,
  playoffTeams,
  simulated,
}: {
  teams: SeasonTeam[];
  playoffTeams: number;
  simulated: boolean;
}) {
  const rows: Array<{ team: SeasonTeam; rank: number }> = teams.map((team, i) => ({
    team,
    rank: i + 1,
  }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ fontSize: 'var(--t-meta)' }}>
        <caption className="sr-only">
          Playoff odds by team, from {simulated ? 'the simulation' : 'projected roster strength'}.
          The top {playoffTeams} make the playoffs.
        </caption>
        <thead>
          <tr className="border-b border-[var(--rule)]">
            <th className="label text-right px-2 py-1.5" style={{ width: 28 }}>
              #
            </th>
            <th className="label text-left px-2 py-1.5">Team</th>
            <th className="label text-left px-2 py-1.5" style={{ minWidth: 190 }}>
              Playoffs
            </th>
            <th className="label text-right px-2 py-1.5">1st</th>
            <th className="label text-right px-2 py-1.5">Last</th>
            <th className="label text-right px-2 py-1.5">Record</th>
            <th className="label text-right px-4 py-1.5">Proj / wk</th>
          </tr>
        </thead>
        <tbody className="banded">
          {rows.map(({ team, rank }) => (
            <Fragment key={team.rosterId}>
              <tr title={`${team.teamName}: ${odds(team.odds?.playoffs ?? 0)} to make the playoffs`}>
                <td className="fig px-2 py-1.5 text-right" style={{ color: 'var(--faint)' }}>
                  {rank}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className="truncate block"
                    style={{ maxWidth: 200, fontWeight: team.mine ? 600 : 400 }}
                  >
                    {team.teamName}
                    {team.mine && (
                      <span className="label ml-2" style={{ color: 'var(--ink)' }}>
                        you
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <OddsBar value={team.odds?.playoffs ?? null} mine={team.mine} />
                </td>
                <td className="fig px-2 py-1.5 text-right" style={{ color: 'var(--graphite)' }}>
                  {team.odds ? odds(team.odds.firstSeed) : '—'}
                </td>
                <td className="fig px-2 py-1.5 text-right" style={{ color: 'var(--graphite)' }}>
                  {team.odds ? odds(team.odds.lastPlace) : '—'}
                </td>
                <td className="fig px-2 py-1.5 text-right">
                  {team.odds
                    ? `${team.odds.expectedWins.toFixed(1)}-${team.odds.expectedLosses.toFixed(1)}`
                    : `${team.wins}-${team.losses}`}
                </td>
                <td className="fig px-4 py-1.5 text-right">{team.weeklyPoints.toFixed(1)}</td>
              </tr>

              {rank === playoffTeams && rank < rows.length && (
                <tr style={{ background: 'var(--vellum)' }}>
                  <td colSpan={7} className="px-2 py-0">
                    <div className="flex items-center gap-3">
                      <span
                        className="label whitespace-nowrap"
                        style={{ color: 'var(--ink)', letterSpacing: '.16em' }}
                      >
                        Playoff line · top {playoffTeams}
                      </span>
                      <span
                        aria-hidden="true"
                        className="flex-1"
                        style={{ height: 2, background: 'var(--ink)' }}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One team's probability, drawn and labelled.
 *
 * The number sits beside the bar rather than under an axis: a reader comparing
 * two teams should not have to measure anything, and the bar is there to make
 * the shape of the field visible at a glance, not to be read off.
 */
function OddsBar({ value, mine }: { value: number | null; mine: boolean }) {
  if (value == null) {
    return (
      <span className="fig" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
        not simulated
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {/* The bar is the comparison; the number is the fact. On a narrow screen
          the number wins, because a bar you have to scroll to is worse than none. */}
      <div
        aria-hidden="true"
        className="relative flex-1 hidden sm:block"
        style={{ height: 10, minWidth: 90, background: 'var(--band)', border: '1px solid var(--rule)' }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: mine ? 'var(--ink)' : 'var(--depth)',
            opacity: mine ? 1 : 0.7,
          }}
        />
      </div>
      <span className="fig text-right" style={{ width: 42, fontWeight: mine ? 600 : 400 }}>
        {odds(value)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Leverage
 * ------------------------------------------------------------------ */

/**
 * The user's remaining games, in week order, each showing what winning it is
 * worth against what losing it costs.
 *
 * Week order rather than swing order on purpose: these are games you play in a
 * sequence, and re-ordering them by importance makes the page harder to plan
 * against. The largest swing is marked instead.
 */
function LeverageList({
  leverage,
  hasRoster,
  remaining,
}: {
  leverage: Leverage[];
  hasRoster: boolean;
  remaining: number;
}) {
  if (!hasRoster) {
    return (
      <Empty
        title="You do not have a team in this league."
        hint="Leverage is personal — it needs a roster to be about."
      />
    );
  }
  if (!leverage.length) {
    return (
      <Empty
        title={remaining ? 'No games of yours are left to simulate.' : 'Your season is played out.'}
        hint={
          remaining
            ? 'Sleeper did not return any remaining matchups with you in them.'
            : 'Every regular-season game on your schedule has been played.'
        }
      />
    );
  }

  const biggest = Math.max(...leverage.map((g) => g.swing));

  return (
    <div>
      {/* Two ends to every bar, so they get a legend. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-[var(--rule)]">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" style={{ width: 9, height: 9, background: 'var(--loss)' }} />
          <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--graphite)' }}>
            IF YOU LOSE
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" style={{ width: 9, height: 9, background: 'var(--gain)' }} />
          <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--graphite)' }}>
            IF YOU WIN
          </span>
        </span>
        <span className="fig ml-auto" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
          TRACK = 0% TO 100% PLAYOFF ODDS
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: 'var(--t-meta)' }}>
          <caption className="sr-only">
            Your remaining games, with playoff odds if each is won and if it is lost.
          </caption>
          <thead>
            <tr className="border-b border-[var(--rule)]">
              <th className="label text-left px-4 py-1.5" style={{ width: 56 }}>
                Week
              </th>
              <th className="label text-left px-2 py-1.5">Against</th>
              <th className="label text-left px-2 py-1.5 hidden sm:table-cell" style={{ minWidth: 200 }}>
                Odds either way
              </th>
              <th className="label text-right px-2 py-1.5">Lose</th>
              <th className="label text-right px-2 py-1.5">Win</th>
              <th className="label text-right px-4 py-1.5">Swing</th>
            </tr>
          </thead>
          <tbody className="banded">
            {leverage.map((g) => {
              const decisive = g.swing === biggest && biggest > 0;
              return (
                <tr key={`${g.week}-${g.opponentRosterId}`}>
                  <td className="fig px-4 py-2">{g.week}</td>
                  <td className="px-2 py-2">
                    <span className="truncate block" style={{ maxWidth: 190 }}>
                      {g.opponentName}
                    </span>
                    {decisive && (
                      <span className="label" style={{ color: 'var(--ink)' }}>
                        biggest swing
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 hidden sm:table-cell">
                    <SwingBar game={g} />
                  </td>
                  <td className="fig px-2 py-2 text-right" style={{ color: 'var(--loss)' }}>
                    {odds(g.ifLost)}
                  </td>
                  <td className="fig px-2 py-2 text-right" style={{ color: 'var(--gain)' }}>
                    {odds(g.ifWon)}
                  </td>
                  <td
                    className="fig px-4 py-2 text-right"
                    style={{ fontWeight: decisive ? 600 : 400 }}
                  >
                    {Math.round(g.swing * 100)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p
        className="px-4 py-2.5 border-t border-[var(--rule)]"
        style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)', lineHeight: 1.5, maxWidth: '68ch' }}
      >
        Swing is in points of playoff odds. Two games against identical opponents can be worth
        wildly different amounts depending on where they fall and who else is chasing the same
        spot — which is exactly what a standings table cannot tell you.
      </p>
    </div>
  );
}

/**
 * The span between losing and winning one game, drawn on a 0-100% track.
 *
 * A single bar would have to pick one of the two outcomes; the span is the
 * quantity that matters, and its length is the leverage.
 */
function SwingBar({ game }: { game: Leverage }) {
  const lo = Math.max(0, Math.min(1, Math.min(game.ifLost, game.ifWon)));
  const hi = Math.max(0, Math.min(1, Math.max(game.ifLost, game.ifWon)));
  const label = `Week ${game.week} against ${game.opponentName}: ${odds(
    game.ifLost
  )} if you lose, ${odds(game.ifWon)} if you win, a swing of ${Math.round(
    game.swing * 100
  )} points of playoff odds.`;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="relative"
      // Tall enough to be an easy hover target for a 10px-high mark.
      style={{ height: 22 }}
    >
      <div
        className="absolute left-0 right-0"
        style={{ top: 10, height: 1, background: 'var(--rule)' }}
      />
      <div
        className="absolute"
        style={{
          left: `${lo * 100}%`,
          // A floor of 0.6% of the track, so a game that barely matters still
          // draws something between its two end caps rather than nothing.
          width: `${Math.max(0.006, hi - lo) * 100}%`,
          top: 7,
          height: 7,
          background: 'var(--depth)',
          opacity: 0.55,
        }}
      />
      {/* End caps: the two outcomes, each in its own ink. */}
      <div
        className="absolute"
        style={{
          left: `calc(${Math.max(0, Math.min(1, game.ifLost)) * 100}% - 1px)`,
          top: 4,
          width: 3,
          height: 13,
          background: 'var(--loss)',
        }}
      />
      <div
        className="absolute"
        style={{
          left: `calc(${Math.max(0, Math.min(1, game.ifWon)) * 100}% - 1px)`,
          top: 4,
          width: 3,
          height: 13,
          background: 'var(--gain)',
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */

/** The fixture list, week by week, with the user's own game marked. */
function ScheduleTable({
  schedule,
  teams,
  myRosterId,
  missingWeeks,
  lastWeek,
}: {
  schedule: Game[];
  teams: SeasonTeam[];
  myRosterId: number | null;
  missingWeeks: number[];
  lastWeek: number;
}) {
  if (!schedule.length) {
    return (
      <Empty
        title="Sleeper has no fixture list for this league yet."
        hint={`No matchups came back for weeks 1 to ${lastWeek}, so the odds above are driven by records alone. Sleeper publishes a schedule once the league has drafted.`}
      />
    );
  }

  const nameOf = new Map(teams.map((t) => [t.rosterId, t.teamName]));
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);

  return (
    <div className="px-4 py-3">
      <div className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {weeks.map((week) => {
          const games = schedule.filter((g) => g.week === week);
          const done = games.every((g) => g.played);
          return (
            <div key={week}>
              <div className="flex items-baseline gap-2 border-b border-[var(--rule)] pb-1 mb-1">
                <span className="label" style={{ color: done ? 'var(--faint)' : 'var(--ink)' }}>
                  Week {week}
                </span>
                {done && (
                  <span className="fig" style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)' }}>
                    PLAYED
                  </span>
                )}
              </div>
              <ul className="space-y-0.5">
                {games.map((g) => {
                  const mine = g.homeRosterId === myRosterId || g.awayRosterId === myRosterId;
                  return (
                    <li
                      key={`${g.week}-${g.homeRosterId}-${g.awayRosterId}`}
                      className="truncate"
                      style={{
                        fontSize: 'var(--t-meta)',
                        color: g.played ? 'var(--faint)' : mine ? 'var(--ink)' : 'var(--graphite)',
                        fontWeight: mine && !g.played ? 600 : 400,
                      }}
                    >
                      {nameOf.get(g.homeRosterId) ?? `Roster ${g.homeRosterId}`}
                      <span style={{ color: 'var(--faint)' }}> v </span>
                      {nameOf.get(g.awayRosterId) ?? `Roster ${g.awayRosterId}`}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {missingWeeks.length > 0 && (
        <p className="mt-3" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)' }}>
          Weeks {missingWeeks.join(', ')} are missing — Sleeper returned no matchups for them.
        </p>
      )}
    </div>
  );
}
