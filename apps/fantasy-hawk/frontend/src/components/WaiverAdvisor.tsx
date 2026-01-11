import { ClipboardList, ExternalLink, RefreshCw } from 'lucide-react';
import { RecommendationsPanel } from './waiver/RecommendationsPanel';
import { DropsPanel } from './waiver/DropsPanel';
import { FaabSuggestions } from './waiver/FaabSuggestions';

interface WaiverAdvisorProps {
  selectedLeague: string;
}

export function WaiverAdvisor({ selectedLeague }: WaiverAdvisorProps) {
  function handleRefresh() {
    // Trigger page reload to refresh all data
    window.location.reload();
  }

  return (
    <div className="space-y-6" data-testid="waiver-dashboard">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-hawk-orange/20">
              <ClipboardList className="w-5 h-5 text-hawk-orange" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-gray-100">
                Waiver Advisor
              </h2>
              <p className="text-sm text-gray-400">
                Smart recommendations based on your team's needs
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh recommendations"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>

            <a
              href={`https://basketball.fantasysports.yahoo.com/nba/${selectedLeague.split('.l.')[1]}/addplayer`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-sm bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90 transition-colors"
            >
              <span>Yahoo Waivers</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-court-surface rounded-lg p-3 text-sm text-gray-400">
          <p>
            Recommendations are based on your team's category strengths and weaknesses,
            player ownership trends, and upcoming schedule.
          </p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recommendations - 2 columns */}
        <div className="lg:col-span-2 card">
          <RecommendationsPanel leagueKey={selectedLeague} />
        </div>

        {/* Right Column - Drops & FAAB */}
        <div className="space-y-6">
          {/* Drops */}
          <div className="card">
            <DropsPanel leagueKey={selectedLeague} />
          </div>

          {/* FAAB Suggestions (only shows for FAAB leagues) */}
          <div className="card">
            <FaabSuggestions leagueKey={selectedLeague} />
          </div>
        </div>
      </div>

      {/* Tips Section */}
      <div className="card bg-court-surface/50">
        <h3 className="font-medium text-gray-300 mb-3">Waiver Tips</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          <li className="flex items-start gap-2">
            <span className="text-hawk-orange">•</span>
            <span>
              <strong className="text-gray-300">High priority</strong> pickups fill multiple category needs for your team
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-hawk-orange">•</span>
            <span>
              Players with <strong className="text-gray-300">more games this week</strong> provide immediate value
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-hawk-orange">•</span>
            <span>
              Check the <strong className="text-gray-300">ownership %</strong> - low-owned players may be sleepers
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-hawk-orange">•</span>
            <span>
              Review <strong className="text-gray-300">drop candidates</strong> when you need roster space for a pickup
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
