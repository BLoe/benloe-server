import { test, expect } from '@playwright/test';

test.describe('Weights App - Comprehensive Authentication Testing', () => {
  let consoleLogs: string[] = [];
  let networkRequests: Array<{ url: string; method: string; status: number; response?: any }> = [];

  test.beforeEach(async ({ page }) => {
    consoleLogs = [];
    networkRequests = [];

    // Capture console logs
    page.on('console', (msg) => {
      const logMessage = `[${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleLogs.push(logMessage);
    });

    // Capture network requests
    page.on('response', async (response) => {
      const request = response.request();
      const requestInfo = {
        url: request.url(),
        method: request.method(),
        status: response.status()
      };

      if (request.url().includes('/api/')) {
        try {
          const responseText = await response.text();
          requestInfo.response = responseText;
        } catch (e) {
          requestInfo.response = 'Could not read response';
        }
      }

      networkRequests.push(requestInfo);
    });
  });

  test('BASELINE: Unauthenticated user sees auth required page', async ({ page }) => {
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see authentication required
    const authRequired = page.locator('#notAuthenticated');
    await expect(authRequired).toBeVisible();

    // Should NOT see main app
    const mainApp = page.locator('#mainApp');
    await expect(mainApp).toBeHidden();

    // Log the state for debugging
    console.log('=== UNAUTHENTICATED STATE ===');
    console.log('Auth required visible:', await authRequired.isVisible());
    console.log('Main app hidden:', await mainApp.isHidden());
    
    const frontendLogs = consoleLogs.filter(log => log.includes('FRONTEND:'));
    console.log('Frontend logs:', frontendLogs);
  });

  test('BUG TEST: Mock successful auth - should show main app but might not', async ({ page }) => {
    // Mock successful authentication response
    await page.route('**/api/user/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User',
            createdAt: '2023-01-01T00:00:00.000Z',
            lastLoginAt: new Date().toISOString()
          }
        })
      });
    });

    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Give time for auth check and UI updates

    // Get current state of all elements
    const authCheck = page.locator('#authCheck');
    const authRequired = page.locator('#notAuthenticated'); 
    const mainApp = page.locator('#mainApp');

    const authCheckVisible = await authCheck.isVisible();
    const authRequiredVisible = await authRequired.isVisible();
    const mainAppVisible = await mainApp.isVisible();

    console.log('=== AUTHENTICATED STATE ANALYSIS ===');
    console.log('Auth check visible:', authCheckVisible);
    console.log('Auth required visible:', authRequiredVisible);
    console.log('Main app visible:', mainAppVisible);

    // Extract all frontend logs
    const frontendLogs = consoleLogs.filter(log => log.includes('FRONTEND:'));
    console.log('=== FRONTEND DEBUG LOGS ===');
    frontendLogs.forEach(log => console.log(log));

    // Check API requests
    const userMeRequests = networkRequests.filter(req => req.url.includes('/api/user/me'));
    console.log('=== API REQUESTS ===');
    userMeRequests.forEach(req => {
      console.log(`${req.method} ${req.url} - ${req.status}`);
      console.log(`Response: ${req.response}`);
    });

    // This should pass if working correctly, fail if buggy
    console.log('=== EXPECTED vs ACTUAL ===');
    console.log('Expected: Main app visible, auth required hidden');
    console.log(`Actual: Main app ${mainAppVisible ? 'visible' : 'hidden'}, auth required ${authRequiredVisible ? 'visible' : 'hidden'}`);

    // The test assertion - this will likely FAIL and show us the bug
    expect(authRequiredVisible).toBe(false); // Should not show auth required
    expect(mainAppVisible).toBe(true); // Should show main app
  });

  test('DETAILED FLOW ANALYSIS: Step by step auth process', async ({ page }) => {
    // Mock successful authentication
    await page.route('**/api/user/me', async route => {
      console.log('API MOCK: /api/user/me called');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'test-user-id',
            email: 'debug@test.com',
            name: 'Debug User'
          }
        })
      });
    });

    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');

    // Wait and check state at different intervals
    const checkState = async (step: string) => {
      const authCheck = await page.locator('#authCheck').isVisible();
      const authRequired = await page.locator('#notAuthenticated').isVisible();
      const mainApp = await page.locator('#mainApp').isVisible();
      
      console.log(`=== STATE AT ${step} ===`);
      console.log(`Auth check: ${authCheck}, Auth required: ${authRequired}, Main app: ${mainApp}`);
      
      return { authCheck, authRequired, mainApp };
    };

    await page.waitForTimeout(500);
    const state1 = await checkState('500ms');
    
    await page.waitForTimeout(1000);  
    const state2 = await checkState('1.5s');
    
    await page.waitForTimeout(2000);
    const state3 = await checkState('3.5s');

    // Check if anything changed over time
    console.log('=== STATE TRANSITIONS ===');
    console.log('Did main app ever become visible?', [state1.mainApp, state2.mainApp, state3.mainApp]);
    console.log('Did auth required ever hide?', [!state1.authRequired, !state2.authRequired, !state3.authRequired]);

    // Get final frontend logs
    const frontendLogs = consoleLogs.filter(log => log.includes('FRONTEND:'));
    console.log('=== ALL FRONTEND LOGS ===');
    frontendLogs.forEach(log => console.log(log));

    // Check for specific log patterns that indicate the bug
    const authSuccessLogs = frontendLogs.filter(log => log.includes('Authentication successful'));
    const showMainAppLogs = frontendLogs.filter(log => log.includes('showMainApp'));
    const showNotAuthLogs = frontendLogs.filter(log => log.includes('showNotAuthenticated'));

    console.log('=== CRITICAL LOG ANALYSIS ===');
    console.log('Auth success logs:', authSuccessLogs.length);
    console.log('showMainApp calls:', showMainAppLogs.length); 
    console.log('showNotAuthenticated calls:', showNotAuthLogs.length);

    // This will help us pinpoint exactly where the flow breaks
    expect(authSuccessLogs.length).toBeGreaterThan(0); // Should succeed in auth
    expect(showMainAppLogs.length).toBeGreaterThan(0); // Should call showMainApp
    expect(state3.mainApp).toBe(true); // Should end up with main app visible
  });

  test('DOM MANIPULATION TEST: Verify element visibility changes work', async ({ page }) => {
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');

    // Test DOM manipulation directly
    await page.evaluate(() => {
      console.log('MANUAL TEST: Calling showMainApp directly');
      
      // Find the app instance and call showMainApp directly
      const app = (window as any).app;
      if (app && app.showMainApp) {
        app.showMainApp();
      } else {
        // Manual DOM manipulation to test
        document.getElementById('authCheck')?.classList.add('hidden');
        document.getElementById('notAuthenticated')?.classList.add('hidden'); 
        document.getElementById('mainApp')?.classList.remove('hidden');
        console.log('MANUAL TEST: Direct DOM manipulation completed');
      }
    });

    await page.waitForTimeout(1000);

    // Check if manual DOM manipulation worked
    const mainAppVisible = await page.locator('#mainApp').isVisible();
    const authRequiredVisible = await page.locator('#notAuthenticated').isVisible();

    console.log('=== MANUAL DOM TEST RESULTS ===');
    console.log('After manual showMainApp - Main app visible:', mainAppVisible);
    console.log('After manual showMainApp - Auth required visible:', authRequiredVisible);

    // If this fails, there might be CSS or other issues preventing visibility
    expect(mainAppVisible).toBe(true);
    expect(authRequiredVisible).toBe(false);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === 'failed') {
      console.log('\n=== TEST FAILED - FULL DEBUG INFO ===');
      console.log('Console logs:', consoleLogs.length);
      console.log('Network requests:', networkRequests.length);
      
      // Get final DOM state
      try {
        const finalState = await page.evaluate(() => {
          const authCheck = document.getElementById('authCheck');
          const authRequired = document.getElementById('notAuthenticated');
          const mainApp = document.getElementById('mainApp');
          
          return {
            authCheckClasses: authCheck?.className || 'not found',
            authRequiredClasses: authRequired?.className || 'not found', 
            mainAppClasses: mainApp?.className || 'not found',
            authCheckVisible: authCheck && !authCheck.classList.contains('hidden'),
            authRequiredVisible: authRequired && !authRequired.classList.contains('hidden'),
            mainAppVisible: mainApp && !mainApp.classList.contains('hidden')
          };
        });
        
        console.log('Final DOM state:', finalState);
      } catch (e) {
        console.log('Could not get final DOM state:', e);
      }
    }
  });
});