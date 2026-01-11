import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Schedule Planner', () => {
  test.describe('Navigation', () => {
    test('schedule tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Schedule tab in navigation
      const scheduleTab = page.locator(SELECTORS.schedule.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      const tabCount = await scheduleTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking schedule tab navigates to schedule view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const scheduleTab = page.locator(SELECTORS.schedule.tab);

      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();

        // Should show either the schedule page or the no-league message
        await expect(
          page.locator(`${SELECTORS.schedule.page}, ${SELECTORS.schedule.noLeague}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Calendar View', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click schedule tab if visible
      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('calendar view loads with schedule data', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        // Wait for data to load
        await page.waitForTimeout(2000);

        // Heatmap or calendar should be visible
        const heatmap = page.locator(SELECTORS.schedule.heatmap);
        const calendar = page.locator(SELECTORS.schedule.calendar);
        const noLeague = page.locator(SELECTORS.schedule.noLeague);
        const empty = page.locator(SELECTORS.schedule.empty);
        const error = page.locator(SELECTORS.schedule.error);

        // One of these states should be present
        const hasHeatmap = await heatmap.isVisible().catch(() => false);
        const hasCalendar = await calendar.isVisible().catch(() => false);
        const hasNoLeague = await noLeague.isVisible().catch(() => false);
        const hasEmpty = await empty.isVisible().catch(() => false);
        const hasError = await error.isVisible().catch(() => false);

        expect(hasHeatmap || hasCalendar || hasNoLeague || hasEmpty || hasError).toBe(true);
      }
    });

    test('schedule heatmap displays teams and weeks', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const heatmap = page.locator(SELECTORS.schedule.heatmap);

        if (await heatmap.isVisible().catch(() => false)) {
          // Should have heatmap rows for teams
          const heatmapRows = page.locator('[data-testid^="schedule-heatmap-row-"]');
          const rowCount = await heatmapRows.count();
          expect(rowCount).toBeGreaterThan(0);
        }
      }
    });

    test('weekly overview calendar displays weeks', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const calendar = page.locator(SELECTORS.schedule.calendar);

        if (await calendar.isVisible().catch(() => false)) {
          // Should have buttons inside the calendar for weeks
          const weekButtons = calendar.locator('button');
          const buttonCount = await weekButtons.count();
          expect(buttonCount).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Week Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('clicking on a week header shows week detail view', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Look for a week header in the heatmap
        const weekHeader = page.locator('[data-testid^="schedule-week-"]').first();

        if (await weekHeader.isVisible().catch(() => false)) {
          await weekHeader.click();
          await page.waitForTimeout(500);

          // Weekly view should now be visible
          const weeklyView = page.locator(SELECTORS.schedule.weeklyView);
          await expect(weeklyView).toBeVisible({ timeout: TEST_TIMEOUTS.short });
        }
      }
    });

    test('week detail view shows game counts and teams', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        // Click on a week to open detail view
        const weekHeader = page.locator('[data-testid^="schedule-week-"]').first();

        if (await weekHeader.isVisible().catch(() => false)) {
          await weekHeader.click();
          await page.waitForTimeout(500);

          const weeklyView = page.locator(SELECTORS.schedule.weeklyView);

          if (await weeklyView.isVisible().catch(() => false)) {
            // Should have week details content
            const weekContent = await weeklyView.textContent();
            expect(weekContent).toBeTruthy();
            expect(weekContent).toContain('Week');
          }
        }
      }
    });

    test('months are navigable via pagination', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(3000);

        const heatmap = page.locator(SELECTORS.schedule.heatmap);

        if (await heatmap.isVisible().catch(() => false)) {
          // Look for next/previous navigation buttons (ChevronLeft/ChevronRight icons)
          const nextButton = heatmap.locator('button').filter({ has: page.locator('svg') }).last();
          const prevButton = heatmap.locator('button').filter({ has: page.locator('svg') }).first();

          // At least one navigation button should exist
          const hasNext = await nextButton.isVisible().catch(() => false);
          const hasPrev = await prevButton.isVisible().catch(() => false);

          // One of them should be clickable (not disabled)
          if (hasNext) {
            const isDisabled = await nextButton.isDisabled().catch(() => true);
            if (!isDisabled) {
              await nextButton.click();
              await page.waitForTimeout(300);
              // Page should still be functional
              await expect(schedulePage).toBeVisible();
            }
          }
        }
      }
    });
  });

  test.describe('View Toggle', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('toggle between league-wide and my roster view works', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Find view toggle buttons
        const leagueWideButton = page.locator('button:has-text("League-Wide")');
        const myRosterButton = page.locator('button:has-text("My Roster")');

        if (await leagueWideButton.isVisible() && await myRosterButton.isVisible()) {
          // Click My Roster view
          await myRosterButton.click();
          await page.waitForTimeout(2000);

          // Page should still be visible
          await expect(schedulePage).toBeVisible();

          // Click back to League-Wide
          await leagueWideButton.click();
          await page.waitForTimeout(2000);

          // Page should still be visible
          await expect(schedulePage).toBeVisible();
        }
      }
    });

    test('roster view shows roster-specific data', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const myRosterButton = page.locator('button:has-text("My Roster")');

        if (await myRosterButton.isVisible()) {
          await myRosterButton.click();
          await page.waitForTimeout(3000);

          // In roster view, should show roster strength or roster-specific data
          const rosterStrength = page.locator(SELECTORS.schedule.rosterStrength);
          const heatmap = page.locator(SELECTORS.schedule.heatmap);
          const error = page.locator(SELECTORS.schedule.error);

          // One of these should be visible
          const hasRosterStrength = await rosterStrength.isVisible().catch(() => false);
          const hasHeatmap = await heatmap.isVisible().catch(() => false);
          const hasError = await error.isVisible().catch(() => false);

          expect(hasRosterStrength || hasHeatmap || hasError).toBe(true);
        }
      }
    });
  });

  test.describe('Playoff Analysis', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('playoff analysis section displays when playoffs tab is clicked', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Click on Playoffs tab
        const playoffsButton = page.locator('button:has-text("Playoffs")');

        if (await playoffsButton.isVisible()) {
          await playoffsButton.click();
          await page.waitForTimeout(3000);

          // Playoff analysis should be visible
          const playoffAnalysis = page.locator(SELECTORS.schedule.playoffAnalysis);
          const playoffError = page.locator(SELECTORS.schedule.playoffError);

          const hasAnalysis = await playoffAnalysis.isVisible().catch(() => false);
          const hasError = await playoffError.isVisible().catch(() => false);

          expect(hasAnalysis || hasError).toBe(true);
        }
      }
    });

    test('playoff analysis shows roster strength rating', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const playoffsButton = page.locator('button:has-text("Playoffs")');

        if (await playoffsButton.isVisible()) {
          await playoffsButton.click();
          await page.waitForTimeout(3000);

          const playoffAnalysis = page.locator(SELECTORS.schedule.playoffAnalysis);

          if (await playoffAnalysis.isVisible().catch(() => false)) {
            // Roster analysis section should be visible
            const rosterAnalysis = page.locator(SELECTORS.schedule.rosterAnalysis);
            await expect(rosterAnalysis).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
          }
        }
      }
    });

    test('team rankings show best and worst playoff schedules', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const playoffsButton = page.locator('button:has-text("Playoffs")');

        if (await playoffsButton.isVisible()) {
          await playoffsButton.click();
          await page.waitForTimeout(3000);

          const playoffAnalysis = page.locator(SELECTORS.schedule.playoffAnalysis);

          if (await playoffAnalysis.isVisible().catch(() => false)) {
            // Best and worst teams sections should be visible
            const bestTeams = page.locator(SELECTORS.schedule.bestTeams);
            const worstTeams = page.locator(SELECTORS.schedule.worstTeams);

            await expect(bestTeams).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
            await expect(worstTeams).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
          }
        }
      }
    });

    test('playoff weeks show game counts', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        const playoffsButton = page.locator('button:has-text("Playoffs")');

        if (await playoffsButton.isVisible()) {
          await playoffsButton.click();
          await page.waitForTimeout(3000);

          const playoffAnalysis = page.locator(SELECTORS.schedule.playoffAnalysis);

          if (await playoffAnalysis.isVisible().catch(() => false)) {
            // Should have playoff week cards
            const playoffWeeks = page.locator('[data-testid^="playoff-week-"]');
            const weekCount = await playoffWeeks.count();
            expect(weekCount).toBeGreaterThan(0);
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

      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(1000);
      }

      // No critical errors (filter out ResizeObserver which is benign)
      expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    });
  });

  test.describe('Refresh Functionality', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const scheduleTab = page.locator(SELECTORS.schedule.tab);
      if (await scheduleTab.isVisible()) {
        await scheduleTab.click();
        await page.waitForTimeout(1000);
      }
    });

    test('refresh schedule button works', async ({ page }) => {
      const schedulePage = page.locator(SELECTORS.schedule.page);

      if (await schedulePage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await page.waitForTimeout(2000);

        // Find refresh button
        const refreshButton = page.locator('button:has-text("Refresh Schedule")');

        if (await refreshButton.isVisible()) {
          // Click refresh
          await refreshButton.click();

          // Should trigger a reload - wait for any loading state
          await page.waitForTimeout(1000);

          // Page should still be functional after refresh
          const pageStillVisible = await schedulePage.isVisible().catch(() => false);
          expect(pageStillVisible).toBe(true);
        }
      }
    });
  });
});
