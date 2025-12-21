import { test, expect } from '@playwright/test';

test.describe('Weights App - Real Backend Integration', () => {
  let consoleLogs: string[] = [];
  let networkRequests: Array<{ url: string; method: string; status: number; response?: any; headers?: any }> = [];

  test.beforeEach(async ({ page }) => {
    consoleLogs = [];
    networkRequests = [];

    // Capture console logs
    page.on('console', (msg) => {
      const logMessage = `[${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleLogs.push(logMessage);
    });

    // Capture network requests with full details
    page.on('response', async (response) => {
      const request = response.request();
      const requestInfo = {
        url: request.url(),
        method: request.method(),
        status: response.status(),
        headers: 'headers-removed-for-simplicity'
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

  test('REAL BACKEND: Test actual /api/user/me endpoint behavior', async ({ page }) => {
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Get the actual API request to /api/user/me
    const userMeRequests = networkRequests.filter(req => req.url.includes('/api/user/me'));
    
    console.log('=== REAL BACKEND API ANALYSIS ===');
    console.log(`Found ${userMeRequests.length} requests to /api/user/me`);
    
    userMeRequests.forEach((req, index) => {
      console.log(`\nRequest ${index + 1}:`);
      console.log(`  URL: ${req.url}`);
      console.log(`  Method: ${req.method}`);
      console.log(`  Status: ${req.status}`);
      console.log(`  Response: ${req.response}`);
      console.log(`  Headers: ${JSON.stringify(req.headers, null, 2)}`);
    });

    // Check what the frontend actually received
    const frontendLogs = consoleLogs.filter(log => log.includes('FRONTEND:'));
    console.log('\n=== FRONTEND LOGS WITH REAL BACKEND ===');
    frontendLogs.forEach(log => console.log(log));

    // Get current DOM state
    const authCheck = await page.locator('#authCheck').isVisible();
    const authRequired = await page.locator('#notAuthenticated').isVisible();
    const mainApp = await page.locator('#mainApp').isVisible();

    console.log('\n=== FINAL DOM STATE ===');
    console.log(`Auth check visible: ${authCheck}`);
    console.log(`Auth required visible: ${authRequired}`);
    console.log(`Main app visible: ${mainApp}`);

    // This will tell us what's actually happening with real backend
    if (userMeRequests.length > 0) {
      const lastRequest = userMeRequests[userMeRequests.length - 1];
      console.log('\n=== DIAGNOSIS ===');
      
      if (lastRequest.status === 200) {
        console.log('✅ Backend returned 200 - authentication succeeded');
        console.log('🔍 Response format:', lastRequest.response);
        
        if (mainApp) {
          console.log('✅ Main app is visible - everything working correctly!');
        } else {
          console.log('❌ Main app NOT visible - frontend not processing 200 response correctly');
          console.log('🐛 BUG CONFIRMED: Frontend receives 200 but doesn\'t show main app');
        }
      } else if (lastRequest.status === 401) {
        console.log('❌ Backend returned 401 - user not authenticated');
        console.log('📝 This is expected behavior for non-authenticated users');
      } else {
        console.log(`❓ Unexpected status: ${lastRequest.status}`);
      }
    }

    // Don't assert anything - this is for diagnosis only
  });

  test('REAL BACKEND: Compare expected vs actual response format', async ({ page }) => {
    // First test with mock (we know this works)
    await page.route('**/api/user/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'mock-user-id',
            email: 'mock@test.com',
            name: 'Mock User'
          }
        })
      });
    });

    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const mockedMainAppVisible = await page.locator('#mainApp').isVisible();
    const mockedAuthRequiredVisible = await page.locator('#notAuthenticated').isVisible();

    console.log('=== MOCKED RESPONSE RESULTS ===');
    console.log(`Main app visible: ${mockedMainAppVisible}`);
    console.log(`Auth required visible: ${mockedAuthRequiredVisible}`);

    // Now test without mock (real backend)
    await page.unroute('**/api/user/me');
    
    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle'); 
    await page.waitForTimeout(2000);

    const realMainAppVisible = await page.locator('#mainApp').isVisible();
    const realAuthRequiredVisible = await page.locator('#notAuthenticated').isVisible();

    console.log('=== REAL BACKEND RESULTS ===');
    console.log(`Main app visible: ${realMainAppVisible}`);
    console.log(`Auth required visible: ${realAuthRequiredVisible}`);

    // Compare the two
    console.log('=== COMPARISON ===');
    console.log(`Mock works: ${mockedMainAppVisible}`);
    console.log(`Real backend works: ${realMainAppVisible}`);
    console.log(`Same result: ${mockedMainAppVisible === realMainAppVisible}`);

    if (mockedMainAppVisible && !realMainAppVisible) {
      console.log('🐛 BUG CONFIRMED: Mock works but real backend doesn\'t');
      console.log('🔍 Issue is likely in backend response format or authentication');
    } else if (!mockedMainAppVisible && !realMainAppVisible) {
      console.log('🐛 BUG CONFIRMED: Neither mock nor real backend work');
      console.log('🔍 Issue is in frontend code itself');
    } else if (mockedMainAppVisible && realMainAppVisible) {
      console.log('✅ Both work - no bug detected');
    }
  });

  test('REAL BACKEND: Check if we need to set authentication cookies', async ({ page }) => {
    // Set fake authentication cookies to see if that makes the real backend work
    await page.context().addCookies([
      {
        name: 'token',
        value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.token', // Obviously fake JWT
        domain: '.benloe.com',
        path: '/',
        httpOnly: true,
        secure: true
      }
    ]);

    await page.goto('https://weights.benloe.com');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const userMeRequests = networkRequests.filter(req => req.url.includes('/api/user/me'));
    
    console.log('=== WITH FAKE AUTH COOKIE ===');
    userMeRequests.forEach((req, index) => {
      console.log(`Request ${index + 1}: ${req.method} ${req.url} - ${req.status}`);
      console.log(`Response: ${req.response}`);
    });

    const mainAppVisible = await page.locator('#mainApp').isVisible();
    const authRequiredVisible = await page.locator('#notAuthenticated').isVisible();

    console.log('=== RESULTS WITH FAKE COOKIE ===');
    console.log(`Main app visible: ${mainAppVisible}`);
    console.log(`Auth required visible: ${authRequiredVisible}`);

    // Check frontend logs
    const frontendLogs = consoleLogs.filter(log => log.includes('FRONTEND:'));
    console.log('=== FRONTEND LOGS WITH FAKE COOKIE ===');
    frontendLogs.forEach(log => console.log(log));
  });
});