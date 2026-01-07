import { v4 as uuidv4 } from 'uuid';
import { generateToken } from '../services/crypto.js';
import {
  createSession,
  getSessionByAccessToken,
  getSessionByRefreshToken,
  updateSessionTokens,
  deleteSession,
  McpSession,
} from '../services/database.js';
import { config } from '../config.js';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

export interface TokenError {
  error: string;
  error_description: string;
}

/**
 * Issue new MCP tokens for a session
 */
export function issueTokens(
  clientId: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number,
  scope?: string
): TokenResponse {
  const sessionId = uuidv4();
  const accessToken = generateToken(32);
  const refreshToken = generateToken(32);

  createSession(
    sessionId,
    clientId,
    accessToken,
    refreshToken,
    yahooAccessToken,
    yahooRefreshToken,
    yahooExpiresAt
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtl,
    refresh_token: refreshToken,
    scope: scope || 'fantasy',
  };
}

/**
 * Refresh MCP tokens using a refresh token
 */
export function refreshTokens(
  currentRefreshToken: string,
  yahooAccessToken: string,
  yahooRefreshToken: string,
  yahooExpiresAt: number
): TokenResponse | TokenError {
  const session = getSessionByRefreshToken(currentRefreshToken);

  if (!session) {
    return {
      error: 'invalid_grant',
      error_description: 'Invalid refresh token',
    };
  }

  // Check if refresh token is expired
  if (Date.now() > session.refreshTokenExpiresAt) {
    deleteSession(session.id);
    return {
      error: 'invalid_grant',
      error_description: 'Refresh token expired',
    };
  }

  // Generate new tokens
  const newAccessToken = generateToken(32);
  const newRefreshToken = generateToken(32);

  updateSessionTokens(
    session.id,
    newAccessToken,
    newRefreshToken,
    yahooAccessToken,
    yahooRefreshToken,
    yahooExpiresAt
  );

  return {
    access_token: newAccessToken,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtl,
    refresh_token: newRefreshToken,
    scope: 'fantasy',
  };
}

/**
 * Validate an access token and return the session
 */
export function validateAccessToken(accessToken: string): McpSession | TokenError {
  const session = getSessionByAccessToken(accessToken);

  if (!session) {
    return {
      error: 'invalid_token',
      error_description: 'Invalid access token',
    };
  }

  // Check if access token is expired
  if (Date.now() > session.accessTokenExpiresAt) {
    return {
      error: 'invalid_token',
      error_description: 'Access token expired',
    };
  }

  return session;
}

/**
 * Check if a response is a token error
 */
export function isTokenError(response: any): response is TokenError {
  return response && typeof response.error === 'string';
}
