import { test, expect } from '@playwright/test';

test.describe('Game Night Homepage', () => {
  test('should load homepage and display main navigation', async ({ page }) => {
    await page.goto('/');

    // Check that the page loads
    await expect(page).toHaveTitle(/Game Night/);

    // Check main navigation elements
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.getByRole('link', { name: /upcoming events/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /game library/i })).toBeVisible();
  });

  test('should show upcoming events section', async ({ page }) => {
    await page.goto('/');

    // Check upcoming events section exists
    await expect(page.getByRole('heading', { name: /upcoming events/i })).toBeVisible();
  });

  test('should navigate to game library', async ({ page }) => {
    await page.goto('/');

    // Click on game library link
    await page.getByRole('link', { name: /game library/i }).click();

    // Verify we're on the game library page
    await expect(page.getByRole('heading', { name: /game library/i })).toBeVisible();
  });

  test('should display login/profile options', async ({ page }) => {
    await page.goto('/');

    // Check for auth-related UI elements
    const authSection = page.locator(
      '[data-testid="auth-section"], .auth-controls, button:has-text("Login"), button:has-text("Sign"), a:has-text("Login")'
    );
    await expect(authSection.first()).toBeVisible();
  });
});
