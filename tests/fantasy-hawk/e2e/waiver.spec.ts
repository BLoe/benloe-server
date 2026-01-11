import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Waiver Advisor', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to waiver page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await expect(page.locator(SELECTORS.waiver.page)).toBeVisible();
  });

  test('page has heading', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /Waiver Advisor/i });
    await expect(heading).toBeVisible();
  });

  test('recommendations panel displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    const recommendations = page.locator(SELECTORS.waiver.recommendations);
    const loading = page.locator(SELECTORS.waiver.recommendationsLoading);
    const empty = page.locator(SELECTORS.waiver.recommendationsEmpty);
    const error = page.locator(SELECTORS.waiver.recommendationsError);

    const hasRecommendations = await recommendations.isVisible().catch(() => false);
    const hasLoading = await loading.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasRecommendations || hasLoading || hasEmpty || hasError).toBe(true);
  });

  test('drops panel displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    const drops = page.locator(SELECTORS.waiver.drops);
    const loading = page.locator(SELECTORS.waiver.dropsLoading);
    const empty = page.locator(SELECTORS.waiver.dropsEmpty);
    const error = page.locator(SELECTORS.waiver.dropsError);

    const hasDrops = await drops.isVisible().catch(() => false);
    const hasLoading = await loading.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasDrops || hasLoading || hasEmpty || hasError).toBe(true);
  });

  test('refresh button exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    const refreshBtn = page.getByRole('button', { name: /Refresh/i });
    await expect(refreshBtn).toBeVisible();
  });

  test('waiver tips section exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    const tipsHeader = page.getByText('Waiver Tips');
    await expect(tipsHeader).toBeVisible();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/waiver`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
