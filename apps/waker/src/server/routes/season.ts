/**
 * SEASON — the playoff path, and which games decide it.
 *
 * DECISION SERVED: "what is this season actually worth playing for, and where
 * do I spend the effort?"
 *
 * A standings table answers neither. It tells you that you are 4-3 and third,
 * which is a fact about the past; it cannot tell you that week 11 is the game
 * you cannot lose. That only falls out of playing the rest of the season many
 * times and counting, which is what this route does.
 *
 * Everything here is deterministic. The simulation is seeded, so the number on
 * the page is the same number tomorrow unless the inputs moved — an odds figure
 * that drifts on every refresh cannot be screenshotted, argued with, or checked.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import * as S from '../../lib/sleeper.js';
import { cached, diskCached } from '../cache.js';
import {
  CACHE_DIR,
  loadLeague,
  loadLeagueUsers,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadState,
  myRoster,
  perWeek,
  readFixture,
  teamNames,
  useFixtures,
} from '../data.js';
import { projectLineup, type LineupPlayer } from '../../lib/analysis/lineup.js';
import {
  gameLeverage,
  simulateSeason,
  type GameLeverage,
  type PlayoffOdds,
  type SimGame,
  type SimTeam,
} from '../../lib/analysis/playoffs.js';
import { COOKIE_NAME, readCookie, verifySession, type Session } from '../session.js';

/**
 * How many seasons to play out.
 *
 * Five thousand puts the standard error on a 50% odds figure at about 0.7
 * points, which is finer than anyone should read a playoff probability to, and
 * it costs a few hundred milliseconds. The leverage pass runs a season twice per
 * remaining game, so it gets fewer runs on purpose: it is a comparison between
 * games, where a little more noise on each is a fair trade for having all of them.
 */
const ODDS_RUNS = 5000;
const LEVERAGE_RUNS = 800;

/**
 * One fixed seed for the whole app. Deliberately not derived from the league or
 * the date: those would make the "it does not move when you refresh" promise
 * true only within a day.
 */
const SIM_SEED = 20260803;

/** Pairings do not change once published, so the schedule is cached hard. */
const SCHEDULE_TTL = 6 * 60 * 60_000;

/**
 * The simulation costs about a second, and it is a pure function of its inputs.
 * The cache key is a digest of those inputs, so a hit is the same answer rather
 * than a stale one — when a result comes in, the key changes and it is recomputed.
 */
const SIM_TTL = 30 * 60_000;

/* ------------------------------------------------------------------ *
 * Pure helpers — the reasoning, kept out of the fetching so it is testable
 * ------------------------------------------------------------------ */

/** One row of Sleeper's matchup payload, reduced to what a schedule needs. */
export interface MatchupRow {
  roster_id: number;
  matchup_id: number | null;
}

/**
 * Turn a week of Sleeper matchups into games.
 *
 * Sleeper does not describe a fixture list; it gives one row per team per week
 * carrying a `matchup_id`, and the two rows sharing an id are the game. Rows
 * with no id are teams with no opponent that week — in a league with an odd
 * number of teams, or before the schedule has been generated at all — and they
 * are dropped rather than invented into a game.
 *
 * The lower roster id is called home. It has no meaning in fantasy beyond
 * settling the simulation's tie rule, and fixing it keeps the run reproducible.
 */
export function pairMatchups(week: number, rows: MatchupRow[]): SimGame[] {
  const byMatchup = new Map<number, number[]>();
  for (const row of rows) {
    if (row?.matchup_id == null || row.roster_id == null) continue;
    const group = byMatchup.get(row.matchup_id);
    if (group) group.push(row.roster_id);
    else byMatchup.set(row.matchup_id, [row.roster_id]);
  }

  const games: SimGame[] = [];
  for (const [, rosterIds] of [...byMatchup.entries()].sort((a, b) => a[0] - b[0])) {
    // Anything that is not a clean pair is not a game we can simulate. Median
    // and multi-team formats land here and are reported as unpaired rather than
    // being guessed at.
    if (rosterIds.length !== 2) continue;
    const [home, away] = [...rosterIds].sort((a, b) => a - b);
    games.push({ week, homeRosterId: home, awayRosterId: away });
  }
  return games;
}

/**
 * How many weeks are in the books.
 *
 * Taken from the records rather than from the calendar: a league's own week
 * counter says nothing about whether its games have been scored, and in the
 * preseason Sleeper reports this dynasty league as `in_season` while no team has
 * played anybody. The most-played team is the right reading — a team on a bye or
 * newly added would otherwise drag the whole league back a week.
 *
 * A week in progress counts as unplayed, so it is simulated from zero rather
 * than from Sunday's half-finished scores. That is the conservative reading: a
 * lead at four o'clock is not a win, and treating it as one would overstate the
 * odds of whoever happens to have played more games.
 */
export function weeksPlayed(rosters: Array<{ settings?: { wins?: number; losses?: number; ties?: number } }>): number {
  return rosters.reduce((most, r) => {
    const s = r.settings ?? {};
    return Math.max(most, (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0));
  }, 0);
}

/**
 * A cache key that is a fingerprint of the simulation's inputs.
 *
 * Content-addressed rather than time-addressed: a result coming in changes a
 * record, which changes the key, so a cache hit can never be a stale number.
 */
export function simKey(
  leagueId: string,
  teams: SimTeam[],
  remaining: SimGame[],
  playoffTeams: number,
  rosterId: number | null
): string {
  const digest = createHash('sha1')
    .update(
      JSON.stringify({
        teams,
        remaining,
        playoffTeams,
        rosterId,
        runs: [ODDS_RUNS, LEVERAGE_RUNS],
        seed: SIM_SEED,
      })
    )
    .digest('hex')
    .slice(0, 16);
  return `season-sim:${leagueId}:${digest}`;
}

/** Points scored so far. Sleeper splits the decimal into its own field. */
export const pointsFor = (settings: { fpts?: number; fpts_decimal?: number } | undefined): number =>
  (settings?.fpts ?? 0) + (settings?.fpts_decimal ?? 0) / 100;

/** Longest a regular season can be. A malformed setting must not make us fetch 30 weeks. */
const MAX_NFL_WEEK = 18;

/**
 * The week the playoffs open.
 *
 * Sleeper reports `playoff_week_start: 0` for a league that has not had its
 * playoff schedule set — which is most leagues in the preseason, when this page
 * is most likely to be opened. Left alone that becomes a regular season of minus
 * one weeks: no schedule, no simulation, and copy that says "-1 weeks of it".
 * Zero means "not set", so it takes the default rather than being believed.
 */
export function playoffStartWeek(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 1) return 15;
  return Math.min(MAX_NFL_WEEK + 1, Math.floor(n));
}

/** Same story: an unset `playoff_teams` comes back as 0, which would be no field at all. */
export function playoffFieldSize(raw: unknown, totalRosters: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return Math.min(6, Math.max(1, totalRosters));
  return Math.min(Math.floor(n), Math.max(1, totalRosters));
}

/**
 * Expected losses for one team.
 *
 * playoffs.ts derives this figure from the first team in the array and hands the
 * same number to everybody, which is only right when every roster plays the same
 * number of games and nobody has tied. Neither holds in general: a tie is a game
 * played that is neither a win nor a loss, and a week Sleeper never published
 * leaves some teams short. Recomputing per team keeps the record column adding
 * up to the games that team actually plays.
 */
export function expectedLosses(
  record: { wins: number; losses: number; ties: number },
  remainingForTeam: number,
  expectedWins: number
): number {
  const games = record.wins + record.losses + record.ties + remainingForTeam;
  // Ties are not simulated at all, so they are carried separately rather than
  // being quietly counted as defeats.
  return Math.max(0, games - record.ties - expectedWins);
}

/**
 * Starters the model has no projection for.
 *
 * A player with no projection scores zero, so he only reaches a starting slot on
 * a roster with nobody better — and then the slot looks filled while the team's
 * expected score is built on a number we do not have. That is indistinguishable
 * from an empty slot in the arithmetic and must not be indistinguishable on the
 * page, so it is counted and reported.
 */
export function unprojectedStarters(
  slots: Array<{ player: { playerId: string } | null }>,
  projections: Record<string, unknown>
): number {
  return slots.filter((s) => s.player && !projections[s.player.playerId]).length;
}

/* ------------------------------------------------------------------ *
 * The schedule loader
 * ------------------------------------------------------------------ */

/**
 * Every regular-season week's matchups, from fixtures or from Sleeper.
 *
 * Disk-cached as one blob, and deliberately not cached at all when the schedule
 * is incomplete: Sleeper publishes a league's fixture list at some point in the
 * preseason, and remembering "there is no schedule" for six hours would keep the
 * page empty long after it stopped being true.
 */
interface ScheduledWeek {
  games: SimGame[];
  /** Games this week should have had, from the number of roster rows Sleeper sent. */
  expected: number;
}

async function loadSchedule(
  leagueId: string,
  throughWeek: number
): Promise<Map<number, ScheduledWeek>> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);

  const raw: Record<number, MatchupRow[]> = useFixtures()
    ? await readFixture('schedule').catch(() => ({}))
    : await diskCached(CACHE_DIR, `schedule-${leagueId}-${throughWeek}`, SCHEDULE_TTL, async () => {
        const pages = await Promise.all(
          weeks.map(async (w) => [w, await S.getMatchups(leagueId, w).catch(() => [])] as const)
        );
        const complete = pages.filter(([, rows]) => Array.isArray(rows) && rows.length);
        // Throwing keeps a half-published schedule out of the cache file.
        if (complete.length < weeks.length) {
          throw new Error(`schedule incomplete: ${complete.length}/${weeks.length} weeks`);
        }
        return Object.fromEntries(pages);
      }).catch(async () => {
        // No cacheable schedule. Take whatever Sleeper will give us right now.
        const pages = await Promise.all(
          weeks.map(async (w) => [w, await S.getMatchups(leagueId, w).catch(() => [])] as const)
        );
        return Object.fromEntries(pages);
      });

  const out = new Map<number, ScheduledWeek>();
  for (const week of weeks) {
    const rows = raw[week];
    if (!Array.isArray(rows) || !rows.length) continue;
    const games = pairMatchups(week, rows);
    // One row per team, so a straight head-to-head week has half as many games
    // as rows. Anything short of that is a matchup group we could not pair, and
    // the caller has to be able to say so rather than quietly simulating a
    // season with a game missing from it.
    if (games.length) out.set(week, { games, expected: Math.floor(rows.length / 2) });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export interface SeasonTeam {
  rosterId: number;
  teamName: string;
  mine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Expected score from the best lineup this roster can field. */
  weeklyPoints: number;
  /** Starting slots nobody on the roster can fill. */
  emptySlots: string[];
  /** Starters with no projection on file, so coverage is never implied. */
  unprojectedStarters: number;
  odds: PlayoffOdds | null;
}

export interface SeasonResponse {
  season: string;
  preseason: boolean;
  /** Weeks already in the books, from the records. */
  weeksPlayed: number;
  playoffWeekStart: number;
  playoffTeams: number;
  runs: number;
  leverageRuns: number;
  seed: number;
  myRosterId: number | null;
  teams: SeasonTeam[];
  /** Every regular-season game, played or not. */
  schedule: Array<SimGame & { played: boolean }>;
  remainingGames: number;
  /** Weeks the schedule is missing entirely. */
  missingWeeks: number[];
  /** Weeks that came back with fewer games than teams — a matchup group we could not pair. */
  partialWeeks: number[];
  leverage: Array<GameLeverage & { opponentName: string }>;
}

export const seasonRouter = express.Router();

/**
 * Read the signing secret per request, not at module load.
 *
 * The server calls dotenv *after* its imports, and ES module imports are
 * hoisted — a secret captured in a module-level const here is captured before
 * the .env file has been read, and every request 401s with a valid cookie.
 */
const sessionSecret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || '';

const sessionOf = (req: express.Request): Session | null =>
  verifySession(readCookie(req.headers.cookie, COOKIE_NAME), sessionSecret());

seasonRouter.get('/api/league/:leagueId/season', (req, res, next) => {
  const session = sessionOf(req);
  if (!session) {
    return res
      .status(401)
      .json({ error: 'Enter your Sleeper username to continue.', needsIdentity: true });
  }
  handle(req, res, session).catch(next);
});

async function handle(req: express.Request, res: express.Response, session: Session) {
  const { leagueId } = req.params;

  const [league, rosters, users, players, state] = await Promise.all([
    loadLeague(leagueId),
    loadRosters(leagueId),
    loadLeagueUsers(leagueId),
    loadPlayers(),
    loadState(),
  ]);
  const projections = await loadProjections(league.season, league.scoring_settings);

  const nameOf = teamNames(users);
  const mine = myRoster(rosters, session.userId);

  const rosterPositions: string[] = league.roster_positions ?? [];
  const playoffWeekStart = playoffStartWeek(league.settings?.playoff_week_start);
  const playoffTeams = playoffFieldSize(
    league.settings?.playoff_teams,
    rosters.length || league.total_rosters || 12
  );
  const lastRegularWeek = Math.max(0, playoffWeekStart - 1);

  const played = weeksPlayed(rosters);
  // The state's season_type is the authoritative "is anyone playing" signal —
  // the league object reports `in_season` all summer.
  const preseason = played === 0 && state.season_type !== 'post';

  const byWeek = await loadSchedule(leagueId, lastRegularWeek);

  const schedule: Array<SimGame & { played: boolean }> = [];
  const remaining: SimGame[] = [];
  const missingWeeks: number[] = [];
  const partialWeeks: number[] = [];
  for (let week = 1; week <= lastRegularWeek; week++) {
    const entry = byWeek.get(week);
    if (!entry?.games.length) {
      missingWeeks.push(week);
      continue;
    }
    if (entry.games.length < entry.expected) partialWeeks.push(week);
    const done = week <= played;
    for (const game of entry.games) {
      schedule.push({ ...game, played: done });
      if (!done) remaining.push(game);
    }
  }

  const teams: SimTeam[] = [];
  const detail = new Map<number, Omit<SeasonTeam, 'odds'>>();

  for (const r of rosters) {
    const taxi = new Set<string>(r.taxi ?? []);
    const reserve = new Set<string>(r.reserve ?? []);
    const ids: string[] = r.players ?? [];

    const candidates: LineupPlayer[] = ids
      .filter((id) => players[id])
      .map((id) => ({
        playerId: id,
        position: players[id].pos,
        points: perWeek(projections[id]),
        onTaxi: taxi.has(id),
        onIr: reserve.has(id),
      }));

    const lineup = projectLineup(candidates, rosterPositions);

    teams.push({
      rosterId: r.roster_id,
      weeklyPoints: lineup.points,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      pointsFor: pointsFor(r.settings),
    });

    detail.set(r.roster_id, {
      rosterId: r.roster_id,
      teamName: nameOf.get(r.owner_id) ?? `Roster ${r.roster_id}`,
      mine: r.roster_id === mine?.roster_id,
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: pointsFor(r.settings),
      weeklyPoints: lineup.points,
      emptySlots: lineup.empty,
      unprojectedStarters: unprojectedStarters(lineup.slots, projections),
    });
  }

  /** How many games each roster still has, for the record column. */
  const remainingByRoster = new Map<number, number>();
  for (const g of remaining) {
    remainingByRoster.set(g.homeRosterId, (remainingByRoster.get(g.homeRosterId) ?? 0) + 1);
    remainingByRoster.set(g.awayRosterId, (remainingByRoster.get(g.awayRosterId) ?? 0) + 1);
  }

  // With nothing played and nothing scheduled there is no season to simulate,
  // and inventing one would be worse than saying so.
  const simulable = teams.length > 1 && (remaining.length > 0 || played > 0);

  const askingRosterId = mine?.roster_id ?? null;
  const run = simulable
    ? await cached(simKey(leagueId, teams, remaining, playoffTeams, askingRosterId), SIM_TTL, async () => ({
        odds: simulateSeason(teams, remaining, { playoffTeams, runs: ODDS_RUNS, seed: SIM_SEED }),
        leverage:
          askingRosterId != null && remaining.length
            ? gameLeverage(askingRosterId, teams, remaining, {
                playoffTeams,
                runs: LEVERAGE_RUNS,
                seed: SIM_SEED,
              })
            : ([] as GameLeverage[]),
      }))
    : { odds: [] as PlayoffOdds[], leverage: [] as GameLeverage[] };

  const oddsById = new Map(run.odds.map((o) => [o.rosterId, o]));

  const leverage: Array<GameLeverage & { opponentName: string }> = run.leverage.map((g) => ({
    ...g,
    opponentName: detail.get(g.opponentRosterId)?.teamName ?? `Roster ${g.opponentRosterId}`,
  }));

  // Ranked by odds where we have them, by roster strength where we do not —
  // which in the preseason is the only ordering that means anything anyway.
  const ordered = [...detail.values()].sort((a, b) => {
    const oa = oddsById.get(a.rosterId);
    const ob = oddsById.get(b.rosterId);
    if (oa && ob) return ob.playoffs - oa.playoffs || ob.expectedWins - oa.expectedWins;
    return b.weeklyPoints - a.weeklyPoints;
  });

  const body: SeasonResponse = {
    season: league.season,
    preseason,
    weeksPlayed: played,
    playoffWeekStart,
    playoffTeams,
    runs: simulable ? ODDS_RUNS : 0,
    leverageRuns: leverage.length ? LEVERAGE_RUNS : 0,
    seed: SIM_SEED,
    myRosterId: mine?.roster_id ?? null,
    teams: ordered.map((t) => {
      const o = oddsById.get(t.rosterId);
      return {
        ...t,
        odds: o
          ? { ...o, expectedLosses: expectedLosses(t, remainingByRoster.get(t.rosterId) ?? 0, o.expectedWins) }
          : null,
      };
    }),
    schedule,
    remainingGames: remaining.length,
    missingWeeks,
    partialWeeks,
    leverage,
  };

  res.json(body);
}
