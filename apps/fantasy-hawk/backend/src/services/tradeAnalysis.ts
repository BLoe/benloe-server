/**
 * Trade Analysis Service
 * Provides trade impact calculations and recommendations
 */

export interface StatCategory {
  stat_id: string;
  name: string;
  display_name?: string;
  abbr?: string;
}

export interface PlayerData {
  playerKey: string;
  name: string;
  position?: string;
  team?: string;
  stats: Record<string, number>;
}

export interface CategoryImpact {
  statId: string;
  name: string;
  displayName: string;
  giving: number;
  receiving: number;
  netChange: number;
  isNegative: boolean;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface TradeSummary {
  categoriesGained: number;
  categoriesLost: number;
  netCategories: number;
  grade: string;
  recommendation: string;
}

export interface TradeAnalysisResult {
  playersGiving: Array<{
    playerKey: string;
    name: string;
    position?: string;
    team?: string;
  }>;
  playersReceiving: Array<{
    playerKey: string;
    name: string;
    position?: string;
    team?: string;
  }>;
  categoryImpact: CategoryImpact[];
  summary: TradeSummary;
}

/**
 * Determines if a stat category is "negative" (lower is better)
 * Currently only turnovers are negative
 */
export function isNegativeCategory(category: StatCategory): boolean {
  const name = category.name?.toLowerCase() || '';
  const abbr = category.abbr || '';
  return name.includes('turnover') || abbr === 'TO';
}

/**
 * Aggregates stats from multiple players
 */
export function aggregatePlayerStats(players: PlayerData[]): Record<string, number> {
  const aggregated: Record<string, number> = {};

  for (const player of players) {
    if (player.stats) {
      for (const [statId, value] of Object.entries(player.stats)) {
        aggregated[statId] = (aggregated[statId] || 0) + value;
      }
    }
  }

  return aggregated;
}

/**
 * Calculates the impact of a trade on each stat category
 */
export function calculateCategoryImpact(
  giveStats: Record<string, number>,
  receiveStats: Record<string, number>,
  categories: StatCategory[]
): CategoryImpact[] {
  const impacts: CategoryImpact[] = [];

  for (const cat of categories) {
    if (!cat?.stat_id) continue;

    const statId = cat.stat_id.toString();
    const giving = giveStats[statId] || 0;
    const receiving = receiveStats[statId] || 0;
    const netChange = receiving - giving;

    const isNegative = isNegativeCategory(cat);

    // For negative categories, losing stats is good (positive impact)
    const isPositiveChange = isNegative ? netChange < 0 : netChange > 0;

    let impact: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (Math.abs(netChange) > 0.01) {
      impact = isPositiveChange ? 'positive' : 'negative';
    }

    impacts.push({
      statId: cat.stat_id.toString(),
      name: cat.name || '',
      displayName: cat.display_name || cat.abbr || '',
      giving,
      receiving,
      netChange,
      isNegative,
      impact,
    });
  }

  return impacts;
}

/**
 * Calculates overall trade grade and recommendation
 */
export function calculateTradeGrade(categoryImpact: CategoryImpact[]): TradeSummary {
  const categoriesGained = categoryImpact.filter(c => c.impact === 'positive').length;
  const categoriesLost = categoryImpact.filter(c => c.impact === 'negative').length;
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

  return {
    categoriesGained,
    categoriesLost,
    netCategories,
    grade,
    recommendation,
  };
}

/**
 * Performs full trade analysis
 */
export function analyzeTrade(
  playersToGive: PlayerData[],
  playersToReceive: PlayerData[],
  categories: StatCategory[]
): TradeAnalysisResult {
  const giveStats = aggregatePlayerStats(playersToGive);
  const receiveStats = aggregatePlayerStats(playersToReceive);

  const categoryImpact = calculateCategoryImpact(giveStats, receiveStats, categories);
  const summary = calculateTradeGrade(categoryImpact);

  return {
    playersGiving: playersToGive.map(p => ({
      playerKey: p.playerKey,
      name: p.name,
      position: p.position,
      team: p.team,
    })),
    playersReceiving: playersToReceive.map(p => ({
      playerKey: p.playerKey,
      name: p.name,
      position: p.position,
      team: p.team,
    })),
    categoryImpact,
    summary,
  };
}
