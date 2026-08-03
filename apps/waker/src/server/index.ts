/**
 * Waker API + static server.
 *
 * Waker is organised by decision, not by entity. The routes reflect that: they
 * are named for questions a manager asks ("what needs me now", "what is my
 * roster shaped like") rather than for nouns to browse.
 *
 * Two data sources, chosen by WAKER_SOURCE:
 *   live     - hit the upstreams, cache aggressively (production default)
 *   fixtures - read frozen JSON from fixtures/ (dev + screenshot default)
 *
 * Fixture mode is what makes visual verification reliable: the same request
 * always renders the same pixels. It is wired in from the first commit rather
 * than bolted on, because retrofitting it is how you end up with screenshots
 * that quietly depend on live third-party data.
 */
import { config as loadEnv } from 'dotenv';
import express from 'express';
import compression from 'compression';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/sleeper.js';
import { cached, diskCached, TTL, stats, invalidate } from './cache.js';
import { parseAllowList } from './loginPolicy.js';
import { loadMarket, type Market } from './market.js';
import { readCycle } from '../lib/analysis/cycle.js';
import { buildFeed } from './feed.js';
import { orientationOf } from '../lib/analysis/orientation.js';
import { indexProjections } from '../lib/projections.js';
import {
  COOKIE_NAME,
  cookieHeader,
  clearCookieHeader,
  isValidUsername,
  readCookie,
  signSession,
  verifySession,
  type Session,
} from './session.js';

// Secrets live in the monorepo root, not this app's directory.
loadEnv({ path: '/srv/benloe/.env' });
loadEnv();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
export const CACHE_DIR = process.env.WAKER_CACHE_DIR || join(ROOT, '.cache');

const PORT = Number(process.env.PORT || 3012);
const SOURCE = (process.env.WAKER_SOURCE || 'live') as 'live' | 'fixtures';
/** Which NFL season the captured fixtures describe. See scripts/capture-fixtures. */
const FIXTURE_SEASON = '2025';

/** Signs session cookies. Shared with the other apps on this box. */
const SESSION_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

/**
 * Same twelve-manager gate as sleeper-ui. This is a public hostname asking for
 * a Sleeper username, so it should be easy to narrow or close.
 */
const LOGIN_POLICY = {
  enabled: process.env.SLEEPER_LOGIN_ENABLED !== 'false',
  allow: parseAllowList(process.env.SLEEPER_LOGIN_ALLOW),
};

const app = express();
app.use(compression());

export const useFixtures = () => SOURCE === 'fixtures';
const readFixture = async (name: string) =>
  JSON.parse(await readFile(join(FIXTURES, `${name}.json`), 'utf8'));

const wrap =
  (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ *
 * Session — whose team are we waking up
 * ------------------------------------------------------------------ */

const sessionOf = (req: express.Request): Session | null =>
  verifySession(readCookie(req.headers.cookie, COOKIE_NAME), SESSION_SECRET);

const requireSession: express.RequestHandler = (req, res, next) => {
  const session = sessionOf(req);
  if (!session) {
    return res.status(401).json({ error: 'Enter your Sleeper username to continue.', needsIdentity: true });
  }
  (req as any).session = session;
  next();
};

async function resolveUser(username: string) {
  if (useFixtures()) return readFixture('user');
  return cached(`user:${username.toLowerCase()}`, TTL.league, () => S.getUser(username));
}

app.get('/api/session', (req, res) => {
  const session = sessionOf(req);
  res.json({
    session: session ? { userId: session.userId, username: session.username } : null,
  });
});

app.post(
  '/api/session',
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    if (!SESSION_SECRET) {
      return res.status(500).json({ error: 'Server is missing a session signing secret.' });
    }
    const raw = req.body?.username;
    if (!isValidUsername(raw)) {
      return res.status(400).json({ error: 'That is not a valid Sleeper username.' });
    }
    const username = raw.trim();

    // The allowlist gates who may sign in at all, not just who may write.
    if (LOGIN_POLICY.enabled === false) {
      return res.status(403).json({ error: 'Sign-in is closed.' });
    }
    if (LOGIN_POLICY.allow.length && !LOGIN_POLICY.allow.includes(username.toLowerCase())) {
      return res.status(403).json({ error: 'This is a private league dashboard.' });
    }

    let user: any;
    try {
      user = await resolveUser(username);
    } catch {
      return res.status(404).json({ error: `No Sleeper account found for "${username}".` });
    }
    if (!user?.user_id) {
      return res.status(404).json({ error: `No Sleeper account found for "${username}".` });
    }

    const session: Session = {
      userId: user.user_id,
      username: user.username ?? username,
      iat: Math.floor(Date.now() / 1000),
    };
    res.setHeader(
      'set-cookie',
      cookieHeader(signSession(session, SESSION_SECRET), { secure: SECURE_COOKIES })
    );
    res.json({ session: { userId: session.userId, username: session.username } });
  })
);

app.delete('/api/session', (_req, res) => {
  res.setHeader('set-cookie', clearCookieHeader(SECURE_COOKIES));
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, source: SOURCE, cache: stats() });
});

app.post('/api/cache/flush', (_req, res) => {
  invalidate();
  playerMemo = null;
  marketMemo.clear();
  projectionMemo.clear();
  res.json({ ok: true });
});

/** Bootstrap: who am I, which leagues, and where in the season are we. */
app.get(
  '/api/me',
  requireSession,
  wrap(async (req, res) => {
    const session: Session = (req as any).session;
    const [state, user] = await Promise.all([
      useFixtures() ? readFixture('state') : cached('state', TTL.state, () => S.getState()),
      resolveUser(session.username),
    ]);
    const season: string = state.league_season ?? state.season;
    const seasons = [season, state.previous_season].filter(Boolean) as string[];

    const leagues = useFixtures()
      ? await readFixture('leagues')
      : (
          await Promise.all(
            seasons.map((s) =>
              cached(`leagues:${user.user_id}:${s}`, TTL.league, () =>
                S.getUserLeagues(user.user_id, s)
              ).catch(() => [])
            )
          )
        ).flat();

    res.json({
      user: {
        userId: user.user_id,
        username: user.username,
        displayName: user.display_name,
        avatar: S.AVATAR(user.avatar),
      },
      state,
      leagues: leagues.map((l: any) => ({
        leagueId: l.league_id,
        name: l.name,
        season: l.season,
        status: l.status,
        totalRosters: l.total_rosters,
        // Sleeper states it outright: 0 redraft, 1 keeper, 2 dynasty. Worth
        // knowing because `previous_league_id` does NOT distinguish them — a
        // redraft league that ran last year links back too, so every league
        // looked like a dynasty league by that test.
        kind: l.settings?.type === 2 ? 'dynasty' : l.settings?.type === 1 ? 'keeper' : 'redraft',
      })),
    });
  })
);

/* ------------------------------------------------------------------ *
 * League data
 * ------------------------------------------------------------------ */

async function loadLeague(leagueId: string) {
  if (useFixtures()) return readFixture('league');
  return cached(`league:${leagueId}`, TTL.league, () => S.getLeague(leagueId));
}

async function loadRosters(leagueId: string) {
  if (useFixtures()) return readFixture('rosters');
  return cached(`rosters:${leagueId}`, TTL.rosters, () => S.getRosters(leagueId));
}

async function loadLeagueUsers(leagueId: string) {
  if (useFixtures()) return readFixture('users');
  return cached(`users:${leagueId}`, TTL.league, () => S.getLeagueUsers(leagueId));
}

/**
 * Slim player index. The full dump is ~14MB of mostly-inactive players; this
 * keeps the fields any Waker view actually reads.
 */
export interface PlayerRow {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
  age: number | null;
  exp: number | null;
  status: string | null;
  bye: number | null;
  rank: number | null;
}

let playerMemo: Record<string, PlayerRow> | null = null;

async function loadPlayers(): Promise<Record<string, PlayerRow>> {
  if (playerMemo) return playerMemo;
  const full: Record<string, any> = useFixtures()
    ? await readFixture('players')
    : await diskCached(CACHE_DIR, 'players-full', TTL.players, () => S.getAllPlayers());

  const slim: Record<string, PlayerRow> = {};
  for (const [id, p] of Object.entries(full)) {
    if (!p.active && !p.team) continue;
    slim[id] = {
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position ?? null,
      team: p.team ?? null,
      age: p.age ?? null,
      exp: p.years_exp ?? null,
      status: p.injury_status ?? null,
      bye: p.bye_week ?? null,
      rank: p.search_rank ?? null,
    };
  }
  playerMemo = slim;
  return slim;
}

/** Rotowire season projections, indexed and memoised. */
const projectionMemo = new Map<string, Record<string, { points: number; games: number | null }>>();

async function loadProjections(season: string, scoring: Record<string, number> | undefined) {
  const key = `${season}:${scoringKey(scoring)}`;
  const hit = projectionMemo.get(key);
  if (hit) return hit;

  const raw = useFixtures()
    ? await readFixture('projections')
    : await diskCached(CACHE_DIR, `projections-${season}`, 6 * 60 * 60_000, () =>
        S.getProjections(season, null)
      ).catch(() => []);

  const index = indexProjections(raw, scoringKey(scoring));
  projectionMemo.set(key, index);
  return index;
}

/** Which projected-points field matches this league's scoring. */
function scoringKey(scoring: Record<string, number> | undefined): 'pts_ppr' | 'pts_half_ppr' | 'pts_std' {
  const rec = scoring?.rec ?? 0;
  if (rec >= 0.75) return 'pts_ppr';
  if (rec >= 0.25) return 'pts_half_ppr';
  return 'pts_std';
}

/** The third-party layer for one league, memoised per league shape. */
const marketMemo = new Map<string, Promise<Market>>();

async function loadMarketFor(league: any, players: Record<string, PlayerRow>): Promise<Market> {
  const numQbs = (league.roster_positions ?? []).filter(
    (p: string) => p === 'QB' || p === 'SUPER_FLEX'
  ).length;
  const ppr = league.scoring_settings?.rec ?? 0;
  const key = `${league.season}-${numQbs}-${league.total_rosters}-${ppr}`;

  let hit = marketMemo.get(key);
  if (!hit) {
    hit = loadMarket(Object.values(players), league.season, {
      cacheDir: CACHE_DIR,
      fixtures: useFixtures(),
      fixtureDir: FIXTURES,
      fixtureSeason: FIXTURE_SEASON,
      numQbs: Math.max(1, numQbs),
      numTeams: league.total_rosters ?? 12,
      ppr,
    });
    marketMemo.set(key, hit);
  }
  return hit;
}

/**
 * Coverage report. Not a debug route — the UI uses it to say which sources are
 * actually answering rather than implying complete data.
 */
app.get(
  '/api/league/:leagueId/sources',
  requireSession,
  wrap(async (req, res) => {
    const league = await loadLeague(req.params.leagueId);
    const players = await loadPlayers();
    const market = await loadMarketFor(league, players);
    res.json({
      health: market.health,
      picks: market.crosswalk.picks.length,
      players: Object.keys(players).length,
    });
  })
);

/**
 * The board: every rostered player as a point in value-by-age space.
 *
 * Returns the whole league, not just one roster, because the shape of your
 * roster only means something against the shapes of the others.
 */
app.get(
  '/api/league/:leagueId/board',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const session: Session = (req as any).session;

    const [league, rosters, users, players] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
    ]);
    const [market, projections] = await Promise.all([
      loadMarketFor(league, players),
      loadProjections(league.season, league.scoring_settings),
    ]);

    const nameOf = new Map<string, string>(
      users.map((u: any) => [u.user_id, u.metadata?.team_name || u.display_name || 'Unnamed'])
    );
    const mine = rosters.find(
      (r: any) => r.owner_id === session.userId || r.co_owners?.includes(session.userId)
    );

    const teams = rosters.map((r: any) => {
      const taxi = new Set<string>(r.taxi ?? []);
      const reserve = new Set<string>(r.reserve ?? []);
      const roster = (r.players ?? [])
        .map((id: string) => {
          const p = players[id];
          if (!p) return null;
          const v = market.crosswalk.bySleeperId.get(id);
          const proj = projections[id];
          const games = Math.min(17, Math.max(1, proj?.games ?? 17));
          return {
            id,
            name: p.name,
            position: p.pos,
            team: p.team,
            age: p.age,
            perWeek: (proj?.points ?? 0) / games,
            dynasty: v?.dynasty ?? null,
            redraft: v?.redraft ?? null,
            trend7Day: v?.trend7Day ?? null,
            onTaxi: taxi.has(id),
            onIr: reserve.has(id),
          };
        })
        .filter(Boolean);

      const orientation = orientationOf(
        roster.map((p: any) => ({ playerId: p.id, dynasty: p.dynasty, redraft: p.redraft }))
      );

      return {
        rosterId: r.roster_id,
        teamName: nameOf.get(r.owner_id) ?? `Roster ${r.roster_id}`,
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        mine: r.roster_id === mine?.roster_id,
        orientation: {
          index: orientation.index,
          label: orientation.label,
          dynastyValue: orientation.dynastyValue,
          redraftValue: orientation.redraftValue,
          unpriced: orientation.unpriced,
        },
        players: roster,
      };
    });

    res.json({ teams, myRosterId: mine?.roster_id ?? null, coverage: market.health });
  })
);

/**
 * The feed: what needs you, ranked by what is at stake.
 *
 * Everything the app knows meets here. Each source is already best-effort, so a
 * dead upstream removes its cards rather than the page.
 */
app.get(
  '/api/league/:leagueId/feed',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const session: Session = (req as any).session;

    const [league, rosters, players, state] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadPlayers(),
      useFixtures() ? readFixture('state') : cached('state', TTL.state, () => S.getState()),
    ]);

    const roster = rosters.find(
      (r: any) => r.owner_id === session.userId || r.co_owners?.includes(session.userId)
    );
    if (!roster) {
      return res.status(404).json({ error: 'You do not have a roster in this league.' });
    }

    const [market, projections] = await Promise.all([
      loadMarketFor(league, players),
      loadProjections(league.season, league.scoring_settings),
    ]);

    const inSeason = state.season_type === 'regular' || state.season_type === 'post';
    const week: number = state.week ?? 0;
    const phase = readCycle({
      now: new Date(),
      gamesScheduled: inSeason,
      periodLabel: inSeason ? `Week ${week}` : 'Preseason',
    }).phase;

    // The usage window.
    //
    // In season, four recent games: long enough that one blowout does not
    // define a player, short enough to catch a role that changed a month ago.
    //
    // Out of season, the whole season that was played — and deliberately NOT
    // through week 18. Week 18 is the one where playoff teams rest their
    // starters, and reading it as usage produced a feed full of "Michael
    // Pittman is being used more than he is scoring" at 2.1 points a game,
    // which was an artefact of him sitting out, not a signal about his role.
    const throughWeek = inSeason && week > 0 ? week : 17;
    const usageWindow = inSeason && week > 0 ? 4 : 17;

    res.json(
      buildFeed({
        phase,
        roster,
        rosters,
        league,
        players,
        projections,
        market,
        throughWeek,
        usageWindow,
      })
    );
  })
);

/**
 * Where we are in the week.
 *
 * Its own route because every horizon needs it and it is cheap — the clock
 * matters more often than the data does.
 */
app.get(
  '/api/league/:leagueId/cycle',
  requireSession,
  wrap(async (req, res) => {
    const [league, state] = await Promise.all([
      loadLeague(req.params.leagueId),
      useFixtures() ? readFixture('state') : cached('state', TTL.state, () => S.getState()),
    ]);

    // Trust the NFL state, not the league's own status.
    //
    // Sleeper reports this dynasty league as `in_season` in August, while the
    // state endpoint correctly says season_type 'pre' at week 0. Believing the
    // league gives you "Week 0 · games in progress" in the middle of summer.
    // The state's season_type is the authoritative signal for whether anyone is
    // actually playing.
    let week: number = state.week ?? state.display_week ?? 0;
    let inSeason = state.season_type === 'regular' || state.season_type === 'post';
    // Same reasoning as the pinned clock: fixtures need to render an in-season
    // page in August, and this must never be reachable in live mode.
    if (useFixtures() && req.query.inSeason === '1') {
      inSeason = true;
      week = Number(req.query.week) || 7;
    }

    // Fixture mode may pin the clock, which is the only way to screenshot a
    // Sunday-lock page on a Tuesday. Refused in live mode: a settable "now"
    // reachable from the internet would let anyone fake a deadline.
    const pinned = useFixtures() && typeof req.query.now === 'string' ? new Date(req.query.now) : null;
    const now = pinned && !Number.isNaN(pinned.getTime()) ? pinned : new Date();

    res.json({
      cycle: readCycle({
        now,
        gamesScheduled: inSeason,
        periodLabel: inSeason ? `Week ${week}` : 'Preseason',
        daysToKickoff: inSeason ? null : daysToKickoff(league.season, now),
      }),
      week: inSeason ? week : null,
      season: league.season,
      status: league.status,
    });
  })
);

/**
 * Roughly when week 1 kicks off. The NFL opens the Thursday after Labor Day,
 * which is close enough for a countdown and avoids another API call for a
 * number nobody reads to the day.
 */
function daysToKickoff(season: string, now: Date): number | null {
  const year = Number(season);
  if (!Number.isFinite(year)) return null;
  const sept = new Date(Date.UTC(year, 8, 1));
  const firstMonday = 1 + ((8 - sept.getUTCDay()) % 7);
  const kickoff = Date.UTC(year, 8, firstMonday + 3);
  const days = Math.ceil((kickoff - now.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

/* ------------------------------------------------------------------ *
 * Static + errors
 * ------------------------------------------------------------------ */

const DIST = join(ROOT, 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get('*', wrap(async (_req, res) => res.sendFile(join(DIST, 'index.html'))));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err?.message ?? err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? 'internal error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`waker listening on 127.0.0.1:${PORT} (source=${SOURCE})`);
});
