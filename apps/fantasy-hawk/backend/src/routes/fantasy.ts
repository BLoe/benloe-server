import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { yahooOAuthService } from '../services/yahoo-oauth';
import { getYahooTokens, saveYahooTokens } from '../services/database';

const router = Router();

const YAHOO_FANTASY_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

/**
 * Helper function to get valid access token (refreshing if needed)
 */
async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = getYahooTokens(userId);

  if (!tokens) {
    throw new Error('Yahoo account not connected');
  }

  // Check if token is expired or will expire in next 5 minutes
  const now = Date.now();
  const expiryBuffer = 5 * 60 * 1000; // 5 minutes

  if (now + expiryBuffer >= tokens.tokenExpires) {
    console.log('Access token expired, refreshing...');

    // Refresh the token
    const refreshedTokens = await yahooOAuthService.refreshAccessToken(tokens.refreshToken);

    // Update database
    saveYahooTokens({
      userId,
      accessToken: refreshedTokens.accessToken,
      refreshToken: refreshedTokens.refreshToken,
      tokenExpires: now + refreshedTokens.expiresIn * 1000,
      createdAt: tokens.createdAt,
      updatedAt: now,
    });

    console.log('Access token refreshed successfully');
    return refreshedTokens.accessToken;
  }

  return tokens.accessToken;
}

/**
 * Helper function to make authenticated Yahoo API request
 */
async function makeYahooRequest(userId: string, endpoint: string): Promise<any> {
  const accessToken = await getValidAccessToken(userId);
  const url = `${YAHOO_FANTASY_BASE_URL}${endpoint}`;

  return yahooOAuthService.makeAuthenticatedRequest(url, accessToken);
}

/**
 * Get user's games (seasons they've participated in)
 */
router.get('/games', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = await makeYahooRequest(user.id, '/users;use_login=1/games');

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy games error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch games',
    });
  }
});

/**
 * Get user's leagues for a specific game
 * Query params: game_key (e.g., 'nba' or '428' for 2024-2025 NBA season)
 */
router.get('/leagues', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { game_key } = req.query;

    let endpoint = '/users;use_login=1/games;game_keys=nba/leagues';
    if (game_key) {
      endpoint = `/users;use_login=1/games;game_keys=${game_key}/leagues`;
    }

    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy leagues error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch leagues',
    });
  }
});

/**
 * Get league details including teams
 * Params: league_key (e.g., '428.l.12345')
 */
router.get('/leagues/:league_key', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    const endpoint = `/league/${league_key}`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy league details error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch league details',
    });
  }
});

/**
 * Get league settings (includes stat categories)
 */
router.get('/leagues/:league_key/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    const endpoint = `/league/${league_key}/settings`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy settings error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch league settings',
    });
  }
});

/**
 * Get league standings
 */
router.get('/leagues/:league_key/standings', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    const endpoint = `/league/${league_key}/standings`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy standings error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch standings',
    });
  }
});

/**
 * Get user's teams
 */
router.get('/teams', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { game_key } = req.query;

    let endpoint = '/users;use_login=1/games;game_keys=nba/teams';
    if (game_key) {
      endpoint = `/users;use_login=1/games;game_keys=${game_key}/teams`;
    }

    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy teams error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch teams',
    });
  }
});

/**
 * Get team roster
 */
router.get('/teams/:team_key/roster', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { team_key } = req.params;

    const endpoint = `/team/${team_key}/roster`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy roster error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch roster',
    });
  }
});

/**
 * Get team stats
 */
router.get('/teams/:team_key/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { team_key } = req.params;

    const endpoint = `/team/${team_key}/stats`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy team stats error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch team stats',
    });
  }
});

/**
 * Get player stats
 */
router.get('/players/:player_key/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { player_key } = req.params;

    const endpoint = `/player/${player_key}/stats`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy player stats error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch player stats',
    });
  }
});

/**
 * Get league scoreboard (current week's matchups)
 */
router.get('/leagues/:league_key/scoreboard', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { week } = req.query;

    let endpoint = `/league/${league_key}/scoreboard`;
    if (week) {
      endpoint += `;week=${week}`;
    }

    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy scoreboard error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch scoreboard',
    });
  }
});

/**
 * Get team category stats for a given timespan
 * timespan: 'thisWeek' | 'last3Weeks' | 'season'
 */
router.get('/leagues/:league_key/category-stats', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { timespan = 'thisWeek' } = req.query;

    // First get league info to know current week
    const leagueEndpoint = `/league/${league_key}`;
    const leagueData = await makeYahooRequest(user.id, leagueEndpoint);
    const leagueInfo = leagueData?.fantasy_content?.league?.[0];
    const currentWeek = parseInt(leagueInfo?.current_week || '1', 10);

    let result: any;

    if (timespan === 'season') {
      // Use standings for season totals
      const standingsEndpoint = `/league/${league_key}/standings`;
      const standingsData = await makeYahooRequest(user.id, standingsEndpoint);
      result = {
        timespan: 'season',
        currentWeek,
        weeksIncluded: Array.from({ length: currentWeek }, (_, i) => i + 1),
        data: standingsData
      };
    } else {
      // Determine which weeks to fetch
      let weeksToFetch: number[];
      if (timespan === 'last3Weeks') {
        weeksToFetch = [];
        for (let w = Math.max(1, currentWeek - 2); w <= currentWeek; w++) {
          weeksToFetch.push(w);
        }
      } else {
        // thisWeek
        weeksToFetch = [currentWeek];
      }

      // Fetch scoreboard for each week
      const weeklyData: any[] = [];
      for (const week of weeksToFetch) {
        const scoreboardEndpoint = `/league/${league_key}/scoreboard;week=${week}`;
        const scoreboardData = await makeYahooRequest(user.id, scoreboardEndpoint);
        weeklyData.push({
          week,
          data: scoreboardData
        });
      }

      result = {
        timespan,
        currentWeek,
        weeksIncluded: weeksToFetch,
        weeklyData
      };
    }

    res.json(result);
  } catch (error: any) {
    console.error('Category stats error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch category stats',
    });
  }
});

/**
 * Debug endpoint to dump any endpoint response to a file for analysis
 */
router.get('/debug/dump/:type/:league_key', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { type, league_key } = req.params;
    const { week } = req.query;
    const fs = await import('fs/promises');
    const path = await import('path');

    let endpoint: string;
    switch (type) {
      case 'settings':
        endpoint = `/league/${league_key}/settings`;
        break;
      case 'standings':
        endpoint = `/league/${league_key}/standings`;
        break;
      case 'scoreboard':
        endpoint = `/league/${league_key}/scoreboard${week ? `;week=${week}` : ''}`;
        break;
      default:
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    const data = await makeYahooRequest(user.id, endpoint);

    const dumpPath = path.join('/var/apps/fantasy-hawk', 'api-dumps');
    await fs.mkdir(dumpPath, { recursive: true });

    const filename = `${type}-${league_key.replace(/\./g, '-')}${week ? `-week${week}` : ''}-${Date.now()}.json`;
    const filePath = path.join(dumpPath, filename);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    console.log(`Dumped ${type} to ${filePath}`);
    res.json({ success: true, file: filePath, endpoint });
  } catch (error: any) {
    console.error('Debug dump error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Legacy: Debug endpoint to dump settings (keeping for backwards compat)
 */
router.get('/debug/dump-settings/:league_key', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const fs = await import('fs/promises');
    const path = await import('path');

    const endpoint = `/league/${league_key}/settings`;
    const data = await makeYahooRequest(user.id, endpoint);

    const dumpPath = path.join('/var/apps/fantasy-hawk', 'api-dumps');
    await fs.mkdir(dumpPath, { recursive: true });

    const filename = `settings-${league_key.replace(/\./g, '-')}-${Date.now()}.json`;
    const filePath = path.join(dumpPath, filename);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    console.log(`Dumped settings to ${filePath}`);
    res.json({ success: true, file: filePath, endpoint });
  } catch (error: any) {
    console.error('Debug dump error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Debug endpoint to see raw standings response
 */
router.get('/debug/standings/:league_key', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    const endpoint = `/league/${league_key}/standings`;
    const data = await makeYahooRequest(user.id, endpoint);

    res.json({ raw: data, endpoint });
  } catch (error: any) {
    console.error('Debug standings error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Debug endpoint to see raw teams response
 */
router.get('/debug/teams', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { game_key } = req.query;

    let endpoint = '/users;use_login=1/games;game_keys=nba/teams';
    if (game_key) {
      endpoint = `/users;use_login=1/games;game_keys=${game_key}/teams`;
    }

    const data = await makeYahooRequest(user.id, endpoint);

    res.json({ raw: data, endpoint });
  } catch (error: any) {
    console.error('Debug teams error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generic proxy endpoint for any Yahoo Fantasy API request
 * Useful for testing and custom queries
 */
router.get('/proxy', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { endpoint } = req.query;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Endpoint parameter required' });
    }

    const data = await makeYahooRequest(user.id, endpoint);

    res.json(data);
  } catch (error: any) {
    console.error('Fantasy proxy error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch data',
    });
  }
});

export const fantasyRoutes = router;
