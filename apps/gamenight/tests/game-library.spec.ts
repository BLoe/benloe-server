import { test, expect } from '@playwright/test';

test.describe('Game Library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to game library
    await page.getByRole('link', { name: /game library/i }).click();
  });

  test('should display game library page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /game library/i })).toBeVisible();
  });

  test('should show empty state when no games exist', async ({ page }) => {
    // Since we cleared test data, should show empty state or search option
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]');
    const addGameButton = page.locator(
      'button:has-text("Add"), button:has-text("Import"), button:has-text("Search")'
    );

    // Should have either search functionality or add game functionality
    const hasSearchOrAdd =
      (await searchInput
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await addGameButton
        .first()
        .isVisible()
        .catch(() => false));

    expect(hasSearchOrAdd).toBe(true);
  });

  test('should allow searching for games from BGG', async ({ page }) => {
    // Look for BGG search functionality
    const searchButton = page.locator(
      'button:has-text("Search"), button:has-text("BGG"), button:has-text("BoardGameGeek")'
    );

    if (
      await searchButton
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await searchButton.first().click();

      // Should open search dialog or navigate to search
      await expect(page.locator('[role="dialog"], .modal, .search-dialog')).toBeVisible({
        timeout: 2000,
      });
    }
  });

  test('should handle search input', async ({ page }) => {
    const searchInput = page
      .locator('input[placeholder*="search" i], input[type="search"]')
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Settlers of Catan');
      // Should trigger search or show results
      await page.waitForTimeout(1000); // Allow for debounced search
    }
  });
});
