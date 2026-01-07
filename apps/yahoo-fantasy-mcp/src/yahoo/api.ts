// Yahoo Fantasy API Client
// (Adapted from Fantasy Hawk patterns)
import { yahooOAuthService } from './oauth.js';
import { getSessionByAccessToken, updateSessionYahooTokens, McpSession } from '../services/database.js';

const YAHOO_FANTASY_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

/**
 * Get valid Yahoo access token, refreshing if needed
 */
async function getValidYahooToken(session: McpSession): Promise<{ accessToken: string; session: McpSession }> {
  const refreshBuffer = 5 * 60 * 1000; // 5 minutes

  if (Date.now() + refreshBuffer >= session.yahooExpiresAt) {
    console.log('Yahoo token expiring soon, refreshing...');
    try {
      const newTokens = await yahooOAuthService.refreshAccessToken(session.yahooRefreshToken);

      // Update session with new Yahoo tokens
      updateSessionYahooTokens(
        session.id,
        newTokens.accessToken,
        newTokens.refreshToken,
        newTokens.expiresAt
      );

      console.log('Yahoo token refreshed successfully');
      return {
        accessToken: newTokens.accessToken,
        session: {
          ...session,
          yahooAccessToken: newTokens.accessToken,
          yahooRefreshToken: newTokens.refreshToken,
          yahooExpiresAt: newTokens.expiresAt,
        },
      };
    } catch (error) {
      console.error('Failed to refresh Yahoo token:', error);
      throw new Error('Yahoo authorization expired. Please re-authorize.');
    }
  }

  return { accessToken: session.yahooAccessToken, session };
}

/**
 * Make authenticated request to Yahoo Fantasy API
 */
async function makeYahooRequest(session: McpSession, endpoint: string): Promise<any> {
  const { accessToken } = await getValidYahooToken(session);

  // Add format=json to get JSON response instead of XML
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${YAHOO_FANTASY_BASE_URL}${endpoint}${separator}format=json`;

  console.log('Yahoo API request:', endpoint);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Yahoo API error (${endpoint}):`, response.status, errorText);
    throw new Error(`Yahoo API request failed: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// ============================================================
// API Functions
// ============================================================

/**
 * Get user's fantasy games (seasons)
 */
export async function getFantasyGames(session: McpSession): Promise<any> {
  return makeYahooRequest(session, '/users;use_login=1/games');
}

/**
 * Get user's leagues for a game
 */
export async function getFantasyLeagues(session: McpSession, gameKey: string = 'nba'): Promise<any> {
  return makeYahooRequest(session, `/users;use_login=1/games;game_keys=${gameKey}/leagues`);
}

/**
 * Get league details
 */
export async function getLeagueDetails(session: McpSession, leagueKey: string): Promise<any> {
  return makeYahooRequest(session, `/league/${leagueKey}`);
}

/**
 * Get league settings (includes stat categories)
 */
export async function getLeagueSettings(session: McpSession, leagueKey: string): Promise<any> {
  return makeYahooRequest(session, `/league/${leagueKey}/settings`);
}

/**
 * Get league standings
 */
export async function getLeagueStandings(session: McpSession, leagueKey: string): Promise<any> {
  return makeYahooRequest(session, `/league/${leagueKey}/standings`);
}

/**
 * Get league scoreboard (matchups)
 */
export async function getLeagueScoreboard(session: McpSession, leagueKey: string, week?: number): Promise<any> {
  let endpoint = `/league/${leagueKey}/scoreboard`;
  if (week !== undefined) {
    endpoint += `;week=${week}`;
  }
  return makeYahooRequest(session, endpoint);
}

/**
 * Get user's teams
 */
export async function getMyTeams(session: McpSession, gameKey: string = 'nba'): Promise<any> {
  return makeYahooRequest(session, `/users;use_login=1/games;game_keys=${gameKey}/teams`);
}

/**
 * Get team roster
 */
export async function getTeamRoster(session: McpSession, teamKey: string): Promise<any> {
  return makeYahooRequest(session, `/team/${teamKey}/roster`);
}

/**
 * Get team stats
 */
export async function getTeamStats(session: McpSession, teamKey: string): Promise<any> {
  return makeYahooRequest(session, `/team/${teamKey}/stats`);
}

/**
 * Get player stats
 */
export async function getPlayerStats(session: McpSession, playerKey: string): Promise<any> {
  return makeYahooRequest(session, `/player/${playerKey}/stats`);
}

/**
 * Get free agents
 */
export async function getFreeAgents(
  session: McpSession,
  leagueKey: string,
  count: number = 50,
  position?: string
): Promise<any> {
  let endpoint = `/league/${leagueKey}/players;status=FA;count=${Math.min(count, 50)}`;
  if (position) {
    endpoint += `;position=${position}`;
  }
  return makeYahooRequest(session, endpoint);
}

/**
 * Generic proxy to any Yahoo Fantasy endpoint
 */
export async function yahooProxy(session: McpSession, endpoint: string): Promise<any> {
  // Ensure endpoint starts with /
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }
  return makeYahooRequest(session, endpoint);
}
