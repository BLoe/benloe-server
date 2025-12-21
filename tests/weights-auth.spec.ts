import { test, expect } from '@playwright/test';

test.describe('Weights App Authentication', () => {
  let consoleLogs: string[] = [];
  let networkRequests: Array<{ url: string; method: string; status: number; response?: any }> = [];

  test.beforeEach(async ({ page }) => {
    // Clear logs for each test
    consoleLogs = [];
    networkRequests = [];

    // Capture console logs
    page.on('console', (msg) => {
      const logMessage = `[${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleLogs.push(logMessage);
      console.log('Browser Console:', logMessage);
    });

    // Capture network requests
    page.on('response', async (response) => {
      const request = response.request();
      const requestInfo = {
        url: request.url(),
        method: request.method(),
        status: response.status()
      };

      // Capture response for API calls
      if (request.url().includes('/api/')) {
        try {
          const responseText = await response.text();
          requestInfo.response = responseText;
        } catch (e) {
          requestInfo.response = 'Could not read response';
        }
      }

      networkRequests.push(requestInfo);
      console.log(`Network: ${requestInfo.method} ${requestInfo.url} - ${requestInfo.status}`);
    });
  });

  test('should display authentication required page when not logged in', async ({ page }) => {
    // Navigate to weights app
    await page.goto('https://weights.benloe.com');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Should see authentication required message
    const authRequired = page.locator('#notAuthenticated');
    await expect(authRequired).toBeVisible();
    
    // Should see sign in button
    const signInButton = page.locator('a[href*="auth.benloe.com"]');
    await expect(signInButton).toBeVisible();
    
    // Should see debug logs button
    const debugButton = page.locator('#showDebugLogs');
    await expect(debugButton).toBeVisible();
    
    console.log('=== CONSOLE LOGS ===');
    consoleLogs.forEach(log => console.log(log));
    
    console.log('=== NETWORK REQUESTS ===');
    networkRequests.forEach(req => {
      console.log(`${req.method} ${req.url} - ${req.status}`);
      if (req.response) {
        console.log(`Response: ${req.response}`);
      }
    });
  });

  test('should show debug logs when debug button is clicked', async ({ page }) => {
    // Navigate to weights app
    await page.goto('https://weights.benloe.com');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Click debug logs button
    const debugButton = page.locator('#showDebugLogs');
    await debugButton.click();
    
    // Debug modal should be visible
    const debugModal = page.locator('#debugModal');
    await expect(debugModal).toBeVisible();
    
    // Should see debug logs content
    const debugContent = page.locator('#debugLogsContent');
    await expect(debugContent).toBeVisible();
    
    // Wait a bit for logs to load
    await page.waitForTimeout(2000);
    
    // Get the debug logs content
    const debugText = await debugContent.textContent();
    console.log('=== DEBUG LOGS FROM UI ===');
    console.log(debugText);
    
    // Test copy to clipboard button
    const copyButton = page.locator('#copyDebugLogs');
    await expect(copyButton).toBeVisible();
    
    // Test refresh button
    const refreshButton = page.locator('#refreshDebugLogs');
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();
    
    // Close modal
    const closeButton = page.locator('#closeDebugModal');
    await closeButton.click();
    await expect(debugModal).toBeHidden();
  });

  test('should make API requests to check authentication', async ({ page }) => {
    // Navigate to weights app
    await page.goto('https://weights.benloe.com');
    
    // Wait for all network requests to complete
    await page.waitForLoadState('networkidle');
    
    // Check that authentication API calls were made
    const authRequests = networkRequests.filter(req => 
      req.url.includes('/api/user/me') || 
      req.url.includes('/api/exercises') ||
      req.url.includes('auth.benloe.com')
    );
    
    console.log('=== AUTHENTICATION REQUESTS ===');
    authRequests.forEach(req => {
      console.log(`${req.method} ${req.url} - ${req.status}`);
      if (req.response) {
        console.log(`Response: ${req.response}`);
      }
    });
    
    // Should have made authentication requests
    expect(authRequests.length).toBeGreaterThan(0);
    
    // Check if any requests returned 401 (unauthorized)
    const unauthorizedRequests = authRequests.filter(req => req.status === 401);
    console.log(`Found ${unauthorizedRequests.length} unauthorized requests`);
  });

  test('should show frontend debug logs in browser console', async ({ page }) => {
    // Navigate to weights app
    await page.goto('https://weights.benloe.com');
    
    // Wait for page to load and auth check to complete
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Look for frontend debug logs
    const frontendLogs = consoleLogs.filter(log => 
      log.includes('FRONTEND:') || 
      log.includes('Frontend:') ||
      log.includes('Authentication') ||
      log.includes('Auth check')
    );
    
    console.log('=== FRONTEND DEBUG LOGS ===');
    frontendLogs.forEach(log => console.log(log));
    
    // Should have some frontend logs
    expect(frontendLogs.length).toBeGreaterThan(0);
  });

  test('should handle authentication flow with cookies', async ({ page }) => {
    // Test what happens if we manually set a fake auth cookie
    await page.context().addCookies([
      {
        name: 'token',
        value: 'fake-token-for-testing',
        domain: '.benloe.com',
        path: '/'
      }
    ]);
    
    // Navigate to weights app with fake cookie
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    
    // Check what happens with the fake token
    const authRequests = networkRequests.filter(req => 
      req.url.includes('/api/user/me') || req.url.includes('/api/exercises')
    );
    
    console.log('=== REQUESTS WITH FAKE TOKEN ===');
    authRequests.forEach(req => {
      console.log(`${req.method} ${req.url} - ${req.status}`);
      if (req.response) {
        console.log(`Response: ${req.response}`);
      }
    });
  });

  test.afterEach(async ({ page }) => {
    // Print summary after each test
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Total console logs: ${consoleLogs.length}`);
    console.log(`Total network requests: ${networkRequests.length}`);
    
    const apiRequests = networkRequests.filter(req => req.url.includes('/api/'));
    console.log(`API requests: ${apiRequests.length}`);
    
    const failedRequests = networkRequests.filter(req => req.status >= 400);
    console.log(`Failed requests (4xx/5xx): ${failedRequests.length}`);
    
    if (failedRequests.length > 0) {
      console.log('Failed requests:');
      failedRequests.forEach(req => {
        console.log(`  ${req.method} ${req.url} - ${req.status}`);
      });
    }
  });
});