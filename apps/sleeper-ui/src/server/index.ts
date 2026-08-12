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
import { TokenStore, defaultTokenPath } from './tokenStore.js';
import { mayConnectSleeper, parseAllowList } from './loginPolicy.js';
import { BriefService } from './brief.js';
import { espnNewsFor, mapOutlook, mapSleeperNews, mergeNews, prettySource } from '../lib/news.js';
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
  buildActivityRows,
  buildDepthChart,
  buildPlayerHistory,
  describePeriod,
  indexProjections,
  projectSeason,
  compareLineup,
  positionalStrength,
  ageProfile,
  scoringKey,
  type PlayerIndex,
} from '../lib/derive.js';

// Secrets live in the tmpfs file benloe-secrets renders for THIS app — sleeper-ui's
// own set merged over 'shared' — not in this app's directory. What the process can
// see is decided by what is in that set, not by anything in this file.
loadEnv({ path: '/run/benloe-secrets/sleeper-ui.env' });
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

/**
 * Sleeper sign-in, which is how a visitor gets chat without hand-editing .env.
 * Off switch, plus an optional allowlist of usernames — this is a public page
 * asking for a Sleeper password, so it should be easy to narrow or close.
 */
const LOGIN_POLICY = {
  enabled: process.env.SLEEPER_LOGIN_ENABLED !== 'false',
  allow: parseAllowList(process.env.SLEEPER_LOGIN_ALLOW),
};
const LOGIN_ENABLED = LOGIN_POLICY.enabled;

const tokens = SESSION_SECRET
  ? new TokenStore(defaultTokenPath(CACHE_DIR), SESSION_SECRET)
  : null;

/**
 * AI player briefs. Absent key simply means the Player page shows no brief —
 * every other part of the app is unaffected.
 */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const briefs = ANTHROPIC_API_KEY
  ? new BriefService(ANTHROPIC_API_KEY, join(CACHE_DIR, 'briefs'))
  : null;

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

/**
 * Projection index for a season, or a specific week.
 *
 * The upstream payload is 5–9MB of every player in the league, most with nothing
 * but an ADP, so it is disk-cached and trimmed to the handful of fields the
 * player page renders.
 */
const projectionMemo = new Map<string, Record<string, any>>();

async function loadProjections(
  season: string,
  week: number | null,
  scoring: Record<string, number> | undefined
) {
  if (useFixtures()) {
    // Only the season-long fixture was captured — it is what the preseason
    // views actually use, and a weekly one would be 9,400 rows of zeroes.
    if (week) return {};
    const raw = await readFixture(`projections-${season}`).catch(() => []);
    return indexProjections(raw, scoringKey(scoring));
  }
  const key = week ? `projections-${season}-w${week}` : `projections-${season}-season`;
  const scored = `${key}:${scoringKey(scoring)}`;

  // Keep the indexed form in memory. The raw payload is 8MB of 9,400 entries,
  // and re-parsing and re-walking it on every player page was most of the
  // request time.
  const hit = projectionMemo.get(scored);
  if (hit) return hit;

  const raw = await diskCached<any[]>(CACHE_DIR, key, 6 * 60 * 60_000, () =>
    S.getProjections(season, week)
  );
  const index = indexProjections(raw, scoringKey(scoring));
  projectionMemo.set(scored, index);
  return index;
}

/** Draft picks for a league, so a player can show where they were taken. */
async function loadDraftPicks(leagueId: string) {
  if (useFixtures()) return { picks: [], season: undefined as string | undefined };
  return cached(`draft-picks:${leagueId}`, TTL.league, async () => {
    const drafts = await S.getDrafts(leagueId).catch(() => []);
    const draft = (drafts ?? [])[0];
    if (!draft?.draft_id) return { picks: [], season: undefined };
    const picks = await S.getDraftPicks(draft.draft_id).catch(() => []);
    return { picks: picks ?? [], season: draft.season as string | undefined };
  });
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
  projectionMemo.clear();
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
    const period = describePeriod(state, {
      season: league.season,
      status: league.status,
      playoffWeekStart: playoffStart,
    });
    // Nothing is scheduled in the preseason, so there is no week to load.
    const lastWeek = period.week ?? 0;

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
        // Dynasty roster rules. A taxi squad is capacity-limited and closes at
        // a deadline, so the roster page needs the limits, not just the names.
        taxiSlots: league.settings?.taxi_slots ?? 0,
        taxiDeadline: league.settings?.taxi_deadline ?? null,
        taxiYears: league.settings?.taxi_years ?? null,
        reserveSlots: league.settings?.reserve_slots ?? 0,
        previousLeagueId: league.previous_league_id,
        scoringSettings: league.scoring_settings,
      },
      currentWeek: lastWeek,
      period,
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
    // Projected points for this specific week, so the lineup can show expected
    // beside actual.
    const projections = await loadProjections(league.season, week, league.scoring_settings).catch(
      () => ({})
    );

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
      projections,
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

    const state = await loadState();
    const period = describePeriod(state, {
      season: league.season,
      status: league.status,
      playoffWeekStart: league.settings?.playoff_week_start ?? 15,
    });
    // Weekly projections once games are scheduled; season totals before that.
    const projections = await loadProjections(
      league.season,
      period.week,
      league.scoring_settings
    ).catch(() => ({}));

    const teams = buildTeams(rosters, users);
    const hasProjections = Object.keys(projections).length > 0;

    res.json({
      team: teams.get(rosterId),
      settings: roster.settings,
      slots: buildRosterView(roster, league.roster_positions, players),
      depth: buildDepthChart(roster, league.roster_positions, players),
      projections,
      projectionScope: period.week ? `Week ${period.week}` : `${league.season} season`,
      // The three reads the roster page is actually opened for. All of them
      // need projections, so they are simply absent without them rather than
      // rendering as a page full of zeroes.
      compare: hasProjections
        ? compareLineup(roster, league.roster_positions, players, projections as any)
        : null,
      positions: hasProjections
        ? (positionalStrength(rosters, league.roster_positions, players, projections as any).get(
            rosterId
          ) ?? [])
        : [],
      ages: hasProjections
        ? ageProfile(roster, rosters, players, projections as any)
        : null,
    });
  })
);

/** Recent league activity as one row per manager action, newest first. */
app.get(
  '/api/league/:leagueId/transactions',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const through = Math.min(Number(req.query.through ?? 17) || 17, 22);
    const [rosters, users, players] = await Promise.all([
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
    ]);

    const weeks = await Promise.all(
      [...Array(through)].map((_, i) => loadTransactions(leagueId, i + 1).catch(() => []))
    );

    res.json({
      rows: buildActivityRows(weeks.flat(), buildTeams(rosters, users), players),
    });
  })
);

/**
 * One player, in the context of this league: who owns them, how they have
 * scored week by week, and what the beat reporters are saying.
 */
app.get(
  '/api/league/:leagueId/player/:playerId',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId, playerId } = req.params;
    const [league, rosters, users, players, state] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
      loadState(),
    ]);

    const player = players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found.' });

    const teams = buildTeams(rosters, users);
    const roster = rosters.find((r: any) => (r.players ?? []).includes(playerId));
    const team = roster ? teams.get(roster.roster_id) : null;

    const playoffStart: number = league.settings?.playoff_week_start ?? 15;
    const lastWeek =
      league.status === 'complete' ? playoffStart + 2 : Math.max(1, Number(state.week) || 1);
    const allMatchups = await loadAllMatchups(leagueId, lastWeek);

    // Weekly scoring comes from whichever roster held the player that week, so
    // a mid-season pickup still shows a full season of production.
    const weeks: Array<{ week: number; points: number; started: boolean }> = [];
    for (const [weekKey, entries] of Object.entries(allMatchups as Record<string, any[]>)) {
      const week = Number(weekKey);
      if (Number.isNaN(week)) continue;
      for (const entry of entries ?? []) {
        const pts = entry.players_points?.[playerId];
        if (pts == null) continue;
        weeks.push({ week, points: pts, started: (entry.starters ?? []).includes(playerId) });
        break;
      }
    }
    weeks.sort((a, b) => a.week - b.week);

    const scored = weeks.filter((w) => w.points !== 0 || w.started);
    const total = weeks.reduce((sum, w) => sum + w.points, 0);

    // News, outlook, projections and draft position are all best-effort: every
    // one is an undocumented endpoint, and the page is useful without any of them.
    const settle = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };

    const period = describePeriod(state, {
      season: league.season,
      status: league.status,
      playoffWeekStart: playoffStart,
    });

    const [newsRaw, outlookRaw, seasonProj, weekProj, draft, txWeeks] = await Promise.all([
      useFixtures() ? Promise.resolve([]) : settle(() => S.getPlayerNews(playerId, 8), []),
      useFixtures()
        ? Promise.resolve(null)
        : settle(() => S.getPlayerOutlook(playerId, league.season), null),
      settle(() => loadProjections(league.season, null, league.scoring_settings), {}),
      period.week
        ? settle(() => loadProjections(league.season, period.week, league.scoring_settings), {})
        : Promise.resolve({}),
      settle(() => loadDraftPicks(leagueId), { picks: [], season: undefined }),
      Promise.all(
        [...Array(Math.max(1, lastWeek))].map((_, i) =>
          loadTransactions(leagueId, i + 1).catch(() => [])
        )
      ),
    ]);

    const news = (newsRaw ?? [])
      .map((n: any) => ({
        title: n.metadata?.title ?? null,
        // The full write-up, which is what makes these worth showing at all.
        body: n.metadata?.description ?? null,
        source: n.source ?? null,
        published: n.published ?? null,
        url: n.metadata?.url ?? null,
      }))
      .filter((n: any) => n.title || n.body);

    const outlook = outlookRaw?.metadata?.description
      ? {
          text: outlookRaw.metadata.description as string,
          source: outlookRaw.source ?? null,
          season: league.season as string,
        }
      : null;

    const history = buildPlayerHistory(
      playerId,
      txWeeks.flat(),
      draft.picks,
      teams,
      draft.season
    );

    res.json({
      player,
      owner: team
        ? { rosterId: team.rosterId, teamName: team.teamName, managerName: team.managerName, avatar: team.avatar }
        : null,
      onTaxi: !!roster?.taxi?.includes(playerId),
      onIr: !!roster?.reserve?.includes(playerId),
      isStarter: !!roster?.starters?.includes(playerId),
      weeks,
      totals: {
        points: Math.round(total * 100) / 100,
        games: scored.length,
        average: scored.length ? Math.round((total / scored.length) * 100) / 100 : 0,
        best: weeks.length ? Math.max(...weeks.map((w) => w.points)) : 0,
      },
      news,
      outlook,
      history,
      projection: {
        season: (seasonProj as any)[playerId] ?? null,
        week: (weekProj as any)[playerId] ?? null,
        weekNumber: period.week,
        scoring: scoringKey(league.scoring_settings),
      },
    });
  })
);


/* ------------------------------------------------------------------ *
 * Sleeper sign-in and league chat
 *
 * Chat is the only Sleeper surface that requires being signed in. Each visitor
 * connects their own account and we hold their token, encrypted, so chat is
 * per-visitor like everything else.
 * ------------------------------------------------------------------ */

/** Resolve which token, if any, this visitor may read chat with. */
async function resolveChat(req: express.Request): Promise<
  { ok: true; token: string } | { ok: false; status: number; body: Record<string, unknown> }
> {
  const session = sessionOf(req);
  const ownToken = session && tokens ? await tokens.get(session.userId) : null;

  const decision = chatAccess({
    fixtures: useFixtures(),
    visitorId: session?.userId ?? null,
    hasOwnToken: !!ownToken,
    hasServerToken: !!SLEEPER_TOKEN,
    serverTokenOwnerId: await chatTokenOwnerId(),
  });

  if (!decision.allowed) {
    return {
      ok: false,
      status: decision.status,
      body: {
        error: decision.error,
        [decision.code]: true,
        // This visitor's own permission, not the global switch — the client uses
        // it to decide between showing a sign-in form and explaining why not.
        canLogIn: session ? loginPermitted(session) : false,
      },
    };
  }
  return { ok: true, token: decision.using === 'own' ? ownToken! : SLEEPER_TOKEN };
}

/** May this visitor connect a Sleeper account at all? */
const loginPermitted = (session: Session): boolean =>
  mayConnectSleeper(session.username, LOGIN_POLICY);

/** Whether this visitor already has an account connected. */
app.get(
  '/api/sleeper-login',
  requireSession,
  wrap(async (req, res) => {
    const session: Session = (req as any).session;
    const connected = tokens ? await tokens.has(session.userId) : false;
    res.json({
      connected,
      since: connected && tokens ? await tokens.savedAt(session.userId) : null,
      canLogIn: loginPermitted(session),
    });
  })
);

/**
 * Exchange Sleeper credentials for a token held on this visitor's behalf.
 *
 * The password is forwarded to Sleeper and then dropped: never written to disk,
 * never logged, never echoed back in an error.
 */
app.post(
  '/api/sleeper-login',
  requireSession,
  express.json({ limit: '4kb' }),
  wrap(async (req, res) => {
    const session: Session = (req as any).session;
    if (!tokens) return res.status(500).json({ error: 'Server is missing a signing secret.' });
    if (!loginPermitted(session)) {
      return res.status(403).json({
        error:
          'Sleeper sign-in on this server is limited to managers in the league. ' +
          'If that should include you, ask Ben to add your username.',
      });
    }

    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Enter your Sleeper username or email and password.' });
    }

    let result;
    try {
      result = await S.login(identifier, password);
    } catch {
      // Never surface the upstream error verbatim — it can echo the request.
      return res.status(502).json({ error: 'Sleeper did not respond. Try again shortly.' });
    }

    if (!result) return res.status(401).json({ error: 'Sleeper rejected those credentials.' });

    // The token must belong to the account being browsed, or chat would show one
    // person's conversations under another person's session.
    if (result.user_id !== session.userId) {
      return res.status(409).json({
        error: `Those credentials are for ${result.username ?? 'another account'}, but you are browsing as ${session.username}. Switch accounts first.`,
      });
    }

    await tokens.set(session.userId, session.username, result.token);
    res.json({ connected: true, username: result.username ?? session.username });
  })
);

app.delete(
  '/api/sleeper-login',
  requireSession,
  wrap(async (req, res) => {
    const session: Session = (req as any).session;
    if (tokens) await tokens.remove(session.userId);
    res.json({ connected: false });
  })
);

app.get(
  '/api/league/:leagueId/chat',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;

    const access = await resolveChat(req);
    if (!access.ok) return res.status(access.status).json(access.body);

    const [rosters, users] = await Promise.all([
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
    ]);

    // Fixture mode has no token, so the screenshot harness reads a synthetic
    // feed shaped exactly like a real one. Live chat is deliberately uncached:
    // it is the one surface where staleness is immediately obvious.
    const raw = useFixtures()
      ? await readFixture('chat.sample').catch(() => [])
      : await S.getLeagueMessages(leagueId, { token: access.token, before });

    res.json({
      messages: buildChatFeed(raw, {
        teams: buildTeams(rosters, users),
        rosters,
        myUserId: ((req as any).session as Session).userId,
      }),
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
    const access = await resolveChat(req);
    if (!access.ok) return res.status(access.status).json(access.body);
    if (!ALLOW_POSTING) {
      return res.status(403).json({
        error: 'Posting is off. Set SLEEPER_ALLOW_POSTING=true to enable it.',
      });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Message is empty.' });
    if (text.length > 2000) return res.status(400).json({ error: 'Message is too long.' });

    const sent = await S.postLeagueMessage(req.params.leagueId, text, { token: access.token });
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


/**
 * Projected season: every roster's best lineup, and the schedule resolved from
 * those numbers. This is the preseason's headline view.
 */
app.get(
  '/api/league/:leagueId/projections',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId } = req.params;
    const [league, rosters, users, players, state] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
      loadState(),
    ]);

    const playoffStart: number = league.settings?.playoff_week_start ?? 15;
    const projections = await loadProjections(league.season, null, league.scoring_settings).catch(
      () => ({})
    );
    if (!Object.keys(projections).length) {
      return res.json({ available: false, teams: [], matchups: [] });
    }

    // The full published schedule, which exists before any game is played.
    const schedule = await loadAllMatchups(leagueId, playoffStart - 1);

    const { teams, matchups } = projectSeason(
      rosters,
      users,
      league.roster_positions,
      players,
      projections as any,
      schedule,
      playoffStart
    );

    const { userId } = (req as any).session as Session;
    const myRoster = rosters.find(
      (r: any) => r.owner_id === userId || r.co_owners?.includes(userId)
    );

    res.json({
      available: true,
      season: league.season,
      playoffTeams: league.settings?.playoff_teams ?? 6,
      weeksProjected: new Set(matchups.map((m) => m.week)).size,
      myRosterId: myRoster?.roster_id ?? null,
      teams,
      matchups,
    });
  })
);

/**
 * Everything written about a player lately, from every source that will answer.
 *
 * Sources are fetched in parallel and each is best-effort — a slow or broken
 * upstream degrades the feed rather than failing the page.
 */
app.get(
  '/api/league/:leagueId/player/:playerId/news',
  requireSession,
  wrap(async (req, res) => {
    const { leagueId, playerId } = req.params;
    const [league, players] = await Promise.all([loadLeague(leagueId), loadPlayers()]);
    const player = players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found.' });

    if (useFixtures()) return res.json({ items: [], sources: [] });

    const settle = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };

    const [sleeperRaw, outlookRaw, espn] = await Promise.all([
      settle(() => S.getPlayerNews(playerId, 12), [] as any[]),
      settle(() => S.getPlayerOutlook(playerId, league.season), null as any),
      settle(() => espnNewsFor(player.name), []),
    ]);

    const outlook = mapOutlook(outlookRaw, league.season);
    const items = mergeNews(
      [...mapSleeperNews(sleeperRaw ?? []), ...espn, ...(outlook ? [outlook] : [])],
      24
    );

    res.json({
      items,
      // Which upstreams actually returned something, for the panel's subtitle.
      sources: [...new Set(items.map((i) => i.source))].sort(),
    });
  })
);

/**
 * A short analyst read on a player, written by Claude from the gathered news
 * plus its own web search.
 *
 * Cached for twelve hours because each generation is a paid API call.
 */
app.get(
  '/api/league/:leagueId/player/:playerId/brief',
  requireSession,
  wrap(async (req, res) => {
    if (!briefs) {
      return res.status(503).json({
        error: 'AI briefs need ANTHROPIC_API_KEY in /run/benloe-secrets/sleeper-ui.env.',
        unavailable: true,
      });
    }

    const { leagueId, playerId } = req.params;
    const force = req.query.refresh === '1';

    // Fixture runs must never bill the Anthropic API. The verification harness
    // opens player pages on every pass, and a live call there would be both a
    // real charge and a non-deterministic screenshot.
    if (useFixtures()) {
      return res.json({
        cached: true,
        brief: {
          summary:
            'Fixture brief. In fixture mode the app does not call the Anthropic API, so this stands in for the generated text.',
          points: ['Deterministic stand-in so screenshots do not change between runs.'],
          watch: [],
          sources: ['Fixtures'],
          generatedAt: 1_700_000_000_000,
          model: 'fixture',
        },
      });
    }

    const [league, rosters, users, players] = await Promise.all([
      loadLeague(leagueId),
      loadRosters(leagueId),
      loadLeagueUsers(leagueId),
      loadPlayers(),
    ]);
    const player = players[playerId];
    if (!player) return res.status(404).json({ error: 'Player not found.' });

    const key = `${league.season}-${playerId}`;
    if (!force) {
      const hit = await briefs.cached(key);
      if (hit) return res.json({ brief: hit, cached: true });
    }

    // Assemble the same picture the page shows, then let Claude check it.
    const settle = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };

    const [sleeperRaw, outlookRaw, espn, seasonProj] = await Promise.all([
      settle(() => S.getPlayerNews(playerId, 12), [] as any[]),
      settle(() => S.getPlayerOutlook(playerId, league.season), null as any),
      settle(() => espnNewsFor(player.name), []),
      settle(() => loadProjections(league.season, null, league.scoring_settings), {} as any),
    ]);

    const outlook = mapOutlook(outlookRaw, league.season);
    const news = mergeNews(
      [...mapSleeperNews(sleeperRaw ?? []), ...espn, ...(outlook ? [outlook] : [])],
      14
    );

    const teams = buildTeams(rosters, users);
    const owner = rosters.find((r: any) => (r.players ?? []).includes(playerId));

    try {
      const brief = await briefs.get(
        key,
        {
          playerName: player.name,
          position: player.pos,
          nflTeam: player.team,
          season: league.season,
          leagueName: league.name,
          scoring: scoringKey(league.scoring_settings).replace('pts_', '').replace('_', ' '),
          injuryStatus: player.status ?? null,
          projection: (seasonProj as any)[playerId]
            ? {
                points: (seasonProj as any)[playerId].points,
                games: (seasonProj as any)[playerId].games,
              }
            : null,
          ownedBy: owner ? (teams.get(owner.roster_id)?.teamName ?? null) : null,
          news,
        },
        force
      );
      res.json({ brief, cached: false });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
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
