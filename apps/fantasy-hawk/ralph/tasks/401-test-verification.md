# Task 401: Update e2e tests and run full verification

## Objective
Update Playwright e2e tests to work with the new URL-based routing and verify all functionality.

## Files to Review/Modify
- `tests/fantasy-hawk/fixtures.ts` - URL constants and selectors
- `tests/fantasy-hawk/*.spec.ts` - All test files
- `tests/fantasy-hawk/helpers.ts` - Test helper functions (if exists)

## Files to Read First
- `tests/fantasy-hawk/fixtures.ts` - Current test selectors
- List all test files to understand coverage

## Implementation Steps

### Step 1: List all test files

```bash
ls /srv/benloe/tests/fantasy-hawk/*.spec.ts
```

### Step 2: Update URL navigation patterns

Tests that currently:
1. Click a tab button
2. Wait for content to load

Should now:
1. Navigate to URL directly, OR
2. Click NavLink (which updates URL)
3. Wait for content to load

**Before:**
```ts
await page.click('[data-testid="matchup-tab"]');
await page.waitForSelector('[data-testid="matchup-page"]');
```

**After (navigate directly):**
```ts
await page.goto('/#/league/123.l.456/matchup');
await page.waitForSelector('[data-testid="matchup-page"]');
```

**Or (click link - same behavior):**
```ts
await page.click('[data-testid="matchup-tab"]'); // Now a NavLink
await page.waitForSelector('[data-testid="matchup-page"]');
// URL should now be /#/league/123.l.456/matchup
```

### Step 3: Update fixtures.ts URLs

Add helper for constructing league URLs:

```ts
export const URLS = {
  home: '/',
  league: (leagueKey: string) => `/#/league/${leagueKey}`,
  standings: (leagueKey: string) => `/#/league/${leagueKey}/standings`,
  matchup: (leagueKey: string) => `/#/league/${leagueKey}/matchup`,
  categories: (leagueKey: string) => `/#/league/${leagueKey}/categories`,
  categoriesProfile: (leagueKey: string) => `/#/league/${leagueKey}/categories/profile`,
  // ... etc
  api: {
    // API URLs stay the same
  },
} as const;
```

### Step 4: Update test navigation helpers

If there's a common pattern for navigating to a tab, create a helper:

```ts
async function navigateToTab(page: Page, leagueKey: string, tab: string) {
  await page.goto(`/#/league/${leagueKey}/${tab}`);
  await page.waitForLoadState('networkidle');
}
```

### Step 5: Update individual test files

For each test file:
1. Read the test to understand what it's testing
2. Update navigation to use URLs
3. Ensure waitFor conditions still work
4. Run the test to verify

Common updates needed:
- `page.goto('/')` → might need league selection first
- Tab clicks → still work but URL changes
- Assertions on URL → update to match new structure

### Step 6: Handle authenticated tests

Tests that require auth should:
1. Mock the auth API, OR
2. Navigate to league URL directly (if mocking league data)

```ts
// If mocking, can go directly to league URL
await page.goto('/#/league/mock-league-key/standings');
```

### Step 7: Run full test suite

```bash
cd /srv/benloe && npx playwright test --project=fantasy-hawk
```

Fix any failures, then run again.

### Step 8: Test URL persistence

Add or update tests to verify URL behavior:

```ts
test('URL updates when navigating tabs', async ({ page }) => {
  await page.goto('/#/league/123.l.456/standings');
  await page.click('[data-testid="matchup-tab"]');
  await expect(page).toHaveURL(/matchup/);
});

test('Page refresh maintains current view', async ({ page }) => {
  await page.goto('/#/league/123.l.456/matchup');
  await page.reload();
  await page.waitForSelector('[data-testid="matchup-page"]');
});

test('Browser back button works', async ({ page }) => {
  await page.goto('/#/league/123.l.456/standings');
  await page.click('[data-testid="matchup-tab"]');
  await page.goBack();
  await page.waitForSelector('[data-testid="standings-page"]');
});
```

## Implementation Notes

- HashRouter URLs start with `/#/` in Playwright
- Test selectors (data-testid) should mostly stay the same
- Focus on navigation changes, not component behavior changes
- If a test was working before and component behavior hasn't changed, it should still work

## Verification

```bash
# Run all fantasy-hawk tests
cd /srv/benloe && npx playwright test --project=fantasy-hawk

# Run specific test file if debugging
cd /srv/benloe && npx playwright test --project=fantasy-hawk tests/fantasy-hawk/matchup.spec.ts

# Run with headed mode to see what's happening
cd /srv/benloe && npx playwright test --project=fantasy-hawk --headed
```

## Success Criteria
- [x] All existing tests updated for URL routing
- [x] New tests added for URL persistence
- [x] Full test suite passes
- [x] No regressions in functionality
- [x] Build succeeds
- [x] Manual verification of key flows
