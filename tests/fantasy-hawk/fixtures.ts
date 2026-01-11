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

  // Trade Analyzer
  trade: {
    tab: '[data-testid="trade-tab"]',
    page: '[data-testid="trade-analyzer-page"]',
    noLeague: '[data-testid="trade-no-league"]',
    builder: '[data-testid="trade-builder"]',
    partnerSelect: '[data-testid="trade-partner-select"]',
    givePanel: '[data-testid="trade-builder-give-panel"]',
    receivePanel: '[data-testid="trade-builder-receive-panel"]',
    analyzeBtn: '[data-testid="analyze-trade-btn"]',
    resetBtn: '[data-testid="trade-reset-button"]',
    analysisResult: '[data-testid="trade-analysis-result"]',
    fairnessMeter: '[data-testid="trade-fairness-meter"]',
    categoryImpact: '[data-testid="trade-category-impact"]',
    tradeImpact: '[data-testid="trade-impact"]',
  },

  // Punt Engine
  punt: {
    tab: '[data-testid="punt-tab"]',
    page: '[data-testid="punt-page"]',
    noLeague: '[data-testid="punt-no-league"]',
    error: '[data-testid="punt-error"]',
    empty: '[data-testid="punt-empty"]',
    analyzer: '[data-testid="punt-analyzer"]',
    currentBuild: '[data-testid="punt-current-build"]',
    categoryRanks: '[data-testid="punt-category-ranks"]',
    archetypes: '[data-testid="punt-archetypes"]',
    archetypesPanel: '[data-testid="archetypes-panel"]',
  },

  // League Insights
  insights: {
    tab: '[data-testid="insights-tab"]',
    page: '[data-testid="league-insights-page"]',
    noLeague: '[data-testid="insights-no-league"]',
    error: '[data-testid="insights-error"]',
    empty: '[data-testid="insights-empty"]',
    settings: '[data-testid="league-settings"]',
    settingsOverview: '[data-testid="league-settings-overview"]',
    categoriesTable: '[data-testid="league-categories-table"]',
    settingsInsights: '[data-testid="league-settings-insights"]',
    missingCategories: '[data-testid="league-missing-categories"]',
    standardReference: '[data-testid="league-standard-reference"]',
    recommendation: '[data-testid="league-recommendation"]',
    categoryImportance: '[data-testid="category-importance"]',
    positionalValue: '[data-testid="positional-value"]',
    exploitableEdges: '[data-testid="exploitable-edges"]',
    customRankings: '[data-testid="custom-rankings"]',
    valueShifts: '[data-testid="league-value-shifts"]',
    adjustedRankings: '[data-testid="league-adjusted-rankings"]',
    rankingsSearch: '[data-testid="league-rankings-search"]',
    rankingsPositionFilter: '[data-testid="league-rankings-position-filter"]',
  },

  // Schedule Planner
  schedule: {
    tab: '[data-testid="schedule-tab"]',
    page: '[data-testid="schedule-planner-page"]',
    noLeague: '[data-testid="schedule-no-league"]',
    error: '[data-testid="schedule-error"]',
    empty: '[data-testid="schedule-empty"]',
    heatmap: '[data-testid="schedule-heatmap"]',
    calendar: '[data-testid="schedule-calendar"]',
    weeklyView: '[data-testid="schedule-weekly-view"]',
    rosterStrength: '[data-testid="schedule-roster-strength"]',
    playoffAnalysis: '[data-testid="schedule-playoff-analysis"]',
    playoffError: '[data-testid="schedule-playoff-error"]',
    rosterAnalysis: '[data-testid="schedule-roster-analysis"]',
    bestTeams: '[data-testid="schedule-best-teams"]',
    worstTeams: '[data-testid="schedule-worst-teams"]',
  },

  // Season Outlook
  outlook: {
    tab: '[data-testid="outlook-tab"]',
    page: '[data-testid="season-outlook-page"]',
    noLeague: '[data-testid="outlook-no-league"]',
    error: '[data-testid="outlook-error"]',
    empty: '[data-testid="outlook-empty"]',
    dashboard: '[data-testid="outlook-dashboard"]',
    currentStanding: '[data-testid="outlook-current-standing"]',
    projectedFinish: '[data-testid="outlook-projected-finish"]',
    trend: '[data-testid="outlook-trend"]',
    seasonProgress: '[data-testid="outlook-season-progress"]',
    playoffOdds: '[data-testid="outlook-playoff-odds"]',
    standingsTable: '[data-testid="outlook-standings-table"]',
  },

  // Learning Mode
  learning: {
    toggle: '[data-testid="learning-mode-toggle"]',
    tooltipTrigger: '[data-testid="tooltip-trigger"]',
    tooltip: '[data-testid="tooltip"]',
    glossaryButton: '[data-testid="glossary-button"]',
    glossary: '[data-testid="glossary"]',
    glossarySearch: '[data-testid="glossary-search"]',
    glossaryDefinition: '[data-testid="glossary-definition"]',
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
