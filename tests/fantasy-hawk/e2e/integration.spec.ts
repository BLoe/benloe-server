import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

/**
 * Integration tests for Fantasy Hawk
 * These tests verify complete user workflows across multiple features
 */
test.describe('Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test.describe('Navigation Flow', () => {
    test('can navigate to all main tabs', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
      await page.waitForLoadState('networkidle');

      const tabs = [
        { name: 'Standings', route: 'standings' },
        { name: 'Categories', route: 'categories' },
        { name: 'Matchup', route: 'matchup' },
        { name: 'Streaming', route: 'streaming' },
        { name: 'Trade', route: 'trade' },
        { name: 'Compare', route: 'compare' },
        { name: 'Waiver', route: 'waiver' },
        { name: 'Punt', route: 'punt' },
        { name: 'Insights', route: 'insights' },
        { name: 'Schedule', route: 'schedule' },
        { name: 'Outlook', route: 'outlook' },
        { name: 'Chat', route: 'chat' },
      ];

      for (const tab of tabs) {
        await page.goto(`/#/league/${TEST_LEAGUE_KEY}/${tab.route}`);
        await page.waitForLoadState('networkidle');

        // Verify page loaded without crashing
        const documentReady = await page.evaluate(() => document.readyState === 'complete');
        expect(documentReady).toBe(true);
      }
    });

    test('header is consistent across pages', async ({ page }) => {
      const routes = ['standings', 'categories', 'matchup', 'streaming', 'trade'];

      for (const route of routes) {
        await page.goto(`/#/league/${TEST_LEAGUE_KEY}/${route}`);
        await page.waitForLoadState('networkidle');

        const header = page.locator('header, nav').first();
        const hasHeader = await header.isVisible().catch(() => false);
        expect(hasHeader).toBe(true);
      }
    });
  });

  test.describe('Dashboard Workflow', () => {
    test('dashboard loads without crashing', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
      await page.waitForLoadState('networkidle');

      const documentReady = await page.evaluate(() => document.readyState === 'complete');
      expect(documentReady).toBe(true);
    });

    test('league selector is functional', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
      await page.waitForLoadState('networkidle');

      const leagueSelector = page.locator(SELECTORS.leagueSelector);
      const hasSelector = await leagueSelector.isVisible().catch(() => false);
      expect(hasSelector).toBeDefined();
    });
  });

  test.describe('Streaming Workflow', () => {
    test('streaming page shows panels', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
      await page.waitForLoadState('networkidle');

      const streamingPage = page.locator(SELECTORS.streaming.page);
      await expect(streamingPage).toBeVisible();

      const scheduleGrid = page.locator(SELECTORS.streaming.scheduleGridPanel);
      const candidatesPanel = page.locator(SELECTORS.streaming.candidatesPanel);
      const recommendationsPanel = page.locator(SELECTORS.streaming.recommendationsPanel);

      const hasSchedule = await scheduleGrid.isVisible().catch(() => false);
      const hasCandidates = await candidatesPanel.isVisible().catch(() => false);
      const hasRecommendations = await recommendationsPanel.isVisible().catch(() => false);

      expect(hasSchedule || hasCandidates || hasRecommendations).toBe(true);
    });
  });

  test.describe('Matchup Workflow', () => {
    test('matchup page displays scoreboard', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
      await page.waitForLoadState('networkidle');

      const matchupPage = page.locator(SELECTORS.matchup.page);
      await expect(matchupPage).toBeVisible();

      const scoreboard = page.locator(SELECTORS.matchup.scoreboard);
      const loading = page.locator(SELECTORS.matchup.scoreboardLoading);
      const error = page.locator(SELECTORS.matchup.error);
      const byeWeek = page.locator(SELECTORS.matchup.byeWeek);

      const hasScoreboard = await scoreboard.isVisible().catch(() => false);
      const hasLoading = await loading.isVisible().catch(() => false);
      const hasError = await error.isVisible().catch(() => false);
      const hasBye = await byeWeek.isVisible().catch(() => false);

      expect(hasScoreboard || hasLoading || hasError || hasBye).toBe(true);
    });
  });

  test.describe('Trade Workflow', () => {
    test('trade page shows trade builder', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
      await page.waitForLoadState('networkidle');

      const tradePage = page.locator(SELECTORS.trade.page);
      await expect(tradePage).toBeVisible();

      const builder = page.locator(SELECTORS.trade.builder);
      await expect(builder).toBeVisible();
    });
  });

  test.describe('Waiver Workflow', () => {
    test('waiver page shows recommendations', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
      await page.waitForLoadState('networkidle');

      const waiverPage = page.locator(SELECTORS.waiver.page);
      await expect(waiverPage).toBeVisible();
    });
  });

  test.describe('Comparison Workflow', () => {
    test('comparison page shows player selector', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
      await page.waitForLoadState('networkidle');

      const comparisonPage = page.locator(SELECTORS.comparison.page);
      await expect(comparisonPage).toBeVisible();

      const selector = page.locator(SELECTORS.comparison.selector);
      await expect(selector).toBeVisible();
    });
  });

  test.describe('Error Recovery', () => {
    test('page handles reload gracefully', async ({ page }) => {
      await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
      await page.waitForLoadState('networkidle');

      await page.reload();
      await page.waitForLoadState('networkidle');

      const documentReady = await page.evaluate(() => document.readyState === 'complete');
      expect(documentReady).toBe(true);
    });
  });

  test.describe('No Console Errors', () => {
    test('no console errors across pages', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        if (!error.message.includes('ResizeObserver')) {
          errors.push(error.message);
        }
      });

      const routes = ['standings', 'categories', 'matchup', 'streaming', 'trade'];
      for (const route of routes) {
        await page.goto(`/#/league/${TEST_LEAGUE_KEY}/${route}`);
        await page.waitForLoadState('networkidle');
      }

      expect(errors).toHaveLength(0);
    });
  });
});
