import { Info, CheckCircle, AlertCircle, HelpCircle } from 'lucide-react';

interface LeagueCategory {
  statId: string;
  name: string;
  displayName: string;
  abbr?: string;
}

interface SettingsInsight {
  type: 'missing' | 'unusual' | 'alternative';
  category: string;
  description: string;
  impact: string;
}

interface LeagueSettingsSummary {
  leagueType: string;
  numTeams: number;
  categories: LeagueCategory[];
  isStandard: boolean;
  insights: SettingsInsight[];
  missingStandard: string[];
  unusualCategories: string[];
}

interface SettingsBreakdownProps {
  settings: LeagueSettingsSummary;
  leagueName?: string;
}

// Standard categories for reference
const STANDARD_CATEGORY_ABBRS = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'];

export function SettingsBreakdown({ settings, leagueName }: SettingsBreakdownProps) {
  const isStandardCategory = (abbr: string): boolean => {
    const normalized = abbr.toUpperCase();
    return STANDARD_CATEGORY_ABBRS.some(
      std => normalized.includes(std) || std.includes(normalized.replace('%', ''))
    );
  };

  const getLeagueTypeDisplay = (type: string): string => {
    switch (type) {
      case 'head-to-head':
        return 'Head-to-Head Categories';
      case 'roto':
        return 'Rotisserie';
      case 'points':
        return 'Points League';
      default:
        return type || 'Unknown';
    }
  };

  return (
    <div className="space-y-6" data-testid="league-settings">
      {/* League Overview Card */}
      <div className="card" data-testid="league-settings-overview">
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-5 h-5 text-hawk-teal" />
          <h3 className="font-semibold text-gray-100">League Overview</h3>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-400">League Name</div>
            <div className="text-gray-100 font-medium">{leagueName || 'Your League'}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Teams</div>
            <div className="text-gray-100 font-medium">{settings.numTeams} Teams</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Scoring Type</div>
            <div className="text-gray-100 font-medium">{getLeagueTypeDisplay(settings.leagueType)}</div>
          </div>
        </div>

        {/* Standard/Non-Standard Badge */}
        <div className="mt-4 pt-4 border-t border-white/10">
          {settings.isStandard ? (
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Standard 9-Category League</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-hawk-orange">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Non-Standard Settings Detected</span>
            </div>
          )}
        </div>
      </div>

      {/* Category Settings Table */}
      <div className="card" data-testid="league-categories-table">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-100">Scoring Categories</h3>
            <span className="text-sm text-gray-400">({settings.categories.length} categories)</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span>Standard</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-hawk-orange" />
              <span>Non-Standard</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-400 border-b border-white/10">
                <th className="pb-2 px-2">Category</th>
                <th className="pb-2 px-2">Abbreviation</th>
                <th className="pb-2 px-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {settings.categories.map((cat) => {
                const abbr = cat.abbr || cat.displayName || cat.name;
                const isStandard = isStandardCategory(abbr);

                return (
                  <tr
                    key={cat.statId}
                    className="border-b border-white/5 hover:bg-white/5"
                    data-testid={`league-category-${cat.statId}`}
                  >
                    <td className="py-3 px-2">
                      <span className="text-gray-100">{cat.name}</span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-sm ${
                        isStandard
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-hawk-orange/20 text-hawk-orange'
                      }`}>
                        {abbr}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      {isStandard ? (
                        <span className="flex items-center gap-1 text-sm text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          Standard
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-sm text-hawk-orange">
                          <AlertCircle className="w-4 h-4" />
                          Non-Standard
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insights Section */}
      {settings.insights.length > 0 && (
        <div className="card" data-testid="league-settings-insights">
          <div className="flex items-center gap-2 mb-4">
            <HelpCircle className="w-5 h-5 text-hawk-indigo" />
            <h3 className="font-semibold text-gray-100">What This Means For You</h3>
          </div>

          <div className="space-y-4">
            {settings.insights.map((insight, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${
                  insight.type === 'missing'
                    ? 'bg-red-500/10 border-red-500/30'
                    : insight.type === 'alternative'
                      ? 'bg-hawk-orange/10 border-hawk-orange/30'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                }`}
                data-testid={`league-insight-${index}`}
              >
                <div className="font-medium text-gray-100 mb-1">
                  {insight.description}
                </div>
                <div className="text-sm text-gray-300">
                  {insight.impact}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Standard Categories */}
      {settings.missingStandard.length > 0 && (
        <div className="card border border-red-500/30" data-testid="league-missing-categories">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <h4 className="font-medium text-red-400">Missing Standard Categories</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.missingStandard.map((cat) => (
              <span
                key={cat}
                className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-sm"
              >
                {cat}
              </span>
            ))}
          </div>
          <p className="mt-3 text-sm text-gray-400">
            These categories are typically used in standard leagues but are not counted in yours.
            This may affect player valuations from standard rankings.
          </p>
        </div>
      )}

      {/* Standard Reference */}
      {!settings.isStandard && (
        <div className="card bg-court-base/50" data-testid="league-standard-reference">
          <div className="text-sm text-gray-400 mb-2">Standard 9-Category Reference</div>
          <div className="flex flex-wrap gap-2">
            {STANDARD_CATEGORY_ABBRS.map((cat) => (
              <span
                key={cat}
                className="px-2 py-1 bg-gray-700/50 text-gray-300 rounded text-sm"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
