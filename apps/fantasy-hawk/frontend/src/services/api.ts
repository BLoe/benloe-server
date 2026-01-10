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
    proxy: (endpoint: string) => fetchApi(`/fantasy/proxy?endpoint=${encodeURIComponent(endpoint)}`),
    dumpSettings: (leagueKey: string) => fetchApi(`/fantasy/debug/dump-settings/${leagueKey}`),
    dump: (type: string, leagueKey: string, week?: number) =>
      fetchApi(`/fantasy/debug/dump/${type}/${leagueKey}${week ? `?week=${week}` : ''}`),
  },
};

export { ApiError };
