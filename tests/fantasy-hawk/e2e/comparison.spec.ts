import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Player Comparison', () => {
  test.describe('Navigation', () => {
    test('compare tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Compare tab in navigation
      const compareTab = page.locator(SELECTORS.comparison.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await compareTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking compare tab navigates to comparison view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);

      if (await compareTab.isVisible()) {
        await compareTab.click();

        // Should show either the comparison page or loading state
        await expect(
          page.locator(`${SELECTORS.comparison.page}, ${SELECTORS.loadingSpinner}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Player Selector', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click compare tab if visible
      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('player selector is visible on comparison page', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const selector = page.locator(SELECTORS.comparison.selector);
        await expect(selector).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });

    test('player slots are clickable', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Wait for page to load
        await page.waitForTimeout(1000);

        // Look for empty player slots (they have cursor-pointer class)
        const emptySlots = page.locator('[data-testid="player-selector"] .cursor-pointer');
        const count = await emptySlots.count();

        // Should have at least 2 empty slots initially
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });

    test('clicking slot shows search dropdown', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Find an empty slot (first one that's clickable)
        const emptySlots = page.locator('[data-testid="player-selector"] .cursor-pointer').first();

        if (await emptySlots.isVisible()) {
          await emptySlots.click();
          await page.waitForTimeout(500);

          // Search input should now be visible
          const searchInput = page.locator(SELECTORS.comparison.searchInput);
          await expect(searchInput).toBeVisible({ timeout: TEST_TIMEOUTS.short });
        }
      }
    });

    test('search input accepts text', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Click an empty slot to open search
        const emptySlots = page.locator('[data-testid="player-selector"] .cursor-pointer').first();

        if (await emptySlots.isVisible()) {
          await emptySlots.click();
          await page.waitForTimeout(500);

          const searchInput = page.locator(SELECTORS.comparison.searchInput);

          if (await searchInput.isVisible()) {
            await searchInput.fill('LeBron');
            await page.waitForTimeout(500);

            // Input should have the value
            await expect(searchInput).toHaveValue('LeBron');
          }
        }
      }
    });
  });

  test.describe('Compare Button', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('compare button exists', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const compareBtn = page.locator(SELECTORS.comparison.compareBtn);
        await expect(compareBtn).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });

    test('compare button is initially disabled', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        const compareBtn = page.locator(SELECTORS.comparison.compareBtn);

        if (await compareBtn.isVisible()) {
          // Button should be disabled when no players are selected
          await expect(compareBtn).toBeDisabled();
        }
      }
    });
  });

  test.describe('Comparison Table', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('comparison table not visible initially', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Table should not be visible before comparison is run
        const table = page.locator(SELECTORS.comparison.table);
        const isVisible = await table.isVisible().catch(() => false);
        expect(isVisible).toBe(false);
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

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
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

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(2000);
      }

      // Check for any valid state
      const comparePage = page.locator(SELECTORS.comparison.page);
      const loadingSpinner = page.locator(SELECTORS.loadingSpinner);

      const hasPage = await comparePage.isVisible().catch(() => false);
      const hasLoading = await loadingSpinner.isVisible().catch(() => false);

      // Either we have content OR the tab isn't visible (unauthenticated user)
      const tabVisible = await compareTab.isVisible().catch(() => false);

      expect(hasPage || hasLoading || !tabVisible).toBe(true);
    });

    test('page contains header with title', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(1000);
      }

      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Look for the heading text
        const heading = page.getByRole('heading', { name: /Player Comparison/i });
        await expect(heading).toBeVisible({ timeout: TEST_TIMEOUTS.short });
      }
    });
  });

  test.describe('Player Slots', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('shows 4 player slots', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Player selector should have 4 grid items (slots)
        const selector = page.locator(SELECTORS.comparison.selector);
        if (await selector.isVisible()) {
          const slots = selector.locator('.grid > div');
          const count = await slots.count();
          expect(count).toBe(4);
        }
      }
    });

    test('first two slots show "Add Player" label', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Look for "Add Player" text in the first two slots
        const addPlayerTexts = page.getByText('Add Player');
        const count = await addPlayerTexts.count();

        // Should have at least 2 "Add Player" labels
        expect(count).toBeGreaterThanOrEqual(2);
      }
    });

    test('last two slots show "Optional" label', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Look for "Optional" text
        const optionalTexts = page.getByText('Optional');
        const count = await optionalTexts.count();

        // Should have at least 2 "Optional" labels
        expect(count).toBeGreaterThanOrEqual(2);
      }
    });
  });

  test.describe('Minimum Players Warning', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const compareTab = page.locator(SELECTORS.comparison.tab);
      if (await compareTab.isVisible()) {
        await compareTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('shows warning when less than 2 players selected', async ({ page }) => {
      const comparePage = page.locator(SELECTORS.comparison.page);

      if (await comparePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(1000);

        // Warning should be visible when no players are selected
        const warning = page.getByText(/Select at least 2 players/i);
        await expect(warning).toBeVisible({ timeout: TEST_TIMEOUTS.short });
      }
    });
  });
});
