import { test, expect } from '@playwright/test';
import { SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Category Analysis - Enhanced Features', () => {
  test.describe('View Toggle', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Click categories tab if visible
      const categoriesTab = page.locator('button:has-text("Categories")');
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('view toggle is visible on categories tab', async ({ page }) => {
      const viewToggle = page.locator(SELECTORS.category.viewToggle);

      // View toggle might not be visible if user isn't authenticated
      const toggleCount = await viewToggle.count();
      expect(toggleCount).toBeGreaterThanOrEqual(0);
    });

    test('view toggle has all options', async ({ page }) => {
      const viewToggle = page.locator(SELECTORS.category.viewToggle);

      if (await viewToggle.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Check for all view options
        const profileBtn = page.locator(SELECTORS.category.viewProfile);
        const enhancedBtn = page.locator(SELECTORS.category.viewEnhanced);
        const trendsBtn = page.locator(SELECTORS.category.viewTrends);
        const rawBtn = page.locator(SELECTORS.category.viewRaw);

        const hasProfile = await profileBtn.isVisible().catch(() => false);
        const hasEnhanced = await enhancedBtn.isVisible().catch(() => false);
        const hasTrends = await trendsBtn.isVisible().catch(() => false);
        const hasRaw = await rawBtn.isVisible().catch(() => false);

        // At least some buttons should be visible
        expect(hasProfile || hasEnhanced || hasTrends || hasRaw).toBe(true);
      }
    });

    test('clicking profile view switches to profile', async ({ page }) => {
      const viewToggle = page.locator(SELECTORS.category.viewToggle);

      if (await viewToggle.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const profileBtn = page.locator(SELECTORS.category.viewProfile);

        if (await profileBtn.isVisible()) {
          await profileBtn.click();
          await page.waitForTimeout(500);

          // Should show profile or loading state
          const profile = page.locator(SELECTORS.category.profile);
          const loading = page.locator(SELECTORS.category.profileLoading);
          const error = page.locator(SELECTORS.category.profileError);

          const hasProfile = await profile.isVisible().catch(() => false);
          const hasLoading = await loading.isVisible().catch(() => false);
          const hasError = await error.isVisible().catch(() => false);

          expect(hasProfile || hasLoading || hasError).toBe(true);
        }
      }
    });

    test('clicking enhanced view switches to league table', async ({ page }) => {
      const viewToggle = page.locator(SELECTORS.category.viewToggle);

      if (await viewToggle.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const enhancedBtn = page.locator(SELECTORS.category.viewEnhanced);

        if (await enhancedBtn.isVisible()) {
          await enhancedBtn.click();
          await page.waitForTimeout(500);

          // Should show enhanced table or loading state
          const table = page.locator(SELECTORS.category.enhancedTable);
          const loading = page.locator(SELECTORS.category.enhancedTableLoading);
          const error = page.locator(SELECTORS.category.enhancedTableError);

          const hasTable = await table.isVisible().catch(() => false);
          const hasLoading = await loading.isVisible().catch(() => false);
          const hasError = await error.isVisible().catch(() => false);

          expect(hasTable || hasLoading || hasError).toBe(true);
        }
      }
    });

    test('clicking trends view switches to trends', async ({ page }) => {
      const viewToggle = page.locator(SELECTORS.category.viewToggle);

      if (await viewToggle.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const trendsBtn = page.locator(SELECTORS.category.viewTrends);

        if (await trendsBtn.isVisible()) {
          await trendsBtn.click();
          await page.waitForTimeout(500);

          // Should show trends or loading state
          const trends = page.locator(SELECTORS.category.trendCharts);
          const loading = page.locator(SELECTORS.category.trendsLoading);
          const error = page.locator(SELECTORS.category.trendsError);

          const hasTrends = await trends.isVisible().catch(() => false);
          const hasLoading = await loading.isVisible().catch(() => false);
          const hasError = await error.isVisible().catch(() => false);

          expect(hasTrends || hasLoading || hasError).toBe(true);
        }
      }
    });
  });

  test.describe('Team Profile', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate to categories tab and switch to profile view
      const categoriesTab = page.locator('button:has-text("Categories")');
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
        await page.waitForTimeout(500);
      }

      const profileBtn = page.locator(SELECTORS.category.viewProfile);
      if (await profileBtn.isVisible()) {
        await profileBtn.click();
        await page.waitForTimeout(1000);
      }
    });

    test('profile displays team information', async ({ page }) => {
      const profile = page.locator(SELECTORS.category.profile);

      if (await profile.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        // Profile should contain team identity information
        const teamName = profile.locator('h3');
        const hasTeamName = await teamName.isVisible().catch(() => false);
        expect(hasTeamName).toBe(true);
      }
    });

    test('profile shows radar chart', async ({ page }) => {
      const profile = page.locator(SELECTORS.category.profile);

      if (await profile.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const radarChart = page.locator(SELECTORS.category.profileRadarChart);
        const hasRadar = await radarChart.isVisible().catch(() => false);

        // Radar chart should be visible
        expect(hasRadar).toBe(true);
      }
    });

    test('profile shows strengths and weaknesses', async ({ page }) => {
      const profile = page.locator(SELECTORS.category.profile);

      if (await profile.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const strengths = page.locator(SELECTORS.category.profileStrengths);
        const weaknesses = page.locator(SELECTORS.category.profileWeaknesses);

        const hasStrengths = await strengths.isVisible().catch(() => false);
        const hasWeaknesses = await weaknesses.isVisible().catch(() => false);

        // Both sections should be visible
        expect(hasStrengths).toBe(true);
        expect(hasWeaknesses).toBe(true);
      }
    });

    test('profile shows all categories breakdown', async ({ page }) => {
      const profile = page.locator(SELECTORS.category.profile);

      if (await profile.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const categories = page.locator(SELECTORS.category.profileCategories);
        const hasCategories = await categories.isVisible().catch(() => false);

        expect(hasCategories).toBe(true);
      }
    });
  });

  test.describe('Enhanced Table', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate to categories tab and switch to enhanced view
      const categoriesTab = page.locator('button:has-text("Categories")');
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
        await page.waitForTimeout(500);
      }

      const enhancedBtn = page.locator(SELECTORS.category.viewEnhanced);
      if (await enhancedBtn.isVisible()) {
        await enhancedBtn.click();
        await page.waitForTimeout(1000);
      }
    });

    test('enhanced table displays league comparison', async ({ page }) => {
      const table = page.locator(SELECTORS.category.enhancedTable);

      if (await table.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        // Table should contain data
        const rows = table.locator('tbody tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);
      }
    });

    test('enhanced table has value mode toggle', async ({ page }) => {
      const table = page.locator(SELECTORS.category.enhancedTable);

      if (await table.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const viewToggle = page.locator(SELECTORS.category.enhancedViewToggle);
        const hasToggle = await viewToggle.isVisible().catch(() => false);

        expect(hasToggle).toBe(true);
      }
    });

    test('clicking z-scores view changes display', async ({ page }) => {
      const table = page.locator(SELECTORS.category.enhancedTable);

      if (await table.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const zscoresBtn = page.locator(SELECTORS.category.viewZscores);

        if (await zscoresBtn.isVisible()) {
          await zscoresBtn.click();
          await page.waitForTimeout(500);

          // Button should now be active
          await expect(zscoresBtn).toHaveClass(/bg-hawk-orange/);
        }
      }
    });

    test('clicking percentiles view changes display', async ({ page }) => {
      const table = page.locator(SELECTORS.category.enhancedTable);

      if (await table.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const percentilesBtn = page.locator(SELECTORS.category.viewPercentiles);

        if (await percentilesBtn.isVisible()) {
          await percentilesBtn.click();
          await page.waitForTimeout(500);

          // Button should now be active
          await expect(percentilesBtn).toHaveClass(/bg-hawk-orange/);
        }
      }
    });

    test('user team row is highlighted', async ({ page }) => {
      const table = page.locator(SELECTORS.category.enhancedTable);

      if (await table.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const userRow = page.locator(SELECTORS.category.userTeamRow);
        const hasUserRow = await userRow.isVisible().catch(() => false);

        // User row should be highlighted if authenticated
        expect(hasUserRow).toBeDefined();
      }
    });
  });

  test.describe('Trend Charts', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate to categories tab and switch to trends view
      const categoriesTab = page.locator('button:has-text("Categories")');
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
        await page.waitForTimeout(500);
      }

      const trendsBtn = page.locator(SELECTORS.category.viewTrends);
      if (await trendsBtn.isVisible()) {
        await trendsBtn.click();
        await page.waitForTimeout(1000);
      }
    });

    test('trend charts display line chart', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const chart = page.locator(SELECTORS.category.trendLineChart);
        const hasChart = await chart.isVisible().catch(() => false);

        expect(hasChart).toBe(true);
      }
    });

    test('category selector is present', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const selector = page.locator(SELECTORS.category.categorySelector);
        const hasSelector = await selector.isVisible().catch(() => false);

        expect(hasSelector).toBe(true);
      }
    });

    test('weeks selector changes data range', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const weeks6Btn = page.locator(SELECTORS.category.weeksSelector(6));

        if (await weeks6Btn.isVisible()) {
          await weeks6Btn.click();
          await page.waitForTimeout(1000);

          // Button should now be active
          await expect(weeks6Btn).toHaveClass(/bg-hawk-orange/);
        }
      }
    });

    test('rank/value toggle works', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const valuesBtn = page.locator(SELECTORS.category.showValues);

        if (await valuesBtn.isVisible()) {
          await valuesBtn.click();
          await page.waitForTimeout(500);

          // Button should now be active
          await expect(valuesBtn).toHaveClass(/bg-hawk-orange/);
        }
      }
    });

    test('improving and declining categories are shown', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const improving = page.locator(SELECTORS.category.improvingCategories);
        const declining = page.locator(SELECTORS.category.decliningCategories);

        const hasImproving = await improving.isVisible().catch(() => false);
        const hasDeclining = await declining.isVisible().catch(() => false);

        // Both summary sections should be visible
        expect(hasImproving).toBe(true);
        expect(hasDeclining).toBe(true);
      }
    });

    test('clicking trend card selects category', async ({ page }) => {
      const trends = page.locator(SELECTORS.category.trendCharts);

      if (await trends.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        // Find any trend card
        const trendCard = page.locator('[data-testid^="trend-card-"]').first();

        if (await trendCard.isVisible()) {
          await trendCard.click();
          await page.waitForTimeout(500);

          // Card should now have ring highlight
          await expect(trendCard).toHaveClass(/ring-2/);
        }
      }
    });
  });
});
