import { useLeagueContext } from '../components/LeagueLayout';
import { StandingsChart } from '../components/StandingsChart';

export function StandingsPage() {
  const { standings } = useLeagueContext();

  return (
    <div className="card">
      <h2 className="font-display text-xl font-semibold text-gray-100 mb-6">
        League Standings
      </h2>
      {standings.length > 0 ? (
        <StandingsChart standings={standings} />
      ) : (
        <p className="text-gray-400">No standings data available</p>
      )}
    </div>
  );
}
