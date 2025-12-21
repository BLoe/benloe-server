interface StandingsChartProps {
  standings: any[];
}

export function StandingsChart({ standings }: StandingsChartProps) {
  // Transform Yahoo data for display
  const tableData = standings
    .map((standing: any) => {
      const teamStandings = standing.team_standings;
      const outcomes = teamStandings?.outcome_totals;

      return {
        name: standing.name || 'Team',
        wins: parseInt(outcomes?.wins || '0', 10),
        losses: parseInt(outcomes?.losses || '0', 10),
        ties: parseInt(outcomes?.ties || '0', 10),
        rank: parseInt(teamStandings?.rank || '0', 10),
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Rank
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Team
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              W-L-T
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Win %
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {tableData.map((team, idx) => {
            const totalGames = team.wins + team.losses + team.ties;
            const winPct = totalGames > 0 ? (team.wins / totalGames) * 100 : 0;

            return (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {team.rank}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{team.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {team.wins}-{team.losses}
                  {team.ties > 0 ? `-${team.ties}` : ''}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {winPct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
