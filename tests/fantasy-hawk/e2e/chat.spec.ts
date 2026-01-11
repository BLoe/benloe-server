import { test, expect } from '@playwright/test';
import { setupMocks } from '../mocks/setup';
import { TEST_LEAGUE_KEY } from '../fixtures/index';
import { SELECTORS } from '../fixtures/index';

test.describe('AI Strategy Chat', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('navigates to chat page', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await expect(page.locator(SELECTORS.chat.page)).toBeVisible();
  });

  test('chat panel is visible', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const chatPanel = page.locator(SELECTORS.chat.panel);
    await expect(chatPanel).toBeVisible();
  });

  test('message input is present', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const input = page.locator(SELECTORS.chat.input);
    await expect(input).toBeVisible();
  });

  test('send button is present', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const sendButton = page.locator(SELECTORS.chat.send);
    await expect(sendButton).toBeVisible();
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const sendButton = page.locator(SELECTORS.chat.send);
    const input = page.locator(SELECTORS.chat.input);

    await input.clear();
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has text', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const sendButton = page.locator(SELECTORS.chat.send);
    const input = page.locator(SELECTORS.chat.input);

    await input.fill('How should I approach this matchup?');
    await expect(sendButton).toBeEnabled();
  });

  test('can type in input field', async ({ page }) => {
    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    const input = page.locator(SELECTORS.chat.input);
    await input.fill('Test message');

    const inputValue = await input.inputValue();
    expect(inputValue).toBe('Test message');
  });

  test('no console errors on page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!error.message.includes('ResizeObserver')) {
        errors.push(error.message);
      }
    });

    await page.goto(`/#/league/${TEST_LEAGUE_KEY}/chat`);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});
