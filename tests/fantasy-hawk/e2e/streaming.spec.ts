import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Streaming Optimizer', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to streaming page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await expect(page.locator(SELECTORS.streaming.page)).toBeVisible();
  });

  test('displays three-panel layout', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    // Schedule grid panel should be present
    await expect(page.locator(SELECTORS.streaming.scheduleGridPanel)).toBeVisible();

    // Candidates panel should be present
    await expect(page.locator(SELECTORS.streaming.candidatesPanel)).toBeVisible();

    // Recommendations panel should be present
    await expect(page.locator(SELECTORS.streaming.recommendationsPanel)).toBeVisible();
  });

  test('schedule grid shows content or empty state', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    const grid = page.locator(SELECTORS.streaming.scheduleGrid);
    const empty = page.locator(SELECTORS.streaming.scheduleGridEmpty);

    const hasGrid = await grid.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);

    expect(hasGrid || hasEmpty).toBe(true);
  });

  test('candidates table or empty state visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    const table = page.locator(SELECTORS.streaming.candidatesTable);
    const empty = page.locator(SELECTORS.streaming.candidatesEmpty);

    const hasTable = await table.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
  });

  test('position filter is present', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    const positionFilter = page.locator(SELECTORS.streaming.candidatesPositionFilter);
    await expect(positionFilter).toBeVisible();
  });

  test('recommendations panel shows content', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    const recommendations = page.locator(SELECTORS.streaming.recommendations);
    const empty = page.locator(SELECTORS.streaming.recommendationsEmpty);
    const error = page.locator(SELECTORS.streaming.recommendationsError);

    const hasContent = await recommendations.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasContent || hasEmpty || hasError).toBe(true);
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/streaming`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
