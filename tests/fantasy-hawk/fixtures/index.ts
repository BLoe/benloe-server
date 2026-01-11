/**
 * Fantasy Hawk Test Fixtures
 *
 * Real Yahoo Fantasy API responses captured for deterministic e2e testing.
 * League: 466.l.15701 (NWF Keeper Lge Jamboree)
 * Captured: December 31, 2024
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Re-export selectors and constants from the main fixtures file
export { SELECTORS, URLS, TEST_TIMEOUTS } from '../fixtures';

const RAW_DIR = join(__dirname, 'raw');

function loadFixture(filename: string): any {
  const content = readFileSync(join(RAW_DIR, filename), 'utf-8');
  return JSON.parse(content);
}

// Lazy-load fixtures to avoid loading everything on import
let _cache: Record<string, any> = {};

function getFixture(name: string, filename: string): any {
  if (!_cache[name]) {
    _cache[name] = loadFixture(filename);
  }
  return _cache[name];
}

// Test league key used in fixtures
export const TEST_LEAGUE_KEY = '466.l.15701';
export const TEST_LEAGUE_NAME = 'NWF Keeper Lge Jamboree';

// Yahoo Fantasy API Fixtures
export const yahooFixtures = {
  get league() { return getFixture('league', 'league.json'); },
  get settings() { return getFixture('settings', 'settings.json'); },
  get standings() { return getFixture('standings', 'standings.json'); },
  get scoreboard() { return getFixture('scoreboard', 'scoreboard.json'); },
  get scoreboardWeek1() { return getFixture('scoreboardWeek1', 'scoreboard-week1.json'); },
  get teams() { return getFixture('teams', 'teams.json'); },
  get teamsRoster() { return getFixture('teamsRoster', 'teams-roster.json'); },
  get teamsStats() { return getFixture('teamsStats', 'teams-stats.json'); },
  get playersRostered() { return getFixture('playersRostered', 'players-rostered.json'); },
  get playersFreeAgents() { return getFixture('playersFreeAgents', 'players-fa.json'); },
  get playersWaivers() { return getFixture('playersWaivers', 'players-waivers.json'); },
  get transactions() { return getFixture('transactions', 'transactions.json'); },
  get draftResults() { return getFixture('draftResults', 'draftresults.json'); },
  get gameNba() { return getFixture('gameNba', 'game-nba.json'); },
  get gameStatCategories() { return getFixture('gameStatCategories', 'game-stat-categories.json'); },
};

// Auth fixtures (useAuth expects 'connected' field, not 'yahooLinked')
export const authFixtures = {
  authenticated: {
    authenticated: true,
    connected: true,
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    },
  },
  notAuthenticated: {
    authenticated: false,
    connected: false,
  },
  authenticatedNoYahoo: {
    authenticated: true,
    connected: false,
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
    },
  },
};

// League list fixture (what /api/fantasy/leagues returns - Yahoo nested structure)
export const leaguesFixture = {
  fantasy_content: {
    users: {
      '0': {
        user: [
          { guid: 'test-user-guid' },
          {
            games: {
              '0': {
                game: [
                  { game_key: 'nba', game_id: '466', name: 'Basketball' },
                  {
                    leagues: {
                      count: 1,
                      '0': {
                        league: [
                          {
                            league_key: TEST_LEAGUE_KEY,
                            league_id: '15701',
                            name: TEST_LEAGUE_NAME,
                            num_teams: 12,
                            current_week: 11,
                            season: '2025',
                            scoring_type: 'head',
                            league_type: 'private',
                          },
                        ],
                      },
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

// Clear fixture cache (useful between tests)
export function clearFixtureCache() {
  _cache = {};
}
