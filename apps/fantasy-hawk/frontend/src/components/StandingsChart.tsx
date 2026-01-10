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
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="table-header">Rank</th>
            <th className="table-header">Team</th>
            <th className="table-header">W-L-T</th>
            <th className="table-header">Win %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {tableData.map((team, idx) => {
            const totalGames = team.wins + team.losses + team.ties;
            const winPct = totalGames > 0 ? (team.wins / totalGames) * 100 : 0;
            const isTopHalf = team.rank <= Math.ceil(tableData.length / 2);

            return (
              <tr key={idx} className="table-row">
                <td className="table-cell">
                  <span className={`font-mono font-semibold ${isTopHalf ? 'text-hawk-teal' : 'text-gray-400'}`}>
                    {team.rank}
                  </span>
                </td>
                <td className="table-cell font-medium">{team.name}</td>
                <td className="table-cell font-mono">
                  <span className="text-hawk-teal">{team.wins}</span>
                  <span className="text-gray-500">-</span>
                  <span className="text-hawk-red">{team.losses}</span>
                  {team.ties > 0 && (
                    <>
                      <span className="text-gray-500">-</span>
                      <span className="text-hawk-amber">{team.ties}</span>
                    </>
                  )}
                </td>
                <td className="table-cell font-mono">
                  <span className={winPct >= 50 ? 'text-hawk-teal' : 'text-gray-400'}>
                    {winPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
