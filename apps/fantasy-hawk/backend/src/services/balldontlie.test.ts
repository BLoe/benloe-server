import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ballDontLieService, clearCache, getCacheSize } from './balldontlie';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock environment
vi.stubEnv('BALLDONTLIE_API_KEY', 'test-api-key');

describe('BallDontLie Service', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearCache();
  });

  describe('isConfigured', () => {
    it('returns true when API key is set', () => {
      expect(ballDontLieService.isConfigured()).toBe(true);
    });
  });

  describe('getTeams', () => {
    const mockTeamsResponse = {
      data: [
        {
          id: 1,
          conference: 'East',
          division: 'Atlantic',
          city: 'Boston',
          name: 'Celtics',
          full_name: 'Boston Celtics',
          abbreviation: 'BOS',
        },
        {
          id: 2,
          conference: 'West',
          division: 'Pacific',
          city: 'Los Angeles',
          name: 'Lakers',
          full_name: 'Los Angeles Lakers',
          abbreviation: 'LAL',
        },
      ],
    };

    it('fetches and returns teams', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTeamsResponse,
      });

      const teams = await ballDontLieService.getTeams();

      expect(teams).toHaveLength(2);
      expect(teams[0].abbreviation).toBe('BOS');
      expect(teams[1].abbreviation).toBe('LAL');
    });

    it('caches teams response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTeamsResponse,
      });

      // First call - fetches
      await ballDontLieService.getTeams();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      await ballDontLieService.getTeams();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getCacheSize()).toBe(1);
    });
  });

  describe('getGames', () => {
    const mockGamesResponse = {
      data: [
        {
          id: 100,
          date: '2025-01-10',
          datetime: '2025-01-10T19:00:00Z',
          season: 2024,
          status: 'Final',
          postseason: false,
          home_team: {
            id: 1,
            abbreviation: 'BOS',
            city: 'Boston',
            name: 'Celtics',
            full_name: 'Boston Celtics',
            conference: 'East',
            division: 'Atlantic',
          },
          visitor_team: {
            id: 2,
            abbreviation: 'LAL',
            city: 'Los Angeles',
            name: 'Lakers',
            full_name: 'Los Angeles Lakers',
            conference: 'West',
            division: 'Pacific',
          },
          home_team_score: 110,
          visitor_team_score: 105,
        },
      ],
      meta: { per_page: 100 },
    };

    it('fetches games for date range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGamesResponse,
      });

      const games = await ballDontLieService.getGames('2025-01-10', '2025-01-16');

      expect(games).toHaveLength(1);
      expect(games[0].home_team.abbreviation).toBe('BOS');
      expect(games[0].visitor_team.abbreviation).toBe('LAL');
    });

    it('caches games by date range', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGamesResponse,
      });

      // First call - fetches
      await ballDontLieService.getGames('2025-01-10', '2025-01-16');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Same date range - uses cache
      await ballDontLieService.getGames('2025-01-10', '2025-01-16');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Different date range - fetches again
      await ballDontLieService.getGames('2025-01-17', '2025-01-23');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles pagination', async () => {
      const page1 = {
        data: [{ id: 1, date: '2025-01-10', home_team: { abbreviation: 'BOS' }, visitor_team: { abbreviation: 'LAL' } }],
        meta: { per_page: 100, next_cursor: 2 },
      };
      const page2 = {
        data: [{ id: 2, date: '2025-01-11', home_team: { abbreviation: 'MIA' }, visitor_team: { abbreviation: 'NYK' } }],
        meta: { per_page: 100 },
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => page1 })
        .mockResolvedValueOnce({ ok: true, json: async () => page2 });

      // Clear cache to ensure fresh fetch
      clearCache();

      const games = await ballDontLieService.getGames('2025-01-10', '2025-01-16');

      expect(games).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getScheduleAnalysis', () => {
    it('groups games by date and calculates games per team', async () => {
      const mockGames = {
        data: [
          {
            id: 1,
            date: '2025-01-10',
            home_team: { abbreviation: 'BOS', id: 1, city: 'Boston', name: 'Celtics', full_name: 'Boston Celtics', conference: 'East', division: 'Atlantic' },
            visitor_team: { abbreviation: 'LAL', id: 2, city: 'Los Angeles', name: 'Lakers', full_name: 'Los Angeles Lakers', conference: 'West', division: 'Pacific' },
          },
          {
            id: 2,
            date: '2025-01-10',
            home_team: { abbreviation: 'MIA', id: 3, city: 'Miami', name: 'Heat', full_name: 'Miami Heat', conference: 'East', division: 'Southeast' },
            visitor_team: { abbreviation: 'BOS', id: 1, city: 'Boston', name: 'Celtics', full_name: 'Boston Celtics', conference: 'East', division: 'Atlantic' },
          },
          {
            id: 3,
            date: '2025-01-11',
            home_team: { abbreviation: 'LAL', id: 2, city: 'Los Angeles', name: 'Lakers', full_name: 'Los Angeles Lakers', conference: 'West', division: 'Pacific' },
            visitor_team: { abbreviation: 'MIA', id: 3, city: 'Miami', name: 'Heat', full_name: 'Miami Heat', conference: 'East', division: 'Southeast' },
          },
        ],
        meta: { per_page: 100 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGames,
      });

      const analysis = await ballDontLieService.getScheduleAnalysis('2025-01-10', '2025-01-11');

      // Check games by date
      expect(Object.keys(analysis.gamesByDate)).toEqual(['2025-01-10', '2025-01-11']);
      expect(analysis.gamesByDate['2025-01-10']).toHaveLength(2);
      expect(analysis.gamesByDate['2025-01-11']).toHaveLength(1);

      // Check games per team
      expect(analysis.gamesPerTeam['BOS'].total).toBe(2); // 2 games for BOS
      expect(analysis.gamesPerTeam['LAL'].total).toBe(2); // 2 games for LAL
      expect(analysis.gamesPerTeam['MIA'].total).toBe(2); // 2 games for MIA

      // Check date range
      expect(analysis.dateRange).toEqual({ start: '2025-01-10', end: '2025-01-11' });
    });
  });

  describe('error handling', () => {
    it('throws error when API key is not configured', async () => {
      vi.stubEnv('BALLDONTLIE_API_KEY', '');

      await expect(ballDontLieService.getTeams()).rejects.toThrow(
        "Ball Don't Lie API key not configured"
      );

      // Restore for other tests
      vi.stubEnv('BALLDONTLIE_API_KEY', 'test-api-key');
    });

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(ballDontLieService.getTeams()).rejects.toThrow(
        "Ball Don't Lie API error: 500"
      );
    });
  });

  describe('cache expiry', () => {
    it('clears expired cache entries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await ballDontLieService.getTeams();
      expect(getCacheSize()).toBe(1);

      clearCache();
      expect(getCacheSize()).toBe(0);
    });
  });
});
