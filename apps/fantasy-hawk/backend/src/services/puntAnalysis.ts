/**
 * Punt Strategy Analysis Service
 * Analyzes team builds and provides punt strategy recommendations
 */

export interface CategoryData {
  statId: string;
  name: string;
  displayName: string;
  isNegative: boolean;
  value: number;
  rank: number;
  percentile: number;
}

export interface PuntArchetype {
  id: string;
  name: string;
  description: string;
  puntCategories: string[];
  strengthCategories: string[];
  matchScore: number;
  isRecommended: boolean;
}

export interface TeamBuildAnalysis {
  detectedBuild: string;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  categoryRanks: CategoryData[];
  archetypes: PuntArchetype[];
  recommendation: string;
}

export interface LeaguePuntStrategy {
  id: string;
  name: string;
  description: string;
  puntCategories: string[];
  strengthCategories: string[];
}

// Common punt strategy archetypes
const PUNT_ARCHETYPES: Omit<PuntArchetype, 'matchScore' | 'isRecommended'>[] = [
  {
    id: 'punt-ast',
    name: 'Punt Assists',
    description: 'Big man focus with emphasis on boards, blocks, and efficiency',
    puntCategories: ['AST', 'Assists'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'Rebounds', 'Blocks', 'Field Goal Percentage'],
  },
  {
    id: 'punt-ft',
    name: 'Punt Free Throws',
    description: 'High-volume centers and rim protectors who struggle at the line',
    puntCategories: ['FT%', 'Free Throw Percentage'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'Rebounds', 'Blocks', 'Field Goal Percentage'],
  },
  {
    id: 'punt-3pm',
    name: 'Punt Three Pointers',
    description: 'Traditional bigs and slashers who dominate inside',
    puntCategories: ['3PM', '3PTM', 'Three Pointers Made', '3-Pointers Made'],
    strengthCategories: ['REB', 'FG%', 'AST', 'Rebounds', 'Field Goal Percentage', 'Assists'],
  },
  {
    id: 'punt-to',
    name: 'Punt Turnovers',
    description: 'High-usage playmakers who dominate volume stats',
    puntCategories: ['TO', 'Turnovers'],
    strengthCategories: ['PTS', 'AST', 'STL', 'Points', 'Assists', 'Steals'],
  },
  {
    id: 'punt-blk',
    name: 'Punt Blocks',
    description: 'Guard-heavy build focused on perimeter play',
    puntCategories: ['BLK', 'Blocks'],
    strengthCategories: ['3PM', 'AST', 'STL', 'FT%', 'Three Pointers Made', 'Assists', 'Steals', 'Free Throw Percentage'],
  },
  {
    id: 'punt-fg',
    name: 'Punt Field Goal %',
    description: 'Volume shooters and three-point specialists',
    puntCategories: ['FG%', 'Field Goal Percentage'],
    strengthCategories: ['3PM', 'PTS', 'FT%', 'Three Pointers Made', 'Points', 'Free Throw Percentage'],
  },
  {
    id: 'punt-ast-ft',
    name: 'Punt AST + FT%',
    description: 'Classic big man build with traditional centers',
    puntCategories: ['AST', 'FT%', 'Assists', 'Free Throw Percentage'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'Rebounds', 'Blocks', 'Field Goal Percentage'],
  },
  {
    id: 'punt-3pm-pts',
    name: 'Punt 3PM + PTS',
    description: 'Defensive specialists and rebounders',
    puntCategories: ['3PM', 'PTS', 'Three Pointers Made', 'Points'],
    strengthCategories: ['REB', 'BLK', 'STL', 'AST', 'Rebounds', 'Blocks', 'Steals', 'Assists'],
  },
];

/**
 * Determines if a stat category is negative (lower is better)
 */
export function isNegativeCategory(name: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.includes('turnover') || lowerName === 'to';
}

/**
 * Normalizes category name for matching
 */
function normalizeCategory(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9%]/g, '');
}

/**
 * Checks if category name matches one of the target categories
 */
function categoryMatches(categoryName: string, targets: string[]): boolean {
  const normalized = normalizeCategory(categoryName);
  return targets.some(target => {
    const normalizedTarget = normalizeCategory(target);
    return normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized);
  });
}

/**
 * Calculates percentile rank (1 = best, 100 = worst)
 */
function calculatePercentile(rank: number, totalTeams: number): number {
  return Math.round((rank / totalTeams) * 100);
}

/**
 * Analyzes team's category strengths and weaknesses
 */
export function analyzeTeamCategories(
  teamStats: Record<string, number>,
  leagueStats: Array<{ teamKey: string; stats: Record<string, number> }>,
  categories: Array<{ statId: string; name: string; displayName?: string; abbr?: string }>
): CategoryData[] {
  const result: CategoryData[] = [];
  const totalTeams = leagueStats.length;

  for (const cat of categories) {
    if (!cat.statId) continue;

    const statId = cat.statId.toString();
    const teamValue = teamStats[statId] || 0;
    const isNeg = isNegativeCategory(cat.name || cat.abbr || '');

    // Calculate rank by sorting all teams
    const allValues = leagueStats.map(t => ({
      teamKey: t.teamKey,
      value: t.stats[statId] || 0,
    }));

    // Sort: for negative categories (TO), lower is better; for others, higher is better
    allValues.sort((a, b) => isNeg ? a.value - b.value : b.value - a.value);

    // Find this team's rank
    const rank = allValues.findIndex(t => Math.abs(t.value - teamValue) < 0.001) + 1;
    const percentile = calculatePercentile(rank, totalTeams);

    result.push({
      statId,
      name: cat.name || '',
      displayName: cat.displayName || cat.abbr || cat.name || '',
      isNegative: isNeg,
      value: teamValue,
      rank,
      percentile,
    });
  }

  return result;
}

/**
 * Calculates how well a team fits a punt archetype
 */
export function calculateArchetypeMatch(
  categoryRanks: CategoryData[],
  archetype: Omit<PuntArchetype, 'matchScore' | 'isRecommended'>
): number {
  let puntScore = 0;
  let strengthScore = 0;
  let puntCount = 0;
  let strengthCount = 0;

  for (const cat of categoryRanks) {
    const isPuntCategory = categoryMatches(cat.displayName, archetype.puntCategories) ||
                           categoryMatches(cat.name, archetype.puntCategories);
    const isStrengthCategory = categoryMatches(cat.displayName, archetype.strengthCategories) ||
                               categoryMatches(cat.name, archetype.strengthCategories);

    if (isPuntCategory) {
      // For punt categories, being worse (higher percentile) is better for fit
      puntScore += cat.percentile;
      puntCount++;
    }

    if (isStrengthCategory) {
      // For strength categories, being better (lower percentile) is better for fit
      strengthScore += (100 - cat.percentile);
      strengthCount++;
    }
  }

  // Calculate average scores
  const avgPuntScore = puntCount > 0 ? puntScore / puntCount : 50;
  const avgStrengthScore = strengthCount > 0 ? strengthScore / strengthCount : 50;

  // Combined score (0-100)
  const matchScore = Math.round((avgPuntScore + avgStrengthScore) / 2);

  return matchScore;
}

/**
 * Detects the current punt build based on category ranks
 */
export function detectCurrentBuild(
  categoryRanks: CategoryData[],
  totalTeams: number
): { buildName: string; confidence: number } {
  // Find weak categories (bottom third)
  const weakThreshold = Math.ceil(totalTeams * 0.67);
  const weakCategories = categoryRanks.filter(c => c.rank >= weakThreshold);

  if (weakCategories.length === 0) {
    return { buildName: 'Balanced', confidence: 80 };
  }

  // Map weak categories to archetype names
  const weakNames = weakCategories.map(c => c.displayName);

  // Find best matching archetype
  let bestMatch = { name: 'Custom Punt', score: 0 };

  for (const arch of PUNT_ARCHETYPES) {
    const matchCount = arch.puntCategories.filter(pc =>
      weakNames.some(wn => categoryMatches(wn, [pc]))
    ).length;

    if (matchCount > 0 && matchCount >= bestMatch.score) {
      bestMatch = { name: arch.name, score: matchCount };
    }
  }

  // Calculate confidence based on how extreme the weakness is
  const avgWeakPercentile = weakCategories.reduce((sum, c) => sum + c.percentile, 0) / weakCategories.length;
  const confidence = Math.min(95, Math.round(avgWeakPercentile));

  return {
    buildName: bestMatch.score > 0 ? bestMatch.name : `Punt ${weakNames.slice(0, 2).join(' + ')}`,
    confidence,
  };
}

/**
 * Generates recommendations based on analysis
 */
export function generateRecommendation(
  archetypes: PuntArchetype[],
  categoryRanks: CategoryData[],
  totalTeams: number
): string {
  const topArchetype = archetypes.find(a => a.isRecommended);
  const weakCategories = categoryRanks.filter(c => c.rank >= Math.ceil(totalTeams * 0.67));
  const strongCategories = categoryRanks.filter(c => c.rank <= Math.floor(totalTeams * 0.33));

  if (!topArchetype) {
    return 'Your team has a balanced build. Consider committing to a specific punt strategy to maximize category wins.';
  }

  if (topArchetype.matchScore >= 75) {
    return `Strong fit for ${topArchetype.name}! Focus on strengthening ${strongCategories.slice(0, 2).map(c => c.displayName).join(', ')}.`;
  }

  if (topArchetype.matchScore >= 60) {
    return `Moderate fit for ${topArchetype.name}. Consider trading players who don't align with this strategy.`;
  }

  return `Your team doesn't strongly fit any single punt strategy. Consider trading to commit to a direction.`;
}

/**
 * Performs full punt strategy analysis
 */
export function analyzePuntStrategy(
  teamStats: Record<string, number>,
  leagueStats: Array<{ teamKey: string; stats: Record<string, number> }>,
  categories: Array<{ statId: string; name: string; displayName?: string; abbr?: string }>
): TeamBuildAnalysis {
  const totalTeams = leagueStats.length;
  const categoryRanks = analyzeTeamCategories(teamStats, leagueStats, categories);

  // Calculate archetype matches
  const archetypes: PuntArchetype[] = PUNT_ARCHETYPES.map(arch => {
    const matchScore = calculateArchetypeMatch(categoryRanks, arch);
    return {
      ...arch,
      matchScore,
      isRecommended: false,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);

  // Mark top archetype as recommended if score is high enough
  if (archetypes[0].matchScore >= 55) {
    archetypes[0].isRecommended = true;
  }

  // Detect current build
  const { buildName, confidence } = detectCurrentBuild(categoryRanks, totalTeams);

  // Identify strengths and weaknesses
  const weakThreshold = Math.ceil(totalTeams * 0.67);
  const strongThreshold = Math.floor(totalTeams * 0.33);

  const strengths = categoryRanks
    .filter(c => c.rank <= strongThreshold)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map(c => `${c.displayName} (${c.rank}${ordinalSuffix(c.rank)})`);

  const weaknesses = categoryRanks
    .filter(c => c.rank >= weakThreshold)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map(c => `${c.displayName} (${c.rank}${ordinalSuffix(c.rank)})`);

  const recommendation = generateRecommendation(archetypes, categoryRanks, totalTeams);

  return {
    detectedBuild: buildName,
    confidence,
    strengths,
    weaknesses,
    categoryRanks,
    archetypes: archetypes.slice(0, 5), // Return top 5 matches
    recommendation,
  };
}

/**
 * Gets viable punt strategies for a league based on its categories
 */
export function getLeaguePuntStrategies(
  categories: Array<{ statId: string; name: string; displayName?: string; abbr?: string }>
): LeaguePuntStrategy[] {
  const strategies: LeaguePuntStrategy[] = [];

  for (const arch of PUNT_ARCHETYPES) {
    // Check if the league has the categories this strategy targets
    const hasPuntCategories = arch.puntCategories.some(pc =>
      categories.some(c =>
        categoryMatches(c.displayName || c.abbr || c.name, [pc])
      )
    );

    const hasStrengthCategories = arch.strengthCategories.some(sc =>
      categories.some(c =>
        categoryMatches(c.displayName || c.abbr || c.name, [sc])
      )
    );

    if (hasPuntCategories && hasStrengthCategories) {
      strategies.push({
        id: arch.id,
        name: arch.name,
        description: arch.description,
        puntCategories: arch.puntCategories.filter(pc =>
          categories.some(c => categoryMatches(c.displayName || c.abbr || c.name, [pc]))
        ),
        strengthCategories: arch.strengthCategories.filter(sc =>
          categories.some(c => categoryMatches(c.displayName || c.abbr || c.name, [sc]))
        ),
      });
    }
  }

  return strategies;
}

/**
 * Helper to get ordinal suffix for ranks
 */
function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
