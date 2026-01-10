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

  // Streaming optimizer
  streaming: {
    tab: '[data-testid="streaming-tab"]',
    page: '[data-testid="streaming-page"]',
    noLeague: '[data-testid="streaming-no-league"]',
    error: '[data-testid="streaming-error"]',
    scheduleGridPanel: '[data-testid="streaming-schedule-grid-panel"]',
    scheduleGrid: '[data-testid="schedule-grid"]',
    scheduleGridEmpty: '[data-testid="schedule-grid-empty"]',
    scheduleGridLoading: '[data-testid="schedule-grid-loading"]',
    candidatesPanel: '[data-testid="streaming-candidates-panel"]',
    candidatesTable: '[data-testid="candidates-table"]',
    candidatesEmpty: '[data-testid="candidates-empty"]',
    candidatesLoading: '[data-testid="candidates-loading"]',
    candidatesPositionFilter: '[data-testid="candidates-position-filter"]',
    recommendationsPanel: '[data-testid="streaming-recommendations-panel"]',
    recommendations: '[data-testid="recommendations-panel"]',
    recommendationsEmpty: '[data-testid="recommendations-empty"]',
    recommendationsLoading: '[data-testid="recommendations-loading"]',
    recommendationsError: '[data-testid="recommendations-error"]',
  },

  // Matchup center
  matchup: {
    tab: '[data-testid="matchup-tab"]',
    page: '[data-testid="matchup-page"]',
    noLeague: '[data-testid="matchup-no-league"]',
    error: '[data-testid="matchup-error"]',
    scoreboard: '[data-testid="matchup-scoreboard"]',
    scoreboardLoading: '[data-testid="matchup-scoreboard-loading"]',
    byeWeek: '[data-testid="matchup-bye-week"]',
    refresh: '[data-testid="matchup-refresh"]',
    toggleCategoryBreakdown: '[data-testid="toggle-category-breakdown"]',
    categoryBreakdown: '[data-testid="category-breakdown"]',
    projectionsPanel: '[data-testid="projections-panel"]',
    projectionsLoading: '[data-testid="projections-loading"]',
    projectionsError: '[data-testid="projections-error"]',
    projectionsEmpty: '[data-testid="projections-empty"]',
  },

  // AI Chat
  chat: {
    tab: '[data-testid="chat-tab"]',
    page: '[data-testid="chat-page"]',
    noLeague: '[data-testid="chat-no-league"]',
    noKey: '[data-testid="chat-no-key"]',
    panel: '[data-testid="chat-panel"]',
    input: '[data-testid="chat-input"]',
    send: '[data-testid="chat-send"]',
  },

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
