import { config as dotenvConfig } from 'dotenv';

// Load from monorepo .env
dotenvConfig({ path: '/srv/benloe/.env' });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('PORT', '3006'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // MCP Server URLs
  mcpServerUrl: optionalEnv('MCP_SERVER_URL', 'https://yahoomcp.benloe.com'),
  mcpYahooCallbackUrl: optionalEnv('MCP_YAHOO_CALLBACK_URL', 'https://yahoomcp.benloe.com/yahoo/callback'),

  // Yahoo OAuth (reuse from Fantasy Hawk)
  yahooClientId: requireEnv('YAHOO_CLIENT_ID'),
  yahooClientSecret: requireEnv('YAHOO_CLIENT_SECRET'),

  // Security
  mcpTokenEncryptionKey: requireEnv('MCP_TOKEN_ENCRYPTION_KEY'),
  mcpTokenSecret: requireEnv('MCP_TOKEN_SECRET'),

  // Database
  databasePath: optionalEnv('DATABASE_PATH', '/srv/benloe/data/yahoo-fantasy-mcp.db'),

  // Token lifetimes (in seconds)
  accessTokenTtl: 3600,           // 1 hour
  refreshTokenTtl: 30 * 24 * 3600, // 30 days
  authCodeTtl: 600,               // 10 minutes
  pkceStateTtl: 600,              // 10 minutes

  // Claude's OAuth callback
  claudeCallbackUrl: 'https://claude.ai/api/mcp/auth_callback',
} as const;

export type Config = typeof config;
