import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { yahooOAuthService } from '../services/yahoo-oauth';
import { getYahooTokens, saveYahooTokens } from '../services/database';
import { ballDontLieService } from '../services/balldontlie';
import {
  detectTopic,
  buildSystemPrompt,
  buildMatchupContext,
  buildStreamingContext,
  type ContextInputs,
} from '../services/chatContext';
import {
  analyzePuntStrategy,
  getLeaguePuntStrategies,
} from '../services/puntAnalysis';
import {
  parseLeagueSettings,
  analyzeLeague,
  generateCustomRankings,
  LeagueCategory,
} from '../services/leagueInsights';
import {
  comparePlayers,
  parseYahooPlayerData,
  filterPlayersByName,
  type PlayerStats,
} from '../services/playerComparison';
import {
  parseYahooPlayer,
  analyzeTeamNeeds,
  generateRecommendations,
  identifyDropCandidates,
  calculateLeagueAverages,
  type PlayerStats as WaiverPlayerStats,
} from '../services/waiverAnalysis';

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

// Rate limiting for chat endpoint (simple in-memory implementation)
const chatRateLimits = new Map<string, { count: number; resetTime: number }>();
const CHAT_RATE_LIMIT = 10; // messages per minute
const CHAT_RATE_WINDOW = 60 * 1000; // 1 minute

/**
 * AI Strategy Chat endpoint
 * Streaming chat interface with fantasy basketball context
 */
router.post('/leagues/:league_key/chat', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { messages = [], model = 'claude-3-5-haiku-20241022' } = req.body;

    // Rate limiting check
    const now = Date.now();
    const userLimit = chatRateLimits.get(user.id);
    if (userLimit) {
      if (now < userLimit.resetTime) {
        if (userLimit.count >= CHAT_RATE_LIMIT) {
          return res.status(429).json({
            error: 'Rate limit exceeded. Please wait before sending more messages.',
            retryAfter: Math.ceil((userLimit.resetTime - now) / 1000),
          });
        }
        userLimit.count++;
      } else {
        chatRateLimits.set(user.id, { count: 1, resetTime: now + CHAT_RATE_WINDOW });
      }
    } else {
      chatRateLimits.set(user.id, { count: 1, resetTime: now + CHAT_RATE_WINDOW });
    }

    if (!messages.length || !messages[messages.length - 1]?.content) {
      return res.status(400).json({ error: 'Message content required' });
    }

    // Detect topic from conversation
    const topic = detectTopic(messages);

    // Fetch fantasy context data based on topic
    const [leagueData, scoreboardData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
    ]);

    // Build concise fantasy context
    const leagueInfo = leagueData?.fantasy_content?.league?.[0] || {};
    const settings = leagueData?.fantasy_content?.league?.[1]?.settings?.[0] || {};

    // Extract stat categories
    const statCategories = settings?.stat_categories?.stats
      ?.map((s: any) => s.stat?.display_name || s.stat?.name)
      .filter(Boolean)
      .join(', ') || 'Standard categories';

    // Build context inputs
    const contextInputs: ContextInputs = {
      leagueName: leagueInfo.name || 'Unknown',
      currentWeek: leagueInfo.current_week || 'Unknown',
      statCategories,
      matchupSummary: buildMatchupContext(scoreboardData, settings),
    };

    // Add topic-specific context
    if (topic === 'streaming') {
      try {
        const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
        const weekStart = scoreboard?.['0']?.matchups?.['0']?.matchup?.week_start;
        const weekEnd = scoreboard?.['0']?.matchups?.['0']?.matchup?.week_end;
        if (weekStart && weekEnd) {
          const scheduleData = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);
          contextInputs.scheduleSummary = buildStreamingContext({ schedule: scheduleData });
        }
      } catch (err) {
        console.log('Could not fetch schedule for streaming context');
      }
    }

    // Build system prompt using context service
    const systemPrompt = buildSystemPrompt(contextInputs, topic);

    // Prepare messages for Claude (keep last 10 messages for context)
    const recentMessages = messages.slice(-10).map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    // Call Artanis Claude proxy with streaming
    const AUTH_URL = process.env.AUTH_URL || 'https://auth.benloe.com';
    const cookies = req.headers.cookie || '';

    const claudeResponse = await fetch(`${AUTH_URL}/api/claude/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: recentMessages,
        max_tokens: 1024,
      }),
    });

    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json().catch(() => ({ error: 'Unknown error' }));
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
          console.error('Chat stream error:', error);
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
    console.error('Chat error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to process chat message',
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

// ============================================================
// Matchup Center Endpoints
// ============================================================

/**
 * Get current matchup data for user's team
 * Returns structured category comparison with win/loss/tie status
 */
router.get('/leagues/:league_key/matchup/current', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Fetch scoreboard and settings in parallel
    const [scoreboardData, settingsData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
    ]);

    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];

    if (!scoreboard) {
      return res.status(404).json({ error: 'No scoreboard data available' });
    }

    // Get stat categories from settings
    const statCategories = settings?.stat_categories?.stats?.map((s: any) => s.stat) || [];

    // Find user's matchup
    const matchups = scoreboard['0']?.matchups;
    let userMatchup: any = null;
    let userTeam: any = null;
    let opponentTeam: any = null;
    const matchupCount = matchups?.count || 0;

    for (let i = 0; i < matchupCount; i++) {
      const matchup = matchups?.[i]?.matchup;
      if (!matchup) continue;

      const teams = matchup['0']?.teams;
      if (!teams) continue;

      for (let t = 0; t < 2; t++) {
        const team = teams?.[t]?.team;
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
          userMatchup = matchup;
          userTeam = team;
          opponentTeam = teams[t === 0 ? 1 : 0]?.team;
          break;
        }
      }
      if (userMatchup) break;
    }

    if (!userMatchup || !userTeam || !opponentTeam) {
      return res.json({
        matchup: null,
        message: 'No active matchup found (bye week or season ended)',
      });
    }

    // Parse team data
    const parseTeamData = (team: any[]) => {
      const props = team[0] || [];
      const stats = team[1]?.team_stats?.stats || [];

      const merged: any = {};
      for (const prop of props) {
        if (prop && typeof prop === 'object') {
          Object.assign(merged, prop);
        }
      }

      const categoryStats: Record<string, { value: string | number }> = {};
      for (const stat of stats) {
        if (stat?.stat) {
          categoryStats[stat.stat.stat_id] = { value: stat.stat.value };
        }
      }

      return { ...merged, categoryStats };
    };

    const userTeamData = parseTeamData(userTeam);
    const opponentTeamData = parseTeamData(opponentTeam);

    // Build category comparison
    const categories: any[] = [];
    for (const cat of statCategories) {
      if (!cat?.stat_id) continue;

      const userValue = parseFloat(userTeamData.categoryStats[cat.stat_id]?.value || '0');
      const oppValue = parseFloat(opponentTeamData.categoryStats[cat.stat_id]?.value || '0');

      // Determine if higher or lower is better (TOs are typically negative)
      const isNegative = cat.name?.toLowerCase().includes('turnover') || cat.abbr === 'TO';
      let status: 'win' | 'loss' | 'tie' = 'tie';

      if (userValue !== oppValue) {
        if (isNegative) {
          status = userValue < oppValue ? 'win' : 'loss';
        } else {
          status = userValue > oppValue ? 'win' : 'loss';
        }
      }

      const diff = isNegative ? oppValue - userValue : userValue - oppValue;

      categories.push({
        statId: cat.stat_id,
        name: cat.name,
        abbr: cat.abbr || cat.display_name,
        userValue,
        opponentValue: oppValue,
        status,
        difference: diff,
        isNegative,
      });
    }

    // Calculate overall score
    const wins = categories.filter(c => c.status === 'win').length;
    const losses = categories.filter(c => c.status === 'loss').length;
    const ties = categories.filter(c => c.status === 'tie').length;

    res.json({
      week: userMatchup.week,
      weekStart: userMatchup.week_start,
      weekEnd: userMatchup.week_end,
      userTeam: {
        name: userTeamData.name,
        teamKey: userTeamData.team_key,
        logoUrl: userTeamData.team_logos?.[0]?.team_logo?.url,
        score: { wins, losses, ties },
      },
      opponent: {
        name: opponentTeamData.name,
        teamKey: opponentTeamData.team_key,
        logoUrl: opponentTeamData.team_logos?.[0]?.team_logo?.url,
        score: { wins: losses, losses: wins, ties },
      },
      categories,
      status: wins > losses ? 'winning' : wins < losses ? 'losing' : 'tied',
    });
  } catch (error: any) {
    console.error('Matchup current error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch matchup',
    });
  }
});

/**
 * Get matchup projections
 * Projects final category outcomes based on current pace
 */
router.get('/leagues/:league_key/matchup/projections', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Fetch scoreboard, settings, and rosters
    const [scoreboardData, settingsData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
    ]);

    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const weekStart = scoreboard?.['0']?.matchups?.['0']?.matchup?.week_start;
    const weekEnd = scoreboard?.['0']?.matchups?.['0']?.matchup?.week_end;

    if (!scoreboard || !weekStart || !weekEnd) {
      return res.status(404).json({ error: 'No scoreboard data available' });
    }

    // Get schedule data for games remaining
    const scheduleAnalysis = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);

    // Calculate days elapsed and remaining
    const now = new Date();
    const start = new Date(weekStart + 'T00:00:00');
    const end = new Date(weekEnd + 'T23:59:59');
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const percentComplete = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;

    // Get stat categories
    const statCategories = settings?.stat_categories?.stats?.map((s: any) => s.stat) || [];

    // Find user's matchup
    const matchups = scoreboard['0']?.matchups;
    let userMatchup: any = null;
    let userTeam: any = null;
    let opponentTeam: any = null;
    const matchupCount = matchups?.count || 0;

    for (let i = 0; i < matchupCount; i++) {
      const matchup = matchups?.[i]?.matchup;
      if (!matchup) continue;

      const teams = matchup['0']?.teams;
      if (!teams) continue;

      for (let t = 0; t < 2; t++) {
        const team = teams?.[t]?.team;
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
          userMatchup = matchup;
          userTeam = team;
          opponentTeam = teams[t === 0 ? 1 : 0]?.team;
          break;
        }
      }
      if (userMatchup) break;
    }

    if (!userMatchup || !userTeam || !opponentTeam) {
      return res.json({
        projections: null,
        message: 'No active matchup found',
      });
    }

    // Parse team stats
    const parseTeamStats = (team: any[]) => {
      const stats = team[1]?.team_stats?.stats || [];
      const categoryStats: Record<string, number> = {};
      for (const stat of stats) {
        if (stat?.stat) {
          categoryStats[stat.stat.stat_id] = parseFloat(stat.stat.value || '0');
        }
      }
      return categoryStats;
    };

    const userStats = parseTeamStats(userTeam);
    const oppStats = parseTeamStats(opponentTeam);

    // Calculate projections for each category
    const projections: any[] = [];

    for (const cat of statCategories) {
      if (!cat?.stat_id) continue;

      const userCurrent = userStats[cat.stat_id] || 0;
      const oppCurrent = oppStats[cat.stat_id] || 0;

      // Simple linear projection based on pace
      const projectionMultiplier = percentComplete > 0 ? 100 / percentComplete : 1;
      const userProjected = userCurrent * projectionMultiplier;
      const oppProjected = oppCurrent * projectionMultiplier;

      const isNegative = cat.name?.toLowerCase().includes('turnover') || cat.abbr === 'TO';

      // Determine projected outcome
      let projectedStatus: 'win' | 'loss' | 'tie' = 'tie';
      if (userProjected !== oppProjected) {
        if (isNegative) {
          projectedStatus = userProjected < oppProjected ? 'win' : 'loss';
        } else {
          projectedStatus = userProjected > oppProjected ? 'win' : 'loss';
        }
      }

      // Calculate current status
      let currentStatus: 'win' | 'loss' | 'tie' = 'tie';
      if (userCurrent !== oppCurrent) {
        if (isNegative) {
          currentStatus = userCurrent < oppCurrent ? 'win' : 'loss';
        } else {
          currentStatus = userCurrent > oppCurrent ? 'win' : 'loss';
        }
      }

      // Determine if this is a swing category
      const margin = Math.abs(userProjected - oppProjected);
      const relativeMargin = oppProjected > 0 ? margin / oppProjected : margin;
      const isSwing = relativeMargin < 0.1 && daysRemaining > 1; // Within 10% and time remains

      // Confidence based on margin and time remaining
      let confidence: 'high' | 'medium' | 'low' = 'medium';
      if (relativeMargin > 0.2) confidence = 'high';
      else if (isSwing) confidence = 'low';

      projections.push({
        statId: cat.stat_id,
        name: cat.name,
        abbr: cat.abbr || cat.display_name,
        current: { user: userCurrent, opponent: oppCurrent, status: currentStatus },
        projected: { user: Math.round(userProjected * 10) / 10, opponent: Math.round(oppProjected * 10) / 10, status: projectedStatus },
        isSwing,
        confidence,
        couldFlip: currentStatus !== projectedStatus || isSwing,
      });
    }

    // Summary
    const projectedWins = projections.filter(p => p.projected.status === 'win').length;
    const projectedLosses = projections.filter(p => p.projected.status === 'loss').length;
    const swingCategories = projections.filter(p => p.isSwing).length;

    res.json({
      week: userMatchup.week,
      weekProgress: {
        daysElapsed,
        daysRemaining,
        percentComplete: Math.round(percentComplete),
      },
      projectedScore: {
        wins: projectedWins,
        losses: projectedLosses,
        ties: projections.length - projectedWins - projectedLosses,
      },
      projectedOutcome: projectedWins > projectedLosses ? 'win' : projectedWins < projectedLosses ? 'loss' : 'tie',
      swingCategories,
      projections,
      gamesRemaining: {
        totalGamesInWeek: Object.keys(scheduleAnalysis.gamesByDate).reduce(
          (sum, date) => sum + scheduleAnalysis.gamesByDate[date].length, 0
        ),
        datesRemaining: Object.keys(scheduleAnalysis.gamesByDate).filter(date => new Date(date) > now),
      },
    });
  } catch (error: any) {
    console.error('Matchup projections error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to generate projections',
    });
  }
});

/**
 * Get another team's roster for trade partner selection
 */
router.get('/leagues/:league_key/teams/:team_key/roster', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key, team_key } = req.params;

    const rosterData = await makeYahooRequest(
      user.id,
      `/team/${team_key}/roster/players`
    );

    const players = rosterData?.fantasy_content?.team?.[1]?.roster?.['0']?.players || {};
    const playerCount = players.count || 0;

    const roster: any[] = [];
    for (let i = 0; i < playerCount; i++) {
      const player = players[i]?.player;
      if (player) {
        const playerInfo = player[0] || [];
        const stats = player[1]?.player_stats?.stats || [];

        const merged: any = {};
        for (const prop of playerInfo) {
          if (prop && typeof prop === 'object') {
            Object.assign(merged, prop);
          }
        }

        // Extract season stats
        const seasonStats: Record<string, number> = {};
        for (const stat of stats) {
          if (stat?.stat) {
            seasonStats[stat.stat.stat_id] = parseFloat(stat.stat.value || '0');
          }
        }

        roster.push({
          playerKey: merged.player_key,
          name: merged.name?.full || 'Unknown',
          position: merged.display_position || '',
          team: merged.editorial_team_abbr || '',
          imageUrl: merged.headshot?.url,
          stats: seasonStats,
        });
      }
    }

    res.json({ roster, teamKey: team_key });
  } catch (error: any) {
    console.error('Team roster error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch roster',
    });
  }
});

/**
 * Analyze a potential trade
 */
router.post('/leagues/:league_key/trade/analyze', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { playersToGive = [], playersToReceive = [], partnerTeamKey } = req.body;

    if (!playersToGive.length && !playersToReceive.length) {
      return res.status(400).json({ error: 'At least one player must be included in the trade' });
    }

    // Fetch league settings for stat categories
    const settingsData = await makeYahooRequest(user.id, `/league/${league_key}/settings`);
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0] || {};
    const statCategories = settings?.stat_categories?.stats?.map((s: any) => s.stat) || [];

    // Helper function to calculate per-game averages
    const calculatePerGameAvg = (stats: Record<string, number>, gamesPlayed: number) => {
      const perGame: Record<string, number> = {};
      for (const [statId, value] of Object.entries(stats)) {
        perGame[statId] = gamesPlayed > 0 ? value / gamesPlayed : 0;
      }
      return perGame;
    };

    // Calculate impact for each category
    const categoryImpact: any[] = [];
    let categoriesGained = 0;
    let categoriesLost = 0;

    // Aggregate stats from players to give and receive
    const giveStats: Record<string, number> = {};
    const receiveStats: Record<string, number> = {};

    for (const player of playersToGive) {
      if (player.stats) {
        for (const [statId, value] of Object.entries(player.stats)) {
          giveStats[statId] = (giveStats[statId] || 0) + (value as number);
        }
      }
    }

    for (const player of playersToReceive) {
      if (player.stats) {
        for (const [statId, value] of Object.entries(player.stats)) {
          receiveStats[statId] = (receiveStats[statId] || 0) + (value as number);
        }
      }
    }

    // Calculate impact per category
    for (const cat of statCategories) {
      if (!cat?.stat_id) continue;

      const statId = cat.stat_id.toString();
      const giving = giveStats[statId] || 0;
      const receiving = receiveStats[statId] || 0;
      const netChange = receiving - giving;

      const isNegative = cat.name?.toLowerCase().includes('turnover') || cat.abbr === 'TO';
      const isPositiveChange = isNegative ? netChange < 0 : netChange > 0;

      if (Math.abs(netChange) > 0.01) {
        if (isPositiveChange) {
          categoriesGained++;
        } else {
          categoriesLost++;
        }
      }

      categoryImpact.push({
        statId: cat.stat_id,
        name: cat.name,
        displayName: cat.display_name || cat.abbr,
        giving,
        receiving,
        netChange,
        isNegative,
        impact: isPositiveChange ? 'positive' : Math.abs(netChange) < 0.01 ? 'neutral' : 'negative',
      });
    }

    // Generate trade grade
    const netCategories = categoriesGained - categoriesLost;
    let grade: string;
    let recommendation: string;

    if (netCategories >= 3) {
      grade = 'A';
      recommendation = 'Strongly recommended - significant category improvement';
    } else if (netCategories >= 1) {
      grade = 'B';
      recommendation = 'Good trade - net positive impact';
    } else if (netCategories === 0) {
      grade = 'C';
      recommendation = 'Even trade - consider team needs';
    } else if (netCategories >= -2) {
      grade = 'D';
      recommendation = 'Below average - losing ground in categories';
    } else {
      grade = 'F';
      recommendation = 'Not recommended - significant category decline';
    }

    res.json({
      playersGiving: playersToGive.map((p: any) => ({
        playerKey: p.playerKey,
        name: p.name,
        position: p.position,
        team: p.team,
      })),
      playersReceiving: playersToReceive.map((p: any) => ({
        playerKey: p.playerKey,
        name: p.name,
        position: p.position,
        team: p.team,
      })),
      categoryImpact,
      summary: {
        categoriesGained,
        categoriesLost,
        netCategories,
        grade,
        recommendation,
      },
    });
  } catch (error: any) {
    console.error('Trade analysis error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to analyze trade',
    });
  }
});

/**
 * Get all teams in a league for trade partner selection
 */
router.get('/leagues/:league_key/teams', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    const teamsData = await makeYahooRequest(user.id, `/league/${league_key}/teams`);
    const teams = teamsData?.fantasy_content?.league?.[1]?.teams || {};
    const teamCount = teams.count || 0;

    const teamList: any[] = [];
    for (let i = 0; i < teamCount; i++) {
      const team = teams[i]?.team;
      if (team) {
        const teamInfo = team[0] || [];
        const merged: any = {};
        for (const prop of teamInfo) {
          if (prop && typeof prop === 'object') {
            Object.assign(merged, prop);
          }
        }

        teamList.push({
          teamKey: merged.team_key,
          name: merged.name,
          logoUrl: merged.team_logos?.[0]?.team_logo?.url,
          isOwnedByCurrentLogin: merged.is_owned_by_current_login === 1,
          managerName: merged.managers?.[0]?.manager?.nickname,
        });
      }
    }

    res.json({ teams: teamList });
  } catch (error: any) {
    console.error('League teams error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch teams',
    });
  }
});

/**
 * ===== PUNT STRATEGY ENDPOINTS =====
 */

/**
 * Get punt strategy analysis for user's team
 */
router.get('/leagues/:league_key/punt/analysis', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get league settings to know the scoring categories
    const settingsData = await makeYahooRequest(user.id, `/league/${league_key}/settings`);
    const settingsContent = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const statCategories = settingsContent?.stat_categories?.stats || [];

    // Get standings to get all team stats
    const standingsData = await makeYahooRequest(user.id, `/league/${league_key}/standings`);
    const standingsContent = standingsData?.fantasy_content?.league?.[1]?.standings?.['0']?.teams;
    const teamCount = standingsContent?.count || 0;

    // Parse all team stats
    const leagueStats: Array<{ teamKey: string; stats: Record<string, number>; isCurrentUser: boolean }> = [];
    let myTeamStats: Record<string, number> = {};

    for (let i = 0; i < teamCount; i++) {
      const teamArray = standingsContent?.[i]?.team;
      if (!teamArray) continue;

      // Extract team info from Yahoo's nested structure
      const teamInfo: any = {};
      if (Array.isArray(teamArray[0])) {
        for (const prop of teamArray[0]) {
          if (prop && typeof prop === 'object') {
            Object.assign(teamInfo, prop);
          }
        }
      }

      const teamKey = teamInfo.team_key || '';
      const isCurrentUser = teamInfo.is_owned_by_current_login === 1;

      // Extract stats from standings
      const teamStandings = teamArray[2]?.team_standings || teamArray[1]?.team_standings;
      const teamStatsData = teamStandings?.outcome_totals?.wins !== undefined
        ? {} // Category wins/losses format
        : {};

      // Get actual stat values if available
      const statsArray = teamArray[1]?.team_stats?.stats || [];
      const stats: Record<string, number> = {};
      for (const statObj of statsArray) {
        if (statObj?.stat?.stat_id && statObj?.stat?.value !== undefined) {
          stats[statObj.stat.stat_id.toString()] = parseFloat(statObj.stat.value) || 0;
        }
      }

      leagueStats.push({
        teamKey,
        stats,
        isCurrentUser,
      });

      if (isCurrentUser) {
        myTeamStats = stats;
      }
    }

    // Parse categories
    const categories = statCategories.map((s: any) => ({
      statId: s.stat?.stat_id?.toString() || '',
      name: s.stat?.name || '',
      displayName: s.stat?.display_name || s.stat?.abbr || s.stat?.name || '',
      abbr: s.stat?.abbr || '',
    })).filter((c: any) => c.statId);

    // Run punt analysis
    const analysis = analyzePuntStrategy(myTeamStats, leagueStats, categories);

    res.json(analysis);
  } catch (error: any) {
    console.error('Punt analysis error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to analyze punt strategy',
    });
  }
});

/**
 * Get available punt strategies for a league
 */
router.get('/leagues/:league_key/punt/strategies', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get league settings to know the scoring categories
    const settingsData = await makeYahooRequest(user.id, `/league/${league_key}/settings`);
    const settingsContent = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const statCategories = settingsContent?.stat_categories?.stats || [];

    // Parse categories
    const categories = statCategories.map((s: any) => ({
      statId: s.stat?.stat_id?.toString() || '',
      name: s.stat?.name || '',
      displayName: s.stat?.display_name || s.stat?.abbr || s.stat?.name || '',
      abbr: s.stat?.abbr || '',
    })).filter((c: any) => c.statId);

    // Get available strategies for this league's categories
    const strategies = getLeaguePuntStrategies(categories);

    res.json({
      categories: categories.map((c: any) => ({
        statId: c.statId,
        name: c.name,
        displayName: c.displayName,
      })),
      strategies,
    });
  } catch (error: any) {
    console.error('Punt strategies error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to get punt strategies',
    });
  }
});

/**
 * ===== LEAGUE INSIGHTS ENDPOINTS =====
 */

// Simple in-memory cache for league insights (settings rarely change)
const insightsCache = new Map<string, { data: any; timestamp: number }>();
const INSIGHTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get parsed league settings summary
 * Identifies non-standard settings and highlights unusual category weights
 */
router.get('/leagues/:league_key/insights/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Check cache
    const cacheKey = `settings:${league_key}`;
    const cached = insightsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < INSIGHTS_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Get league settings and league info
    const [settingsData, leagueData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}`),
    ]);

    const settingsContent = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const leagueInfo = leagueData?.fantasy_content?.league?.[0] || {};
    const statCategories = settingsContent?.stat_categories?.stats || [];

    // Parse categories
    const categories: LeagueCategory[] = statCategories.map((s: any) => ({
      statId: s.stat?.stat_id?.toString() || '',
      name: s.stat?.name || '',
      displayName: s.stat?.display_name || s.stat?.abbr || s.stat?.name || '',
      abbr: s.stat?.abbr || '',
    })).filter((c: LeagueCategory) => c.statId);

    // Get league type and team count
    const leagueType = leagueInfo.scoring_type || 'head-to-head';
    const numTeams = parseInt(leagueInfo.num_teams || '12', 10);

    // Parse settings
    const settingsSummary = parseLeagueSettings(categories, leagueType, numTeams);

    const result = {
      leagueName: leagueInfo.name || 'Unknown League',
      season: leagueInfo.season || '',
      ...settingsSummary,
    };

    // Cache the result
    insightsCache.set(cacheKey, { data: result, timestamp: Date.now() });

    res.json(result);
  } catch (error: any) {
    console.error('League insights settings error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to get league insights',
    });
  }
});

/**
 * Get full league analysis
 * Category importance rankings, positional scarcity, and exploitable edges
 */
router.get('/leagues/:league_key/insights/analysis', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Check cache
    const cacheKey = `analysis:${league_key}`;
    const cached = insightsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < INSIGHTS_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Get league settings and league info
    const [settingsData, leagueData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}`),
    ]);

    const settingsContent = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const leagueInfo = leagueData?.fantasy_content?.league?.[0] || {};
    const statCategories = settingsContent?.stat_categories?.stats || [];

    // Parse categories
    const categories: LeagueCategory[] = statCategories.map((s: any) => ({
      statId: s.stat?.stat_id?.toString() || '',
      name: s.stat?.name || '',
      displayName: s.stat?.display_name || s.stat?.abbr || s.stat?.name || '',
      abbr: s.stat?.abbr || '',
    })).filter((c: LeagueCategory) => c.statId);

    // Get league type and team count
    const leagueType = leagueInfo.scoring_type || 'head-to-head';
    const numTeams = parseInt(leagueInfo.num_teams || '12', 10);

    // Run full analysis
    const { settings, analysis } = analyzeLeague(categories, leagueType, numTeams);

    const result = {
      leagueName: leagueInfo.name || 'Unknown League',
      season: leagueInfo.season || '',
      settings,
      analysis,
    };

    // Cache the result
    insightsCache.set(cacheKey, { data: result, timestamp: Date.now() });

    res.json(result);
  } catch (error: any) {
    console.error('League insights analysis error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to analyze league',
    });
  }
});

/**
 * Get custom player rankings based on league settings
 * Rankings are weighted by actual league categories
 */
router.get('/leagues/:league_key/insights/rankings', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const position = req.query.position as string | undefined;

    // Check cache
    const cacheKey = `rankings:${league_key}`;
    const cached = insightsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < INSIGHTS_CACHE_TTL) {
      let result = cached.data;
      // Apply position filter if provided
      if (position && position !== 'All') {
        result = {
          ...result,
          players: result.players.filter((p: any) => p.position === position),
        };
      }
      return res.json(result);
    }

    // Get league settings
    const [settingsData, leagueData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}`),
    ]);

    const settingsContent = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const leagueInfo = leagueData?.fantasy_content?.league?.[0] || {};
    const statCategories = settingsContent?.stat_categories?.stats || [];

    // Parse categories
    const categories: LeagueCategory[] = statCategories.map((s: any) => ({
      statId: s.stat?.stat_id?.toString() || '',
      name: s.stat?.name || '',
      displayName: s.stat?.display_name || s.stat?.abbr || s.stat?.name || '',
      abbr: s.stat?.abbr || '',
    })).filter((c: LeagueCategory) => c.statId);

    // Get league type and team count
    const leagueType = leagueInfo.scoring_type || 'head-to-head';
    const numTeams = parseInt(leagueInfo.num_teams || '12', 10);

    // Parse settings and generate rankings
    const settings = parseLeagueSettings(categories, leagueType, numTeams);
    const rankings = generateCustomRankings(categories, settings);

    const result = {
      leagueName: leagueInfo.name || 'Unknown League',
      ...rankings,
    };

    // Cache the result
    insightsCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Apply position filter if provided
    let filteredResult = result;
    if (position && position !== 'All') {
      filteredResult = {
        ...result,
        players: result.players.filter(p => p.position === position),
      };
    }

    res.json(filteredResult);
  } catch (error: any) {
    console.error('League insights rankings error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to get league rankings',
    });
  }
});

// ============================================================
// Season Schedule Planner Endpoints
// ============================================================

/**
 * Get full season schedule grouped by fantasy weeks
 * Query params: season (optional, defaults to current season)
 */
router.get('/schedule/season', authenticate, async (req: Request, res: Response) => {
  try {
    const seasonParam = req.query.season as string | undefined;
    const season = seasonParam ? parseInt(seasonParam, 10) : undefined;

    const schedule = await ballDontLieService.getSeasonSchedule(season);

    // Return a lighter version without full game objects to reduce payload
    const lightWeeks = schedule.weeks.map(week => ({
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate: week.endDate,
      gameCount: week.games.length,
      gamesPerTeam: week.gamesPerTeam,
    }));

    res.json({
      season: schedule.season,
      weeks: lightWeeks,
      teams: schedule.teams.map(t => ({ abbreviation: t.abbreviation, name: t.full_name })),
      playoffWeeks: schedule.playoffWeeks,
      allStarBreak: schedule.allStarBreak,
      totalWeeks: schedule.weeks.length,
    });
  } catch (error: any) {
    console.error('Season schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get schedule for a specific NBA team
 * Includes all games and games per week breakdown
 */
router.get('/schedule/team/:teamAbbr', authenticate, async (req: Request, res: Response) => {
  try {
    const { teamAbbr } = req.params;
    const seasonParam = req.query.season as string | undefined;
    const season = seasonParam ? parseInt(seasonParam, 10) : undefined;

    const teamSchedule = await ballDontLieService.getTeamSchedule(teamAbbr, season);

    res.json(teamSchedule);
  } catch (error: any) {
    console.error('Team schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get schedule for a league's rostered players
 * Shows games per week aggregated for all players on the user's roster
 */
router.get('/leagues/:league_key/schedule/roster', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const seasonParam = req.query.season as string | undefined;
    const season = seasonParam ? parseInt(seasonParam, 10) : undefined;

    // Get user's roster
    const rostersData = await makeYahooRequest(user.id, `/league/${league_key}/teams/roster`);
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;

    // Find user's team and extract player NBA teams
    const rosterTeams: string[] = [];
    const playerInfo: Array<{ name: string; team: string }> = [];
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
              const playerProps = player[0] || [];
              let playerName = '';
              let nbaTeam = '';

              for (const prop of playerProps) {
                if (prop?.name?.full) playerName = prop.name.full;
                if (prop?.editorial_team_abbr) nbaTeam = prop.editorial_team_abbr;
              }

              if (nbaTeam) {
                rosterTeams.push(nbaTeam.toUpperCase());
                playerInfo.push({ name: playerName, team: nbaTeam.toUpperCase() });
              }
            }
          }
        }
        break;
      }
    }

    if (rosterTeams.length === 0) {
      return res.status(404).json({ error: 'No roster found or no NBA teams detected' });
    }

    // Get unique teams only
    const uniqueTeams = [...new Set(rosterTeams)];

    // Get schedule for roster teams
    const schedule = await ballDontLieService.getTeamsSchedule(uniqueTeams, season);

    // Calculate per-player game counts for playoffs
    const playerPlayoffGames: Record<string, number> = {};
    for (const player of playerInfo) {
      playerPlayoffGames[player.name] = 0;
      for (const weekNum of schedule.playoffWeeks) {
        const week = schedule.weeks.find(w => w.weekNumber === weekNum);
        if (week) {
          playerPlayoffGames[player.name] += week.gamesByTeam[player.team] || 0;
        }
      }
    }

    res.json({
      season: schedule.season,
      rosterTeams: uniqueTeams,
      players: playerInfo,
      weeks: schedule.weeks,
      playoffWeeks: schedule.playoffWeeks,
      playoffGamesTotal: schedule.playoffGamesTotal,
      playerPlayoffGames,
    });
  } catch (error: any) {
    console.error('Roster schedule error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch roster schedule',
    });
  }
});

/**
 * Get detailed playoff schedule analysis for a league
 * Analyzes game distribution during playoff weeks
 */
router.get('/leagues/:league_key/schedule/playoffs', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get season schedule to find playoff weeks
    const seasonSchedule = await ballDontLieService.getSeasonSchedule();

    // Get user's roster to identify their teams
    const rostersData = await makeYahooRequest(user.id, `/league/${league_key}/teams/roster`);
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;

    // Find user's team and extract player NBA teams
    const rosterTeams: string[] = [];
    const playerInfo: Array<{ name: string; team: string }> = [];
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
              let playerName = '';
              let nbaTeam = '';

              for (const prop of playerProps) {
                if (prop?.name?.full) playerName = prop.name.full;
                if (prop?.editorial_team_abbr) nbaTeam = prop.editorial_team_abbr;
              }

              if (nbaTeam) {
                rosterTeams.push(nbaTeam.toUpperCase());
                playerInfo.push({ name: playerName, team: nbaTeam.toUpperCase() });
              }
            }
          }
        }
        break;
      }
    }

    const uniqueRosterTeams = [...new Set(rosterTeams)];

    // Get playoff weeks
    const playoffWeeks = seasonSchedule.weeks.filter(w =>
      seasonSchedule.playoffWeeks.includes(w.weekNumber)
    );

    // Calculate games per team during playoffs
    const teamPlayoffGames: Record<string, { total: number; byWeek: Record<number, number> }> = {};

    for (const team of seasonSchedule.teams) {
      teamPlayoffGames[team.abbreviation] = { total: 0, byWeek: {} };
      for (const week of playoffWeeks) {
        const games = week.gamesPerTeam[team.abbreviation] || 0;
        teamPlayoffGames[team.abbreviation].total += games;
        teamPlayoffGames[team.abbreviation].byWeek[week.weekNumber] = games;
      }
    }

    // Sort teams by playoff games
    const rankedTeams = Object.entries(teamPlayoffGames)
      .map(([abbr, data]) => ({
        team: abbr,
        totalGames: data.total,
        gamesByWeek: data.byWeek,
        isOnRoster: uniqueRosterTeams.includes(abbr),
      }))
      .sort((a, b) => b.totalGames - a.totalGames);

    // Calculate user's roster playoff strength
    let rosterTotalGames = 0;
    const playerPlayoffGames: Record<string, number> = {};

    for (const player of playerInfo) {
      const teamGames = teamPlayoffGames[player.team]?.total || 0;
      rosterTotalGames += teamGames;
      playerPlayoffGames[player.name] = teamGames;
    }

    // Calculate optimal (if all players had best schedule)
    const bestSchedule = rankedTeams[0]?.totalGames || 0;
    const optimalGames = playerInfo.length * bestSchedule;

    // Calculate average per team
    const avgPlayoffGames = Object.values(teamPlayoffGames).reduce((sum, t) => sum + t.total, 0) / 30;

    res.json({
      season: seasonSchedule.season,
      playoffWeeks: playoffWeeks.map(w => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        endDate: w.endDate,
        totalGames: w.games.length,
      })),
      teamRankings: rankedTeams.slice(0, 15), // Top 15 teams
      rosterTeams: uniqueRosterTeams,
      rosterAnalysis: {
        totalPlayoffGames: rosterTotalGames,
        optimalGames,
        percentOfOptimal: optimalGames > 0 ? Math.round((rosterTotalGames / optimalGames) * 100) : 0,
        averagePerTeam: avgPlayoffGames,
        players: playerInfo.map(p => ({
          name: p.name,
          team: p.team,
          playoffGames: playerPlayoffGames[p.name] || 0,
        })).sort((a, b) => b.playoffGames - a.playoffGames),
      },
      bestScheduleTeams: rankedTeams.slice(0, 5).map(t => t.team),
      worstScheduleTeams: rankedTeams.slice(-5).reverse().map(t => t.team),
    });
  } catch (error: any) {
    console.error('Playoff schedule error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch playoff schedule',
    });
  }
});

/**
 * ===== SEASON OUTLOOK ENDPOINTS =====
 */

interface TeamStanding {
  teamKey: string;
  teamName: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  isCurrentUser: boolean;
}

interface StandingsProjection {
  teamKey: string;
  teamName: string;
  currentRank: number;
  projectedRank: number;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
  projectedWins: number;
  projectedLosses: number;
  projectedTies: number;
  winPace: number; // Wins per week pace
  gamesPlayed: number;
  gamesRemaining: number;
  isCurrentUser: boolean;
  trend: 'improving' | 'stable' | 'declining'; // Based on recent performance
}

interface PlayoffOdds {
  teamKey: string;
  teamName: string;
  currentRank: number;
  playoffOdds: number; // 0-100 percentage
  byeOdds: number; // For top seeds
  magicNumber: number | null; // Wins needed to clinch
  eliminationNumber: number | null; // Losses before elimination
  isCurrentUser: boolean;
  clinched: boolean;
  eliminated: boolean;
}

/**
 * Parse Yahoo standings data into structured team standings
 */
function parseStandingsData(standingsData: any): {
  teams: TeamStanding[];
  currentWeek: number;
  totalWeeks: number;
  playoffStartWeek: number;
  playoffSpots: number;
} {
  const leagueData = standingsData?.fantasy_content?.league?.[0] || {};
  const standingsContent = standingsData?.fantasy_content?.league?.[1]?.standings?.['0']?.teams;
  const teamCount = standingsContent?.count || 0;

  const currentWeek = parseInt(leagueData.current_week) || 1;
  const startWeek = parseInt(leagueData.start_week) || 1;
  const endWeek = parseInt(leagueData.end_week) || 22;
  const playoffStartWeek = parseInt(leagueData.playoff_start_week) || Math.ceil(endWeek * 0.8);
  const playoffSpots = parseInt(leagueData.num_playoff_teams) || Math.ceil(teamCount / 2);

  const totalWeeks = playoffStartWeek - startWeek;

  const teams: TeamStanding[] = [];

  for (let i = 0; i < teamCount; i++) {
    const teamArray = standingsContent?.[i]?.team;
    if (!teamArray) continue;

    // Extract team info from Yahoo's nested structure
    const teamInfo: any = {};
    if (Array.isArray(teamArray[0])) {
      for (const prop of teamArray[0]) {
        if (prop && typeof prop === 'object') {
          Object.assign(teamInfo, prop);
        }
      }
    }

    const teamStandings = teamArray[2]?.team_standings || teamArray[1]?.team_standings || {};
    const outcomeTotals = teamStandings.outcome_totals || {};

    teams.push({
      teamKey: teamInfo.team_key || '',
      teamName: teamInfo.name || 'Unknown Team',
      rank: parseInt(teamStandings.rank) || i + 1,
      wins: parseInt(outcomeTotals.wins) || 0,
      losses: parseInt(outcomeTotals.losses) || 0,
      ties: parseInt(outcomeTotals.ties) || 0,
      pointsFor: parseFloat(teamStandings.points_for) || 0,
      pointsAgainst: parseFloat(teamStandings.points_against) || 0,
      isCurrentUser: teamInfo.is_owned_by_current_login === 1,
    });
  }

  // Sort by rank
  teams.sort((a, b) => a.rank - b.rank);

  return {
    teams,
    currentWeek,
    totalWeeks,
    playoffStartWeek,
    playoffSpots,
  };
}

/**
 * Project standings based on current pace
 */
function projectStandings(
  teams: TeamStanding[],
  currentWeek: number,
  totalWeeks: number
): StandingsProjection[] {
  const weeksPlayed = currentWeek - 1; // Assuming current week hasn't finished
  const weeksRemaining = totalWeeks - weeksPlayed;

  // Calculate projections for each team
  const projections: StandingsProjection[] = teams.map(team => {
    const gamesPlayed = team.wins + team.losses + team.ties;
    const gamesPerWeek = gamesPlayed > 0 ? gamesPlayed / weeksPlayed : 0;

    // Win rate (count ties as half wins)
    const winRate = gamesPlayed > 0
      ? (team.wins + team.ties * 0.5) / gamesPlayed
      : 0.5;

    // Projected remaining games (categories per matchup varies by league, estimate)
    const gamesRemaining = Math.round(gamesPerWeek * weeksRemaining);

    // Project wins/losses based on current pace
    const projectedAdditionalWins = Math.round(gamesRemaining * winRate);
    const projectedAdditionalLosses = Math.round(gamesRemaining * (1 - winRate));

    // Calculate win pace (wins per week)
    const winPace = weeksPlayed > 0 ? team.wins / weeksPlayed : 0;

    // Determine trend - simplified (would need historical data for real trend)
    // For now, use win rate relative to league average
    const avgWinRate = teams.reduce((sum, t) => {
      const g = t.wins + t.losses + t.ties;
      return sum + (g > 0 ? t.wins / g : 0.5);
    }, 0) / teams.length;

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (winRate > avgWinRate + 0.05) trend = 'improving';
    if (winRate < avgWinRate - 0.05) trend = 'declining';

    return {
      teamKey: team.teamKey,
      teamName: team.teamName,
      currentRank: team.rank,
      projectedRank: 0, // Will be calculated after sorting
      currentWins: team.wins,
      currentLosses: team.losses,
      currentTies: team.ties,
      projectedWins: team.wins + projectedAdditionalWins,
      projectedLosses: team.losses + projectedAdditionalLosses,
      projectedTies: team.ties, // Keep ties constant
      winPace: Math.round(winPace * 100) / 100,
      gamesPlayed,
      gamesRemaining,
      isCurrentUser: team.isCurrentUser,
      trend,
    };
  });

  // Calculate projected ranks based on projected wins
  const sortedByProjectedWins = [...projections].sort((a, b) => {
    // Sort by projected wins descending, then by current rank as tiebreaker
    if (b.projectedWins !== a.projectedWins) {
      return b.projectedWins - a.projectedWins;
    }
    return a.currentRank - b.currentRank;
  });

  // Assign projected ranks
  sortedByProjectedWins.forEach((p, index) => {
    const original = projections.find(proj => proj.teamKey === p.teamKey);
    if (original) {
      original.projectedRank = index + 1;
    }
  });

  return projections;
}

/**
 * Calculate playoff odds and magic/elimination numbers
 */
function calculatePlayoffOdds(
  projections: StandingsProjection[],
  playoffSpots: number,
  totalWeeks: number,
  currentWeek: number
): PlayoffOdds[] {
  const weeksRemaining = totalWeeks - (currentWeek - 1);
  const sortedByWins = [...projections].sort((a, b) => b.currentWins - a.currentWins);

  // Estimate max remaining wins (varies by league format)
  // Assuming average 9 categories per matchup
  const avgCatsPerMatchup = 9;
  const maxRemainingWins = weeksRemaining * avgCatsPerMatchup;

  return projections.map(team => {
    // Find the team currently at the playoff cutoff
    const cutoffTeam = sortedByWins[playoffSpots - 1];
    const firstOutTeam = sortedByWins[playoffSpots];

    // Magic number: wins needed + cutoff team's losses remaining
    // Simplified: wins above cutoff + buffer
    let magicNumber: number | null = null;
    let eliminationNumber: number | null = null;
    let clinched = false;
    let eliminated = false;

    if (team.currentRank <= playoffSpots) {
      // In playoff position
      // Magic number = wins needed so that last playoff team can't catch up
      if (firstOutTeam && weeksRemaining > 0) {
        const winGap = team.currentWins - firstOutTeam.currentWins;
        magicNumber = Math.max(0, maxRemainingWins - winGap);
        if (magicNumber <= 0) {
          clinched = true;
          magicNumber = null;
        }
      }
    } else {
      // Outside playoff position
      // Elimination number = losses before we can't catch cutoff
      if (cutoffTeam && weeksRemaining > 0) {
        const winsNeeded = cutoffTeam.currentWins - team.currentWins + 1;
        eliminationNumber = Math.max(0, maxRemainingWins - winsNeeded + 1);
        if (team.currentWins + maxRemainingWins < cutoffTeam.currentWins) {
          eliminated = true;
          eliminationNumber = null;
        }
      }
    }

    // Calculate playoff odds (simplified probability model)
    // Based on projected rank and variance
    let playoffOdds = 0;

    if (clinched) {
      playoffOdds = 100;
    } else if (eliminated) {
      playoffOdds = 0;
    } else {
      // Use projected rank with some uncertainty
      const rankDiff = playoffSpots - team.projectedRank;
      const seasonProgress = (currentWeek - 1) / totalWeeks;

      // More certain as season progresses
      const uncertainty = Math.max(0.1, 1 - seasonProgress);

      if (team.projectedRank <= playoffSpots) {
        // Projected in playoffs
        playoffOdds = Math.min(95, 50 + (rankDiff + 1) * 15 * (1 + seasonProgress));
      } else {
        // Projected out
        playoffOdds = Math.max(5, 50 - Math.abs(rankDiff) * 15 * (1 + seasonProgress));
      }

      // Adjust based on how close they are to cutoff
      if (team.currentRank === playoffSpots) {
        playoffOdds = 50 + (team.projectedRank <= playoffSpots ? 10 : -10);
      }
      if (team.currentRank === playoffSpots + 1) {
        playoffOdds = 40;
      }
    }

    // Bye odds (top 2 get byes typically)
    const byeSpots = Math.floor(playoffSpots / 4) || 1;
    let byeOdds = 0;
    if (team.projectedRank <= byeSpots) {
      byeOdds = Math.min(80, playoffOdds * 0.6);
    }

    return {
      teamKey: team.teamKey,
      teamName: team.teamName,
      currentRank: team.currentRank,
      playoffOdds: Math.round(playoffOdds),
      byeOdds: Math.round(byeOdds),
      magicNumber,
      eliminationNumber,
      isCurrentUser: team.isCurrentUser,
      clinched,
      eliminated,
    };
  });
}

/**
 * Get season standings projections
 */
router.get('/leagues/:league_key/outlook/standings', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get current standings
    const standingsData = await makeYahooRequest(user.id, `/league/${league_key}/standings`);

    const { teams, currentWeek, totalWeeks, playoffStartWeek, playoffSpots } =
      parseStandingsData(standingsData);

    // Project standings
    const projections = projectStandings(teams, currentWeek, totalWeeks);

    // Sort by current rank for display
    projections.sort((a, b) => a.currentRank - b.currentRank);

    // Find user's team
    const userTeam = projections.find(p => p.isCurrentUser);

    res.json({
      season: {
        currentWeek,
        totalWeeks,
        playoffStartWeek,
        weeksRemaining: totalWeeks - (currentWeek - 1),
        playoffSpots,
        teamCount: teams.length,
      },
      projections,
      userTeam: userTeam ? {
        currentRank: userTeam.currentRank,
        projectedRank: userTeam.projectedRank,
        projectedWins: userTeam.projectedWins,
        trend: userTeam.trend,
        rankChange: userTeam.currentRank - userTeam.projectedRank,
      } : null,
      insights: {
        earlySeasonWarning: currentWeek <= 4,
        message: currentWeek <= 4
          ? 'Early season projections have high variance. Results will become more accurate as the season progresses.'
          : currentWeek >= totalWeeks - 2
          ? 'Late season - projections are highly accurate.'
          : null,
      },
    });
  } catch (error: any) {
    console.error('Outlook standings error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch standings outlook',
    });
  }
});

/**
 * Get playoff odds and scenarios
 */
router.get('/leagues/:league_key/outlook/playoffs', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;

    // Get current standings
    const standingsData = await makeYahooRequest(user.id, `/league/${league_key}/standings`);

    const { teams, currentWeek, totalWeeks, playoffStartWeek, playoffSpots } =
      parseStandingsData(standingsData);

    // Get projections first
    const projections = projectStandings(teams, currentWeek, totalWeeks);

    // Calculate playoff odds
    const playoffOdds = calculatePlayoffOdds(projections, playoffSpots, totalWeeks, currentWeek);

    // Sort by playoff odds descending
    playoffOdds.sort((a, b) => b.playoffOdds - a.playoffOdds);

    // Find user's team
    const userTeam = playoffOdds.find(p => p.isCurrentUser);

    // Calculate some derived insights
    const teamsCliched = playoffOdds.filter(t => t.clinched).length;
    const teamsEliminated = playoffOdds.filter(t => t.eliminated).length;
    const raceTeams = playoffOdds.filter(t => !t.clinched && !t.eliminated && t.playoffOdds >= 10 && t.playoffOdds <= 90);

    res.json({
      season: {
        currentWeek,
        totalWeeks,
        playoffStartWeek,
        weeksRemaining: totalWeeks - (currentWeek - 1),
        playoffSpots,
        teamCount: teams.length,
      },
      playoffOdds,
      userTeam: userTeam ? {
        playoffOdds: userTeam.playoffOdds,
        byeOdds: userTeam.byeOdds,
        magicNumber: userTeam.magicNumber,
        eliminationNumber: userTeam.eliminationNumber,
        clinched: userTeam.clinched,
        eliminated: userTeam.eliminated,
        currentRank: userTeam.currentRank,
      } : null,
      raceStatus: {
        clinched: teamsCliched,
        eliminated: teamsEliminated,
        inTheRace: raceTeams.length,
        tightRaces: raceTeams.filter(t => t.playoffOdds >= 40 && t.playoffOdds <= 60).length,
      },
      insights: {
        earlySeasonWarning: currentWeek <= 4,
        message: currentWeek <= 4
          ? 'Playoff odds are volatile early in the season. Focus on building your roster.'
          : teamsCliched === playoffSpots
          ? 'All playoff spots have been clinched!'
          : raceTeams.length > 2
          ? `${raceTeams.length} teams are still fighting for playoff spots.`
          : null,
      },
    });
  } catch (error: any) {
    console.error('Outlook playoffs error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to fetch playoff outlook',
    });
  }
});

// ============================================================
// Player Comparison Endpoints
// ============================================================

/**
 * Search for players by name in a league
 * Returns basic player info for selection UI
 */
router.get('/leagues/:league_key/players/search', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { q, status = 'ALL' } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Search players - Yahoo requires search parameter
    const endpoint = `/league/${league_key}/players;search=${encodeURIComponent(q)};status=${status};count=25`;
    const data = await makeYahooRequest(user.id, endpoint);

    const playersData = data?.fantasy_content?.league?.[1]?.players;
    const playerCount = playersData?.count || 0;
    const players: any[] = [];

    for (let i = 0; i < playerCount; i++) {
      const playerArray = playersData?.[i]?.player;
      if (!playerArray) continue;

      // Parse player props
      const props = playerArray[0] || [];
      const merged: Record<string, any> = {};

      for (const prop of props) {
        if (prop && typeof prop === 'object') {
          Object.assign(merged, prop);
        }
      }

      players.push({
        playerKey: merged.player_key || '',
        name: merged.name?.full || 'Unknown',
        firstName: merged.name?.first || '',
        lastName: merged.name?.last || '',
        position: merged.display_position || merged.primary_position || '',
        team: merged.editorial_team_abbr || '',
        teamFull: merged.editorial_team_full_name || '',
        imageUrl: merged.image_url || merged.headshot?.url || '',
        status: merged.status || '',
        percentOwned: parseFloat(merged.percent_owned?.value) || 0,
        isUndroppable: merged.is_undroppable === '1',
      });
    }

    res.json({
      query: q,
      players,
      count: players.length,
    });
  } catch (error: any) {
    console.error('Player search error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to search players',
    });
  }
});

/**
 * Compare multiple players side-by-side
 * Accepts 2-4 player keys, returns detailed stat comparison
 */
router.post('/leagues/:league_key/players/compare', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { playerKeys } = req.body;

    // Validate input
    if (!Array.isArray(playerKeys) || playerKeys.length < 2 || playerKeys.length > 4) {
      return res.status(400).json({ error: 'Must provide 2-4 player keys for comparison' });
    }

    // Get league settings to know which categories to compare
    const settingsData = await makeYahooRequest(user.id, `/league/${league_key}/settings`);
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];

    // Get scoring categories (filter out display-only stats)
    const statCategories = (settings?.stat_categories?.stats || [])
      .map((s: any) => s.stat)
      .filter((stat: any) => !stat?.is_only_display_stat);

    // Fetch all player stats in parallel
    const playerPromises = playerKeys.map((playerKey: string) =>
      makeYahooRequest(user.id, `/player/${playerKey}/stats`)
    );

    const playerResults = await Promise.all(playerPromises);

    // Parse player data
    const players: PlayerStats[] = [];

    for (const result of playerResults) {
      const playerArray = result?.fantasy_content?.player;
      if (!playerArray) continue;

      const parsed = parseYahooPlayerData(playerArray);
      if (parsed) {
        players.push(parsed);
      }
    }

    if (players.length < 2) {
      return res.status(400).json({ error: 'Could not retrieve data for enough players' });
    }

    // Compare players
    const comparison = comparePlayers(players, statCategories);

    res.json(comparison);
  } catch (error: any) {
    console.error('Player comparison error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to compare players',
    });
  }
});

// ============================================================
// Waiver Advisor Endpoints
// ============================================================

/**
 * Get waiver wire recommendations based on team needs
 */
router.get('/leagues/:league_key/waiver/recommendations', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { position, limit = '10' } = req.query;

    // Fetch data in parallel
    const [settingsData, scoreboardData, rostersData, faData, teamsStatsData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}/scoreboard`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/roster/players/stats`),
      makeYahooRequest(user.id, `/league/${league_key}/players;status=FA;count=50;sort=PTS`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/stats`),
    ]);

    // Get stat categories
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const statCategories = (settings?.stat_categories?.stats || [])
      .map((s: any) => s.stat)
      .filter((stat: any) => stat && !stat.is_only_display_stat);

    // Get week dates for schedule
    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    const firstMatchup = scoreboard?.['0']?.matchups?.['0']?.matchup;
    const weekStart = firstMatchup?.week_start;
    const weekEnd = firstMatchup?.week_end;

    // Get games per team for the week
    let gamesPerTeam: Record<string, number> = {};
    if (weekStart && weekEnd) {
      try {
        const scheduleAnalysis = await ballDontLieService.getScheduleAnalysis(weekStart, weekEnd);
        // Extract just the total count from each team's schedule
        for (const [team, data] of Object.entries(scheduleAnalysis.gamesPerTeam || {})) {
          gamesPerTeam[team] = data.total;
        }
      } catch (err) {
        console.warn('Could not fetch schedule:', err);
      }
    }

    // Parse user's roster stats
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;
    const teamCount = teams?.count || 0;
    let userTeamStats: Record<string, number> = {};
    let userRoster: WaiverPlayerStats[] = [];

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
        // Get team stats
        const teamStatsArr = team[1]?.team_stats?.stats || [];
        for (const statEntry of teamStatsArr) {
          if (statEntry?.stat) {
            const statId = statEntry.stat.stat_id?.toString();
            const value = parseFloat(statEntry.stat.value) || 0;
            if (statId) userTeamStats[statId] = value;
          }
        }

        // Parse roster
        const roster = team[1]?.roster?.['0']?.players;
        if (roster) {
          const playerCount = roster.count || 0;
          for (let p = 0; p < playerCount; p++) {
            const player = roster[p]?.player;
            if (player) {
              const parsed = parseYahooPlayer(player);
              if (parsed) userRoster.push(parsed);
            }
          }
        }
        break;
      }
    }

    // Calculate league averages from all teams
    const allTeamStats: Record<string, number>[] = [];
    const teamsData = teamsStatsData?.fantasy_content?.league?.[1]?.teams;
    const allTeamCount = teamsData?.count || 0;

    for (let i = 0; i < allTeamCount; i++) {
      const team = teamsData?.[i]?.team;
      if (!team) continue;

      const teamStatsArr = team[1]?.team_stats?.stats || [];
      const stats: Record<string, number> = {};
      for (const statEntry of teamStatsArr) {
        if (statEntry?.stat) {
          const statId = statEntry.stat.stat_id?.toString();
          const value = parseFloat(statEntry.stat.value) || 0;
          if (statId) stats[statId] = value;
        }
      }
      allTeamStats.push(stats);
    }

    const leagueAverages = calculateLeagueAverages(allTeamStats);

    // Analyze team needs
    const teamNeeds = analyzeTeamNeeds(userTeamStats, leagueAverages, statCategories);

    // Parse free agents
    const freeAgents: WaiverPlayerStats[] = [];
    const faPlayers = faData?.fantasy_content?.league?.[1]?.players;
    const faCount = faPlayers?.count || 0;

    for (let i = 0; i < faCount; i++) {
      const player = faPlayers?.[i]?.player;
      if (player) {
        const parsed = parseYahooPlayer(player);
        if (parsed) freeAgents.push(parsed);
      }
    }

    // Generate recommendations
    const positionFilter = position && typeof position === 'string' ? position : undefined;
    const recommendations = generateRecommendations(
      freeAgents,
      teamNeeds,
      statCategories,
      gamesPerTeam,
      parseInt(limit as string, 10) || 10,
      positionFilter
    );

    res.json({
      recommendations,
      teamNeeds,
      weekStart,
      weekEnd,
      rosterSize: userRoster.length,
      freeAgentsAvailable: freeAgents.length,
    });
  } catch (error: any) {
    console.error('Waiver recommendations error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to get waiver recommendations',
    });
  }
});

/**
 * Get drop suggestions from user's roster
 */
router.get('/leagues/:league_key/waiver/drops', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { league_key } = req.params;
    const { limit = '5' } = req.query;

    // Fetch data in parallel
    const [settingsData, rostersData, teamsStatsData] = await Promise.all([
      makeYahooRequest(user.id, `/league/${league_key}/settings`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/roster/players/stats`),
      makeYahooRequest(user.id, `/league/${league_key}/teams/stats`),
    ]);

    // Get stat categories
    const settings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0];
    const statCategories = (settings?.stat_categories?.stats || [])
      .map((s: any) => s.stat)
      .filter((stat: any) => stat && !stat.is_only_display_stat);

    // Parse user's roster
    const teams = rostersData?.fantasy_content?.league?.[1]?.teams;
    const teamCount = teams?.count || 0;
    let userTeamStats: Record<string, number> = {};
    let userRoster: WaiverPlayerStats[] = [];

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
        // Get team stats
        const teamStatsArr = team[1]?.team_stats?.stats || [];
        for (const statEntry of teamStatsArr) {
          if (statEntry?.stat) {
            const statId = statEntry.stat.stat_id?.toString();
            const value = parseFloat(statEntry.stat.value) || 0;
            if (statId) userTeamStats[statId] = value;
          }
        }

        // Parse roster
        const roster = team[1]?.roster?.['0']?.players;
        if (roster) {
          const playerCount = roster.count || 0;
          for (let p = 0; p < playerCount; p++) {
            const player = roster[p]?.player;
            if (player) {
              const parsed = parseYahooPlayer(player);
              if (parsed) userRoster.push(parsed);
            }
          }
        }
        break;
      }
    }

    // Calculate league averages
    const allTeamStats: Record<string, number>[] = [];
    const teamsData = teamsStatsData?.fantasy_content?.league?.[1]?.teams;
    const allTeamCount = teamsData?.count || 0;

    for (let i = 0; i < allTeamCount; i++) {
      const team = teamsData?.[i]?.team;
      if (!team) continue;

      const teamStatsArr = team[1]?.team_stats?.stats || [];
      const stats: Record<string, number> = {};
      for (const statEntry of teamStatsArr) {
        if (statEntry?.stat) {
          const statId = statEntry.stat.stat_id?.toString();
          const value = parseFloat(statEntry.stat.value) || 0;
          if (statId) stats[statId] = value;
        }
      }
      allTeamStats.push(stats);
    }

    const leagueAverages = calculateLeagueAverages(allTeamStats);

    // Analyze team needs
    const teamNeeds = analyzeTeamNeeds(userTeamStats, leagueAverages, statCategories);

    // Find drop candidates
    const dropCandidates = identifyDropCandidates(
      userRoster,
      teamNeeds,
      statCategories,
      parseInt(limit as string, 10) || 5
    );

    res.json({
      dropCandidates,
      teamNeeds,
      rosterSize: userRoster.length,
    });
  } catch (error: any) {
    console.error('Waiver drops error:', error);
    res.status(error.message === 'Yahoo account not connected' ? 403 : 500).json({
      error: error.message || 'Failed to get drop suggestions',
    });
  }
});

export const fantasyRoutes = router;
