import { defineConfig, devices } from '@playwright/test';

/**
 * Kickball integration tests.
 *
 * These run against a throwaway API on port 3010 with its own database, so a
 * test run never touches the real roster or the published lineups. The API is
 * started with KICKBALL_TEST_USER, which stands in for an Artanis session and
 * is ignored entirely when NODE_ENV is production.
 *
 * This config is deliberately separate from the monorepo root config: the
 * webServer block below would otherwise start these servers for every other
 * app's test run too.
 *
 *   npx playwright test --config apps/kickball/playwright.config.ts
 */

const TEST_DB = '/tmp/kickball-e2e.db';
const API_PORT = 3010;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: '../../tests/kickball',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/kickball' }]],
  // Generating a lineup runs real Monte Carlo simulations and takes a few
  // seconds, so the default 30s is not enough headroom.
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'kickball' }],
  webServer: [
    {
      command: `rm -f ${TEST_DB} ${TEST_DB}-wal ${TEST_DB}-shm && node api/dist/server.js`,
      cwd: __dirname,
      port: API_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        KICKBALL_DB: TEST_DB,
        KICKBALL_TEST_USER: 'manager@example.com',
        KICKBALL_ADMIN_EMAILS: 'manager@example.com',
      },
    },
    {
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: `${__dirname}/web`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { KICKBALL_TEST_PORT: String(API_PORT) },
    },
  ],
});
