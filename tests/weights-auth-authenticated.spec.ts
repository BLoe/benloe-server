import { test, expect } from '@playwright/test';

test.describe('Weights App - Authenticated State', () => {
  let consoleLogs: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleLogs = [];

    // Capture console logs
    page.on('console', (msg) => {
      const logMessage = `[${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleLogs.push(logMessage);
    });

    // Set a real authentication token (you'd need to get this from your auth flow)
    // For now, let's test what happens when the frontend THINKS it's authenticated
    await page.addInitScript(() => {
      // Mock the fetch to return successful authentication
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        
        if (url.includes('/api/user/me')) {
          // Return a successful authentication response
          return new Response(JSON.stringify({
            user: {
              id: 'test-user-id',
              email: 'test@example.com',
              name: 'Test User'
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // For all other requests, use original fetch
        return originalFetch(input, init);
      };
    });
  });

  test('should show main app interface when authentication succeeds', async ({ page }) => {
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for auth check to complete

    // Should NOT see authentication required page
    const authRequired = page.locator('#notAuthenticated');
    await expect(authRequired).toBeHidden();

    // Should see the main app
    const mainApp = page.locator('#mainApp');
    await expect(mainApp).toBeVisible();

    // Should see main app elements
    const header = page.locator('h1:has-text("PR Tracker")');
    await expect(header).toBeVisible();

    console.log('=== CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(log));
  });

  test('should call showMainApp() when user is set', async ({ page }) => {
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check frontend logs for the right method calls
    const frontendLogs = consoleLogs.filter(log => 
      log.includes('FRONTEND:') || log.includes('showMainApp') || log.includes('showNotAuthenticated')
    );
    
    console.log('=== RELEVANT FRONTEND LOGS ===');
    frontendLogs.forEach(log => console.log(log));

    // Should have called showMainApp, not showNotAuthenticated
    const showMainAppCalled = frontendLogs.some(log => log.includes('showMainApp'));
    const showNotAuthCalled = frontendLogs.some(log => log.includes('showNotAuthenticated'));

    expect(showMainAppCalled).toBe(true);
    expect(showNotAuthCalled).toBe(false);
  });
});