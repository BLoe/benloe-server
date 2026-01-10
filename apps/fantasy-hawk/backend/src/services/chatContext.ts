/**
 * Chat Context Service
 * Builds dynamic context for AI chat based on user's fantasy data
 */

// Simple in-memory cache for context data
const contextCache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Topic keywords for context selection
const TOPIC_PATTERNS = {
  streaming: ['stream', 'pickup', 'add player', 'waiver', 'free agent', 'schedule', 'games this week'],
  trade: ['trade', 'deal', 'swap', 'send', 'receive', 'other team', 'their roster'],
  matchup: ['matchup', 'opponent', 'this week', 'winning', 'losing', 'categories', 'beat'],
  roster: ['roster', 'my team', 'my players', 'lineup', 'start', 'bench', 'drop'],
  punt: ['punt', 'punting', 'strategy', 'build', 'categories to ignore'],
};

export type TopicType = 'streaming' | 'trade' | 'matchup' | 'roster' | 'punt' | 'general';

/**
 * Detect the main topic from user messages
 */
export function detectTopic(messages: { role: string; content: string }[]): TopicType {
  // Get last 3 user messages to analyze
  const recentUserMessages = messages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content.toLowerCase())
    .join(' ');

  // Check for topic keywords
  for (const [topic, patterns] of Object.entries(TOPIC_PATTERNS)) {
    for (const pattern of patterns) {
      if (recentUserMessages.includes(pattern)) {
        return topic as TopicType;
      }
    }
  }

  return 'general';
}

/**
 * Get cached data or null if expired
 */
function getCached<T>(key: string): T | null {
  const cached = contextCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }
  contextCache.delete(key);
  return null;
}

/**
 * Set cache with expiry
 */
function setCache(key: string, data: any): void {
  contextCache.set(key, {
    data,
    expires: Date.now() + CACHE_TTL,
  });
}

/**
 * Parse team data from Yahoo response
 */
function parseTeamData(team: any[]): any {
  const props = team[0] || [];
  const merged: any = {};
  for (const prop of props) {
    if (prop && typeof prop === 'object') {
      Object.assign(merged, prop);
    }
  }
  return merged;
}

/**
 * Build context summary for roster topic
 */
function buildRosterContext(rosterData: any): string {
  try {
    const roster = rosterData?.fantasy_content?.team?.[1]?.roster?.['0']?.players || {};
    const playerCount = roster.count || 0;

    const players: string[] = [];
    for (let i = 0; i < playerCount && i < 15; i++) {
      const player = roster[i]?.player;
      if (player) {
        const playerInfo = player[0] || [];
        const name = playerInfo.find((p: any) => p?.name?.full)?.name?.full || 'Unknown';
        const position = playerInfo.find((p: any) => p?.display_position)?.display_position || '';
        const team = playerInfo.find((p: any) => p?.editorial_team_abbr)?.editorial_team_abbr || '';
        players.push(`${name} (${position}, ${team})`);
      }
    }

    return players.length > 0
      ? `Current Roster: ${players.join(', ')}`
      : 'Roster data not available';
  } catch {
    return 'Roster data not available';
  }
}

/**
 * Build context summary for matchup topic
 */
function buildMatchupContext(scoreboardData: any, settings: any): string {
  try {
    const scoreboard = scoreboardData?.fantasy_content?.league?.[1]?.scoreboard;
    if (!scoreboard) return 'No active matchup';

    const matchups = scoreboard['0']?.matchups;
    const matchupCount = matchups?.count || 0;

    // Find user's matchup
    for (let i = 0; i < matchupCount; i++) {
      const matchup = matchups?.[i]?.matchup;
      if (!matchup) continue;

      const teams = matchup['0']?.teams;
      if (!teams) continue;

      for (let t = 0; t < 2; t++) {
        const team = teams?.[t]?.team;
        if (!team) continue;

        const teamProps = team[0] || [];
        const isUserTeam = teamProps.some((p: any) => p?.is_owned_by_current_login === 1);

        if (isUserTeam) {
          const userTeamData = parseTeamData(team);
          const oppTeam = teams[t === 0 ? 1 : 0]?.team;
          const oppTeamData = parseTeamData(oppTeam || []);

          // Get stats
          const userStats = team[1]?.team_stats?.stats || [];
          const oppStats = oppTeam?.[1]?.team_stats?.stats || [];

          // Extract stat categories from settings
          const statCategories = settings?.stat_categories?.stats || [];

          let wins = 0, losses = 0, ties = 0;
          const categoryDetails: string[] = [];

          for (let s = 0; s < Math.min(userStats.length, 9); s++) {
            const userStat = userStats[s]?.stat;
            const oppStat = oppStats[s]?.stat;
            const catInfo = statCategories[s]?.stat;

            if (userStat && oppStat && catInfo) {
              const userVal = parseFloat(userStat.value || '0');
              const oppVal = parseFloat(oppStat.value || '0');
              const isNegative = catInfo.name?.toLowerCase().includes('turnover');

              let status: string;
              if (userVal === oppVal) {
                ties++;
                status = 'T';
              } else if (isNegative ? userVal < oppVal : userVal > oppVal) {
                wins++;
                status = 'W';
              } else {
                losses++;
                status = 'L';
              }

              categoryDetails.push(`${catInfo.display_name || catInfo.name}: ${userVal} vs ${oppVal} (${status})`);
            }
          }

          return `Matchup: ${userTeamData.name || 'You'} vs ${oppTeamData.name || 'Opponent'} (Week ${matchup.week || '?'})
Score: ${wins}-${losses}-${ties}
Categories: ${categoryDetails.join('; ')}`;
        }
      }
    }

    return 'No active matchup found (possibly bye week)';
  } catch (err) {
    return 'Error parsing matchup data';
  }
}

/**
 * Build context for streaming topic
 */
function buildStreamingContext(scheduleData: any): string {
  try {
    if (!scheduleData?.schedule?.gamesByDate) {
      return 'Schedule data not available';
    }

    const dates = Object.keys(scheduleData.schedule.gamesByDate).sort();
    const gamesPerTeam = scheduleData.schedule.gamesPerTeam || {};

    // Find teams with most games
    const teamGames = Object.entries(gamesPerTeam)
      .map(([team, data]: [string, any]) => ({ team, games: data.total || 0 }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);

    return `Week Schedule: ${dates.length} game days remaining
Top teams by games: ${teamGames.map(t => `${t.team} (${t.games}g)`).join(', ')}`;
  } catch {
    return 'Schedule data not available';
  }
}

/**
 * Build full context for chat
 */
export interface ChatContext {
  systemPrompt: string;
  topic: TopicType;
}

export interface ContextInputs {
  leagueName: string;
  currentWeek: string;
  statCategories: string;
  matchupSummary: string;
  rosterSummary?: string;
  scheduleSummary?: string;
}

export function buildSystemPrompt(inputs: ContextInputs, topic: TopicType): string {
  let topicContext = '';

  switch (topic) {
    case 'streaming':
      topicContext = `
The user is asking about streaming strategy or player pickups.
${inputs.scheduleSummary || ''}
Focus on: Schedule-based pickups, short-term value, games this week.`;
      break;
    case 'trade':
      topicContext = `
The user is asking about trades.
Focus on: Player values, category fit, trade targets, sell-high/buy-low opportunities.`;
      break;
    case 'matchup':
      topicContext = `
The user is asking about their current matchup.
${inputs.matchupSummary}
Focus on: Category battles, strategies to win close categories, punt decisions.`;
      break;
    case 'roster':
      topicContext = `
The user is asking about their roster.
${inputs.rosterSummary || ''}
Focus on: Lineup decisions, player values, roster construction.`;
      break;
    case 'punt':
      topicContext = `
The user is asking about punt strategies.
Focus on: Category correlations, build archetypes, long-term strategy.`;
      break;
    default:
      topicContext = inputs.matchupSummary;
  }

  return `You are an expert fantasy basketball assistant helping a user with their Yahoo Fantasy Basketball team.

LEAGUE INFO:
- League: ${inputs.leagueName}
- Current Week: ${inputs.currentWeek}
- Scoring Categories: ${inputs.statCategories}

CURRENT SITUATION:
${topicContext}

INSTRUCTIONS:
- Provide concise, actionable fantasy basketball advice
- Reference specific categories when relevant
- Be conversational but focused on helping the user win
- If you don't have specific data, give general strategic advice
- Keep responses focused and to the point (aim for 2-3 paragraphs max)`;
}

export { buildRosterContext, buildMatchupContext, buildStreamingContext, getCached, setCache };
