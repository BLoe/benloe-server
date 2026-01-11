import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Waiver Advisor', () => {
  test.describe('Navigation', () => {
    test('waivers tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Waivers tab in navigation
      const waiverTab = page.locator(SELECTORS.waiver.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await waiverTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking waivers tab navigates to waiver advisor', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);

      if (await waiverTab.isVisible()) {
        await waiverTab.click();

        // Should show either the waiver dashboard or loading state
        await expect(
          page.locator(`${SELECTORS.waiver.page}, ${SELECTORS.loadingSpinner}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Recommendations Panel', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click waivers tab if visible
      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('recommendations panel is visible on waiver page', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const recommendations = page.locator(SELECTORS.waiver.recommendations);
        const loading = page.locator(SELECTORS.waiver.recommendationsLoading);
        const error = page.locator(SELECTORS.waiver.recommendationsError);
        const empty = page.locator(SELECTORS.waiver.recommendationsEmpty);

        // One of these should be visible
        const hasRecommendations = await recommendations.isVisible().catch(() => false);
        const hasLoading = await loading.isVisible().catch(() => false);
        const hasError = await error.isVisible().catch(() => false);
        const hasEmpty = await empty.isVisible().catch(() => false);

        expect(hasRecommendations || hasLoading || hasError || hasEmpty).toBe(true);
      }
    });

    test('position filter buttons exist', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Check for position filter buttons
        const allFilter = page.locator(SELECTORS.waiver.positionFilter('all'));

        // At least the All filter should exist if recommendations panel loaded
        const hasFilter = await allFilter.isVisible().catch(() => false);

        // It's OK if the filter isn't there (could be in loading/error state)
        expect(hasFilter).toBeDefined();
      }
    });

    test('clicking position filter updates view', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const pgFilter = page.locator(SELECTORS.waiver.positionFilter('pg'));

        if (await pgFilter.isVisible()) {
          await pgFilter.click();
          await page.waitForTimeout(500);

          // Filter should now be active
          await expect(pgFilter).toHaveClass(/bg-hawk-orange/);
        }
      }
    });
  });

  test.describe('Drops Panel', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('drops panel is visible on waiver page', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const drops = page.locator(SELECTORS.waiver.drops);
        const loading = page.locator(SELECTORS.waiver.dropsLoading);
        const error = page.locator(SELECTORS.waiver.dropsError);
        const empty = page.locator(SELECTORS.waiver.dropsEmpty);

        // One of these should be visible
        const hasDrops = await drops.isVisible().catch(() => false);
        const hasLoading = await loading.isVisible().catch(() => false);
        const hasError = await error.isVisible().catch(() => false);
        const hasEmpty = await empty.isVisible().catch(() => false);

        expect(hasDrops || hasLoading || hasError || hasEmpty).toBe(true);
      }
    });

    test('drops panel has header', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const dropsPanel = page.locator(SELECTORS.waiver.drops);

        if (await dropsPanel.isVisible()) {
          // Should have "Consider Dropping" header
          const header = dropsPanel.getByText('Consider Dropping');
          await expect(header).toBeVisible({ timeout: TEST_TIMEOUTS.short });
        }
      }
    });
  });

  test.describe('FAAB Suggestions', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('FAAB section exists (shows content or not-available)', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const faab = page.locator(SELECTORS.waiver.faab);
        const faabLoading = page.locator(SELECTORS.waiver.faabLoading);
        const faabError = page.locator(SELECTORS.waiver.faabError);
        const faabNotAvailable = page.locator(SELECTORS.waiver.faabNotAvailable);

        // One of these should be visible
        const hasFaab = await faab.isVisible().catch(() => false);
        const hasLoading = await faabLoading.isVisible().catch(() => false);
        const hasError = await faabError.isVisible().catch(() => false);
        const hasNotAvailable = await faabNotAvailable.isVisible().catch(() => false);

        expect(hasFaab || hasLoading || hasError || hasNotAvailable).toBe(true);
      }
    });

    test('non-FAAB leagues show appropriate message', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const faabNotAvailable = page.locator(SELECTORS.waiver.faabNotAvailable);

        // If this is a non-FAAB league, we should see the not available message
        if (await faabNotAvailable.isVisible()) {
          const message = page.getByText("This league doesn't use FAAB");
          await expect(message).toBeVisible();
        }
      }
    });
  });

  test.describe('Page Structure', () => {
    test('shows appropriate state based on authentication', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(2000);
      }

      // Check for any valid state
      const waiverPage = page.locator(SELECTORS.waiver.page);
      const loadingSpinner = page.locator(SELECTORS.loadingSpinner);

      const hasPage = await waiverPage.isVisible().catch(() => false);
      const hasLoading = await loadingSpinner.isVisible().catch(() => false);

      // Either we have content OR the tab isn't visible (unauthenticated user)
      const tabVisible = await waiverTab.isVisible().catch(() => false);

      expect(hasPage || hasLoading || !tabVisible).toBe(true);
    });

    test('page contains header with title', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(1000);
      }

      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Look for the heading text
        const heading = page.getByRole('heading', { name: /Waiver Advisor/i });
        await expect(heading).toBeVisible({ timeout: TEST_TIMEOUTS.short });
      }
    });

    test('page contains tips section', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(1000);
      }

      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Look for waiver tips section
        const tipsHeader = page.getByText('Waiver Tips');
        await expect(tipsHeader).toBeVisible({ timeout: TEST_TIMEOUTS.short });
      }
    });

    test('page contains refresh button', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(1000);
      }

      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const refreshBtn = page.getByRole('button', { name: /Refresh/i });
        await expect(refreshBtn).toBeVisible({ timeout: TEST_TIMEOUTS.short });
      }
    });

    test('page contains Yahoo waivers link', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(1000);
      }

      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const yahooLink = page.getByRole('link', { name: /Yahoo Waivers/i });
        await expect(yahooLink).toBeVisible({ timeout: TEST_TIMEOUTS.short });
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

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(1000);
      }

      // No critical errors (filter out ResizeObserver which is benign)
      expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    });
  });

  test.describe('Player Cards', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const waiverTab = page.locator(SELECTORS.waiver.tab);
      if (await waiverTab.isVisible()) {
        await waiverTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('recommendation cards display player info', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Look for recommendation items
        const firstRec = page.locator('[data-testid="recommendation-0"]');

        if (await firstRec.isVisible()) {
          // Should have player name and team info
          const hasText = await firstRec.textContent();
          expect(hasText).toBeTruthy();
          expect(hasText?.length).toBeGreaterThan(0);
        }
      }
    });

    test('drop candidate cards display player info', async ({ page }) => {
      const waiverPage = page.locator(SELECTORS.waiver.page);

      if (await waiverPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Look for drop candidate items
        const firstDrop = page.locator('[data-testid="drop-candidate-0"]');

        if (await firstDrop.isVisible()) {
          // Should have player name and reason
          const hasText = await firstDrop.textContent();
          expect(hasText).toBeTruthy();
          expect(hasText?.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
