/**
 * Waiver Analysis Service
 * Provides waiver wire recommendations and drop suggestions
 */

export interface StatCategory {
  stat_id: string;
  name: string;
  display_name?: string;
  abbr?: string;
  is_only_display_stat?: string;
}

export interface PlayerStats {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  imageUrl?: string;
  status?: string;
  percentOwned: number;
  gamesPlayed: number;
  stats: Record<string, number>;
  averages: Record<string, number>;
}

export interface TeamNeeds {
  strong: string[];   // Categories where team is strong
  weak: string[];     // Categories where team needs help
  neutral: string[];  // Average categories
}

export interface WaiverRecommendation {
  player: PlayerStats;
  score: number;
  reason: string;
  fillsNeeds: string[];
  gamesThisWeek: number;
  trend: 'rising' | 'falling' | 'stable';
  priority: 'high' | 'medium' | 'low';
}

export interface DropCandidate {
  player: PlayerStats;
  score: number;
  reason: string;
  weakCategories: string[];
}

/**
 * Determines if a stat category is "negative" (lower is better)
 */
export function isNegativeCategory(category: StatCategory): boolean {
  const name = category.name?.toLowerCase() || '';
  const abbr = category.abbr || '';
  return name.includes('turnover') || abbr === 'TO';
}

/**
 * Calculates per-game averages from total stats
 */
export function calculateAverages(
  stats: Record<string, number>,
  gamesPlayed: number
): Record<string, number> {
  if (gamesPlayed <= 0) return {};

  const averages: Record<string, number> = {};
  for (const [statId, value] of Object.entries(stats)) {
    averages[statId] = value / gamesPlayed;
  }
  return averages;
}

/**
 * Parses Yahoo player data into PlayerStats format
 */
export function parseYahooPlayer(playerData: any, statsData?: any[]): PlayerStats | null {
  if (!playerData) return null;

  // Parse player props from Yahoo's nested array format
  const props = playerData[0] || [];
  const merged: Record<string, any> = {};

  for (const prop of props) {
    if (prop && typeof prop === 'object') {
      Object.assign(merged, prop);
    }
  }

  // Get player stats
  const playerStats = statsData || playerData[1]?.player_stats?.stats || [];
  const stats: Record<string, number> = {};

  for (const statEntry of playerStats) {
    if (statEntry?.stat) {
      const statId = statEntry.stat.stat_id?.toString();
      const value = parseFloat(statEntry.stat.value) || 0;
      if (statId) {
        stats[statId] = value;
      }
    }
  }

  // Games played is typically stat_id 0
  const gamesPlayed = stats['0'] || 0;

  return {
    playerKey: merged.player_key || '',
    name: merged.name?.full || 'Unknown',
    position: merged.display_position || merged.primary_position || '',
    team: merged.editorial_team_abbr || '',
    imageUrl: merged.image_url || merged.headshot?.url || '',
    status: merged.status || '',
    percentOwned: parseFloat(merged.percent_owned?.value) || 0,
    gamesPlayed,
    stats,
    averages: calculateAverages(stats, gamesPlayed),
  };
}

/**
 * Analyzes team's category strengths/weaknesses compared to league
 */
export function analyzeTeamNeeds(
  teamStats: Record<string, number>,
  leagueAverages: Record<string, number>,
  categories: StatCategory[]
): TeamNeeds {
  const strong: string[] = [];
  const weak: string[] = [];
  const neutral: string[] = [];

  for (const cat of categories) {
    if (!cat?.stat_id || cat.is_only_display_stat === '1') continue;

    const statId = cat.stat_id.toString();
    const teamValue = teamStats[statId] || 0;
    const leagueAvg = leagueAverages[statId] || 0;

    if (leagueAvg === 0) {
      neutral.push(statId);
      continue;
    }

    const ratio = teamValue / leagueAvg;
    const isNegative = isNegativeCategory(cat);

    // For negative categories, lower is better
    if (isNegative) {
      if (ratio <= 0.9) strong.push(statId);
      else if (ratio >= 1.1) weak.push(statId);
      else neutral.push(statId);
    } else {
      if (ratio >= 1.1) strong.push(statId);
      else if (ratio <= 0.9) weak.push(statId);
      else neutral.push(statId);
    }
  }

  return { strong, weak, neutral };
}

/**
 * Scores a player based on team needs
 * Higher score = better fit for team
 */
export function scorePlayerForNeeds(
  player: PlayerStats,
  teamNeeds: TeamNeeds,
  categories: StatCategory[]
): { score: number; fillsNeeds: string[] } {
  let score = 0;
  const fillsNeeds: string[] = [];

  for (const cat of categories) {
    if (!cat?.stat_id || cat.is_only_display_stat === '1') continue;

    const statId = cat.stat_id.toString();
    const playerValue = player.averages[statId] || 0;

    if (playerValue === 0) continue;

    const isNegative = isNegativeCategory(cat);

    // If player is strong where team is weak = high value
    if (teamNeeds.weak.includes(statId)) {
      // For negative categories, low value is good
      if (isNegative) {
        // Player with low turnovers helps a team with high turnovers
        score += 3;
      } else {
        score += 3;
      }
      fillsNeeds.push(cat.abbr || cat.display_name || statId);
    }

    // If player is strong where team is neutral = medium value
    if (teamNeeds.neutral.includes(statId)) {
      score += 1;
    }

    // If player hurts where team is weak = negative
    if (teamNeeds.strong.includes(statId)) {
      // Already strong, less value
      score += 0.5;
    }
  }

  // Bonus for ownership percentage (higher owned = likely better)
  score += player.percentOwned * 0.02;

  // Bonus for games played (established players)
  if (player.gamesPlayed > 20) {
    score += 1;
  }

  return { score, fillsNeeds };
}

/**
 * Determines player's ownership trend
 */
export function getOwnershipTrend(percentOwned: number): 'rising' | 'falling' | 'stable' {
  // Without historical data, we estimate based on current ownership
  // In a real implementation, you'd track this over time
  if (percentOwned < 20) return 'stable';
  if (percentOwned > 60) return 'stable';
  // Middle range could be rising or stable
  return 'stable';
}

/**
 * Generates waiver recommendations based on team needs and available players
 */
export function generateRecommendations(
  freeAgents: PlayerStats[],
  teamNeeds: TeamNeeds,
  categories: StatCategory[],
  gamesPerTeam: Record<string, number>,
  limit: number = 10,
  positionFilter?: string
): WaiverRecommendation[] {
  // Filter by position if specified
  let candidates = freeAgents;
  if (positionFilter && positionFilter !== 'All') {
    candidates = freeAgents.filter((p) =>
      p.position.includes(positionFilter)
    );
  }

  // Filter out injured players
  candidates = candidates.filter(
    (p) => !['IL', 'IL+', 'O', 'OUT'].includes(p.status?.toUpperCase() || '')
  );

  // Score each player
  const scoredPlayers = candidates.map((player) => {
    const { score, fillsNeeds } = scorePlayerForNeeds(player, teamNeeds, categories);
    const gamesThisWeek = gamesPerTeam[player.team?.toUpperCase()] || 0;
    const trend = getOwnershipTrend(player.percentOwned);

    // Boost score for games this week
    const adjustedScore = score + (gamesThisWeek * 0.5);

    // Determine priority
    let priority: 'high' | 'medium' | 'low' = 'low';
    if (adjustedScore >= 8) priority = 'high';
    else if (adjustedScore >= 5) priority = 'medium';

    // Generate reason
    let reason = '';
    if (fillsNeeds.length > 0) {
      reason = `Helps in ${fillsNeeds.slice(0, 3).join(', ')}`;
    } else if (gamesThisWeek >= 4) {
      reason = `${gamesThisWeek} games this week`;
    } else {
      reason = `${player.percentOwned.toFixed(0)}% owned`;
    }

    return {
      player,
      score: adjustedScore,
      reason,
      fillsNeeds,
      gamesThisWeek,
      trend,
      priority,
    };
  });

  // Sort by score descending
  scoredPlayers.sort((a, b) => b.score - a.score);

  return scoredPlayers.slice(0, limit);
}

/**
 * Identifies players that could be dropped from roster
 */
export function identifyDropCandidates(
  roster: PlayerStats[],
  teamNeeds: TeamNeeds,
  categories: StatCategory[],
  limit: number = 5
): DropCandidate[] {
  const candidates: DropCandidate[] = [];

  for (const player of roster) {
    // Don't suggest dropping injured reserve eligible players
    const status = player.status?.toUpperCase() || '';
    if (['IL', 'IL+'].includes(status)) continue;

    let score = 0;
    const weakCategories: string[] = [];

    for (const cat of categories) {
      if (!cat?.stat_id || cat.is_only_display_stat === '1') continue;

      const statId = cat.stat_id.toString();
      const playerValue = player.averages[statId] || 0;
      const isNegative = isNegativeCategory(cat);

      // If player is weak where team is weak, less valuable
      if (teamNeeds.weak.includes(statId)) {
        if (isNegative && playerValue > 2) {
          score += 2;
          weakCategories.push(cat.abbr || cat.display_name || statId);
        } else if (!isNegative && playerValue < 5) {
          score += 2;
          weakCategories.push(cat.abbr || cat.display_name || statId);
        }
      }

      // Low games played = potentially droppable
      if (player.gamesPlayed < 10 && player.gamesPlayed > 0) {
        score += 1;
      }
    }

    // Lower ownership could indicate droppable
    if (player.percentOwned < 30) {
      score += 2;
    }

    // Generate reason
    let reason = '';
    if (weakCategories.length > 0) {
      reason = `Weak in ${weakCategories.slice(0, 3).join(', ')}`;
    } else if (player.percentOwned < 30) {
      reason = `Only ${player.percentOwned.toFixed(0)}% owned`;
    } else {
      reason = 'Underperforming';
    }

    if (score >= 2) {
      candidates.push({
        player,
        score,
        reason,
        weakCategories,
      });
    }
  }

  // Sort by score descending (higher = more droppable)
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, limit);
}

/**
 * Calculates league average stats from all team stats
 */
export function calculateLeagueAverages(
  teamStats: Record<string, number>[]
): Record<string, number> {
  if (teamStats.length === 0) return {};

  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const stats of teamStats) {
    for (const [statId, value] of Object.entries(stats)) {
      totals[statId] = (totals[statId] || 0) + value;
      counts[statId] = (counts[statId] || 0) + 1;
    }
  }

  const averages: Record<string, number> = {};
  for (const [statId, total] of Object.entries(totals)) {
    averages[statId] = total / (counts[statId] || 1);
  }

  return averages;
}

// ============================================================
// FAAB Suggestion Logic
// ============================================================

export interface FaabSuggestion {
  player: PlayerStats;
  suggestedBid: number;
  bidRangeMin: number;
  bidRangeMax: number;
  percentOfBudget: number;
  competition: 'high' | 'medium' | 'low';
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

export interface FaabContext {
  userFaabBalance: number;
  totalFaabBudget: number;
  leagueAvgFaab: number;
  weeksRemaining: number;
  isPlayoffs: boolean;
}

/**
 * Estimates competition level based on player ownership and priority
 */
export function estimateCompetition(
  percentOwned: number,
  priority: 'high' | 'medium' | 'low'
): 'high' | 'medium' | 'low' {
  // Players with rising ownership indicate more competition
  if (priority === 'high' && percentOwned > 30) return 'high';
  if (priority === 'high' || percentOwned > 50) return 'medium';
  if (percentOwned > 20) return 'low';
  return 'low';
}

/**
 * Calculates season progress factor (0 = start, 1 = end)
 * Affects bidding aggressiveness
 */
export function getSeasonProgress(weeksRemaining: number, totalWeeks: number = 20): number {
  const weeksPlayed = totalWeeks - weeksRemaining;
  return Math.max(0, Math.min(1, weeksPlayed / totalWeeks));
}

/**
 * Calculates FAAB suggestion for a player
 */
export function calculateFaabSuggestion(
  recommendation: WaiverRecommendation,
  context: FaabContext
): FaabSuggestion {
  const { player, score, priority, fillsNeeds, reason } = recommendation;
  const { userFaabBalance, totalFaabBudget, leagueAvgFaab, weeksRemaining, isPlayoffs } = context;

  // Base bid percentage based on priority
  let baseBidPercent: number;
  switch (priority) {
    case 'high':
      baseBidPercent = 0.25; // 25% of budget for must-haves
      break;
    case 'medium':
      baseBidPercent = 0.12; // 12% for strong adds
      break;
    default:
      baseBidPercent = 0.05; // 5% for speculative
  }

  // Adjust for season progress (bid more aggressively late season)
  const seasonProgress = getSeasonProgress(weeksRemaining);
  const progressMultiplier = 1 + (seasonProgress * 0.5); // Up to 50% more late season

  // Adjust for playoff push
  const playoffMultiplier = isPlayoffs ? 1.3 : 1.0;

  // Calculate suggested bid
  let suggestedBid = Math.round(
    totalFaabBudget * baseBidPercent * progressMultiplier * playoffMultiplier
  );

  // Cap at remaining budget
  suggestedBid = Math.min(suggestedBid, userFaabBalance);

  // Don't suggest more than remaining budget percentage
  const maxBudgetPercent = priority === 'high' ? 0.6 : priority === 'medium' ? 0.35 : 0.15;
  suggestedBid = Math.min(suggestedBid, Math.round(userFaabBalance * maxBudgetPercent));

  // Set range (±30% of suggested)
  const bidRangeMin = Math.max(1, Math.round(suggestedBid * 0.7));
  const bidRangeMax = Math.min(userFaabBalance, Math.round(suggestedBid * 1.3));

  // Determine competition level
  const competition = estimateCompetition(player.percentOwned, priority);

  // Adjust for competition
  if (competition === 'high') {
    suggestedBid = Math.min(userFaabBalance, Math.round(suggestedBid * 1.2));
  }

  // Generate reasoning
  let reasoning = '';
  if (priority === 'high') {
    reasoning = `High-impact pickup${fillsNeeds.length > 0 ? ` filling ${fillsNeeds.slice(0, 2).join(', ')}` : ''}`;
  } else if (priority === 'medium') {
    reasoning = `Solid addition${fillsNeeds.length > 0 ? ` for ${fillsNeeds[0]}` : ''}`;
  } else {
    reasoning = 'Low-risk speculative add';
  }

  if (competition === 'high') {
    reasoning += ' - expect competition';
  } else if (competition === 'low' && player.percentOwned < 15) {
    reasoning += ' - may clear waivers';
  }

  return {
    player,
    suggestedBid,
    bidRangeMin,
    bidRangeMax,
    percentOfBudget: Math.round((suggestedBid / totalFaabBudget) * 100),
    competition,
    reasoning,
    priority,
  };
}

/**
 * Generates FAAB suggestions for a list of recommendations
 */
export function generateFaabSuggestions(
  recommendations: WaiverRecommendation[],
  context: FaabContext,
  limit: number = 10
): FaabSuggestion[] {
  // If no budget remaining, return empty
  if (context.userFaabBalance <= 0) {
    return [];
  }

  const suggestions = recommendations
    .slice(0, limit)
    .map((rec) => calculateFaabSuggestion(rec, context));

  return suggestions;
}

/**
 * Calculates league average FAAB remaining from all teams
 */
export function calculateLeagueAvgFaab(teamFaabBalances: number[]): number {
  if (teamFaabBalances.length === 0) return 0;
  const total = teamFaabBalances.reduce((sum, balance) => sum + balance, 0);
  return Math.round(total / teamFaabBalances.length);
}
