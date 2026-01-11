/**
 * Playwright Mock Setup for Fantasy Hawk
 *
 * Intercepts API calls and returns fixture data for deterministic e2e testing.
 */

import { Page, Route } from '@playwright/test';
import {
  yahooFixtures,
  authFixtures,
  leaguesFixture,
  TEST_LEAGUE_KEY,
} from '../fixtures/index';

export interface MockOptions {
  /** Override auth state. Default: authenticated with Yahoo linked */
  auth?: 'authenticated' | 'notAuthenticated' | 'noYahoo';
  /** Use a specific week for scoreboard. Default: current week */
  scoreboardWeek?: number;
}

/**
 * Set up all API mocks for Fantasy Hawk e2e tests.
 *
 * Call this at the start of each test to intercept API calls
 * and return deterministic fixture data.
 *
 * @example
 * ```ts
 * test('shows standings', async ({ page }) => {
 *   await setupMocks(page);
 *   await page.goto('/#/league/466.l.15701/standings');
 *   await expect(page.getByTestId('standings-chart')).toBeVisible();
 * });
 * ```
 */
export async function setupMocks(page: Page, options: MockOptions = {}) {
  const { auth = 'authenticated', scoreboardWeek } = options;

  // Auth status - useAuth expects 401 for not authenticated
  await page.route('**/api/oauth/status', async (route: Route) => {
    if (auth === 'notAuthenticated') {
      // Return 401 to indicate not authenticated with Artanis
      await route.fulfill({ status: 401, json: { error: 'Not authenticated' } });
    } else {
      const authData = auth === 'noYahoo'
        ? authFixtures.authenticatedNoYahoo
        : authFixtures.authenticated;
      await route.fulfill({ json: authData });
    }
  });

  // League list (matches with or without query params)
  await page.route('**/api/fantasy/leagues?**', async (route: Route) => {
    await route.fulfill({ json: leaguesFixture });
  });
  await page.route('**/api/fantasy/leagues', async (route: Route) => {
    await route.fulfill({ json: leaguesFixture });
  });

  // League settings
  await page.route(`**/api/fantasy/leagues/*/settings`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.settings });
  });

  // League standings
  await page.route(`**/api/fantasy/leagues/*/standings`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.standings });
  });

  // Scoreboard (current week)
  await page.route(`**/api/fantasy/leagues/*/scoreboard`, async (route: Route) => {
    const url = new URL(route.request().url());
    const week = url.searchParams.get('week');
    const data = week === '1' ? yahooFixtures.scoreboardWeek1 : yahooFixtures.scoreboard;
    await route.fulfill({ json: data });
  });

  // Matchup endpoints
  await page.route(`**/api/fantasy/leagues/*/matchup`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.scoreboard });
  });
  await page.route(`**/api/fantasy/leagues/*/matchup/current`, async (route: Route) => {
    // Return current week matchup data matching MatchupData interface
    await route.fulfill({
      json: {
        week: 11,
        weekStart: '2024-12-30',
        weekEnd: '2025-01-05',
        yourTeam: {
          teamKey: '466.l.15701.t.1',
          name: 'Test Team',
          logoUrl: '',
          managerName: 'Test Manager',
        },
        opponentTeam: {
          teamKey: '466.l.15701.t.2',
          name: 'Opponent Team',
          logoUrl: '',
          managerName: 'Opponent Manager',
        },
        score: { wins: 5, losses: 3, ties: 1 },
        categories: [
          { statId: 1, name: 'FG%', displayName: 'FG%', yourValue: '48.5', opponentValue: '46.2', winner: 'you', margin: '2.3', isPercentage: true },
          { statId: 2, name: 'FT%', displayName: 'FT%', yourValue: '78.0', opponentValue: '82.1', winner: 'opponent', margin: '-4.1', isPercentage: true },
        ],
        lastUpdated: new Date().toISOString(),
      },
    });
  });
  await page.route(`**/api/fantasy/leagues/*/matchup/projections`, async (route: Route) => {
    await route.fulfill({
      json: {
        projections: [],
        remainingGames: [],
      },
    });
  });

  // Teams
  await page.route(`**/api/fantasy/leagues/*/teams`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.teams });
  });

  // Teams with rosters
  await page.route(`**/api/fantasy/leagues/*/teams/roster*`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.teamsRoster });
  });

  // Teams with stats
  await page.route(`**/api/fantasy/leagues/*/teams/stats*`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.teamsStats });
  });

  // Category stats
  await page.route(`**/api/fantasy/leagues/*/category-stats*`, async (route: Route) => {
    // Return a simplified category stats response based on standings
    await route.fulfill({
      json: {
        currentWeek: 11,
        weeksIncluded: [11],
        teams: [],
        categoryAverages: {},
      },
    });
  });

  // Players (rostered)
  await page.route(`**/api/fantasy/leagues/*/players*status=T*`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.playersRostered });
  });

  // Players (free agents)
  await page.route(`**/api/fantasy/leagues/*/players*status=FA*`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.playersFreeAgents });
  });

  // Players (waivers)
  await page.route(`**/api/fantasy/leagues/*/players*status=W*`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.playersWaivers });
  });

  // Transactions
  await page.route(`**/api/fantasy/leagues/*/transactions`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.transactions });
  });

  // Draft results
  await page.route(`**/api/fantasy/leagues/*/draftresults`, async (route: Route) => {
    await route.fulfill({ json: yahooFixtures.draftResults });
  });

  // Schedule API (Ball Don't Lie) - return mock schedule
  await page.route(`**/api/fantasy/leagues/*/schedule`, async (route: Route) => {
    await route.fulfill({
      json: {
        week: { start: '2024-12-30', end: '2025-01-05', weekNumber: 11 },
        games: [],
        teamGameCounts: {},
      },
    });
  });

  // Schedule status
  await page.route(`**/api/fantasy/schedule/status`, async (route: Route) => {
    await route.fulfill({ json: { configured: true, apiKey: 'present' } });
  });

  // Streaming analysis
  await page.route(`**/api/fantasy/leagues/*/streaming`, async (route: Route) => {
    await route.fulfill({
      json: {
        roster: [],
        freeAgents: [],
        recommendations: [],
      },
    });
  });

  // Waiver recommendations
  await page.route(`**/api/fantasy/leagues/*/waiver/*`, async (route: Route) => {
    await route.fulfill({
      json: {
        recommendations: [],
        dropCandidates: [],
      },
    });
  });

  // Trade analysis
  await page.route(`**/api/fantasy/leagues/*/trade/analyze`, async (route: Route) => {
    await route.fulfill({
      json: {
        fairnessScore: 0.5,
        analysis: 'Mock trade analysis',
        categoryImpact: {},
      },
    });
  });

  // Punt analysis
  await page.route(`**/api/fantasy/leagues/*/punt/*`, async (route: Route) => {
    await route.fulfill({
      json: {
        currentBuild: {},
        archetypes: [],
        recommendations: [],
      },
    });
  });

  // League insights
  await page.route(`**/api/fantasy/leagues/*/insights`, async (route: Route) => {
    await route.fulfill({
      json: {
        settings: {},
        analysis: {},
      },
    });
  });

  // Season outlook
  await page.route(`**/api/fantasy/leagues/*/outlook`, async (route: Route) => {
    await route.fulfill({
      json: {
        currentStanding: 1,
        projectedFinish: 1,
        playoffOdds: 0.9,
      },
    });
  });

  // Player comparison
  await page.route(`**/api/fantasy/leagues/*/compare`, async (route: Route) => {
    await route.fulfill({
      json: {
        players: [],
        comparison: {},
      },
    });
  });

  // AI Chat - return non-streaming mock
  await page.route(`**/api/fantasy/chat`, async (route: Route) => {
    await route.fulfill({
      json: {
        message: 'Mock AI response for testing.',
      },
    });
  });

  // Claude status (for AI features)
  await page.route(`**/api/claude/status`, async (route: Route) => {
    await route.fulfill({
      json: { hasKey: true, provider: 'anthropic' },
    });
  });
}

/**
 * Navigate to a league page with mocks already set up.
 */
export async function gotoWithMocks(
  page: Page,
  path: string,
  options: MockOptions = {}
) {
  await setupMocks(page, options);
  await page.goto(`/#/league/${TEST_LEAGUE_KEY}${path}`);
  await page.waitForLoadState('networkidle');
}
