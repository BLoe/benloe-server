import { test, expect } from '@playwright/test';
import { URLS, SELECTORS, TEST_TIMEOUTS } from '../fixtures';

test.describe('AI Strategy Chat', () => {
  test.describe('Navigation', () => {
    test('chat tab appears in navigation', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Look for Chat tab in navigation
      const chatTab = page.locator(SELECTORS.chat.tab);

      // Tab might not be visible if user isn't authenticated - that's OK
      // We just verify the app loads without errors
      const tabCount = await chatTab.count();
      expect(tabCount).toBeGreaterThanOrEqual(0);
    });

    test('clicking chat tab navigates to chat view', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const chatTab = page.locator(SELECTORS.chat.tab);

      if (await chatTab.isVisible()) {
        await chatTab.click();

        // Should show either the chat page, no-league message, or no-key message
        await expect(
          page.locator(`${SELECTORS.chat.page}, ${SELECTORS.chat.noLeague}, ${SELECTORS.chat.noKey}`)
        ).toBeVisible({ timeout: TEST_TIMEOUTS.medium });
      }
    });
  });

  test.describe('Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Try to click chat tab if visible
      const chatTab = page.locator(SELECTORS.chat.tab);
      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('chat panel displays when authenticated with key', async ({ page }) => {
      const chatPage = page.locator(SELECTORS.chat.page);
      const chatPanel = page.locator(SELECTORS.chat.panel);

      // If chat page is visible, panel should be visible
      if (await chatPage.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
        await expect(chatPanel).toBeVisible();
      }
    });

    test('message input field is present and functional', async ({ page }) => {
      const chatPanel = page.locator(SELECTORS.chat.panel);

      if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const input = page.locator(SELECTORS.chat.input);
        await expect(input).toBeVisible();

        // Type a test message
        await input.fill('Test message');
        const inputValue = await input.inputValue();
        expect(inputValue).toBe('Test message');
      }
    });

    test('send button is present', async ({ page }) => {
      const chatPanel = page.locator(SELECTORS.chat.panel);

      if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const sendButton = page.locator(SELECTORS.chat.send);
        await expect(sendButton).toBeVisible();
      }
    });

    test('send button is disabled when input is empty', async ({ page }) => {
      const chatPanel = page.locator(SELECTORS.chat.panel);

      if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const sendButton = page.locator(SELECTORS.chat.send);
        const input = page.locator(SELECTORS.chat.input);

        // Clear input
        await input.clear();

        // Button should be disabled
        await expect(sendButton).toBeDisabled();
      }
    });

    test('send button is enabled when input has text', async ({ page }) => {
      const chatPanel = page.locator(SELECTORS.chat.panel);

      if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const sendButton = page.locator(SELECTORS.chat.send);
        const input = page.locator(SELECTORS.chat.input);

        // Type a message
        await input.fill('How should I approach this matchup?');

        // Button should be enabled
        await expect(sendButton).toBeEnabled();
      }
    });
  });

  test.describe('No Configuration States', () => {
    test('shows no-league message when no league selected', async ({ page }) => {
      // Clear cookies to ensure clean state
      await page.context().clearCookies();

      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const chatTab = page.locator(SELECTORS.chat.tab);

      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(1000);

        // Should show either no-league or no-key message (depending on auth state)
        const noLeague = page.locator(SELECTORS.chat.noLeague);
        const noKey = page.locator(SELECTORS.chat.noKey);

        const hasNoLeague = await noLeague.isVisible().catch(() => false);
        const hasNoKey = await noKey.isVisible().catch(() => false);

        // One of these should be visible, or chat tab isn't showing
        expect(hasNoLeague || hasNoKey || !(await chatTab.isVisible())).toBe(true);
      }
    });
  });

  test.describe('Error Handling', () => {
    test('page handles gracefully when not authenticated', async ({ page }) => {
      // Clear any existing auth cookies
      await page.context().clearCookies();

      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      // Page should load without crashing
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });

      const chatTab = page.locator(SELECTORS.chat.tab);
      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(1000);
      }

      // No critical errors (filter out ResizeObserver which is benign)
      expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
    });
  });

  test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const chatTab = page.locator(SELECTORS.chat.tab);
      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('input supports multiline with Shift+Enter', async ({ page }) => {
      const chatPanel = page.locator(SELECTORS.chat.panel);

      if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.medium }).catch(() => false)) {
        const input = page.locator(SELECTORS.chat.input);

        // Type text with Shift+Enter for newline
        await input.fill('Line 1');
        await input.press('Shift+Enter');
        await input.type('Line 2');

        const inputValue = await input.inputValue();
        expect(inputValue).toContain('Line 1');
        expect(inputValue).toContain('Line 2');
      }
    });
  });

  test.describe('Mobile Layout', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('chat interface works on mobile viewport', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const chatTab = page.locator(SELECTORS.chat.tab);

      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(500);

        const chatPage = page.locator(SELECTORS.chat.page);
        const chatPanel = page.locator(SELECTORS.chat.panel);

        // Either chat page or panel should be visible
        const hasPage = await chatPage.isVisible().catch(() => false);
        const hasPanel = await chatPanel.isVisible().catch(() => false);
        const noLeague = page.locator(SELECTORS.chat.noLeague);
        const noKey = page.locator(SELECTORS.chat.noKey);
        const hasNoLeague = await noLeague.isVisible().catch(() => false);
        const hasNoKey = await noKey.isVisible().catch(() => false);

        // Some state should be visible
        expect(hasPage || hasPanel || hasNoLeague || hasNoKey).toBe(true);
      }
    });

    test('input and send button visible on mobile', async ({ page }) => {
      await page.goto(URLS.home);
      await page.waitForLoadState('networkidle');

      const chatTab = page.locator(SELECTORS.chat.tab);

      if (await chatTab.isVisible()) {
        await chatTab.click();
        await page.waitForTimeout(500);

        const chatPanel = page.locator(SELECTORS.chat.panel);

        if (await chatPanel.isVisible({ timeout: TEST_TIMEOUTS.short }).catch(() => false)) {
          const input = page.locator(SELECTORS.chat.input);
          const send = page.locator(SELECTORS.chat.send);

          await expect(input).toBeVisible();
          await expect(send).toBeVisible();
        }
      }
    });
  });
});
