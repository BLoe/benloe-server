import { McpSession } from '../services/database.js';
import { ToolName, toolSchemas } from './schemas.js';
import * as yahooApi from '../yahoo/api.js';
import { z } from 'zod';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Execute an MCP tool
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  session: McpSession
): Promise<ToolResult> {
  try {
    // Validate tool exists
    if (!(toolName in toolSchemas)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    // Parse and validate arguments
    const schema = toolSchemas[toolName as ToolName];
    const validatedArgs = schema.parse(args);

    // Execute the appropriate tool
    let result: any;
    switch (toolName) {
      case 'get_fantasy_games':
        result = await yahooApi.getFantasyGames(session);
        break;

      case 'get_fantasy_leagues': {
        const { game_key } = validatedArgs as z.infer<typeof toolSchemas.get_fantasy_leagues>;
        result = await yahooApi.getFantasyLeagues(session, game_key);
        break;
      }

      case 'get_league_details': {
        const { league_key } = validatedArgs as z.infer<typeof toolSchemas.get_league_details>;
        result = await yahooApi.getLeagueDetails(session, league_key);
        break;
      }

      case 'get_league_settings': {
        const { league_key } = validatedArgs as z.infer<typeof toolSchemas.get_league_settings>;
        result = await yahooApi.getLeagueSettings(session, league_key);
        break;
      }

      case 'get_league_standings': {
        const { league_key } = validatedArgs as z.infer<typeof toolSchemas.get_league_standings>;
        result = await yahooApi.getLeagueStandings(session, league_key);
        break;
      }

      case 'get_league_scoreboard': {
        const { league_key, week } = validatedArgs as z.infer<typeof toolSchemas.get_league_scoreboard>;
        result = await yahooApi.getLeagueScoreboard(session, league_key, week);
        break;
      }

      case 'get_my_teams': {
        const { game_key } = validatedArgs as z.infer<typeof toolSchemas.get_my_teams>;
        result = await yahooApi.getMyTeams(session, game_key);
        break;
      }

      case 'get_team_roster': {
        const { team_key } = validatedArgs as z.infer<typeof toolSchemas.get_team_roster>;
        result = await yahooApi.getTeamRoster(session, team_key);
        break;
      }

      case 'get_team_stats': {
        const { team_key } = validatedArgs as z.infer<typeof toolSchemas.get_team_stats>;
        result = await yahooApi.getTeamStats(session, team_key);
        break;
      }

      case 'get_player_stats': {
        const { player_key } = validatedArgs as z.infer<typeof toolSchemas.get_player_stats>;
        result = await yahooApi.getPlayerStats(session, player_key);
        break;
      }

      case 'get_free_agents': {
        const { league_key, count, position } = validatedArgs as z.infer<typeof toolSchemas.get_free_agents>;
        result = await yahooApi.getFreeAgents(session, league_key, count, position);
        break;
      }

      case 'yahoo_proxy': {
        const { endpoint } = validatedArgs as z.infer<typeof toolSchemas.yahoo_proxy>;
        result = await yahooApi.yahooProxy(session, endpoint);
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: `Tool not implemented: ${toolName}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    console.error(`Tool ${toolName} error:`, error);
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}

/**
 * Get tool definitions for MCP tools/list
 */
export function getToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Object.entries(toolSchemas).map(([name, schema]) => {
    // Convert Zod schema to JSON Schema
    const jsonSchema = zodToJsonSchema(schema);

    return {
      name,
      description: schema.description || name,
      inputSchema: jsonSchema,
    };
  });
}

/**
 * Simple Zod to JSON Schema converter
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: 'object',
    properties: {},
    required: [] as string[],
  };

  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodTypeAny;
      properties[key] = zodPropertyToJsonSchema(zodValue);

      // Check if optional
      if (!(zodValue instanceof z.ZodOptional) && !(zodValue instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    result.properties = properties;
    result.required = required;
  }

  return result;
}

function zodPropertyToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Handle optional
  if (schema instanceof z.ZodOptional) {
    return zodPropertyToJsonSchema(schema._def.innerType);
  }

  // Handle default
  if (schema instanceof z.ZodDefault) {
    const inner = zodPropertyToJsonSchema(schema._def.innerType);
    inner.default = schema._def.defaultValue();
    return inner;
  }

  // Handle string
  if (schema instanceof z.ZodString) {
    result.type = 'string';
  }

  // Handle number
  if (schema instanceof z.ZodNumber) {
    result.type = 'number';
  }

  // Handle boolean
  if (schema instanceof z.ZodBoolean) {
    result.type = 'boolean';
  }

  // Add description if present
  if (schema.description) {
    result.description = schema.description;
  }

  return result;
}
