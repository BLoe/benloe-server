import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { yahooOAuthService } from '../services/yahoo-oauth';
import { getYahooTokens, saveYahooTokens } from '../services/database';
import { ballDontLieService } from '../services/balldontlie';

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
 * Debug endpoint to dump any raw Yahoo API endpoint to a file
 * Query param: endpoint (the Yahoo API path, e.g., /league/428.l.12345/standings)
 */
router.get('/debug/dump-raw', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { endpoint } = req.query;
    const fs = await import('fs/promises');
    const path = await import('path');

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint query parameter required' });
    }

    const data = await makeYahooRequest(user.id, endpoint);

    // Create a filename from the endpoint
    const sanitizedEndpoint = endpoint
      .replace(/^\//, '')
      .replace(/[\/;=]/g, '-')
      .replace(/\./g, '_')
      .slice(0, 100);

    const dumpPath = path.join('/srv/benloe/apps/fantasy-hawk', 'api-dumps');
    await fs.mkdir(dumpPath, { recursive: true });

    const filename = `${sanitizedEndpoint}-${Date.now()}.json`;
    const filePath = path.join(dumpPath, filename);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    console.log(`Dumped ${endpoint} to ${filePath}`);
    res.json({ success: true, file: filePath, endpoint, data });
  } catch (error: any) {
    console.error('Debug dump-raw error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Debug endpoint to dump any endpoint response to a file for analysis (legacy)
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

    const dumpPath = path.join('/srv/benloe/apps/fantasy-hawk', 'api-dumps');
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

    const dumpPath = path.join('/srv/benloe/apps/fantasy-hawk', 'api-dumps');
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
 * AI Strategy Analysis endpoint
 * Uses Claude to analyze fantasy data and provide recommendations
 */
router.post('/leagues/:league_key/analyze', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { analysisType = 'matchup' } = req.body;

    // Fetch relevant Yahoo data based on analysis type
    const [standingsData, scoreboardData, leagueData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/standings`),
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
    ]);

    // Build context for Claude
    const leagueInfo = leagueData?.fantasy_content?.league?.[0] || {};
    const currentWeek = leagueInfo.current_week || '1';

    // Extract standings
    const standings = standingsData?.fantasy_content?.league?.[1]?.standings?.['0']?.teams || {};

    // Extract scoreboard matchups
    const matchups = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard?.['0']?.matchups || {};

    // Build the prompt based on analysis type
    let systemPrompt = `You are an expert fantasy basketball analyst. You're analyzing data from a Yahoo Fantasy Basketball league.

Current Week: ${currentWeek}
League: ${leagueInfo.name || 'Unknown'}

Provide concise, actionable insights. Use bullet points for recommendations.`;

    let userPrompt = '';

    switch (analysisType) {
      case 'matchup':
        userPrompt = `Analyze this week's matchup data and provide strategic recommendations.

Standings Overview:
${JSON.stringify(standings, null, 2).slice(0, 3000)}

Current Week Matchups:
${JSON.stringify(matchups, null, 2).slice(0, 3000)}

Please provide:
1. Key matchup insights for this week
2. Category battles to focus on
3. Potential punting strategies if behind
4. Quick tips for maximizing chances this week`;
        break;

      case 'categories':
        userPrompt = `Analyze the category stats across the league.

Standings with Stats:
${JSON.stringify(standings, null, 2).slice(0, 4000)}

Please provide:
1. Strongest categories across teams
2. Weakest categories (opportunity areas)
3. Category correlations to exploit
4. Trade targets based on category needs`;
        break;

      case 'streaming':
        userPrompt = `Analyze the current week's matchups and provide streaming recommendations.

Current Week Matchups:
${JSON.stringify(matchups, null, 2).slice(0, 3000)}

Standings:
${JSON.stringify(standings, null, 2).slice(0, 2000)}

Please provide:
1. Categories most likely to be close this week
2. Types of players to target for streaming
3. Schedule considerations (teams with many games)
4. General streaming strategy for the week`;
        break;

      default:
        userPrompt = `Provide a general overview of the league standings and any notable insights.

Data:
${JSON.stringify(standings, null, 2).slice(0, 4000)}`;
    }

    // Call Artanis Claude proxy with streaming
    const AUTH_URL = process.env.AUTH_URL || 'https://auth.benloe.com';

    // Get the user's auth cookie to forward to Artanis
    const cookies = req.headers.cookie || '';

    const claudeResponse = await fetch(`${AUTH_URL}/api/claude/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 1500,
      }),
    });

    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json();
      return res.status(claudeResponse.status).json(errorData);
    }

    // Stream the response back
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (claudeResponse.body) {
      const reader = claudeResponse.body.getReader();

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              break;
            }
            const chunk = new TextDecoder().decode(value);
            res.write(chunk);
          }
        } catch (error) {
          console.error('Stream error:', error);
          res.end();
        }
      };

      req.on('close', () => {
        reader.cancel();
      });

      processStream();
    } else {
      res.status(500).json({ error: 'No response body from Claude' });
    }
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to run analysis',
    });
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

// ============================================================
// NBA Schedule Endpoints (Ball Don't Lie API)
// ============================================================

/**
 * Check if NBA schedule service is available
 */
router.get('/schedule/status', authenticate, async (_req: Request, res: Response) => {
  res.json({
    available: ballDontLieService.isConfigured(),
    message: ballDontLieService.isConfigured()
      ? 'NBA schedule data available'
      : 'Ball Don\'t Lie API key not configured',
  });
});

/**
 * Get NBA games for a date range
 * Query params: start_date, end_date (YYYY-MM-DD)
 */
router.get('/schedule/games', authenticate, async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date required' });
    }

    const games = await ballDontLieService.getGames(
      start_date as string,
      end_date as string
    );

    res.json({ games, count: games.length });
  } catch (error: any) {
    console.error('Schedule games error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get schedule analysis for a fantasy week
 * Includes games per team and games by date
 * Query params: start_date, end_date (YYYY-MM-DD)
 */
router.get('/schedule/analysis', authenticate, async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date required' });
    }

    const analysis = await ballDontLieService.getScheduleAnalysis(
      start_date as string,
      end_date as string
    );

    res.json(analysis);
  } catch (error: any) {
    console.error('Schedule analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get schedule analysis for a league's current week
 * Automatically uses the week dates from the Yahoo scoreboard
 */
router.get('/leagues/:league_key/schedule', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get scoreboard to find current week dates
    const scoreboardData = await makeYahooRequest(user.id, `/league/${league_key}/scoreboard`);
    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;

    if (!scoreboard) {
      return res.status(404).json({ error: 'Could not find scoreboard data' });
    }

    // Get week dates from first matchup
    const firstMatchup = scoreboard['0']?.matchups?.['0']?.matchup;
    const weekStart = firstMatchup?.week_start;
    const weekEnd = firstMatchup?.week_end;
    const week = firstMatchup?.week;

    if (!weekStart || !weekEnd) {
      return res.status(404).json({ error: 'Could not determine week dates' });
    }

    // Get NBA schedule for the week
    const analysis = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);

    res.json({
      week: parseInt(week, 10),
      ...analysis,
    });
  } catch (error: any) {
    console.error('League schedule error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch schedule',
    });
  }
});

/**
 * Get streaming analysis for a league
 * Combines roster data with NBA schedule to identify streaming opportunities
 */
router.get('/leagues/:league_key/streaming', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Fetch Yahoo data in parallel
    const [scoreboardData, rostersData, faData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/roster`),
      makeYahooRequest(user.id, `/league/${league_key}/players;status=FA;count=50`),
    ]);

    // Get week dates
    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    const firstMatchup = scoreboard?.['0']?.matchups?.['0']?.matchup;
    const weekStart = firstMatchup?.week_start;
    const weekEnd = firstMatchup?.week_end;
    const week = firstMatchup?.week;

    if (!weekStart || !weekEnd) {
      return res.status(404).json({ error: 'Could not determine week dates' });
    }

    // Get NBA schedule
    const scheduleAnalysis = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);

    // Parse rosters to get player teams
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;
    const userRoster: any[] = [];
    const teamCount = teams?.count || 0;

    for (let i = 0; i < teamCount; i++) {
      const team = teams?.[i]?.team;
      if (!team) continue;

      // Check if this is the user's team
      const teamProps = team[0] || [];
      let isUserTeam = false;
      for (const prop of teamProps) {
        if (prop?.is_owned_by_current_login === 1) {
          isUserTeam = true;
          break;
        }
      }

      if (isUserTeam) {
        const roster = team[1]?.roster?.['0']?.players;
        if (roster) {
          const playerCount = roster.count || 0;
          for (let p = 0; p < playerCount; p++) {
            const player = roster[p]?.player;
            if (player) {
              // Parse player data
              const playerProps = player[0] || [];
              const playerData: any = {};
              for (const prop of playerProps) {
                if (prop && typeof prop === 'object') {
                  Object.assign(playerData, prop);
                }
              }
              // Get selected position
              const selectedPos = player[1]?.selected_position;
              if (selectedPos) {
                for (const pos of selectedPos) {
                  if (pos?.position) {
                    playerData.selected_position = pos.position;
                  }
                }
              }
              userRoster.push(playerData);
            }
          }
        }
        break;
      }
    }

    // Parse free agents
    const freeAgents: any[] = [];
    const faPlayers = faData?.fantasy_content?.league?.[1]?.players;
    const faCount = faPlayers?.count || 0;
    for (let i = 0; i < faCount; i++) {
      const player = faPlayers?.[i]?.player;
      if (player) {
        const playerProps = player[0] || [];
        const playerData: any = {};
        for (const prop of playerProps) {
          if (prop && typeof prop === 'object') {
            Object.assign(playerData, prop);
          }
        }
        freeAgents.push(playerData);
      }
    }

    // Enhance with schedule data
    const gamesPerTeam = scheduleAnalysis.gamesPerTeam;

    const rosterWithSchedule = userRoster.map((player) => {
      const teamAbbr = player.editorial_team_abbr;
      const schedule = gamesPerTeam[teamAbbr] || { total: 0, dates: [] };
      return {
        ...player,
        games_this_week: schedule.total,
        game_dates: schedule.dates,
      };
    });

    const freeAgentsWithSchedule = freeAgents
      .map((player) => {
        const teamAbbr = player.editorial_team_abbr;
        const schedule = gamesPerTeam[teamAbbr] || { total: 0, dates: [] };
        return {
          ...player,
          games_this_week: schedule.total,
          game_dates: schedule.dates,
        };
      })
      .sort((a, b) => b.games_this_week - a.games_this_week); // Sort by most games

    res.json({
      week: parseInt(week, 10),
      weekStart,
      weekEnd,
      schedule: scheduleAnalysis,
      userRoster: rosterWithSchedule,
      freeAgents: freeAgentsWithSchedule,
    });
  } catch (error: any) {
    console.error('Streaming analysis error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch streaming analysis',
    });
  }
});

/**
 * Get streaming recommendations for a league
 * Analyzes roster and suggests drop/add moves to maximize games played
 */
router.get('/leagues/:league_key/streaming/recommendations', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Fetch Yahoo data in parallel
    const [scoreboardData, rostersData, faData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/roster`),
      makeYahooRequest(user.id, `/league/${league_key}/players;status=FA;count=50`),
    ]);

    // Get week dates
    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    const firstMatchup = scoreboard?.['0']?.matchups?.['0']?.matchup;
    const weekStart = firstMatchup?.week_start;
    const weekEnd = firstMatchup?.week_end;

    if (!weekStart || !weekEnd) {
      return res.status(404).json({ error: 'Could not determine week dates' });
    }

    // Get NBA schedule
    const scheduleAnalysis = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);
    const gamesPerTeam = scheduleAnalysis.gamesPerTeam;

    // Parse user's roster
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;
    const userRoster: any[] = [];
    const teamCount = teams?.count || 0;

    for (let i = 0; i < teamCount; i++) {
      const team = teams?.[i]?.team;
      if (!team) continue;

      const teamProps = team[0] || [];
      let isUserTeam = false;
      for (const prop of teamProps) {
        if (prop?.is_owned_by_current_login === 1) {
          isUserTeam = true;
          break;
        }
      }

      if (isUserTeam) {
        const roster = team[1]?.roster?.['0']?.players;
        if (roster) {
          const playerCount = roster.count || 0;
          for (let p = 0; p < playerCount; p++) {
            const player = roster[p]?.player;
            if (player) {
              const playerProps = player[0] || [];
              const playerData: any = {};
              for (const prop of playerProps) {
                if (prop && typeof prop === 'object') {
                  Object.assign(playerData, prop);
                }
              }
              const selectedPos = player[1]?.selected_position;
              if (selectedPos) {
                for (const pos of selectedPos) {
                  if (pos?.position) {
                    playerData.selected_position = pos.position;
                  }
                }
              }
              const teamAbbr = playerData.editorial_team_abbr;
              const schedule = gamesPerTeam[teamAbbr] || { total: 0, dates: [] };
              playerData.games_this_week = schedule.total;
              playerData.game_dates = schedule.dates;
              userRoster.push(playerData);
            }
          }
        }
        break;
      }
    }

    // Parse free agents with schedule
    const freeAgents: any[] = [];
    const faPlayers = faData?.fantasy_content?.league?.[1]?.players;
    const faCount = faPlayers?.count || 0;
    for (let i = 0; i < faCount; i++) {
      const player = faPlayers?.[i]?.player;
      if (player) {
        const playerProps = player[0] || [];
        const playerData: any = {};
        for (const prop of playerProps) {
          if (prop && typeof prop === 'object') {
            Object.assign(playerData, prop);
          }
        }
        const teamAbbr = playerData.editorial_team_abbr;
        const schedule = gamesPerTeam[teamAbbr] || { total: 0, dates: [] };
        playerData.games_this_week = schedule.total;
        playerData.game_dates = schedule.dates;
        freeAgents.push(playerData);
      }
    }

    // Find droppable players: low games remaining, not on IL
    const droppablePlayers = userRoster
      .filter(p => p.selected_position !== 'IL' && p.selected_position !== 'IL+')
      .filter(p => p.games_this_week <= 2)
      .sort((a, b) => a.games_this_week - b.games_this_week);

    // Find top streaming candidates
    const streamingTargets = freeAgents
      .filter(p => p.games_this_week >= 3)
      .sort((a, b) => b.games_this_week - a.games_this_week)
      .slice(0, 10);

    // Generate recommendations
    const recommendations: any[] = [];

    for (const dropPlayer of droppablePlayers.slice(0, 3)) {
      for (const addPlayer of streamingTargets) {
        const gamesGained = addPlayer.games_this_week - dropPlayer.games_this_week;
        if (gamesGained > 0) {
          let confidence: 'high' | 'medium' | 'low' = 'medium';
          if (gamesGained >= 3) confidence = 'high';
          else if (gamesGained <= 1) confidence = 'low';

          recommendations.push({
            id: `${dropPlayer.player_key}-${addPlayer.player_key}`,
            drop: {
              player_key: dropPlayer.player_key,
              name: dropPlayer.name?.full || 'Unknown',
              team: dropPlayer.editorial_team_abbr,
              position: dropPlayer.display_position || '',
              games_this_week: dropPlayer.games_this_week,
              game_dates: dropPlayer.game_dates,
            },
            add: {
              player_key: addPlayer.player_key,
              name: addPlayer.name?.full || 'Unknown',
              team: addPlayer.editorial_team_abbr,
              position: addPlayer.display_position || '',
              games_this_week: addPlayer.games_this_week,
              game_dates: addPlayer.game_dates,
              percent_owned: addPlayer.percent_owned?.value || '0',
            },
            gamesGained,
            confidence,
            reasoning: `${addPlayer.name?.full} has ${addPlayer.games_this_week} games vs ${dropPlayer.name?.full}'s ${dropPlayer.games_this_week}. Gain ${gamesGained} game${gamesGained > 1 ? 's' : ''}.`,
          });
          break;
        }
      }
    }

    recommendations.sort((a, b) => b.gamesGained - a.gamesGained);

    res.json({
      recommendations: recommendations.slice(0, 5),
      rosterAnalysis: {
        totalPlayers: userRoster.length,
        lowGamePlayers: droppablePlayers.length,
        averageGames: userRoster.length > 0
          ? (userRoster.reduce((sum, p) => sum + (p.games_this_week || 0), 0) / userRoster.length).toFixed(1)
          : 0,
      },
      weekStart,
      weekEnd,
    });
  } catch (error: any) {
    console.error('Streaming recommendations error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to generate recommendations',
    });
  }
});

export const fantasyRoutes = router;
