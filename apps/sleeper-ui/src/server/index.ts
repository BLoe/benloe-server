/**
 * sleeper-ui API + static server.
 *
 * Two data sources, chosen by SLEEPER_SOURCE:
 *   live     - hit Sleeper, cache aggressively (production default)
 *   fixtures - read frozen JSON from fixtures/ (dev + screenshot default)
 *
 * Fixture mode is what makes the visual verification loop reliable: the same
 * request always renders the same pixels.
 */
import { config as loadEnv } from 'dotenv';
import express from 'express';
import compression from 'compression';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/sleeper.js';
import { cached, diskCached, TTL, stats, invalidate } from './cache.js';
import { chatAccess } from './chatAccess.js';
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
import {
  buildTeams,
  buildStandings,
  buildMatchups,
  buildResultTimeline,
  buildAllPlay,
  currentStreak,
  buildRosterView,
  buildChatFeed,
  type PlayerIndex,
} from '../lib/derive.js';

// Secrets live in the monorepo root, not this app's directory.
loadEnv({ path: '/srv/benloe/.env' });
loadEnv();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
const CACHE_DIR = process.env.SLEEPER_CACHE_DIR || join(ROOT, '.cache');

const PORT = Number(process.env.PORT || 3010);
const SOURCE = (process.env.SLEEPER_SOURCE || 'live') as 'live' | 'fixtures';

/**
 * Optional. Only used to pre-fill the sign-in box — it is NOT an identity.
 * Whose leagues you see comes from your own session, never from this.
 */
const SUGGESTED_USERNAME = process.env.SLEEPER_USERNAME || '';

/**
 * Bearer token for league chat. This is one specific person's Sleeper session,
 * so chat is only ever served to the visitor whose session matches the token's
 * owner — see requireChatOwner. Absent token means chat is unavailable to all.
 */
const SLEEPER_TOKEN = process.env.SLEEPER_TOKEN || '';
/** Posting writes to a real league, so it stays off unless explicitly enabled. */
const ALLOW_POSTING = process.env.SLEEPER_ALLOW_POSTING === 'true';

/** Signs session cookies. Shared with the other apps on this box. */
const SESSION_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

/** Fixture label -> league id, so fixture mode can answer by real league id. */
const FIXTURE_LEAGUES: Record<string, string> = {
  '1180168833027727360': 'dynasty-2025',
  '1254603551611559936': 'auction-2025',
  '1312065694577209344': 'dynasty-2026',
};

const app = express();
app.use(compression());

const readFixture = async (name: string) =>
  JSON.parse(await readFile(join(FIXTURES, `${name}.json`), 'utf8'));

/* ------------------------------------------------------------------ *
 * Source-aware loaders
 * ------------------------------------------------------------------ */

const useFixtures = () => SOURCE === 'fixtures';

async function loadState() {
  if (useFixtures()) return readFixture('state');
  return cached('state', TTL.state, () => S.getState());
}

/**
 * Resolve a Sleeper username to its account. In fixture mode any name resolves
 * to the fixture user so the screenshot harness can drive the real sign-in flow
 * without network access.
 */
async function resolveUser(username: string) {
  if (useFixtures()) return readFixture('user');
  return cached(`user:${username.toLowerCase()}`, TTL.league, () => S.getUser(username));
}

async function loadUserLeagues(userId: string, season: string) {
  if (useFixtures()) return readFixture(`leagues-${season}`);
  return cached(`leagues:${userId}:${season}`, TTL.league, () =>
    S.getUserLeagues(userId, season)
  );
}

async function loadLeague(leagueId: string) {
  if (useFixtures()) return readFixture(`${FIXTURE_LEAGUES[leagueId]}.league`);
  return cached(`league:${leagueId}`, TTL.league, () => S.getLeague(leagueId));
}

async function loadRosters(leagueId: string) {
  if (useFixtures()) return readFixture(`${FIXTURE_LEAGUES[leagueId]}.rosters`);
  return cached(`rosters:${leagueId}`, TTL.rosters, () => S.getRosters(leagueId));
}

async function loadLeagueUsers(leagueId: string) {
  if (useFixtures()) return readFixture(`${FIXTURE_LEAGUES[leagueId]}.users`);
  return cached(`users:${leagueId}`, TTL.league, () => S.getLeagueUsers(leagueId));
}

async function loadMatchups(leagueId: string, week: number) {
  if (useFixtures()) {
    const all = await readFixture(`${FIXTURE_LEAGUES[leagueId]}.matchups`).catch(() => ({}));
    return all[week] ?? [];
  }
  return cached(`matchups:${leagueId}:${week}`, TTL.matchups, () =>
    S.getMatchups(leagueId, week)
  );
}

/** Every week of matchups, for season-wide derivations. */
async function loadAllMatchups(leagueId: string, throughWeek: number) {
  if (useFixtures()) {
    return readFixture(`${FIXTURE_LEAGUES[leagueId]}.matchups`).catch(() => ({}));
  }
  return cached(`matchups-all:${leagueId}:${throughWeek}`, TTL.matchups, async () => {
    const out: Record<number, any> = {};
    for (let w = 1; w <= throughWeek; w++) {
      try {
        out[w] = await S.getMatchups(leagueId, w);
      } catch {
        break;
      }
    }
    return out;
  });
}

async function loadTransactions(leagueId: string, week: number) {
  if (useFixtures()) {
    const all = await readFixture(`${FIXTURE_LEAGUES[leagueId]}.transactions`).catch(() => ({}));
    return all[week] ?? [];
  }
  return cached(`tx:${leagueId}:${week}`, TTL.transactions, () =>
    S.getTransactions(leagueId, week)
  );
}

/** Slim player index. In live mode this is built from the full dump on disk. */
let playerIndexMemo: PlayerIndex | null = null;
async function loadPlayers(): Promise<PlayerIndex> {
  if (playerIndexMemo) return playerIndexMemo;
  if (useFixtures()) {
    playerIndexMemo = await readFixture('players.slim');
    return playerIndexMemo!;
  }
  const full = await diskCached<Record<string, any>>(
    CACHE_DIR,
    'players.full',
    TTL.players,
    () => S.getAllPlayers()
  );
  const slim: PlayerIndex = {};
  for (const [id, p] of Object.entries(full)) {
    if (!p.active && !p.team) continue;
    slim[id] = {
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position,
      team: p.team,
      no: p.number,
      age: p.age,
      exp: p.years_exp,
      status: p.injury_status,
      bye: p.bye_week,
      rank: p.search_rank,
    };
  }
  playerIndexMemo = slim;
  return slim;
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

const wrap =
  (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ *
 * Session — whose leagues are we looking at
 * ------------------------------------------------------------------ */

const sessionOf = (req: express.Request): Session | null =>
  verifySession(readCookie(req.headers.cookie, COOKIE_NAME), SESSION_SECRET);

/** Every league route needs to know who is asking. */
const requireSession: express.RequestHandler = (req, res, next) => {
  const session = sessionOf(req);
  if (!session) {
    return res.status(401).json({
      error: 'Enter your Sleeper username to continue.',
      needsIdentity: true,
    });
  }
  (req as any).session = session;
  next();
};

/**
 * The chat token belongs to exactly one Sleeper account. Serving chat to anyone
 * else would hand a stranger that account's private league conversations, so
 * chat is restricted to the visitor whose session matches the token's owner.
 */
let tokenOwnerMemo: string | null | undefined;
async function chatTokenOwnerId(): Promise<string | null> {
  if (tokenOwnerMemo !== undefined) return tokenOwnerMemo;
  if (!SLEEPER_TOKEN) return (tokenOwnerMemo = null);
  try {
    const me = await S.getTokenOwner({ token: SLEEPER_TOKEN });
    tokenOwnerMemo = me?.user_id ?? null;
  } catch (err) {
    console.warn(`[chat] could not identify token owner: ${(err as Error).message}`);
    tokenOwnerMemo = null;
  }
  return tokenOwnerMemo;
}

app.get('/api/session', (req, res) => {
  const session = sessionOf(req);
  res.json({
    session: session ? { userId: session.userId, username: session.username } : null,
    suggestedUsername: SUGGESTED_USERNAME || null,
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
    res.setHeader('set-cookie', cookieHeader(signSession(session, SESSION_SECRET), {
      secure: SECURE_COOKIES,
    }));
    res.json({
      session: { userId: session.userId, username: session.username },
      displayName: user.display_name,
    });
  })
);

app.delete('/api/session', (_req, res) => {
  res.setHeader('set-cookie', clearCookieHeader(SECURE_COOKIES));
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    source: SOURCE,
    chat: { enabled: !!SLEEPER_TOKEN, canPost: ALLOW_POSTING },
    cache: stats(),
  });
});

app.post('/api/cache/flush', (_req, res) => {
  invalidate();
  playerIndexMemo = null;
  res.json({ ok: true });
});

/** Bootstrap: who am I, what leagues, what week is it. */
app.get(
  '/api/me',
  requireSession,
  wrap(async (req, res) => {
    const session: Session = (req as any).session;
    const [state, user] = await Promise.all([loadState(), resolveUser(session.username)]);
    const season: string = state.league_season ?? state.season;

    // Show the current season alongside last season's. In the preseason the new
    // leagues are thin or absent, and a dynasty manager is usually still looking
    // back at how the last one finished — both belong in the switcher.
    const seasons = [season, state.previous_season].filter(Boolean) as string[];
    const perSeason = await Promise.all(
      seasons.map((s) => loadUserLeagues(user.user_id, s).catch(() => []))
    );

    const seen = new Set<string>();
    const leagues = perSeason.flat().filter((l: any) => {
      if (!l || seen.has(l.league_id)) return false;
      seen.add(l.league_id);
      return true;
    });

    res.json({
      user: {
        userId: user.user_id,
        username: user.username,
        displayName: user.display_name,
        avatar: S.AVATAR(user.avatar),
      },
      state,
      leagues: (leagues ?? []).map((l: any) => ({
        leagueId: l.league_id,
        name: l.name,
        season: l.season,
        status: l.status,
        totalRosters: l.total_rosters,
        avatar: S.AVATAR(l.avatar),
        sport: l.sport,
      })),
    });
  })
);

/** Everything the league dashboard needs, in one round trip. */
app.get(
  '/api/league/:leagueId',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const [league, rosters, users, state, players] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadState(),
      loadPlayers(),
    ]);

    const playoffStart: number = league.settings?.playoff_week_start ?? 15;
    // A completed season has all its weeks; a live one only through the current.
    const lastWeek =
      league.status === 'complete'
        ? playoffStart + 2
        : Math.max(1, Number(state.week) || 1);

    const allMatchups = await loadAllMatchups(leagueId, lastWeek);
    const timeline = buildResultTimeline(allMatchups, playoffStart);
    const allPlay = buildAllPlay(allMatchups, playoffStart);
    const standings = buildStandings(rosters, users);

    const { userId } = (req as any).session as Session;
    const myRoster = rosters.find(
      (r: any) => r.owner_id === userId || r.co_owners?.includes(userId)
    );

    res.json({
      league: {
        leagueId: league.league_id,
        name: league.name,
        season: league.season,
        status: league.status,
        avatar: S.AVATAR(league.avatar),
        totalRosters: league.total_rosters,
        rosterPositions: league.roster_positions,
        playoffWeekStart: playoffStart,
        playoffTeams: league.settings?.playoff_teams ?? 6,
        waiverBudget: league.settings?.waiver_budget ?? 0,
        tradeDeadline: league.settings?.trade_deadline ?? null,
        divisions: league.settings?.divisions ?? 0,
        previousLeagueId: league.previous_league_id,
        scoringSettings: league.scoring_settings,
      },
      currentWeek: lastWeek,
      myRosterId: myRoster?.roster_id ?? null,
      standings: standings.map((row) => ({
        ...row,
        streak: currentStreak(timeline.get(row.rosterId) ?? []),
        results: timeline.get(row.rosterId) ?? [],
        allPlay: allPlay.get(row.rosterId) ?? { wins: 0, losses: 0, ties: 0, pct: 0 },
      })),
      playerCount: Object.keys(players).length,
    });
  })
);

/** One week's matchups, fully resolved with player names and points. */
app.get(
  '/api/league/:leagueId/matchups/:week',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const week = Number(req.params.week);
    const [league, rosters, users, raw, players] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadMatchups(leagueId, week),
      loadPlayers(),
    ]);

    const teams = buildTeams(rosters, users);
    const rosterById = new Map<number, any>(
      rosters.map((r: any) => [r.roster_id as number, r])
    );
    const matchups = buildMatchups(raw, teams, week);

    // Attach the resolved starting lineup for each side so the UI can render a
    // side-by-side comparison without a second request.
    const hydrate = (sideRaw: any, side: any) => {
      if (!side) return null;
      const roster = rosterById.get(side.rosterId);
      const entry = raw.find((m: any) => m.roster_id === side.rosterId);
      const lineup = roster
        ? buildRosterView(
            { ...roster, starters: entry?.starters ?? roster.starters },
            league.roster_positions,
            players,
            entry?.players_points ?? {}
          )
        : [];
      return { ...side, lineup };
    };

    res.json({
      week,
      matchups: matchups.map((m) => ({
        ...m,
        home: hydrate(raw, m.home),
        away: hydrate(raw, m.away),
      })),
    });
  })
);

/** A single team: full roster laid out into lineup slots. */
app.get(
  '/api/league/:leagueId/roster/:rosterId',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const rosterId = Number(req.params.rosterId);
    const [league, rosters, users, players] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
    ]);

    const roster = rosters.find((r: any) => r.roster_id === rosterId);
    if (!roster) return res.status(404).json({ error: 'roster not found' });

    const teams = buildTeams(rosters, users);
    res.json({
      team: teams.get(rosterId),
      settings: roster.settings,
      slots: buildRosterView(roster, league.roster_positions, players),
    });
  })
);

/** Recent league activity, newest first. */
app.get(
  '/api/league/:leagueId/transactions',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const through = Number(req.query.through ?? 17);
    const [rosters, users, players] = await Promise.all([
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
    ]);
    const teams = buildTeams(rosters, users);

    const weeks = await Promise.all(
      [...Array(through)].map((_, i) => loadTransactions(leagueId, i + 1).catch(() => []))
    );

    const named = (id: string) => players[id]?.name ?? id;
    const items = weeks
      .flat()
      .filter((t: any) => t.status === 'complete')
      .map((t: any) => ({
        id: t.transaction_id,
        type: t.type,
        week: t.leg,
        created: t.created,
        teams: (t.roster_ids ?? []).map((rid: number) => teams.get(rid)?.teamName ?? `#${rid}`),
        adds: Object.entries(t.adds ?? {}).map(([pid, rid]) => ({
          player: named(pid),
          pos: players[pid]?.pos ?? null,
          to: teams.get(rid as number)?.teamName ?? null,
        })),
        drops: Object.entries(t.drops ?? {}).map(([pid, rid]) => ({
          player: named(pid),
          pos: players[pid]?.pos ?? null,
          from: teams.get(rid as number)?.teamName ?? null,
        })),
        bid: t.settings?.waiver_bid ?? null,
        picks: (t.draft_picks ?? []).map((p: any) => ({
          season: p.season,
          round: p.round,
          from: teams.get(p.previous_owner_id)?.teamName ?? null,
          to: teams.get(p.owner_id)?.teamName ?? null,
        })),
      }))
      .sort((a: any, b: any) => b.created - a.created);

    res.json({ transactions: items });
  })
);

/* ------------------------------------------------------------------ *
 * League chat
 *
 * The only part of the app that needs a Sleeper token, and the only part that
 * can write. Reading is on whenever a token is present; posting additionally
 * requires SLEEPER_ALLOW_POSTING, because it puts a real message in a real
 * league in front of real people.
 * ------------------------------------------------------------------ */

const chatOpts = () => ({ token: SLEEPER_TOKEN });

/**
 * Returns a refusal when this visitor must not see chat, or null when they may.
 * Fixture mode is exempt so the screenshot harness has something to render.
 */
async function chatDenial(
  req: express.Request
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const session = sessionOf(req);
  const decision = chatAccess({
    fixtures: useFixtures(),
    hasToken: !!SLEEPER_TOKEN,
    tokenOwnerId: await chatTokenOwnerId(),
    visitorId: session?.userId ?? null,
  });
  if (decision.allowed) return null;
  return {
    status: decision.status,
    body: { error: decision.error, [decision.code]: true },
  };
}

app.get(
  '/api/league/:leagueId/chat',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;

    if (!useFixtures() && !SLEEPER_TOKEN) {
      return res.status(503).json({
        error: 'Chat needs a Sleeper token. Set SLEEPER_TOKEN in /srv/benloe/.env.',
        needsToken: true,
      });
    }

    const denial = await chatDenial(req);
    if (denial) return res.status(denial.status).json(denial.body);

    const [rosters, users] = await Promise.all([
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
    ]);

    // Fixture mode has no token, so the screenshot harness reads a synthetic
    // feed shaped exactly like a real one.
    // Deliberately uncached in live mode: chat is the one surface where
    // staleness is immediately obvious.
    const raw = useFixtures()
      ? await readFixture('chat.sample').catch(() => [])
      : await S.getLeagueMessages(leagueId, { ...chatOpts(), before });

    res.json({
      messages: buildChatFeed(raw, {
        teams: buildTeams(rosters, users),
        rosters,
        myUserId: ((req as any).session as Session).userId,
      }),
      // The oldest id in this page is the cursor for loading older messages.
      nextCursor: raw.length ? raw[raw.length - 1].message_id : null,
      canPost: ALLOW_POSTING,
    });
  })
);

app.post(
  '/api/league/:leagueId/chat',
  requireSession,
  express.json({ limit: '16kb' }),
  wrap(async (req, res) => {
    const denial = await chatDenial(req);
    if (denial) return res.status(denial.status).json(denial.body);
    if (!ALLOW_POSTING) {
      return res.status(403).json({
        error: 'Posting is off. Set SLEEPER_ALLOW_POSTING=true to enable it.',
      });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Message is empty.' });
    if (text.length > 2000) return res.status(400).json({ error: 'Message is too long.' });

    const sent = await S.postLeagueMessage(req.params.leagueId, text, chatOpts());
    const [rosters, users] = await Promise.all([
      loadRosters(req.params.leagueId),
      loadLeagueUsers(req.params.leagueId),
    ]);

    res.json({
      message: buildChatFeed([sent], {
        teams: buildTeams(rosters, users),
        rosters,
        myUserId: ((req as any).session as Session).userId,
      })[0],
    });
  })
);

/** Slim player index for client-side search. */
app.get(
  '/api/players',
  wrap(async (_req, res) => {
    res.set('cache-control', 'public, max-age=3600');
    res.json(await loadPlayers());
  })
);

/* ------------------------------------------------------------------ *
 * Static + errors
 * ------------------------------------------------------------------ */

const DIST = join(ROOT, 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get('*', wrap(async (_req, res) => {
  res.sendFile(join(DIST, 'index.html'));
}));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err?.message ?? err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? 'internal error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`sleeper-ui listening on 127.0.0.1:${PORT} (source=${SOURCE})`);
});
