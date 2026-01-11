/**
 * Category Analysis Service
 * Provides team profile analysis, Z-scores, rankings, and trends
 */

export interface StatCategory {
  stat_id: string;
  name: string;
  display_name?: string;
  abbr?: string;
  is_only_display_stat?: string;
}

export interface CategoryRank {
  statId: string;
  name: string;
  abbr: string;
  value: number;
  rank: number;
  classification: 'elite' | 'strong' | 'average' | 'weak';
  zScore: number;
  percentile: number;
  vsLeagueAvg: number; // percentage vs league average
}

export interface TeamProfile {
  teamKey: string;
  teamName: string;
  categories: CategoryRank[];
  archetype: string;
  puntCategories: string[];
  strengths: string[];
  weaknesses: string[];
}

export interface CategoryTrend {
  statId: string;
  abbr: string;
  weeks: { week: number; rank: number; value: number }[];
  trend: 'improving' | 'declining' | 'stable';
  rankChange: number; // positive = improved, negative = declined
}

export interface TeamComparison {
  userTeam: {
    teamKey: string;
    teamName: string;
    categories: CategoryRank[];
  };
  leagueAverages: Record<string, number>;
  leagueStdDevs: Record<string, number>;
}

/**
 * Determines if a stat category is "negative" (lower is better)
 */
export function isNegativeCategory(category: StatCategory): boolean {
  const name = category.name?.toLowerCase() || '';
  const abbr = category.abbr?.toUpperCase() || '';
  return name.includes('turnover') || abbr === 'TO';
}

/**
 * Calculate Z-score for a value
 * Z = (value - mean) / stdDev
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Convert Z-score to percentile (0-100)
 * Using standard normal distribution approximation
 */
export function zScoreToPercentile(zScore: number): number {
  // Approximate CDF of standard normal distribution
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = zScore < 0 ? -1 : 1;
  const z = Math.abs(zScore) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  const cdf = 0.5 * (1 + sign * erf);
  return Math.round(cdf * 100);
}

/**
 * Classify category performance based on rank in league
 */
export function classifyRank(rank: number, totalTeams: number): 'elite' | 'strong' | 'average' | 'weak' {
  const percentile = 1 - (rank - 1) / totalTeams;

  if (percentile >= 0.75) return 'elite';      // Top 25%
  if (percentile >= 0.5) return 'strong';      // Top 50%
  if (percentile >= 0.25) return 'average';    // Top 75%
  return 'weak';                                // Bottom 25%
}

/**
 * Calculate mean of an array
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation of an array
 */
export function calculateStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Calculate ranks for all teams in a category
 * Returns map of teamKey -> rank
 */
export function calculateRanks(
  teamValues: Record<string, number>,
  isNegative: boolean
): Record<string, number> {
  const entries = Object.entries(teamValues);

  // Sort by value (descending for positive cats, ascending for negative)
  entries.sort((a, b) => {
    if (isNegative) return a[1] - b[1]; // Lower is better
    return b[1] - a[1]; // Higher is better
  });

  const ranks: Record<string, number> = {};
  entries.forEach(([teamKey], index) => {
    ranks[teamKey] = index + 1;
  });

  return ranks;
}

/**
 * Detect team archetype based on category profile
 */
export function detectArchetype(
  categoryRanks: CategoryRank[],
  totalTeams: number
): { archetype: string; puntCategories: string[] } {
  const elite = categoryRanks.filter(c => c.classification === 'elite');
  const weak = categoryRanks.filter(c => c.classification === 'weak');

  const puntCategories = weak.map(c => c.abbr);

  // Check for common archetypes
  const eliteAbbrs = elite.map(c => c.abbr);
  const weakAbbrs = weak.map(c => c.abbr);

  // Big Man Build: Strong in REB, BLK, FG%, weak in AST, FT%, 3PM
  if (
    (eliteAbbrs.includes('REB') || eliteAbbrs.includes('BLK')) &&
    (weakAbbrs.includes('AST') || weakAbbrs.includes('3PTM') || weakAbbrs.includes('3PM'))
  ) {
    return { archetype: 'Big Man Build', puntCategories };
  }

  // Guard Heavy: Strong in AST, STL, 3PM, weak in REB, BLK
  if (
    (eliteAbbrs.includes('AST') || eliteAbbrs.includes('STL') || eliteAbbrs.includes('3PTM')) &&
    (weakAbbrs.includes('REB') || weakAbbrs.includes('BLK'))
  ) {
    return { archetype: 'Guard Heavy', puntCategories };
  }

  // Punt FT%: Strong everywhere except FT%
  if (weakAbbrs.includes('FT%') && !weakAbbrs.includes('FG%')) {
    return { archetype: 'Punt FT% Build', puntCategories };
  }

  // Punt TO: Very few turnovers (which is actually good)
  if (eliteAbbrs.includes('TO')) {
    return { archetype: 'Low Turnover Build', puntCategories };
  }

  // Balanced: No extreme weaknesses
  if (weak.length <= 1) {
    return { archetype: 'Balanced Build', puntCategories };
  }

  // Points League Focus
  if (eliteAbbrs.includes('PTS')) {
    return { archetype: 'Volume Scorer', puntCategories };
  }

  // Default
  return { archetype: 'Mixed Build', puntCategories };
}

/**
 * Determine trend based on historical ranks
 */
export function determineTrend(ranks: number[]): { trend: 'improving' | 'declining' | 'stable'; change: number } {
  if (ranks.length < 2) {
    return { trend: 'stable', change: 0 };
  }

  // Compare recent to earlier
  const recentAvg = calculateMean(ranks.slice(-Math.ceil(ranks.length / 2)));
  const earlierAvg = calculateMean(ranks.slice(0, Math.floor(ranks.length / 2)));

  const change = Math.round(earlierAvg - recentAvg); // Positive = improved (lower rank is better)

  if (change >= 2) return { trend: 'improving', change };
  if (change <= -2) return { trend: 'declining', change };
  return { trend: 'stable', change };
}

/**
 * Build team profile from category stats
 */
export function buildTeamProfile(
  teamKey: string,
  teamName: string,
  teamStats: Record<string, number>,
  allTeamStats: Record<string, Record<string, number>>,
  categories: StatCategory[]
): TeamProfile {
  const categoryRanks: CategoryRank[] = [];
  const totalTeams = Object.keys(allTeamStats).length;

  for (const cat of categories) {
    if (!cat?.stat_id || cat.is_only_display_stat === '1') continue;

    const statId = cat.stat_id.toString();
    const isNegative = isNegativeCategory(cat);

    // Get all team values for this category
    const teamValues: Record<string, number> = {};
    for (const [key, stats] of Object.entries(allTeamStats)) {
      teamValues[key] = stats[statId] || 0;
    }

    // Calculate stats
    const values = Object.values(teamValues);
    const mean = calculateMean(values);
    const stdDev = calculateStdDev(values);
    const ranks = calculateRanks(teamValues, isNegative);

    const teamValue = teamStats[statId] || 0;
    const rank = ranks[teamKey] || totalTeams;

    // For negative categories, flip the z-score interpretation
    let zScore = calculateZScore(teamValue, mean, stdDev);
    if (isNegative) zScore = -zScore; // Lower TO is better, so flip for display

    const percentile = zScoreToPercentile(zScore);
    const vsLeagueAvg = mean !== 0 ? ((teamValue - mean) / mean) * 100 : 0;

    categoryRanks.push({
      statId,
      name: cat.name || statId,
      abbr: cat.abbr || cat.display_name || statId,
      value: teamValue,
      rank,
      classification: classifyRank(rank, totalTeams),
      zScore: Math.round(zScore * 100) / 100,
      percentile,
      vsLeagueAvg: Math.round(vsLeagueAvg * 10) / 10,
    });
  }

  // Sort by rank
  categoryRanks.sort((a, b) => a.rank - b.rank);

  const { archetype, puntCategories } = detectArchetype(categoryRanks, totalTeams);

  const strengths = categoryRanks
    .filter(c => c.classification === 'elite' || c.classification === 'strong')
    .slice(0, 3)
    .map(c => `${c.abbr} (${c.rank}${getRankSuffix(c.rank)})`);

  const weaknesses = categoryRanks
    .filter(c => c.classification === 'weak')
    .slice(0, 3)
    .map(c => `${c.abbr} (${c.rank}${getRankSuffix(c.rank)})`);

  return {
    teamKey,
    teamName,
    categories: categoryRanks,
    archetype,
    puntCategories,
    strengths,
    weaknesses,
  };
}

/**
 * Get ordinal suffix for rank
 */
function getRankSuffix(rank: number): string {
  if (rank >= 11 && rank <= 13) return 'th';
  switch (rank % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Build comparison of user team vs league
 */
export function buildComparison(
  userTeamKey: string,
  userTeamName: string,
  userTeamStats: Record<string, number>,
  allTeamStats: Record<string, Record<string, number>>,
  categories: StatCategory[]
): TeamComparison {
  const leagueAverages: Record<string, number> = {};
  const leagueStdDevs: Record<string, number> = {};

  for (const cat of categories) {
    if (!cat?.stat_id || cat.is_only_display_stat === '1') continue;

    const statId = cat.stat_id.toString();
    const values = Object.values(allTeamStats).map(stats => stats[statId] || 0);

    leagueAverages[statId] = Math.round(calculateMean(values) * 100) / 100;
    leagueStdDevs[statId] = Math.round(calculateStdDev(values) * 100) / 100;
  }

  const profile = buildTeamProfile(
    userTeamKey,
    userTeamName,
    userTeamStats,
    allTeamStats,
    categories
  );

  return {
    userTeam: {
      teamKey: userTeamKey,
      teamName: userTeamName,
      categories: profile.categories,
    },
    leagueAverages,
    leagueStdDevs,
  };
}

/**
 * Parse team stats from Yahoo standings response
 */
export function parseTeamStats(teamArray: any): { teamKey: string; teamName: string; stats: Record<string, number> } | null {
  if (!Array.isArray(teamArray) || teamArray.length < 2) return null;

  const props = teamArray[0] || [];
  let teamKey = '';
  let teamName = '';

  for (const prop of props) {
    if (prop?.team_key) teamKey = prop.team_key;
    if (prop?.name) teamName = prop.name;
  }

  const statsData = teamArray[1]?.team_stats?.stats || teamArray[2]?.team_stats?.stats || [];
  const stats: Record<string, number> = {};

  for (const statEntry of statsData) {
    if (statEntry?.stat) {
      const statId = statEntry.stat.stat_id?.toString();
      const value = parseFloat(statEntry.stat.value) || 0;
      if (statId) stats[statId] = value;
    }
  }

  return { teamKey, teamName, stats };
}
