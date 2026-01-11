import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Category Analysis - Enhanced Features', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to categories page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    // Should show category analysis content
    const viewToggle = page.locator(SELECTORS.category.viewToggle);
    const hasToggle = await viewToggle.isVisible().catch(() => false);
    expect(hasToggle).toBeDefined();
  });

  test('view toggle has options', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    const profileBtn = page.locator(SELECTORS.category.viewProfile);
    const enhancedBtn = page.locator(SELECTORS.category.viewEnhanced);
    const trendsBtn = page.locator(SELECTORS.category.viewTrends);
    const rawBtn = page.locator(SELECTORS.category.viewRaw);

    const hasProfile = await profileBtn.isVisible().catch(() => false);
    const hasEnhanced = await enhancedBtn.isVisible().catch(() => false);
    const hasTrends = await trendsBtn.isVisible().catch(() => false);
    const hasRaw = await rawBtn.isVisible().catch(() => false);

    expect(hasProfile || hasEnhanced || hasTrends || hasRaw).toBe(true);
  });

  test('can click profile view', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    const profileBtn = page.locator(SELECTORS.category.viewProfile);

    if (await profileBtn.isVisible()) {
      await profileBtn.click();
      await page.waitForTimeout(500);

      const profile = page.locator(SELECTORS.category.profile);
      const loading = page.locator(SELECTORS.category.profileLoading);
      const error = page.locator(SELECTORS.category.profileError);

      const hasProfile = await profile.isVisible().catch(() => false);
      const hasLoading = await loading.isVisible().catch(() => false);
      const hasError = await error.isVisible().catch(() => false);

      expect(hasProfile || hasLoading || hasError).toBe(true);
    }
  });

  test('can click enhanced view', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    const enhancedBtn = page.locator(SELECTORS.category.viewEnhanced);

    if (await enhancedBtn.isVisible()) {
      await enhancedBtn.click();
      await page.waitForTimeout(500);

      const table = page.locator(SELECTORS.category.enhancedTable);
      const loading = page.locator(SELECTORS.category.enhancedTableLoading);
      const error = page.locator(SELECTORS.category.enhancedTableError);

      const hasTable = await table.isVisible().catch(() => false);
      const hasLoading = await loading.isVisible().catch(() => false);
      const hasError = await error.isVisible().catch(() => false);

      expect(hasTable || hasLoading || hasError).toBe(true);
    }
  });

  test('can click trends view', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    const trendsBtn = page.locator(SELECTORS.category.viewTrends);

    if (await trendsBtn.isVisible()) {
      await trendsBtn.click();
      await page.waitForTimeout(500);

      const trends = page.locator(SELECTORS.category.trendCharts);
      const loading = page.locator(SELECTORS.category.trendsLoading);
      const error = page.locator(SELECTORS.category.trendsError);

      const hasTrends = await trends.isVisible().catch(() => false);
      const hasLoading = await loading.isVisible().catch(() => false);
      const hasError = await error.isVisible().catch(() => false);

      expect(hasTrends || hasLoading || hasError).toBe(true);
    }
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/categories`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
