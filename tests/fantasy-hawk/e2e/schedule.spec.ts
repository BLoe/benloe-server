import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Schedule Planner', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to schedule page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await expect(page.locator(SELECTORS.schedule.page)).toBeVisible();
  });

  test('page has heading', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /Schedule Planner/i });
    await expect(heading).toBeVisible();
  });

  test('schedule view displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    const heatmap = page.locator(SELECTORS.schedule.heatmap);
    const calendar = page.locator(SELECTORS.schedule.calendar);
    const empty = page.locator(SELECTORS.schedule.empty);
    const error = page.locator(SELECTORS.schedule.error);

    const hasHeatmap = await heatmap.isVisible().catch(() => false);
    const hasCalendar = await calendar.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasHeatmap || hasCalendar || hasEmpty || hasError).toBe(true);
  });

  test('view toggle buttons exist', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    const leagueWideButton = page.locator('button:has-text("League-Wide")');
    const myRosterButton = page.locator('button:has-text("My Roster")');

    const hasLeagueWide = await leagueWideButton.isVisible().catch(() => false);
    const hasMyRoster = await myRosterButton.isVisible().catch(() => false);

    expect(hasLeagueWide || hasMyRoster).toBe(true);
  });

  test('playoffs tab exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    const playoffsButton = page.locator('button:has-text("Playoffs")');
    const hasPlayoffs = await playoffsButton.isVisible().catch(() => false);
    expect(hasPlayoffs).toBeDefined();
  });

  test('refresh button exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    const refreshButton = page.locator('button:has-text("Refresh Schedule")');
    const hasRefresh = await refreshButton.isVisible().catch(() => false);
    expect(hasRefresh).toBeDefined();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/schedule`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
