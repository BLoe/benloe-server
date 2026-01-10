import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('Fantasy Hawk Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    const response = await page.goto(URLS.home);

    // Page should load with 200 status
    expect(response?.status()).toBe(200);

    // Page should have Fantasy Hawk in title or content
    await expect(page).toHaveTitle(/Fantasy Hawk|fantasyhawk/i);
  });

  test('API health check - oauth status endpoint responds', async ({ page }) => {
    const response = await page.goto(URLS.api.status);

    // API should respond (even if not authenticated)
    expect(response?.status()).toBeLessThan(500);

    // Should return JSON
    const contentType = response?.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });

  test('page renders without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

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

    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // No failed requests for critical assets
    const criticalFailures = failedRequests.filter(
      url => url.includes('.js') || url.includes('.css')
    );
    expect(criticalFailures).toHaveLength(0);
  });
});
