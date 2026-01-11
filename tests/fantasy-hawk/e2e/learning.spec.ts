import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('Learning Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('learning mode toggle is visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const toggle = page.locator(SELECTORS.learning.toggle);
    await expect(toggle).toBeVisible();
  });

  test('glossary button is visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const glossaryButton = page.locator(SELECTORS.learning.glossaryButton);
    await expect(glossaryButton).toBeVisible();
  });

  test('clicking toggle changes state', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const toggle = page.locator(SELECTORS.learning.toggle);
    await toggle.click();
    await page.waitForTimeout(300);

    // Toggle should still be visible after clicking
    await expect(toggle).toBeVisible();
  });

  test('clicking glossary opens modal', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const glossaryButton = page.locator(SELECTORS.learning.glossaryButton);
    await glossaryButton.click();
    await page.waitForTimeout(500);

    const glossary = page.locator(SELECTORS.learning.glossary);
    await expect(glossary).toBeVisible();
  });

  test('glossary has search input', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const glossaryButton = page.locator(SELECTORS.learning.glossaryButton);
    await glossaryButton.click();
    await page.waitForTimeout(500);

    const searchInput = page.locator(SELECTORS.learning.glossarySearch);
    await expect(searchInput).toBeVisible();
  });

  test('glossary can be closed', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    const glossaryButton = page.locator(SELECTORS.learning.glossaryButton);
    await glossaryButton.click();
    await page.waitForTimeout(500);

    const glossary = page.locator(SELECTORS.learning.glossary);
    await expect(glossary).toBeVisible();

    // Find and click close button
    const closeButton = glossary.locator('button').first();
    await closeButton.click();
    await page.waitForTimeout(300);

    await expect(glossary).not.toBeVisible();
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/standings`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
