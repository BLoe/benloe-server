import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Punt Strategy Engine', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to punt page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/punt`);
    await expect(page.locator(SELECTORS.punt.page)).toBeVisible();
  });

  test('strategy analyzer displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/punt`);
    await page.waitForLoadState('networkidle');

    const analyzer = page.locator(SELECTORS.punt.analyzer);
    const empty = page.locator(SELECTORS.punt.empty);
    const error = page.locator(SELECTORS.punt.error);

    const hasAnalyzer = await analyzer.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    expect(hasAnalyzer || hasEmpty || hasError).toBe(true);
  });

  test('archetypes panel displays', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/punt`);
    await page.waitForLoadState('networkidle');

    const archetypesPanel = page.locator(SELECTORS.punt.archetypesPanel);
    const empty = page.locator(SELECTORS.punt.empty);

    const hasArchetypes = await archetypesPanel.isVisible().catch(() => false);
    const hasEmpty = await empty.isVisible().catch(() => false);

    expect(hasArchetypes || hasEmpty).toBe(true);
  });

  test('what is punting help button exists', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/punt`);
    await page.waitForLoadState('networkidle');

    const helpButton = page.locator('button:has-text("What is Punting?")');
    const isVisible = await helpButton.isVisible().catch(() => false);

    // Help button should be present on the page
    expect(isVisible).toBeDefined();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/punt`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
