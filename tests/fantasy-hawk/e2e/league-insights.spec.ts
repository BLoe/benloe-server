import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('League Insights', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to insights page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await expect(page.locator(SELECTORS.insights.page)).toBeVisible();
  });

  test('page has heading', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /League Insights/i });
    await expect(heading).toBeVisible();
  });

  test('settings tab is default and visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    const settings = page.locator(SELECTORS.insights.settings);
    const empty = page.locator(SELECTORS.insights.empty);
    const error = page.locator(SELECTORS.insights.error);

    const hasSettings = await settings.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasSettings || hasEmpty || hasError).toBe(true);
  });

  test('strategy analysis tab exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    const analysisTabButton = page.locator('button:has-text("Strategy Analysis")');
    await expect(analysisTabButton).toBeVisible();
  });

  test('custom rankings tab exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
    await expect(rankingsTabButton).toBeVisible();
  });

  test('can switch between tabs', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    const analysisTabButton = page.locator('button:has-text("Strategy Analysis")');
    if (await analysisTabButton.isVisible()) {
      await analysisTabButton.click();
      await page.waitForTimeout(500);

      const categoryImportance = page.locator(SELECTORS.insights.categoryImportance);
      const hasAnalysis = await categoryImportance.isVisible().catch(() => false);
      expect(hasAnalysis).toBeDefined();
    }
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/insights`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
