import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { generateToken } from '../services/crypto.js';
import {
  savePkceState,
  getPkceState,
  deletePkceState,
  saveAuthCode,
  getAuthCode,
  deleteAuthCode,
  getSessionByRefreshToken,
} from '../services/database.js';
import { registerClient, validateClient, isDcrError } from './dcr.js';
import { verifyPkce, isValidCodeChallenge } from './pkce.js';
import { issueTokens, refreshTokens, isTokenError } from './tokens.js';
import { yahooOAuthService } from '../yahoo/oauth.js';

const router = Router();

/**
 * OAuth 2.0 Authorization Server Metadata
 * RFC 8414
 */
router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  res.json({
    issuer: config.mcpServerUrl,
    authorization_endpoint: `${config.mcpServerUrl}/authorize`,
    token_endpoint: `${config.mcpServerUrl}/token`,
    registration_endpoint: `${config.mcpServerUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['fantasy'],
  });
});

/**
 * Dynamic Client Registration
 * RFC 7591
 */
router.post('/register', (req: Request, res: Response) => {
  console.log('DCR request:', JSON.stringify(req.body, null, 2));

  const result = registerClient(req.body);

  if (isDcrError(result)) {
    return res.status(400).json(result);
  }

  res.status(201).json(result);
});

/**
 * Authorization Endpoint
 * Initiates OAuth flow by redirecting to Yahoo
 */
router.get('/authorize', (req: Request, res: Response) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    state,
    scope,
  } = req.query;

  console.log('Authorization request:', {
    client_id,
    redirect_uri,
    response_type,
    code_challenge: code_challenge ? 'present' : 'missing',
    code_challenge_method,
    state: state ? 'present' : 'missing',
  });

  // Validate required parameters
  if (!client_id || typeof client_id !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'client_id is required',
    });
  }

  if (!redirect_uri || typeof redirect_uri !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'redirect_uri is required',
    });
  }

  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported',
    });
  }

  // PKCE is required
  if (!code_challenge || typeof code_challenge !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge is required (PKCE)',
    });
  }

  if (code_challenge_method !== 'S256') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256',
    });
  }

  if (!isValidCodeChallenge(code_challenge)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid code_challenge format',
    });
  }

  // Validate client
  const clientResult = validateClient(client_id, undefined, redirect_uri);
  if (isDcrError(clientResult)) {
    return res.status(400).json(clientResult);
  }

  // Generate a unique state that maps to this MCP auth request
  // We'll use this to track the request through the Yahoo OAuth flow
  const mcpState = generateToken(16);

  // Store PKCE state
  savePkceState(
    mcpState,
    client_id,
    code_challenge,
    'S256',
    redirect_uri,
    typeof scope === 'string' ? scope : null
  );

  // Store the original client state (from Claude) so we can return it after Yahoo auth
  // We encode both our internal state and Claude's state together
  const combinedState = JSON.stringify({
    mcp: mcpState,
    client: state || '',
  });
  const encodedState = Buffer.from(combinedState).toString('base64url');

  // Redirect to Yahoo OAuth
  const yahooAuthUrl = yahooOAuthService.getAuthorizationUrl(encodedState);
  console.log('Redirecting to Yahoo OAuth...');

  res.redirect(yahooAuthUrl);
});

/**
 * Yahoo OAuth Callback
 * Handles the callback from Yahoo and completes the MCP OAuth flow
 */
router.get('/yahoo/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  console.log('Yahoo callback:', {
    code: code ? 'present' : 'missing',
    state: state ? 'present' : 'missing',
    error,
  });

  // Handle Yahoo OAuth errors
  if (error) {
    console.error('Yahoo OAuth error:', error, error_description);
    return res.status(400).json({
      error: 'access_denied',
      error_description: `Yahoo OAuth error: ${error_description || error}`,
    });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing authorization code from Yahoo',
    });
  }

  if (!state || typeof state !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing state parameter',
    });
  }

  // Decode the combined state
  let mcpState: string;
  let clientState: string;
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    mcpState = parsed.mcp;
    clientState = parsed.client;
  } catch (e) {
    console.error('Failed to decode state:', e);
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid state parameter',
    });
  }

  // Look up the PKCE state
  const pkceState = getPkceState(mcpState);
  if (!pkceState) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Unknown or expired state',
    });
  }

  // Check if state is expired
  if (Date.now() > pkceState.expiresAt) {
    deletePkceState(mcpState);
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'State expired',
    });
  }

  try {
    // Exchange Yahoo code for tokens
    const yahooTokens = await yahooOAuthService.getAccessToken(code);
    console.log('Got Yahoo tokens, expires at:', new Date(yahooTokens.expiresAt).toISOString());

    // Generate MCP authorization code
    const mcpAuthCode = generateToken(16);

    // Store the auth code with Yahoo tokens (encrypted)
    saveAuthCode(
      mcpAuthCode,
      pkceState.clientId,
      pkceState.codeChallenge,
      pkceState.codeChallengeMethod,
      pkceState.redirectUri,
      yahooTokens.accessToken,
      yahooTokens.refreshToken,
      yahooTokens.expiresAt
    );

    // Clean up PKCE state
    deletePkceState(mcpState);

    // Redirect back to client with the MCP authorization code
    const redirectUrl = new URL(pkceState.redirectUri);
    redirectUrl.searchParams.set('code', mcpAuthCode);
    if (clientState) {
      redirectUrl.searchParams.set('state', clientState);
    }

    console.log('Redirecting to client with auth code...');
    res.redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error('Yahoo token exchange error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to exchange Yahoo authorization code',
    });
  }
});

/**
 * Token Endpoint
 * Exchange authorization code for tokens, or refresh tokens
 */
router.post('/token', async (req: Request, res: Response) => {
  const { grant_type, code, code_verifier, redirect_uri, client_id, client_secret, refresh_token } =
    req.body;

  console.log('Token request:', {
    grant_type,
    code: code ? 'present' : 'missing',
    code_verifier: code_verifier ? 'present' : 'missing',
    redirect_uri,
    client_id,
    refresh_token: refresh_token ? 'present' : 'missing',
  });

  if (grant_type === 'authorization_code') {
    // Validate required parameters
    if (!code || !code_verifier || !client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code, code_verifier, and client_id are required',
      });
    }

    // Validate client
    const clientResult = validateClient(client_id, client_secret);
    if (isDcrError(clientResult)) {
      return res.status(401).json(clientResult);
    }

    // Get auth code
    const authCode = getAuthCode(code);
    if (!authCode) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code',
      });
    }

    // Check if code is expired
    if (Date.now() > authCode.expiresAt) {
      deleteAuthCode(code);
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Authorization code expired',
      });
    }

    // Verify client matches
    if (authCode.clientId !== client_id) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Client mismatch',
      });
    }

    // Verify redirect_uri if provided
    if (redirect_uri && redirect_uri !== authCode.redirectUri) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'redirect_uri mismatch',
      });
    }

    // Verify PKCE
    if (!verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier',
      });
    }

    // Delete the auth code (single use)
    deleteAuthCode(code);

    // Issue tokens
    const tokens = issueTokens(
      client_id,
      authCode.yahooAccessToken,
      authCode.yahooRefreshToken,
      authCode.yahooExpiresAt
    );

    console.log('Issued MCP tokens for client:', client_id);
    return res.json(tokens);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token || !client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'refresh_token and client_id are required',
      });
    }

    // Validate client
    const clientResult = validateClient(client_id, client_secret);
    if (isDcrError(clientResult)) {
      return res.status(401).json(clientResult);
    }

    // Get current session to access Yahoo tokens
    const session = getSessionByRefreshToken(refresh_token);
    if (!session) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid refresh token',
      });
    }

    // Verify client matches
    if (session.clientId !== client_id) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Client mismatch',
      });
    }

    // Check if Yahoo tokens need refreshing
    let yahooAccessToken = session.yahooAccessToken;
    let yahooRefreshToken = session.yahooRefreshToken;
    let yahooExpiresAt = session.yahooExpiresAt;

    const refreshBuffer = 5 * 60 * 1000; // 5 minutes
    if (Date.now() + refreshBuffer >= yahooExpiresAt) {
      console.log('Refreshing Yahoo tokens...');
      try {
        const newYahooTokens = await yahooOAuthService.refreshAccessToken(yahooRefreshToken);
        yahooAccessToken = newYahooTokens.accessToken;
        yahooRefreshToken = newYahooTokens.refreshToken;
        yahooExpiresAt = newYahooTokens.expiresAt;
        console.log('Yahoo tokens refreshed');
      } catch (error) {
        console.error('Failed to refresh Yahoo tokens:', error);
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Failed to refresh Yahoo authorization',
        });
      }
    }

    // Refresh MCP tokens
    const tokens = refreshTokens(refresh_token, yahooAccessToken, yahooRefreshToken, yahooExpiresAt);

    if (isTokenError(tokens)) {
      return res.status(400).json(tokens);
    }

    console.log('Refreshed MCP tokens for client:', client_id);
    return res.json(tokens);
  } else {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code and refresh_token grant types are supported',
    });
  }
});

export const oauthRouter = router;
