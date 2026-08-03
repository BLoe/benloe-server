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
