import { z } from 'zod';

// Tool input schemas

export const GetFantasyGamesSchema = z.object({}).describe('Get the user\'s fantasy game seasons');

export const GetFantasyLeaguesSchema = z.object({
  game_key: z.string().optional().default('nba')
    .describe('Game key (e.g., "nba" or "428" for 2024-2025 NBA season). Defaults to "nba"'),
}).describe('Get leagues for a specific game/season');

export const GetLeagueDetailsSchema = z.object({
  league_key: z.string()
    .describe('League key (e.g., "428.l.12345")'),
}).describe('Get detailed information about a league');

export const GetLeagueSettingsSchema = z.object({
  league_key: z.string()
    .describe('League key (e.g., "428.l.12345")'),
}).describe('Get league settings including stat categories');

export const GetLeagueStandingsSchema = z.object({
  league_key: z.string()
    .describe('League key (e.g., "428.l.12345")'),
}).describe('Get current league standings');

export const GetLeagueScoreboardSchema = z.object({
  league_key: z.string()
    .describe('League key (e.g., "428.l.12345")'),
  week: z.number().optional()
    .describe('Week number. Defaults to current week if not specified'),
}).describe('Get matchups for a week');

export const GetMyTeamsSchema = z.object({
  game_key: z.string().optional().default('nba')
    .describe('Game key to filter by. Defaults to "nba"'),
}).describe('Get the user\'s teams across leagues');

export const GetTeamRosterSchema = z.object({
  team_key: z.string()
    .describe('Team key (e.g., "428.l.12345.t.1")'),
}).describe('Get a team\'s current roster');

export const GetTeamStatsSchema = z.object({
  team_key: z.string()
    .describe('Team key (e.g., "428.l.12345.t.1")'),
}).describe('Get a team\'s season stats');

export const GetPlayerStatsSchema = z.object({
  player_key: z.string()
    .describe('Player key (e.g., "428.p.5007")'),
}).describe('Get individual player stats');

export const GetFreeAgentsSchema = z.object({
  league_key: z.string()
    .describe('League key (e.g., "428.l.12345")'),
  count: z.number().optional().default(50)
    .describe('Number of free agents to return (max 50)'),
  position: z.string().optional()
    .describe('Filter by position (e.g., "PG", "SF", "C")'),
}).describe('Get available free agents in a league');

export const YahooProxySchema = z.object({
  endpoint: z.string()
    .describe('Yahoo Fantasy API endpoint path (e.g., "/league/428.l.12345/standings")'),
}).describe('Make a direct request to any Yahoo Fantasy API endpoint');

// Export all schemas as a map
export const toolSchemas = {
  get_fantasy_games: GetFantasyGamesSchema,
  get_fantasy_leagues: GetFantasyLeaguesSchema,
  get_league_details: GetLeagueDetailsSchema,
  get_league_settings: GetLeagueSettingsSchema,
  get_league_standings: GetLeagueStandingsSchema,
  get_league_scoreboard: GetLeagueScoreboardSchema,
  get_my_teams: GetMyTeamsSchema,
  get_team_roster: GetTeamRosterSchema,
  get_team_stats: GetTeamStatsSchema,
  get_player_stats: GetPlayerStatsSchema,
  get_free_agents: GetFreeAgentsSchema,
  yahoo_proxy: YahooProxySchema,
} as const;

export type ToolName = keyof typeof toolSchemas;
