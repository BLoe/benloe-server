import type { OAuthStatus } from '../types';

const API_BASE = '/api';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(error.error || 'Request failed', response.status);
  }

  return response.json();
}

export const api = {
  // OAuth endpoints
  oauth: {
    getStatus: () => fetchApi<OAuthStatus>('/oauth/status'),
    connect: () => {
      window.location.href = `${API_BASE}/oauth/connect`;
    },
    disconnect: () => fetchApi<{ success: boolean }>('/oauth/disconnect', { method: 'POST' }),
  },

  // Fantasy endpoints
  fantasy: {
    getGames: () => fetchApi('/fantasy/games'),
    getLeagues: (gameKey?: string) =>
      fetchApi(`/fantasy/leagues${gameKey ? `?game_key=${gameKey}` : ''}`),
    getLeagueDetails: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}`),
    getLeagueSettings: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/settings`),
    getStandings: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/standings`),
    getTeams: (gameKey?: string) =>
      fetchApi(`/fantasy/teams${gameKey ? `?game_key=${gameKey}` : ''}`),
    getRoster: (teamKey: string) => fetchApi(`/fantasy/teams/${teamKey}/roster`),
    getTeamStats: (teamKey: string) => fetchApi(`/fantasy/teams/${teamKey}/stats`),
    getPlayerStats: (playerKey: string) => fetchApi(`/fantasy/players/${playerKey}/stats`),
    getScoreboard: (leagueKey: string, week?: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/scoreboard${week ? `?week=${week}` : ''}`),
    getCategoryStats: (leagueKey: string, timespan: 'thisWeek' | 'last3Weeks' | 'season') =>
      fetchApi(`/fantasy/leagues/${leagueKey}/category-stats?timespan=${timespan}`),
    getStreaming: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/streaming`),
    getStreamingRecommendations: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/streaming/recommendations`),
    getSchedule: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/schedule`),
    getMatchupCurrent: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/matchup/current`),
    getMatchupProjections: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/matchup/projections`),
    // Trade endpoints
    getLeagueTeams: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/teams`),
    getTeamRoster: (leagueKey: string, teamKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/teams/${teamKey}/roster`),
    analyzeTrade: (leagueKey: string, payload: { playersToGive: any[]; playersToReceive: any[]; partnerTeamKey?: string }) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/trade/analyze`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    // Punt Strategy endpoints
    getPuntAnalysis: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/punt/analysis`),
    getPuntStrategies: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/punt/strategies`),
    // League Insights endpoints
    getLeagueInsightsSettings: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/insights/settings`),
    getLeagueInsightsAnalysis: (leagueKey: string) => fetchApi(`/fantasy/leagues/${leagueKey}/insights/analysis`),
    getLeagueInsightsRankings: (leagueKey: string, position?: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/insights/rankings${position && position !== 'All' ? `?position=${position}` : ''}`),
    // Schedule Planner endpoints
    getSeasonSchedule: (season?: number) =>
      fetchApi(`/fantasy/schedule/season${season ? `?season=${season}` : ''}`),
    getTeamSchedule: (teamAbbr: string, season?: number) =>
      fetchApi(`/fantasy/schedule/team/${teamAbbr}${season ? `?season=${season}` : ''}`),
    getRosterSchedule: (leagueKey: string, season?: number) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/schedule/roster${season ? `?season=${season}` : ''}`),
    getPlayoffSchedule: (leagueKey: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/schedule/playoffs`),
    // Season Outlook endpoints
    getOutlookStandings: (leagueKey: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/outlook/standings`),
    getOutlookPlayoffs: (leagueKey: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/outlook/playoffs`),
    // Player Comparison endpoints
    searchPlayers: (leagueKey: string, query: string, status?: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/players/search?q=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`),
    comparePlayers: (leagueKey: string, playerKeys: string[]) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/players/compare`, {
        method: 'POST',
        body: JSON.stringify({ playerKeys }),
      }),
    // Waiver Advisor endpoints
    getWaiverRecommendations: (leagueKey: string, position?: string, limit?: number) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/waiver/recommendations${position ? `?position=${position}` : ''}${limit ? `${position ? '&' : '?'}limit=${limit}` : ''}`),
    getWaiverDrops: (leagueKey: string, limit?: number) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/waiver/drops${limit ? `?limit=${limit}` : ''}`),
    getWaiverFaab: (leagueKey: string, limit?: number) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/waiver/faab${limit ? `?limit=${limit}` : ''}`),
    // Category Analysis endpoints
    getCategoryProfile: (leagueKey: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/category/profile`),
    getCategoryComparison: (leagueKey: string) =>
      fetchApi(`/fantasy/leagues/${leagueKey}/category/comparison`),
    proxy: (endpoint: string) => fetchApi(`/fantasy/proxy?endpoint=${encodeURIComponent(endpoint)}`),
    dumpSettings: (leagueKey: string) => fetchApi(`/fantasy/debug/dump-settings/${leagueKey}`),
    dump: (type: string, leagueKey: string, week?: number) =>
      fetchApi(`/fantasy/debug/dump/${type}/${leagueKey}${week ? `?week=${week}` : ''}`),
  },
};

export { ApiError };
