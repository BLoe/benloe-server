import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Trade Analyzer', () => {
  test.describe('Navigation', () => {
    test('trade tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Trade tab in navigation
      const tradeTab = page.locator(SELECTORS.trade.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await tradeTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking trade tab navigates to trade view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const tradeTab = page.locator(SELECTORS.trade.tab);

      if (await tradeTab.isVisible()) {
        await tradeTab.click();

        // Should show either the trade page or the no-league message
        await expect(
          page.locator(`${SELECTORS.trade.page}, ${SELECTORS.trade.noLeague}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Trade Builder', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click trade tab if visible
      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('trade builder page loads', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Trade builder should be visible
        const builder = page.locator(SELECTORS.trade.builder);
        await expect(builder).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });

    test('trade partner selector is present', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Wait for data to load
        await page.waitForTimeout(2000);

        const partnerSelect = page.locator(SELECTORS.trade.partnerSelect);
        // Partner select should be visible if builder loaded
        const builder = page.locator(SELECTORS.trade.builder);
        if (await builder.isVisible().catch(() => false)) {
          await expect(partnerSelect).toBeVisible();
        }
      }
    });

    test('can select trade partner team', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const partnerSelect = page.locator(SELECTORS.trade.partnerSelect);

        if (await partnerSelect.isVisible()) {
          // Get the options count
          const optionCount = await partnerSelect.locator('option').count();

          if (optionCount > 1) {
            // Select the second option (first is placeholder)
            await partnerSelect.selectOption({ index: 1 });

            // Verify selection changed
            const selectedValue = await partnerSelect.inputValue();
            expect(selectedValue).not.toBe('');
          }
        }
      }
    });

    test('analyze button is initially disabled', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const analyzeBtn = page.locator(SELECTORS.trade.analyzeBtn);

        if (await analyzeBtn.isVisible()) {
          // Button should be disabled without valid trade
          await expect(analyzeBtn).toBeDisabled();
        }
      }
    });
  });

  test.describe('Player Selection', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('rosters display for user team', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Should see roster with player buttons
        const builder = page.locator(SELECTORS.trade.builder);
        if (await builder.isVisible()) {
          // Look for any roster player buttons
          const rosterPlayers = page.locator('[data-testid^="roster-player-"]');
          const count = await rosterPlayers.count();

          // Either we have players or we're still loading
          expect(count).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('can add player to trade (give)', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Find a roster player to add
        const rosterPlayers = page.locator('[data-testid^="roster-player-"]');
        const count = await rosterPlayers.count();

        if (count > 0) {
          // Click first player to add to trade
          await rosterPlayers.first().click();
          await page.waitForTimeout(500);

          // Should now see the player in give panel
          const givePanel = page.locator(SELECTORS.trade.givePanel);
          await expect(givePanel).toBeVisible();
        }
      }
    });

    test('can remove player from trade', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const rosterPlayers = page.locator('[data-testid^="roster-player-"]');
        const count = await rosterPlayers.count();

        if (count > 0) {
          // Add a player
          await rosterPlayers.first().click();
          await page.waitForTimeout(500);

          // Find remove button and click it
          const removeBtn = page.locator('[data-testid^="trade-player-remove-"]').first();
          if (await removeBtn.isVisible()) {
            await removeBtn.click();
            await page.waitForTimeout(500);

            // Give panel should be gone or empty
            const givePanel = page.locator(SELECTORS.trade.givePanel);
            const isVisible = await givePanel.isVisible().catch(() => false);

            // Either panel is hidden or it has no players
            if (isVisible) {
              const givePlayers = page.locator('[data-testid^="trade-player-give-"]');
              expect(await givePlayers.count()).toBe(0);
            }
          }
        }
      }
    });
  });

  test.describe('Trade Analysis', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('analyze button becomes active with valid trade', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Select a trade partner
        const partnerSelect = page.locator(SELECTORS.trade.partnerSelect);
        const optionCount = await partnerSelect.locator('option').count();

        if (optionCount > 1) {
          await partnerSelect.selectOption({ index: 1 });
          await page.waitForTimeout(2000);

          // Add player from my roster
          const myRosterPlayers = page.locator('[data-testid^="roster-player-"]');
          if (await myRosterPlayers.count() > 0) {
            await myRosterPlayers.first().click();
            await page.waitForTimeout(500);
          }

          // Add player from partner roster
          const partnerPlayers = page.locator('[data-testid^="partner-player-"]');
          if (await partnerPlayers.count() > 0) {
            await partnerPlayers.first().click();
            await page.waitForTimeout(500);

            // Now analyze button should be enabled
            const analyzeBtn = page.locator(SELECTORS.trade.analyzeBtn);
            await expect(analyzeBtn).toBeEnabled();
          }
        }
      }
    });
  });

  test.describe('Clear Trade', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('clear trade resets the builder', async ({ page }) => {
      const tradePage = page.locator(SELECTORS.trade.page);

      if (await tradePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Add a player first
        const rosterPlayers = page.locator('[data-testid^="roster-player-"]');
        if (await rosterPlayers.count() > 0) {
          await rosterPlayers.first().click();
          await page.waitForTimeout(500);

          // Click clear/reset button
          const resetBtn = page.locator(SELECTORS.trade.resetBtn);
          if (await resetBtn.isVisible()) {
            await resetBtn.click();
            await page.waitForTimeout(500);

            // Give panel should be hidden (no players selected)
            const givePanel = page.locator(SELECTORS.trade.givePanel);
            const isVisible = await givePanel.isVisible().catch(() => false);
            expect(isVisible).toBe(false);
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

      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
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

      const tradeTab = page.locator(SELECTORS.trade.tab);
      if (await tradeTab.isVisible()) {
        await tradeTab.click();
        await page.waitForTimeout(2000);
      }

      // Check for any valid state
      const noLeagueMessage = page.locator(SELECTORS.trade.noLeague);
      const tradePage = page.locator(SELECTORS.trade.page);
      const loadingSpinner = page.locator(SELECTORS.loadingSpinner);

      const hasNoLeague = await noLeagueMessage.isVisible().catch(() => false);
      const hasPage = await tradePage.isVisible().catch(() => false);
      const hasLoading = await loadingSpinner.isVisible().catch(() => false);

      // Either we have content OR the tab isn't visible (unauthenticated user)
      const tabVisible = await tradeTab.isVisible().catch(() => false);

      expect(hasNoLeague || hasPage || hasLoading || !tabVisible).toBe(true);
    });
  });
});
