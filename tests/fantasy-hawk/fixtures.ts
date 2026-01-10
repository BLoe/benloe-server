/**
 * Test fixtures and constants for Fantasy Hawk e2e tests
 */

export const URLS = {
  home: '/',
  api: {
    status: '/api/oauth/status',
    leagues: '/api/fantasy/leagues',
    settings: (leagueKey: string) => `/api/fantasy/leagues/${leagueKey}/settings`,
    standings: (leagueKey: string) => `/api/fantasy/leagues/${leagueKey}/standings`,
    scoreboard: (leagueKey: string) => `/api/fantasy/leagues/${leagueKey}/scoreboard`,
  },
} as const;

export const SELECTORS = {
  // Header elements
  header: '[data-testid="header"]',
  logo: '[data-testid="logo"]',

  // Auth elements
  connectButton: '[data-testid="connect-yahoo"]',
  disconnectButton: '[data-testid="disconnect-yahoo"]',

  // Dashboard elements
  dashboard: '[data-testid="dashboard"]',
  leagueSelector: '[data-testid="league-selector"]',

  // Category analysis
  categoryTable: '[data-testid="category-table"]',
  categoryRow: '[data-testid="category-row"]',

  // Loading states
  loadingSpinner: '[data-testid="loading"]',
  errorMessage: '[data-testid="error"]',

  // Generic
  button: (name: string) => `button:has-text("${name}")`,
  link: (name: string) => `a:has-text("${name}")`,
} as const;

export const TEST_TIMEOUTS = {
  short: 5000,
  medium: 10000,
  long: 30000,
  apiCall: 15000,
} as const;
