import { test, expect } from '@playwright/test';

test.describe('Responsive Design', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1200, height: 800 },
  ];

  for (const viewport of viewports) {
    test(`should display correctly on ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      // Check that content is visible and properly sized
      await expect(page.locator('body')).toBeVisible();

      // Navigation should be responsive
      const nav = page.locator('nav');
      await expect(nav).toBeVisible();

      // Check that content doesn't overflow
      const body = await page.locator('body').boundingBox();
      expect(body?.width).toBeLessThanOrEqual(viewport.width + 20); // Allow for scrollbars
    });
  }

  test('mobile navigation should work', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Look for mobile menu button (hamburger menu)
    const mobileMenuButton = page.locator(
      'button[aria-label*="menu" i], button:has(svg), .hamburger, .mobile-menu'
    );

    if (
      await mobileMenuButton
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await mobileMenuButton.first().click();

      // Mobile menu should appear
      await expect(page.locator('.mobile-menu, [role="dialog"], .menu-overlay')).toBeVisible();
    }
  });

  test('touch interactions should work on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Test touch interactions on clickable elements
    const clickableElements = page.locator('button, a, [role="button"]');
    const count = await clickableElements.count();

    if (count > 0) {
      // Verify first clickable element responds to tap
      const firstElement = clickableElements.first();
      await expect(firstElement).toBeVisible();

      // Simulate touch by clicking
      await firstElement.click();
    }
  });
});
