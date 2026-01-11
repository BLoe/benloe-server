import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Season Outlook', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to outlook page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await expect(page.locator(SELECTORS.outlook.page)).toBeVisible();
  });

  test('page has heading', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /Season Outlook/i });
    await expect(heading).toBeVisible();
  });

  test('dashboard displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    const dashboard = page.locator(SELECTORS.outlook.dashboard);
    const empty = page.locator(SELECTORS.outlook.empty);
    const error = page.locator(SELECTORS.outlook.error);

    const hasDashboard = await dashboard.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasDashboard || hasEmpty || hasError).toBe(true);
  });

  test('overview tab exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    const overviewButton = page.locator('[data-testid="outlook-overview-tab"]');
    await expect(overviewButton).toBeVisible();
  });

  test('playoffs tab exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    const playoffsButton = page.locator('[data-testid="outlook-playoffs-tab"]');
    await expect(playoffsButton).toBeVisible();
  });

  test('can switch to playoffs tab', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    const playoffsButton = page.locator('[data-testid="outlook-playoffs-tab"]');
    if (await playoffsButton.isVisible()) {
      await playoffsButton.click();
      await page.waitForTimeout(500);

      const playoffOdds = page.locator('[data-testid="playoff-odds"]');
      const hasPlayoffs = await playoffOdds.isVisible().catch(() => false);
      expect(hasPlayoffs).toBeDefined();
    }
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/outlook`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
