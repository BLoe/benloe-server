import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Trade Analyzer', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to trade page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await expect(page.locator(SELECTORS.trade.page)).toBeVisible();
  });

  test('trade builder is visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await page.waitForLoadState('networkidle');

    const builder = page.locator(SELECTORS.trade.builder);
    await expect(builder).toBeVisible();
  });

  test('trade partner selector is present', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await page.waitForLoadState('networkidle');

    const partnerSelect = page.locator(SELECTORS.trade.partnerSelect);
    await expect(partnerSelect).toBeVisible();
  });

  test('analyze button is initially disabled', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await page.waitForLoadState('networkidle');

    const analyzeBtn = page.locator(SELECTORS.trade.analyzeBtn);
    await expect(analyzeBtn).toBeDisabled();
  });

  test('reset button is present', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await page.waitForLoadState('networkidle');

    const resetBtn = page.locator(SELECTORS.trade.resetBtn);
    await expect(resetBtn).toBeVisible();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/trade`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
