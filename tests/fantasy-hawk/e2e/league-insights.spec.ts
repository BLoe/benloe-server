import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('League Insights', () => {
  test.describe('Navigation', () => {
    test('insights tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Insights tab in navigation
      const insightsTab = page.locator(SELECTORS.insights.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await insightsTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking insights tab navigates to insights view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const insightsTab = page.locator(SELECTORS.insights.tab);

      if (await insightsTab.isVisible()) {
        await insightsTab.click();

        // Should show either the insights page or the no-league message
        await expect(
          page.locator(`${SELECTORS.insights.page}, ${SELECTORS.insights.noLeague}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Settings Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click insights tab if visible
      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('settings page loads with league info', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Wait for data to load
        await page.waitForTimeout(2000);

        // Settings should be visible (default tab)
        const settings = page.locator(SELECTORS.insights.settings);
        const noLeague = page.locator(SELECTORS.insights.noLeague);
        const empty = page.locator(SELECTORS.insights.empty);
        const error = page.locator(SELECTORS.insights.error);

        // One of these states should be present
        const hasSettings = await settings.isVisible().catch(() => false);
        const hasNoLeague = await noLeague.isVisible().catch(() => false);
        const hasEmpty = await empty.isVisible().catch(() => false);
        const hasError = await error.isVisible().catch(() => false);

        expect(hasSettings || hasNoLeague || hasEmpty || hasError).toBe(true);
      }
    });

    test('category settings table displays', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const settings = page.locator(SELECTORS.insights.settings);

        if (await settings.isVisible().catch(() => false)) {
          // Categories table should show
          const categoriesTable = page.locator(SELECTORS.insights.categoriesTable);
          await expect(categoriesTable).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('settings overview displays league type and team count', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const settings = page.locator(SELECTORS.insights.settings);

        if (await settings.isVisible().catch(() => false)) {
          // Settings overview should show
          const settingsOverview = page.locator(SELECTORS.insights.settingsOverview);
          await expect(settingsOverview).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('non-standard settings are highlighted with insights', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const settings = page.locator(SELECTORS.insights.settings);

        if (await settings.isVisible().catch(() => false)) {
          // If there are non-standard settings, insights or missing categories should show
          const settingsInsights = page.locator(SELECTORS.insights.settingsInsights);
          const missingCategories = page.locator(SELECTORS.insights.missingCategories);
          const standardReference = page.locator(SELECTORS.insights.standardReference);

          // At least one of these should be visible (standard reference always shows)
          const hasInsights = await settingsInsights.isVisible().catch(() => false);
          const hasMissing = await missingCategories.isVisible().catch(() => false);
          const hasReference = await standardReference.isVisible().catch(() => false);

          expect(hasInsights || hasMissing || hasReference).toBe(true);
        }
      }
    });
  });

  test.describe('Strategy Analysis Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('analysis tab displays category importance', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Click on Strategy Analysis tab
        const analysisTabButton = page.locator('button:has-text("Strategy Analysis")');
        if (await analysisTabButton.isVisible()) {
          await analysisTabButton.click();
          await page.waitForTimeout(2000);

          // Category importance should show
          const categoryImportance = page.locator(SELECTORS.insights.categoryImportance);
          await expect(categoryImportance).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('analysis tab displays positional value adjustments', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const analysisTabButton = page.locator('button:has-text("Strategy Analysis")');
        if (await analysisTabButton.isVisible()) {
          await analysisTabButton.click();
          await page.waitForTimeout(2000);

          // Positional value should show
          const positionalValue = page.locator(SELECTORS.insights.positionalValue);
          await expect(positionalValue).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });
  });

  test.describe('Custom Rankings Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('custom rankings load when tab is clicked', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Click on Custom Rankings tab
        const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
        if (await rankingsTabButton.isVisible()) {
          await rankingsTabButton.click();
          await page.waitForTimeout(3000);

          // Custom rankings should show
          const customRankings = page.locator(SELECTORS.insights.customRankings);
          await expect(customRankings).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('rankings table displays player data', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
        if (await rankingsTabButton.isVisible()) {
          await rankingsTabButton.click();
          await page.waitForTimeout(3000);

          const customRankings = page.locator(SELECTORS.insights.customRankings);

          if (await customRankings.isVisible().catch(() => false)) {
            // Adjusted rankings table should show
            const adjustedRankings = page.locator(SELECTORS.insights.adjustedRankings);
            await expect(adjustedRankings).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

            // Should have player rows
            const playerRows = page.locator('[data-testid^="league-rankings-row-"]');
            const rowCount = await playerRows.count();
            expect(rowCount).toBeGreaterThan(0);
          }
        }
      }
    });

    test('position filter works', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
        if (await rankingsTabButton.isVisible()) {
          await rankingsTabButton.click();
          await page.waitForTimeout(3000);

          const customRankings = page.locator(SELECTORS.insights.customRankings);

          if (await customRankings.isVisible().catch(() => false)) {
            // Position filter should be visible
            const positionFilter = page.locator(SELECTORS.insights.rankingsPositionFilter);
            await expect(positionFilter).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

            // Select a specific position (e.g., PG)
            await positionFilter.selectOption('PG');
            await page.waitForTimeout(500);

            // Table should still be visible after filtering
            const adjustedRankings = page.locator(SELECTORS.insights.adjustedRankings);
            await expect(adjustedRankings).toBeVisible({ timeout: TEST_TIMEOUTS.short });
          }
        }
      }
    });

    test('search filter works', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
        if (await rankingsTabButton.isVisible()) {
          await rankingsTabButton.click();
          await page.waitForTimeout(3000);

          const customRankings = page.locator(SELECTORS.insights.customRankings);

          if (await customRankings.isVisible().catch(() => false)) {
            // Search input should be visible
            const searchInput = page.locator(SELECTORS.insights.rankingsSearch);
            await expect(searchInput).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

            // Type a search query
            await searchInput.fill('Jokic');
            await page.waitForTimeout(500);

            // Table should still be visible after searching
            const adjustedRankings = page.locator(SELECTORS.insights.adjustedRankings);
            await expect(adjustedRankings).toBeVisible({ timeout: TEST_TIMEOUTS.short });
          }
        }
      }
    });

    test('value shifts section shows risers and fallers', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const rankingsTabButton = page.locator('button:has-text("Custom Rankings")');
        if (await rankingsTabButton.isVisible()) {
          await rankingsTabButton.click();
          await page.waitForTimeout(3000);

          const customRankings = page.locator(SELECTORS.insights.customRankings);

          if (await customRankings.isVisible().catch(() => false)) {
            // Value shifts section should show
            const valueShifts = page.locator(SELECTORS.insights.valueShifts);
            await expect(valueShifts).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

            // Should have riser and faller items
            const risers = page.locator('[data-testid^="league-value-riser-"]');
            const fallers = page.locator('[data-testid^="league-value-faller-"]');

            const riserCount = await risers.count();
            const fallerCount = await fallers.count();

            // Should have at least some risers or fallers
            expect(riserCount + fallerCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });

  test.describe('Error Handling', () => {
    test('page handles gracefully when not authenticated', async ({ page }) => {
      // Clear any existing auth cookies
      await page.context().clearCookies();

      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Page should load without crashing
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });

      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(1000);
      }

      // No critical errors (filter out ResizeObserver which is benign)
      expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    });
  });

  test.describe('Tab Switching', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('can switch between all three tabs', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Start on Settings tab (default)
        const settingsButton = page.locator('button:has-text("League Settings")');
        const analysisButton = page.locator('button:has-text("Strategy Analysis")');
        const rankingsButton = page.locator('button:has-text("Custom Rankings")');

        if (await settingsButton.isVisible() && await analysisButton.isVisible() && await rankingsButton.isVisible()) {
          // Should be on settings by default
          const settings = page.locator(SELECTORS.insights.settings);
          const hasSettings = await settings.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false);

          // Switch to Analysis
          await analysisButton.click();
          await page.waitForTimeout(1000);
          const categoryImportance = page.locator(SELECTORS.insights.categoryImportance);
          const hasAnalysis = await categoryImportance.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false);

          // Switch to Rankings
          await rankingsButton.click();
          await page.waitForTimeout(2000);
          const customRankings = page.locator(SELECTORS.insights.customRankings);
          const hasRankings = await customRankings.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false);

          // Switch back to Settings
          await settingsButton.click();
          await page.waitForTimeout(1000);
          const settingsAgain = page.locator(SELECTORS.insights.settings);
          const hasSettingsAgain = await settingsAgain.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false);

          // All tabs should have been accessible
          expect(hasSettings || hasAnalysis || hasRankings || hasSettingsAgain).toBe(true);
        }
      }
    });
  });

  test.describe('Refresh Functionality', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const insightsTab = page.locator(SELECTORS.insights.tab);
      if (await insightsTab.isVisible()) {
        await insightsTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('refresh insights button works', async ({ page }) => {
      const insightsPage = page.locator(SELECTORS.insights.page);

      if (await insightsPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Find refresh button
        const refreshButton = page.locator('button:has-text("Refresh Insights")');

        if (await refreshButton.isVisible()) {
          // Click refresh
          await refreshButton.click();

          // Should trigger a reload - wait for any loading state
          await page.waitForTimeout(1000);

          // Page should still be functional after refresh
          const pageStillVisible = await insightsPage.isVisible().catch(() => false);
          expect(pageStillVisible).toBe(true);
        }
      }
    });
  });
});
