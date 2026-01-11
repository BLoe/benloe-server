/**
 * Ball Don't Lie API Service
 * Provides NBA schedule and game data for streaming analysis
 */

const BALLDONTLIE_API_URL = 'https://api.balldontlie.io';

// Cache configuration
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes - schedule data rarely changes mid-day
const TEAMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - teams don't change
const SEASON_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours - season schedule rarely changes

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

interface WeekSchedule {
  weekNumber: number;
  startDate: string;
  endDate: string;
  games: NBAGame[];
  gamesPerTeam: Record<string, number>;
}

interface SeasonSchedule {
  season: number;
  weeks: WeekSchedule[];
  teams: NBATeam[];
  playoffWeeks: number[]; // Week numbers typically 20-22
  allStarBreak?: { start: string; end: string };
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

  /**
   * Get full season schedule grouped by fantasy weeks
   * Fantasy weeks are Monday-Sunday
   */
  async getSeasonSchedule(season?: number): Promise<SeasonSchedule> {
    const seasonYear = season || this.getCurrentSeason();
    const cacheKey = `season:${seasonYear}`;
    const cached = getCached<SeasonSchedule>(cacheKey);
    if (cached) {
      return cached;
    }

    // NBA regular season typically runs Oct-April
    // For 2024-25 season, starts in October 2024
    const seasonStart = `${seasonYear}-10-01`;
    const seasonEnd = `${seasonYear + 1}-04-30`;

    const [games, teams] = await Promise.all([
      this.getGames(seasonStart, seasonEnd),
      this.getTeams(),
    ]);

    // Group games by fantasy week (Monday-Sunday)
    const weeks = this.groupGamesByFantasyWeek(games, seasonYear);

    // Identify playoff weeks (typically the last 3-4 weeks of regular season)
    // For fantasy basketball, playoffs are usually weeks 20-22 or 21-23
    const playoffWeeks = weeks.length >= 3
      ? [weeks.length - 2, weeks.length - 1, weeks.length]
      : [];

    const result: SeasonSchedule = {
      season: seasonYear,
      weeks,
      teams,
      playoffWeeks,
      allStarBreak: this.getEstimatedAllStarBreak(seasonYear),
    };

    setCache(cacheKey, result, SEASON_CACHE_TTL_MS);
    return result;
  }

  /**
   * Get schedule for a specific NBA team
   */
  async getTeamSchedule(teamAbbr: string, season?: number): Promise<{
    team: string;
    season: number;
    games: Array<{
      date: string;
      opponent: string;
      isHome: boolean;
      weekNumber: number;
    }>;
    gamesByWeek: Record<number, number>;
  }> {
    const seasonSchedule = await this.getSeasonSchedule(season);
    const teamUpper = teamAbbr.toUpperCase();

    const teamGames: Array<{
      date: string;
      opponent: string;
      isHome: boolean;
      weekNumber: number;
    }> = [];
    const gamesByWeek: Record<number, number> = {};

    for (const week of seasonSchedule.weeks) {
      gamesByWeek[week.weekNumber] = 0;

      for (const game of week.games) {
        const isHome = game.home_team.abbreviation === teamUpper;
        const isAway = game.visitor_team.abbreviation === teamUpper;

        if (isHome || isAway) {
          teamGames.push({
            date: game.date,
            opponent: isHome
              ? game.visitor_team.abbreviation
              : game.home_team.abbreviation,
            isHome,
            weekNumber: week.weekNumber,
          });
          gamesByWeek[week.weekNumber]++;
        }
      }
    }

    return {
      team: teamUpper,
      season: seasonSchedule.season,
      games: teamGames,
      gamesByWeek,
    };
  }

  /**
   * Get schedule for multiple teams (useful for roster analysis)
   */
  async getTeamsSchedule(teamAbbrs: string[], season?: number): Promise<{
    season: number;
    weeks: Array<{
      weekNumber: number;
      startDate: string;
      endDate: string;
      totalGames: number;
      gamesByTeam: Record<string, number>;
    }>;
    playoffWeeks: number[];
    playoffGamesTotal: number;
  }> {
    const seasonSchedule = await this.getSeasonSchedule(season);
    const teamsUpper = teamAbbrs.map(t => t.toUpperCase());

    const weeks = seasonSchedule.weeks.map(week => {
      const gamesByTeam: Record<string, number> = {};
      let totalGames = 0;

      for (const team of teamsUpper) {
        const count = week.gamesPerTeam[team] || 0;
        gamesByTeam[team] = count;
        totalGames += count;
      }

      return {
        weekNumber: week.weekNumber,
        startDate: week.startDate,
        endDate: week.endDate,
        totalGames,
        gamesByTeam,
      };
    });

    // Calculate playoff games total
    let playoffGamesTotal = 0;
    for (const weekNum of seasonSchedule.playoffWeeks) {
      const week = weeks.find(w => w.weekNumber === weekNum);
      if (week) {
        playoffGamesTotal += week.totalGames;
      }
    }

    return {
      season: seasonSchedule.season,
      weeks,
      playoffWeeks: seasonSchedule.playoffWeeks,
      playoffGamesTotal,
    };
  }

  /**
   * Get current NBA season year (e.g., 2024 for 2024-25 season)
   */
  private getCurrentSeason(): number {
    const now = new Date();
    const month = now.getMonth() + 1; // 0-indexed
    const year = now.getFullYear();

    // NBA season starts in October
    // If we're in Jan-Sept, we're in the previous year's season
    return month >= 10 ? year : year - 1;
  }

  /**
   * Group games by fantasy week (Monday-Sunday)
   */
  private groupGamesByFantasyWeek(games: NBAGame[], season: number): WeekSchedule[] {
    if (games.length === 0) return [];

    // Sort games by date
    const sortedGames = [...games].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Find the first Monday of the season (or the Monday before the first game)
    const firstGame = new Date(sortedGames[0].date);
    const firstMonday = this.getPreviousMonday(firstGame);

    const weeks: WeekSchedule[] = [];
    let currentWeekStart = new Date(firstMonday);
    let weekNumber = 1;

    while (currentWeekStart < new Date(sortedGames[sortedGames.length - 1].date)) {
      const weekEnd = new Date(currentWeekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // Sunday

      const weekGames = sortedGames.filter(game => {
        const gameDate = new Date(game.date);
        return gameDate >= currentWeekStart && gameDate <= weekEnd;
      });

      if (weekGames.length > 0) {
        const gamesPerTeam: Record<string, number> = {};

        for (const game of weekGames) {
          const home = game.home_team.abbreviation;
          const away = game.visitor_team.abbreviation;
          gamesPerTeam[home] = (gamesPerTeam[home] || 0) + 1;
          gamesPerTeam[away] = (gamesPerTeam[away] || 0) + 1;
        }

        weeks.push({
          weekNumber,
          startDate: this.formatDate(currentWeekStart),
          endDate: this.formatDate(weekEnd),
          games: weekGames,
          gamesPerTeam,
        });
      }

      weekNumber++;
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    }

    return weeks;
  }

  /**
   * Get the previous Monday for a given date
   */
  private getPreviousMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // 0 = Sunday, 1 = Monday
    d.setDate(d.getDate() - diff);
    return d;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get estimated All-Star break dates
   * Typically around mid-February
   */
  private getEstimatedAllStarBreak(season: number): { start: string; end: string } | undefined {
    // All-Star weekend is typically the third weekend of February
    // This is an estimate - actual dates vary
    return {
      start: `${season + 1}-02-14`,
      end: `${season + 1}-02-18`,
    };
  }
}

export const ballDontLieService = new BallDontLieService();
export type { NBAGame, NBATeam, SeasonSchedule, WeekSchedule };
