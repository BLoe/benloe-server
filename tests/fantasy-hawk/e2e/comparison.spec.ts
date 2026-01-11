import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Player Comparison', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to comparison page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await expect(page.locator(SELECTORS.comparison.page)).toBeVisible();
  });

  test('page has heading', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /Player Comparison/i });
    await expect(heading).toBeVisible();
  });

  test('player selector is visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const selector = page.locator(SELECTORS.comparison.selector);
    await expect(selector).toBeVisible();
  });

  test('compare button exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const compareBtn = page.locator(SELECTORS.comparison.compareBtn);
    await expect(compareBtn).toBeVisible();
  });

  test('compare button is initially disabled', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const compareBtn = page.locator(SELECTORS.comparison.compareBtn);
    await expect(compareBtn).toBeDisabled();
  });

  test('shows 4 player slots', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const selector = page.locator(SELECTORS.comparison.selector);
    const slots = selector.locator('.grid > div');
    const count = await slots.count();

    expect(count).toBe(4);
  });

  test('shows minimum players warning', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const warning = page.getByText(/Select at least 2 players/i);
    await expect(warning).toBeVisible();
  });

  test('comparison table not visible initially', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    const table = page.locator(SELECTORS.comparison.table);
    await expect(table).not.toBeVisible();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/compare`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
