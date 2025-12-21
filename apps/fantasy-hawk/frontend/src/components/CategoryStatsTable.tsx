import { useMemo, useState } from 'react';

interface CategoryStatsTableProps {
  categoryStatsData: any;
  categories: any[];
  timespan: 'thisWeek' | 'last3Weeks' | 'season';
}

interface TeamCategoryStats {
  teamKey: string;
  teamName: string;
  stats: Record<string, number>; // stat_id -> value
}

interface CategoryRanking {
  value: number;
  leagueAvg: number;
  percentDiff: number;
  rank: number;
  totalTeams: number;
}

type SortDirection = 'asc' | 'desc';

interface SortConfig {
  column: string; // 'team' or stat_id
  direction: SortDirection;
}

// Stat IDs for categories that are "higher is better" (most stats)
// vs "lower is better" (turnovers, etc.)
const LOWER_IS_BETTER_STATS: string[] = []; // Add stat IDs here if needed (e.g., turnovers)

export function CategoryStatsTable({ categoryStatsData, categories, timespan }: CategoryStatsTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'team', direction: 'asc' });
  // Parse and aggregate team stats
  const teamStats = useMemo(() => {
    if (!categoryStatsData) return [];

    const teams: TeamCategoryStats[] = [];

    if (timespan === 'season') {
      // Parse from standings data
      const standings = categoryStatsData.data?.fantasy_content?.league?.[1]?.standings;
      if (!standings) return [];

      const teamsData = standings[0]?.teams;
      if (!teamsData) return [];

      const count = teamsData.count || 0;
      for (let i = 0; i < count; i++) {
        const teamArray = teamsData[i]?.team;
        if (!teamArray) continue;

        const teamInfo = parseTeamInfo(teamArray);
        const teamStatsObj = teamArray[1]?.team_stats;

        if (teamInfo && teamStatsObj) {
          const stats: Record<string, number> = {};
          const statsArray = teamStatsObj.stats || [];

          for (const s of statsArray) {
            if (s.stat) {
              stats[s.stat.stat_id] = parseStatValue(s.stat.value);
            }
          }

          teams.push({
            teamKey: teamInfo.teamKey,
            teamName: teamInfo.teamName,
            stats,
          });
        }
      }
    } else {
      // Parse from weekly scoreboard data and aggregate
      const weeklyData = categoryStatsData.weeklyData || [];
      const teamAggregates: Record<string, TeamCategoryStats> = {};

      for (const weekEntry of weeklyData) {
        const scoreboard = weekEntry.data?.fantasy_content?.league?.[1]?.scoreboard;
        if (!scoreboard) continue;

        const matchups = scoreboard['0']?.matchups;
        if (!matchups) continue;

        const matchupCount = matchups.count || 0;
        for (let m = 0; m < matchupCount; m++) {
          const matchup = matchups[m]?.matchup?.['0'];
          if (!matchup) continue;

          const teamsData = matchup.teams;
          if (!teamsData) continue;

          const teamCount = teamsData.count || 0;
          for (let t = 0; t < teamCount; t++) {
            const teamArray = teamsData[t]?.team;
            if (!teamArray) continue;

            const teamInfo = parseTeamInfo(teamArray);
            const teamStatsObj = teamArray[1]?.team_stats;

            if (teamInfo && teamStatsObj) {
              if (!teamAggregates[teamInfo.teamKey]) {
                teamAggregates[teamInfo.teamKey] = {
                  teamKey: teamInfo.teamKey,
                  teamName: teamInfo.teamName,
                  stats: {},
                };
              }

              const statsArray = teamStatsObj.stats || [];
              for (const s of statsArray) {
                if (s.stat) {
                  const statId = s.stat.stat_id;
                  const value = parseStatValue(s.stat.value);

                  if (!teamAggregates[teamInfo.teamKey].stats[statId]) {
                    teamAggregates[teamInfo.teamKey].stats[statId] = 0;
                  }
                  teamAggregates[teamInfo.teamKey].stats[statId] += value;
                }
              }
            }
          }
        }
      }

      teams.push(...Object.values(teamAggregates));
    }

    return teams;
  }, [categoryStatsData, timespan]);

  // Calculate league averages and rankings for each category
  const categoryData = useMemo(() => {
    const result: Record<string, Record<string, CategoryRanking>> = {};

    if (teamStats.length === 0) return result;

    // Get scoring category stat IDs (filter out display-only)
    const scoringCategoryIds = categories
      .filter((cat) => !cat.is_only_display_stat)
      .map((cat) => cat.stat_id);

    for (const statId of scoringCategoryIds) {
      // Collect all values for this stat
      const values: { teamKey: string; value: number }[] = [];
      for (const team of teamStats) {
        const value = team.stats[statId] || 0;
        values.push({ teamKey: team.teamKey, value });
      }

      // Calculate league average
      const total = values.reduce((sum, v) => sum + v.value, 0);
      const leagueAvg = values.length > 0 ? total / values.length : 0;

      // Sort for ranking (higher is better for most stats)
      const lowerIsBetter = LOWER_IS_BETTER_STATS.includes(statId);
      const sorted = [...values].sort((a, b) =>
        lowerIsBetter ? a.value - b.value : b.value - a.value
      );

      // Assign rankings and calculate percent diff
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const percentDiff = leagueAvg !== 0 ? ((item.value - leagueAvg) / leagueAvg) * 100 : 0;

        if (!result[item.teamKey]) {
          result[item.teamKey] = {};
        }

        result[item.teamKey][statId] = {
          value: item.value,
          leagueAvg,
          percentDiff,
          rank: i + 1,
          totalTeams: sorted.length,
        };
      }
    }

    return result;
  }, [teamStats, categories]);

  // Get number of weeks for averaging
  const numWeeks = categoryStatsData?.weeksIncluded?.length || 1;

  // Helper to parse team info from Yahoo's array format
  function parseTeamInfo(teamArray: any[]): { teamKey: string; teamName: string } | null {
    if (!Array.isArray(teamArray) || teamArray.length === 0) return null;

    const propsArray = teamArray[0];
    if (!Array.isArray(propsArray)) return null;

    let teamKey = '';
    let teamName = '';

    for (const obj of propsArray) {
      if (obj?.team_key) teamKey = obj.team_key;
      if (obj?.name) teamName = obj.name;
    }

    return teamKey && teamName ? { teamKey, teamName } : null;
  }

  // Helper to parse stat value (handles percentages and fractions)
  function parseStatValue(value: string): number {
    if (!value) return 0;

    // Handle percentage values like ".485"
    if (value.startsWith('.')) {
      return parseFloat(value);
    }

    // Handle fraction format like "56/66" (FTM/FTA display stat)
    if (value.includes('/')) {
      return 0; // Skip display-only fraction stats
    }

    return parseFloat(value) || 0;
  }

  // Format rank as ordinal
  function formatRank(rank: number): string {
    const suffix =
      rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    return `${rank}${suffix}`;
  }

  // Format value based on stat type
  function formatValue(value: number, statId: string, isWeeklyAvg: boolean): string {
    // Check if this is a percentage stat (FG%, FT%)
    const category = categories.find((c) => c.stat_id === statId);
    const isPercentage = category?.name?.includes('Percentage');

    if (isPercentage) {
      // Already a decimal like 0.485, convert to percentage
      return `${(value * 100).toFixed(1)}%`;
    }

    // For counting stats, show weekly average if multiple weeks
    if (isWeeklyAvg && numWeeks > 1) {
      return (value / numWeeks).toFixed(1);
    }

    return value.toFixed(1);
  }

  // Get color class based on percent diff
  function getPercentDiffClass(percentDiff: number): string {
    if (percentDiff > 5) return 'text-green-600';
    if (percentDiff > 0) return 'text-green-500';
    if (percentDiff < -5) return 'text-red-600';
    if (percentDiff < 0) return 'text-red-500';
    return 'text-gray-500';
  }

  // Get background color style based on percent difference
  // Returns an inline style with rgba color - darker for larger differences
  function getCellBgStyle(percentDiff: number): React.CSSProperties {
    // Scale intensity: min 0.08 (very light tint) to max 0.5 (strong color)
    // Reaches max at ±25% difference
    const maxDiff = 25;
    const minOpacity = 0.08;
    const maxOpacity = 0.5;
    const scaledIntensity = Math.min(Math.abs(percentDiff) / maxDiff, 1);
    const opacity = minOpacity + scaledIntensity * (maxOpacity - minOpacity);

    if (percentDiff >= 0) {
      // Green for positive - rgb(34, 197, 94) is Tailwind green-500
      return { backgroundColor: `rgba(34, 197, 94, ${opacity})` };
    } else {
      // Red for negative - rgb(239, 68, 68) is Tailwind red-500
      return { backgroundColor: `rgba(239, 68, 68, ${opacity})` };
    }
  }

  // Filter to only scoring categories
  const scoringCategories = categories.filter((cat) => !cat.is_only_display_stat);

  // Handle column header click for sorting
  function handleSort(column: string) {
    setSortConfig((prev) => {
      if (prev.column === column) {
        // Toggle direction if same column
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      // New column - default to desc for stats (higher is better), asc for team name
      return { column, direction: column === 'team' ? 'asc' : 'desc' };
    });
  }

  // Get sort indicator
  function getSortIndicator(column: string): string {
    if (sortConfig.column !== column) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  }

  // Sort teams based on current sort config
  const sortedTeams = useMemo(() => {
    const sorted = [...teamStats];

    sorted.sort((a, b) => {
      let comparison = 0;

      if (sortConfig.column === 'team') {
        comparison = a.teamName.localeCompare(b.teamName);
      } else {
        // Sort by stat value
        const aData = categoryData[a.teamKey]?.[sortConfig.column];
        const bData = categoryData[b.teamKey]?.[sortConfig.column];
        const aValue = aData?.value || 0;
        const bValue = bData?.value || 0;
        comparison = aValue - bValue;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [teamStats, categoryData, sortConfig]);

  if (teamStats.length === 0) {
    return <p className="text-gray-600">No category stats available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th
              className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => handleSort('team')}
            >
              Team{getSortIndicator('team')}
            </th>
            {scoringCategories.map((cat) => (
              <th
                key={cat.stat_id}
                className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => handleSort(cat.stat_id)}
              >
                {cat.display_name || cat.abbr || cat.name}{getSortIndicator(cat.stat_id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sortedTeams.map((team) => (
            <tr key={team.teamKey} className="hover:bg-gray-50">
              <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0 bg-white z-10">
                {team.teamName}
              </td>
              {scoringCategories.map((cat) => {
                const data = categoryData[team.teamKey]?.[cat.stat_id];
                if (!data) {
                  return (
                    <td key={cat.stat_id} className="px-3 py-3 text-center text-gray-400">
                      -
                    </td>
                  );
                }

                const isPercentageStat = cat.name?.includes('Percentage');

                return (
                  <td
                    key={cat.stat_id}
                    className="px-3 py-2 text-center"
                    style={getCellBgStyle(data.percentDiff)}
                  >
                    <div className="font-medium text-gray-900">
                      {formatValue(data.value, cat.stat_id, !isPercentageStat)}
                    </div>
                    <div className={`text-xs ${getPercentDiffClass(data.percentDiff)}`}>
                      {data.percentDiff >= 0 ? '+' : ''}
                      {data.percentDiff.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">{formatRank(data.rank)}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 text-xs text-gray-500">
        {timespan === 'season' && (
          <span>Showing season totals ({numWeeks} weeks). Percentages are season averages.</span>
        )}
        {timespan === 'last3Weeks' && (
          <span>
            Showing weekly averages for last {numWeeks} weeks (weeks{' '}
            {categoryStatsData?.weeksIncluded?.join(', ')}).
          </span>
        )}
        {timespan === 'thisWeek' && (
          <span>Showing current week (week {categoryStatsData?.currentWeek}) totals.</span>
        )}
      </div>
    </div>
  );
}
