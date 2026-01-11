/**
 * Player Comparison Service
 * Provides side-by-side player comparison analysis
 */

export interface StatCategory {
  stat_id: string;
  name: string;
  display_name?: string;
  abbr?: string;
}

export interface PlayerStats {
  playerKey: string;
  name: string;
  position?: string;
  team?: string;
  imageUrl?: string;
  status?: string;
  percentOwned?: number;
  gamesPlayed: number;
  stats: Record<string, number>;
  averages: Record<string, number>;
}

export interface StatComparison {
  statId: string;
  name: string;
  displayName: string;
  isNegative: boolean;
  players: Array<{
    playerKey: string;
    value: number;
    average: number;
    isLeader: boolean;
    isTied: boolean;
  }>;
}

export interface ComparisonResult {
  players: PlayerStats[];
  comparisons: StatComparison[];
  summary: {
    playerWins: Record<string, number>;
    ties: number;
    totalCategories: number;
  };
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
 * Determines the leader(s) for a stat category
 * Returns array of player keys that are leaders (can be multiple for ties)
 */
export function findLeaders(
  playerStats: PlayerStats[],
  statId: string,
  isNegative: boolean
): { leaders: string[]; isTied: boolean } {
  const values = playerStats.map((p) => ({
    playerKey: p.playerKey,
    value: p.averages[statId] || 0,
  }));

  if (values.length === 0) {
    return { leaders: [], isTied: false };
  }

  // Sort by value - ascending for negative cats, descending for positive
  values.sort((a, b) => (isNegative ? a.value - b.value : b.value - a.value));

  const bestValue = values[0].value;
  const leaders = values.filter((v) => Math.abs(v.value - bestValue) < 0.001).map((v) => v.playerKey);

  return {
    leaders,
    isTied: leaders.length > 1,
  };
}

/**
 * Compares multiple players across all stat categories
 */
export function comparePlayers(
  players: PlayerStats[],
  categories: StatCategory[]
): ComparisonResult {
  const comparisons: StatComparison[] = [];
  const playerWins: Record<string, number> = {};
  let ties = 0;

  // Initialize win counts
  for (const player of players) {
    playerWins[player.playerKey] = 0;
  }

  for (const cat of categories) {
    if (!cat?.stat_id) continue;

    const statId = cat.stat_id.toString();
    const isNegative = isNegativeCategory(cat);
    const { leaders, isTied } = findLeaders(players, statId, isNegative);

    if (isTied) {
      ties++;
    } else if (leaders.length === 1) {
      playerWins[leaders[0]]++;
    }

    const comparison: StatComparison = {
      statId,
      name: cat.name || '',
      displayName: cat.abbr || cat.display_name || cat.name || '',
      isNegative,
      players: players.map((p) => ({
        playerKey: p.playerKey,
        value: p.stats[statId] || 0,
        average: p.averages[statId] || 0,
        isLeader: leaders.includes(p.playerKey),
        isTied: isTied && leaders.includes(p.playerKey),
      })),
    };

    comparisons.push(comparison);
  }

  return {
    players,
    comparisons,
    summary: {
      playerWins,
      ties,
      totalCategories: comparisons.length,
    },
  };
}

/**
 * Parses Yahoo player data into PlayerStats format
 */
export function parseYahooPlayerData(
  playerData: any,
  statsData?: any
): PlayerStats | null {
  if (!playerData) return null;

  // Parse player props from Yahoo's nested array format
  const props = playerData[0] || [];
  const merged: Record<string, any> = {};

  for (const prop of props) {
    if (prop && typeof prop === 'object') {
      Object.assign(merged, prop);
    }
  }

  // Get player stats if available
  const playerStats = statsData?.player_stats?.stats || playerData[1]?.player_stats?.stats || [];
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

  // Get games played (stat_id 0 is typically GP)
  const gamesPlayed = stats['0'] || 0;

  // Calculate averages
  const averages = calculateAverages(stats, gamesPlayed);

  return {
    playerKey: merged.player_key || '',
    name: merged.name?.full || 'Unknown',
    position: merged.display_position || merged.primary_position || '',
    team: merged.editorial_team_abbr || merged.editorial_team_key || '',
    imageUrl: merged.image_url || merged.headshot?.url || '',
    status: merged.status || '',
    percentOwned: parseFloat(merged.percent_owned?.value) || 0,
    gamesPlayed,
    stats,
    averages,
  };
}

/**
 * Filters players by search query (name matching)
 */
export function filterPlayersByName(
  players: Array<{ name: string; [key: string]: any }>,
  query: string
): Array<{ name: string; [key: string]: any }> {
  if (!query || query.trim().length < 2) return [];

  const normalizedQuery = query.toLowerCase().trim();

  return players.filter((player) => {
    const name = player.name?.toLowerCase() || '';
    return name.includes(normalizedQuery);
  });
}
