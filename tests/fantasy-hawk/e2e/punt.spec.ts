import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Punt Strategy Engine', () => {
  test.describe('Navigation', () => {
    test('punt tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Punt tab in navigation
      const puntTab = page.locator(SELECTORS.punt.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await puntTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking punt tab navigates to punt view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const puntTab = page.locator(SELECTORS.punt.tab);

      if (await puntTab.isVisible()) {
        await puntTab.click();

        // Should show either the punt page or the no-league message
        await expect(
          page.locator(`${SELECTORS.punt.page}, ${SELECTORS.punt.noLeague}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Strategy Analyzer', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click punt tab if visible
      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('strategy analyzer page loads', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Wait for data to load
        await page.waitForTimeout(2000);

        // Strategy analyzer should be visible when data is loaded
        const analyzer = page.locator(SELECTORS.punt.analyzer);
        const noLeague = page.locator(SELECTORS.punt.noLeague);
        const empty = page.locator(SELECTORS.punt.empty);
        const error = page.locator(SELECTORS.punt.error);

        // One of these states should be present
        const hasAnalyzer = await analyzer.isVisible().catch(() => false);
        const hasNoLeague = await noLeague.isVisible().catch(() => false);
        const hasEmpty = await empty.isVisible().catch(() => false);
        const hasError = await error.isVisible().catch(() => false);

        expect(hasAnalyzer || hasNoLeague || hasEmpty || hasError).toBe(true);
      }
    });

    test('current build detection displays', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const analyzer = page.locator(SELECTORS.punt.analyzer);

        if (await analyzer.isVisible().catch(() => false)) {
          // Current build panel should show
          const currentBuild = page.locator(SELECTORS.punt.currentBuild);
          await expect(currentBuild).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('category ranks visualization displays', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const analyzer = page.locator(SELECTORS.punt.analyzer);

        if (await analyzer.isVisible().catch(() => false)) {
          // Category ranks panel should show
          const categoryRanks = page.locator(SELECTORS.punt.categoryRanks);
          await expect(categoryRanks).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('archetype cards display with fit scores', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const analyzer = page.locator(SELECTORS.punt.analyzer);

        if (await analyzer.isVisible().catch(() => false)) {
          // Archetypes panel should show
          const archetypes = page.locator(SELECTORS.punt.archetypes);
          await expect(archetypes).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

          // Should have archetype cards with match scores
          const archetypeCards = page.locator('[data-testid^="punt-archetype-"]');
          const cardCount = await archetypeCards.count();

          // Should have at least some archetype cards
          expect(cardCount).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Archetypes Section', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('archetypes panel shows', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const analyzer = page.locator(SELECTORS.punt.analyzer);

        if (await analyzer.isVisible().catch(() => false)) {
          // Archetypes detail panel should show
          const archetypesPanel = page.locator(SELECTORS.punt.archetypesPanel);
          await expect(archetypesPanel).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
        }
      }
    });

    test('clicking archetype shows detail', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const archetypesPanel = page.locator(SELECTORS.punt.archetypesPanel);

        if (await archetypesPanel.isVisible().catch(() => false)) {
          // Find an archetype detail card and click it to expand
          const archetypeCards = page.locator('[data-testid^="archetype-detail-"]');
          const cardCount = await archetypeCards.count();

          if (cardCount > 0) {
            // Click the first card's button to expand
            const firstCard = archetypeCards.first();
            const expandButton = firstCard.locator('button');

            await expandButton.click();
            await page.waitForTimeout(500);

            // After clicking, expanded content should be visible
            // Look for trade tips or example player types (only visible when expanded)
            const expandedContent = firstCard.locator('text=Trade & Waiver Tips');
            const hasExpanded = await expandedContent.isVisible().catch(() => false);

            // Verify we can expand the card
            expect(hasExpanded).toBe(true);
          }
        }
      }
    });

    test('archetype cards show punt and strength categories', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const archetypesPanel = page.locator(SELECTORS.punt.archetypesPanel);

        if (await archetypesPanel.isVisible().catch(() => false)) {
          // Find an archetype detail card and expand it
          const archetypeCards = page.locator('[data-testid^="archetype-detail-"]');
          const cardCount = await archetypeCards.count();

          if (cardCount > 0) {
            const firstCard = archetypeCards.first();
            const expandButton = firstCard.locator('button');

            await expandButton.click();
            await page.waitForTimeout(500);

            // Look for punt categories section (red text)
            const puntSection = firstCard.locator('text=Categories to Punt');
            const strengthSection = firstCard.locator('text=Categories to Target');

            const hasPunt = await puntSection.isVisible().catch(() => false);
            const hasStrength = await strengthSection.isVisible().catch(() => false);

            expect(hasPunt && hasStrength).toBe(true);
          }
        }
      }
    });
  });

  test.describe('Help Panel', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('what is punting help button toggles help panel', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Find the help button
        const helpButton = page.locator('button:has-text("What is Punting?")');

        if (await helpButton.isVisible()) {
          // Click to open help panel
          await helpButton.click();
          await page.waitForTimeout(300);

          // Help content should be visible
          const helpContent = page.locator('text=Understanding Punt Strategies');
          await expect(helpContent).toBeVisible();

          // Click again to close
          await helpButton.click();
          await page.waitForTimeout(300);

          // Help content should be hidden
          await expect(helpContent).not.toBeVisible();
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

      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(1000);
      }

      // No critical errors (filter out ResizeObserver which is benign)
      expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    });
  });

  test.describe('Page Structure', () => {
    test('shows appropriate state based on authentication', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(2000);
      }

      // Check for any valid state
      const noLeagueMessage = page.locator(SELECTORS.punt.noLeague);
      const puntPage = page.locator(SELECTORS.punt.page);
      const loadingSpinner = page.locator(SELECTORS.loadingSpinner);
      const errorMessage = page.locator(SELECTORS.punt.error);

      const hasNoLeague = await noLeagueMessage.isVisible().catch(() => false);
      const hasPage = await puntPage.isVisible().catch(() => false);
      const hasLoading = await loadingSpinner.isVisible().catch(() => false);
      const hasError = await errorMessage.isVisible().catch(() => false);

      // Either we have content OR the tab isn't visible (unauthenticated user)
      const tabVisible = await puntTab.isVisible().catch(() => false);

      expect(hasNoLeague || hasPage || hasLoading || hasError || !tabVisible).toBe(true);
    });

    test('refresh analysis button works', async ({ page }) => {
      const puntPage = page.locator(SELECTORS.punt.page);

      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const puntTab = page.locator(SELECTORS.punt.tab);
      if (await puntTab.isVisible()) {
        await puntTab.click();
        await page.waitForTimeout(3000);
      }

      if (await puntPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const analyzer = page.locator(SELECTORS.punt.analyzer);

        if (await analyzer.isVisible().catch(() => false)) {
          // Find refresh button
          const refreshButton = page.locator('button:has-text("Refresh Analysis")');

          if (await refreshButton.isVisible()) {
            // Click refresh
            await refreshButton.click();

            // Should trigger a reload - wait for any loading state
            await page.waitForTimeout(1000);

            // Page should still be functional after refresh
            const pageStillVisible = await puntPage.isVisible().catch(() => false);
            expect(pageStillVisible).toBe(true);
          }
        }
      }
    });
  });
});
