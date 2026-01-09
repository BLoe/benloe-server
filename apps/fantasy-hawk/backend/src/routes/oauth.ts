import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { yahooOAuthService } from '../services/yahoo-oauth';
import {
  saveOAuthState,
  getOAuthState,
  deleteOAuthState,
  saveYahooTokens,
  getYahooTokens,
  deleteYahooTokens,
} from '../services/database';

const router = Router();

/**
 * Step 1: Initiate OAuth 2.0 flow
 * User clicks "Connect Yahoo Account" button
 */
router.get('/connect', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state temporarily with user ID
    saveOAuthState(state, user.id);

    // Redirect user to Yahoo authorization page
    const authUrl = yahooOAuthService.getAuthorizationUrl(state);
    console.log('Redirecting to Yahoo OAuth:', authUrl);

    res.redirect(authUrl);
  } catch (error) {
    console.error('OAuth connect error:', error);
    res.status(500).json({ error: 'Failed to initiate Yahoo authentication' });
  }
});

/**
 * Step 2: OAuth callback
 * Yahoo redirects here after user authorizes
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}?error=missing_params`);
    }

    // Verify state to prevent CSRF
    const storedState = getOAuthState(state as string);

    if (!storedState || !storedState.userId) {
      return res.redirect(`${process.env.FRONTEND_URL}?error=invalid_state`);
    }

    console.log('Exchanging OAuth code for tokens...');

    // Exchange authorization code for access token
    const tokens = await yahooOAuthService.getAccessToken(code as string);

    // Save tokens to database
    const now = Date.now();
    saveYahooTokens({
      userId: storedState.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpires: now + tokens.expiresIn * 1000,
      createdAt: now,
      updatedAt: now,
    });

    // Clean up state
    deleteOAuthState(state as string);

    console.log('Yahoo OAuth successful for user:', storedState.userId);

    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL}?oauth=success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}?error=oauth_failed`);
  }
});

/**
 * Check if user has connected Yahoo account
 */
router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tokens = getYahooTokens(user.id);

    res.json({
      connected: !!tokens,
      expiresAt: tokens?.tokenExpires,
      role: user.role,
    });
  } catch (error) {
    console.error('OAuth status error:', error);
    res.status(500).json({ error: 'Failed to check OAuth status' });
  }
});

/**
 * Disconnect Yahoo account
 */
router.post('/disconnect', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    deleteYahooTokens(user.id);

    res.json({ success: true, message: 'Yahoo account disconnected' });
  } catch (error) {
    console.error('OAuth disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Yahoo account' });
  }
});

export const oauthRoutes = router;
