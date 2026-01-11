import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { URLS, SELECTORS } from '../fixtures/index';

test.describe('Fantasy Hawk Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await setupMocks(page);
    const response = await page.goto(URLS.home);

    // Page should load with 200 status
    expect(response?.status()).toBe(200);

    // Page should have Fantasy Hawk in title or content
    await expect(page).toHaveTitle(/Fantasy Hawk|fantasyhawk/i);
  });

  test('page renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await setupMocks(page);
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // No critical JavaScript errors
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('static assets load correctly', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('requestfailed', (request) => {
      failedRequests.push(request.url());
    });

    await setupMocks(page);
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // No failed requests for critical assets
    const criticalFailures = failedRequests.filter(
      url => url.includes('.js') || url.includes('.css')
    );
    expect(criticalFailures).toHaveLength(0);
  });

  test('league selector appears when authenticated', async ({ page }) => {
    await setupMocks(page);
    await page.goto(URLS.home);

    // Should show league selector
    await expect(page.locator(SELECTORS.leagueSelector)).toBeVisible();
  });

  test('shows sign in button when not authenticated', async ({ page }) => {
    await setupMocks(page, { auth: 'notAuthenticated' });
    await page.goto(URLS.home);

    // Should show sign in button
    await expect(page.locator('[data-testid="sign-in"]')).toBeVisible();
  });

  test('shows connect yahoo button when authenticated but Yahoo not linked', async ({ page }) => {
    await setupMocks(page, { auth: 'noYahoo' });
    await page.goto(URLS.home);

    // Should show connect Yahoo button
    await expect(page.locator(SELECTORS.connectButton)).toBeVisible();
  });

  test('dashboard loads with league selected', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);

    // Wait for data to load
    await page.waitForLoadState('networkidle');

    // Should show standings content
    await expect(page.getByText('League Standings')).toBeVisible();
  });

  test('tab navigation works', async ({ page }) => {
    await setupMocks(page);
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    // Wait for the tab bar to appear
    await expect(page.locator(SELECTORS.matchup.tab)).toBeVisible({ timeout: 15000 });

    // Click matchup tab
    await page.locator(SELECTORS.matchup.tab).click();

    // Wait for navigation and content to load
    await page.waitForLoadState('networkidle');

    // Should navigate to matchup
    await expect(page.locator(SELECTORS.matchup.page)).toBeVisible({ timeout: 15000 });
  });
});
