/**
 * Sleeper API client.
 *
 * Two upstreams:
 *   REST v1 (api.sleeper.app)  - public, read-only, no auth. Rate limit 1000/min.
 *   GraphQL  (sleeper.app)     - undocumented, powers the real app. Public queries
 *                                work unauthenticated; user-scoped ones need a bearer.
 *
 * Everything here is read-only on purpose. No mutations are exposed.
 */

const REST = 'https://api.sleeper.app/v1';
const GQL = 'https://sleeper.app/graphql';

export type Json = Record<string, any>;

export class SleeperError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = 'SleeperError';
  }
}

export interface FetchOpts {
  /** Bearer token for user-scoped GraphQL. Omitted for all public calls. */
  token?: string;
  signal?: AbortSignal;
}

async function req(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': 'sleeper-ui/1.0 (personal dashboard)', ...init.headers },
  });
  if (!res.ok) {
    throw new SleeperError(`${res.status} ${res.statusText}`, res.status, url);
  }
  return res.json();
}

export async function rest(path: string, opts: FetchOpts = {}): Promise<any> {
  return req(`${REST}${path}`, { method: 'GET', signal: opts.signal });
}

export async function graphql(query: string, opts: FetchOpts = {}): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = opts.token;
  const body = await req(GQL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
    signal: opts.signal,
  });
  if (body.errors?.length) {
    throw new SleeperError(
      `GraphQL: ${body.errors.map((e: Json) => e.message).join('; ')}`,
      200,
      GQL
    );
  }
  return body.data;
}

/* ------------------------------------------------------------------ *
 * REST endpoints
 * ------------------------------------------------------------------ */

export const getUser = (usernameOrId: string, o?: FetchOpts) => rest(`/user/${usernameOrId}`, o);

export const getUserLeagues = (userId: string, season: string, o?: FetchOpts) =>
  rest(`/user/${userId}/leagues/nfl/${season}`, o);

export const getLeague = (leagueId: string, o?: FetchOpts) => rest(`/league/${leagueId}`, o);

export const getRosters = (leagueId: string, o?: FetchOpts) =>
  rest(`/league/${leagueId}/rosters`, o);

export const getLeagueUsers = (leagueId: string, o?: FetchOpts) =>
  rest(`/league/${leagueId}/users`, o);

export const getMatchups = (leagueId: string, week: number, o?: FetchOpts) =>
  rest(`/league/${leagueId}/matchups/${week}`, o);

export const getWinnersBracket = (leagueId: string, o?: FetchOpts) =>
  rest(`/league/${leagueId}/winners_bracket`, o);

export const getLosersBracket = (leagueId: string, o?: FetchOpts) =>
  rest(`/league/${leagueId}/losers_bracket`, o);

export const getTransactions = (leagueId: string, round: number, o?: FetchOpts) =>
  rest(`/league/${leagueId}/transactions/${round}`, o);

export const getTradedPicks = (leagueId: string, o?: FetchOpts) =>
  rest(`/league/${leagueId}/traded_picks`, o);

export const getDrafts = (leagueId: string, o?: FetchOpts) => rest(`/league/${leagueId}/drafts`, o);

export const getDraftPicks = (draftId: string, o?: FetchOpts) => rest(`/draft/${draftId}/picks`, o);

export const getState = (o?: FetchOpts) => rest('/state/nfl', o);

/** ~14.6MB. Never call per-request; cache to disk daily. */
export const getAllPlayers = (o?: FetchOpts) => rest('/players/nfl', o);

export const getTrending = (type: 'add' | 'drop', o?: FetchOpts) =>
  rest(`/players/nfl/trending/${type}?lookback_hours=24&limit=25`, o);

export const getWeekStats = (season: string, week: number, o?: FetchOpts) =>
  rest(`/stats/nfl/regular/${season}/${week}`, o);

/* ------------------------------------------------------------------ *
 * GraphQL — public queries (no token required)
 * ------------------------------------------------------------------ */

/** Live/final NFL game scores for a week. */
export async function getScores(season: string, week: number, o?: FetchOpts) {
  const d = await graphql(
    `query { scores(sport:"nfl", season:"${season}", season_type:"regular", week:${week}) {
      game_id status metadata date
    } }`,
    o
  );
  return d.scores;
}

/** Beat-reporter news items for a player. Not available via REST. */
export async function getPlayerNews(playerId: string, limit = 5, o?: FetchOpts) {
  const d = await graphql(
    `query { get_player_news(sport:"nfl", player_id:"${playerId}", limit:${limit}) {
      metadata player_id published source source_key
    } }`,
    o
  );
  return d.get_player_news;
}

/** Season outlook blurb for a player. Not available via REST. */
export async function getPlayerOutlook(playerId: string, season: string, o?: FetchOpts) {
  const d = await graphql(
    `query { get_player_outlook(sport:"nfl", player_id:"${playerId}", season:"${season}") {
      player_id season text
    } }`,
    o
  );
  return d.get_player_outlook;
}

export const AVATAR = (id?: string | null) =>
  id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null;

export const HEADSHOT = (playerId: string) =>
  `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
