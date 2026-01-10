/**
 * Ball Don't Lie API Service
 * Provides NBA schedule and game data for streaming analysis
 */

const BALLDONTLIE_API_URL = 'https://api.balldontlie.io';

// Cache configuration
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes - schedule data rarely changes mid-day
const TEAMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - teams don't change

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

// Simple in-memory cache
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, {
    data,
    expiry: Date.now() + ttlMs,
  });
}

// Export for testing
export function clearCache(): void {
  cache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}

interface NBATeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

interface NBAGame {
  id: number;
  date: string; // YYYY-MM-DD
  datetime: string; // ISO 8601
  season: number;
  status: string;
  postseason: boolean;
  home_team: NBATeam;
  visitor_team: NBATeam;
  home_team_score: number;
  visitor_team_score: number;
}

interface GamesResponse {
  data: NBAGame[];
  meta: {
    per_page: number;
    next_cursor?: number;
  };
}

interface TeamsResponse {
  data: NBATeam[];
}

class BallDontLieService {
  private getApiKey(): string {
    return process.env.BALLDONTLIE_API_KEY || '';
  }

  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Ball Don\'t Lie API key not configured');
    }

    const url = new URL(`${BALLDONTLIE_API_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ball Don't Lie API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all NBA teams (cached for 24 hours)
   */
  async getTeams(): Promise<NBATeam[]> {
    const cacheKey = 'teams';
    const cached = getCached<NBATeam[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.fetch<TeamsResponse>('/nba/v1/teams');
    setCache(cacheKey, response.data, TEAMS_CACHE_TTL_MS);
    return response.data;
  }

  /**
   * Get games for a date range (cached for 30 minutes)
   */
  async getGames(startDate: string, endDate: string): Promise<NBAGame[]> {
    const cacheKey = `games:${startDate}:${endDate}`;
    const cached = getCached<NBAGame[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const allGames: NBAGame[] = [];
    let cursor: number | undefined;

    // Paginate through all results
    do {
      const params: Record<string, string> = {
        start_date: startDate,
        end_date: endDate,
        per_page: '100',
      };
      if (cursor) {
        params.cursor = cursor.toString();
      }

      const response = await this.fetch<GamesResponse>('/nba/v1/games', params);
      allGames.push(...response.data);
      cursor = response.meta.next_cursor;
    } while (cursor);

    setCache(cacheKey, allGames, CACHE_TTL_MS);
    return allGames;
  }

  /**
   * Get games for the current fantasy week
   * Takes start and end dates from Yahoo's scoreboard data
   */
  async getWeekGames(weekStart: string, weekEnd: string): Promise<NBAGame[]> {
    return this.getGames(weekStart, weekEnd);
  }

  /**
   * Calculate games per team for a date range
   * Returns a map of team abbreviation -> game count
   */
  async getGamesPerTeam(
    startDate: string,
    endDate: string
  ): Promise<Map<string, { total: number; dates: string[] }>> {
    const games = await this.getGames(startDate, endDate);
    const teamGames = new Map<string, { total: number; dates: string[] }>();

    for (const game of games) {
      // Home team
      const homeAbbr = game.home_team.abbreviation;
      if (!teamGames.has(homeAbbr)) {
        teamGames.set(homeAbbr, { total: 0, dates: [] });
      }
      const homeData = teamGames.get(homeAbbr)!;
      homeData.total++;
      homeData.dates.push(game.date);

      // Visitor team
      const visitorAbbr = game.visitor_team.abbreviation;
      if (!teamGames.has(visitorAbbr)) {
        teamGames.set(visitorAbbr, { total: 0, dates: [] });
      }
      const visitorData = teamGames.get(visitorAbbr)!;
      visitorData.total++;
      visitorData.dates.push(game.date);
    }

    return teamGames;
  }

  /**
   * Get schedule analysis for streaming optimization
   * Groups games by date to help identify roster conflicts
   */
  async getScheduleAnalysis(startDate: string, endDate: string): Promise<{
    gamesByDate: Record<string, NBAGame[]>;
    gamesPerTeam: Record<string, { total: number; dates: string[] }>;
    dateRange: { start: string; end: string };
  }> {
    const games = await this.getGames(startDate, endDate);

    // Group by date
    const gamesByDate: Record<string, NBAGame[]> = {};
    for (const game of games) {
      if (!gamesByDate[game.date]) {
        gamesByDate[game.date] = [];
      }
      gamesByDate[game.date].push(game);
    }

    // Calculate games per team
    const gamesPerTeam: Record<string, { total: number; dates: string[] }> = {};
    for (const game of games) {
      // Home team
      const homeAbbr = game.home_team.abbreviation;
      if (!gamesPerTeam[homeAbbr]) {
        gamesPerTeam[homeAbbr] = { total: 0, dates: [] };
      }
      gamesPerTeam[homeAbbr].total++;
      gamesPerTeam[homeAbbr].dates.push(game.date);

      // Visitor team
      const visitorAbbr = game.visitor_team.abbreviation;
      if (!gamesPerTeam[visitorAbbr]) {
        gamesPerTeam[visitorAbbr] = { total: 0, dates: [] };
      }
      gamesPerTeam[visitorAbbr].total++;
      gamesPerTeam[visitorAbbr].dates.push(game.date);
    }

    return {
      gamesByDate,
      gamesPerTeam,
      dateRange: { start: startDate, end: endDate },
    };
  }

  /**
   * Check if the service is configured
   */
  isConfigured(): boolean {
    return !!this.getApiKey();
  }
}

export const ballDontLieService = new BallDontLieService();
export type { NBAGame, NBATeam };
