import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for benloe-server monorepo
 * Tests against live production sites on benloe.com
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Fantasy Hawk - primary test project
    {
      name: 'fantasy-hawk',
      testDir: './tests/fantasy-hawk',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://fantasyhawk.benloe.com',
      },
    },
    // Weights app tests
    {
      name: 'weights',
      testMatch: /weights.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://weights.benloe.com',
      },
    },
    // General/example tests
    {
      name: 'general',
      testMatch: /example\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
