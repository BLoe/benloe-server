import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Matchup Center', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to matchup page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
    await expect(page.locator(SELECTORS.matchup.page)).toBeVisible();
  });

  test('displays scoreboard with matchup data', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
    await page.waitForLoadState('networkidle');

    // Should show scoreboard
    const scoreboard = page.locator(SELECTORS.matchup.scoreboard);
    await expect(scoreboard).toBeVisible();

    // Scoreboard should have score format like "5-3-1"
    const scoreText = await scoreboard.textContent();
    expect(scoreText).toMatch(/\d+-\d+/);
  });

  test('refresh button is present and clickable', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
    await page.waitForLoadState('networkidle');

    const refreshButton = page.locator(SELECTORS.matchup.refresh);
    await expect(refreshButton).toBeVisible();

    // Click refresh - should not crash
    await refreshButton.click();
    await expect(page.locator(SELECTORS.matchup.scoreboard)).toBeVisible();
  });

  test('category breakdown toggle works', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
    await page.waitForLoadState('networkidle');

    const toggleButton = page.locator(SELECTORS.matchup.toggleCategoryBreakdown);

    if (await toggleButton.isVisible()) {
      await toggleButton.click();

      // Category breakdown should now be visible
      const breakdown = page.locator(SELECTORS.matchup.categoryBreakdown);
      await expect(breakdown).toBeVisible();
    }
  });

  test('projections panel loads', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);
    await page.waitForLoadState('networkidle');

    // Should show projections panel or empty/error state
    const projections = page.locator(SELECTORS.matchup.projectionsPanel);
    const empty = page.locator(SELECTORS.matchup.projectionsEmpty);
    const error = page.locator(SELECTORS.matchup.projectionsError);

    const hasProjections = await projections.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    // One of these states should be present
    expect(hasProjections || hasEmpty || hasError).toBe(true);
  });

  test('tab navigation highlights matchup tab', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/matchup`);

    const matchupTab = page.locator(SELECTORS.matchup.tab);
    await expect(matchupTab).toBeVisible();

    // Tab should have active styling
    await expect(matchupTab).toHaveClass(/tab-active/);
  });
});
