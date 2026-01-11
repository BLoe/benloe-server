import { useState, useMemo } from 'react';
import { Search, Book, TrendingUp, Settings, HelpCircle, X } from 'lucide-react';

// Glossary categories
type GlossaryCategory = 'stats' | 'strategy' | 'platform' | 'general';

interface GlossaryEntry {
  term: string;
  definition: string;
  example?: string;
  category: GlossaryCategory;
  relatedTerms?: string[];
}

// Comprehensive glossary data
export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  // Stats Category
  {
    term: 'FG%',
    definition: 'Field Goal Percentage - The percentage of shots made from the field (not including free throws). Calculated as field goals made / field goals attempted.',
    example: 'If a player shoots 5-10 from the field, their FG% is 50%.',
    category: 'stats',
    relatedTerms: ['FT%', '3P%'],
  },
  {
    term: 'FT%',
    definition: 'Free Throw Percentage - The percentage of free throws made. Calculated as free throws made / free throws attempted.',
    example: 'A player who makes 8 of 10 free throws has an 80% FT%.',
    category: 'stats',
    relatedTerms: ['FG%'],
  },
  {
    term: '3PM',
    definition: 'Three-Pointers Made - The total number of three-point shots made. A counting stat (more is better).',
    category: 'stats',
    relatedTerms: ['3P%', 'PTS'],
  },
  {
    term: '3P%',
    definition: 'Three-Point Percentage - The percentage of three-point shots made. Not all leagues use this as a scoring category.',
    category: 'stats',
    relatedTerms: ['3PM', 'FG%'],
  },
  {
    term: 'PTS',
    definition: 'Points - Total points scored by a player. One of the most common fantasy categories.',
    category: 'stats',
    relatedTerms: ['FG%', '3PM'],
  },
  {
    term: 'REB',
    definition: 'Rebounds - Total rebounds (offensive + defensive). Some leagues split these into OREB and DREB.',
    category: 'stats',
    relatedTerms: ['OREB', 'DREB'],
  },
  {
    term: 'AST',
    definition: 'Assists - Passes that directly lead to a made basket by a teammate.',
    category: 'stats',
    relatedTerms: ['A/T'],
  },
  {
    term: 'STL',
    definition: 'Steals - Times a player takes the ball from an opponent through interception or forcing a turnover.',
    category: 'stats',
  },
  {
    term: 'BLK',
    definition: 'Blocks - Shots blocked by a defensive player. Centers and power forwards typically lead in this category.',
    category: 'stats',
  },
  {
    term: 'TO',
    definition: 'Turnovers - Times possession is lost to the opponent through errors, bad passes, or violations. FEWER is better - this is a negative category!',
    example: 'If you have 10 turnovers and your opponent has 15, YOU win this category.',
    category: 'stats',
    relatedTerms: ['A/T'],
  },
  {
    term: 'OREB',
    definition: 'Offensive Rebounds - Rebounds on the offensive end after a missed shot, giving the team another chance to score.',
    category: 'stats',
    relatedTerms: ['REB', 'DREB'],
  },
  {
    term: 'DREB',
    definition: 'Defensive Rebounds - Rebounds on the defensive end after the opponent misses.',
    category: 'stats',
    relatedTerms: ['REB', 'OREB'],
  },
  {
    term: 'DD',
    definition: 'Double-Doubles - Games where a player achieves double digits (10+) in two statistical categories, typically points and rebounds.',
    example: '20 points and 12 rebounds = 1 double-double.',
    category: 'stats',
    relatedTerms: ['TD'],
  },
  {
    term: 'TD',
    definition: 'Triple-Doubles - Games where a player achieves double digits (10+) in three statistical categories. Very rare and valuable.',
    example: '15 points, 10 rebounds, 10 assists = 1 triple-double.',
    category: 'stats',
    relatedTerms: ['DD'],
  },
  {
    term: 'A/T',
    definition: 'Assist-to-Turnover Ratio - Assists divided by turnovers. A higher ratio indicates more efficient ball handling.',
    example: '8 assists and 2 turnovers = 4.0 A/T ratio.',
    category: 'stats',
    relatedTerms: ['AST', 'TO'],
  },
  {
    term: 'MPG',
    definition: 'Minutes Per Game - Average playing time per game. More minutes generally means more statistical production.',
    category: 'stats',
  },
  {
    term: 'GP',
    definition: 'Games Played - The number of games a player has appeared in. Important for evaluating availability.',
    category: 'stats',
  },

  // Strategy Category
  {
    term: 'Punt',
    definition: 'A strategy where you intentionally ignore one or more statistical categories to build strength in the remaining ones.',
    example: 'Punting FT% lets you draft big men who dominate REB and BLK but shoot poorly from the line.',
    category: 'strategy',
    relatedTerms: ['Build', 'Streaming'],
  },
  {
    term: 'Streaming',
    definition: 'Frequently adding and dropping players based on their upcoming schedule to maximize games played each week.',
    example: 'Picking up a player with 4 games this week, then dropping for another with 4 games next week.',
    category: 'strategy',
    relatedTerms: ['Waiver Wire'],
  },
  {
    term: 'Stash',
    definition: 'Holding an injured or underperforming player on your bench in anticipation of future value.',
    example: 'Keeping a star player on IL while they recover from injury for playoff run.',
    category: 'strategy',
    relatedTerms: ['IL', 'IR'],
  },
  {
    term: 'Sell High',
    definition: 'Trading a player while their perceived value is temporarily inflated due to a hot streak.',
    example: 'Trading a player averaging 25 PPG over 5 games when their career average is 15.',
    category: 'strategy',
    relatedTerms: ['Buy Low', 'Trade Value'],
  },
  {
    term: 'Buy Low',
    definition: 'Acquiring a player while their perceived value is temporarily depressed due to a cold streak or minor injury.',
    example: 'Trading for an injured star who will return during playoffs.',
    category: 'strategy',
    relatedTerms: ['Sell High', 'Trade Value'],
  },
  {
    term: 'Build',
    definition: 'A team construction strategy focused on specific categories, often in conjunction with a punt strategy.',
    example: 'A 3-and-D build focuses on 3PM, STL, and BLK while accepting lower AST.',
    category: 'strategy',
    relatedTerms: ['Punt'],
  },
  {
    term: 'Trade Value',
    definition: 'An estimate of a player\'s worth in trades based on their statistical production and potential.',
    category: 'strategy',
    relatedTerms: ['Sell High', 'Buy Low'],
  },
  {
    term: 'Rest Days',
    definition: 'Days when star players are held out of games for load management. Can significantly impact fantasy production.',
    category: 'strategy',
  },
  {
    term: 'Back-to-Back',
    definition: 'When a team plays on consecutive days. Stars sometimes rest during back-to-backs.',
    category: 'strategy',
    relatedTerms: ['Rest Days'],
  },

  // Platform Category
  {
    term: 'IL',
    definition: 'Injured List (Yahoo) - A roster spot that holds injured players without taking up an active roster spot.',
    category: 'platform',
    relatedTerms: ['IR', 'IL+', 'INJ'],
  },
  {
    term: 'IR',
    definition: 'Injured Reserve - Same as IL, terminology used by some platforms.',
    category: 'platform',
    relatedTerms: ['IL'],
  },
  {
    term: 'IL+',
    definition: 'Injured List Plus - Includes players who are Out or have other non-injury designations (COVID, personal).',
    category: 'platform',
    relatedTerms: ['IL', 'INJ'],
  },
  {
    term: 'INJ',
    definition: 'Injury designation indicating a player is hurt. Specifics vary by platform.',
    category: 'platform',
    relatedTerms: ['IL', 'O', 'DTD', 'GTD'],
  },
  {
    term: 'O',
    definition: 'Out - Player designation meaning they will not play in the upcoming game.',
    category: 'platform',
    relatedTerms: ['GTD', 'DTD', 'INJ'],
  },
  {
    term: 'GTD',
    definition: 'Game-Time Decision - Player status is uncertain and will be determined close to game time.',
    category: 'platform',
    relatedTerms: ['DTD', 'O'],
  },
  {
    term: 'DTD',
    definition: 'Day-to-Day - Player has a minor injury and their status is being evaluated daily.',
    category: 'platform',
    relatedTerms: ['GTD', 'O'],
  },
  {
    term: 'NA',
    definition: 'Not Active - Player is on the roster but not eligible to play (often during two-way contracts).',
    category: 'platform',
  },
  {
    term: 'Waiver Wire',
    definition: 'The pool of free agent players available to be added to teams. Players dropped enter waivers before becoming free agents.',
    category: 'platform',
    relatedTerms: ['FAAB', 'Waiver Priority'],
  },
  {
    term: 'FAAB',
    definition: 'Free Agent Acquisition Budget - A dollar budget (typically $100) used to bid on waiver players. Highest bid wins.',
    example: 'Bidding $15 of your $100 budget on a breakout player.',
    category: 'platform',
    relatedTerms: ['Waiver Wire', 'Waiver Priority'],
  },
  {
    term: 'Waiver Priority',
    definition: 'The order in which teams can claim players from waivers. In some leagues, uses reverse standings order.',
    category: 'platform',
    relatedTerms: ['FAAB', 'Waiver Wire'],
  },
  {
    term: 'Trade Deadline',
    definition: 'The last date when teams can make trades during the regular season.',
    category: 'platform',
  },
  {
    term: 'Roster Lock',
    definition: 'When rosters are frozen and no lineup changes can be made. Usually during playoffs or before game start.',
    category: 'platform',
  },
  {
    term: 'Acquisition Limit',
    definition: 'Maximum number of adds/drops allowed per week or season. Prevents excessive streaming.',
    category: 'platform',
    relatedTerms: ['Streaming'],
  },

  // General Category
  {
    term: 'Category League',
    definition: 'A fantasy format where each statistical category is a separate matchup. Win more categories than your opponent to win the week.',
    example: 'Winning 5 categories and losing 4 gives you a 5-4 weekly record.',
    category: 'general',
    relatedTerms: ['Roto', 'Points League'],
  },
  {
    term: 'H2H',
    definition: 'Head-to-Head - A format where you compete against one opponent each week.',
    category: 'general',
    relatedTerms: ['Category League', 'Points League'],
  },
  {
    term: 'Roto',
    definition: 'Rotisserie - A season-long format where cumulative stats are ranked. No weekly matchups.',
    example: 'The team with the most total points across the season ranks #1 in PTS.',
    category: 'general',
    relatedTerms: ['Category League'],
  },
  {
    term: 'Points League',
    definition: 'A format where all stats are converted to fantasy points. Highest weekly total wins.',
    category: 'general',
    relatedTerms: ['Category League', 'H2H'],
  },
  {
    term: 'Dynasty',
    definition: 'A multi-year format where you keep your entire roster year-over-year. Rookies and young players are highly valued.',
    category: 'general',
    relatedTerms: ['Keeper'],
  },
  {
    term: 'Keeper',
    definition: 'A format where you keep a limited number of players year-over-year (typically 3-5).',
    category: 'general',
    relatedTerms: ['Dynasty'],
  },
  {
    term: 'Redraft',
    definition: 'A format where all players are drafted fresh each year. No keepers or dynasty elements.',
    category: 'general',
  },
  {
    term: 'Magic Number',
    definition: 'The combination of your wins and competitor losses needed to mathematically clinch a playoff spot.',
    category: 'general',
    relatedTerms: ['Playoff Odds', 'Clinch'],
  },
  {
    term: 'Playoff Odds',
    definition: 'Estimated percentage chance of making the playoffs based on current standings and remaining schedule.',
    category: 'general',
    relatedTerms: ['Magic Number'],
  },
  {
    term: 'Clinch',
    definition: 'Mathematically securing a playoff spot regardless of remaining games.',
    category: 'general',
    relatedTerms: ['Magic Number', 'Eliminated'],
  },
  {
    term: 'Eliminated',
    definition: 'Mathematically eliminated from playoff contention with no remaining path to qualify.',
    category: 'general',
    relatedTerms: ['Clinch'],
  },
  {
    term: 'Bubble Team',
    definition: 'A team on the edge of playoff contention whose position could go either way.',
    category: 'general',
  },
  {
    term: 'Playoff Schedule',
    definition: 'The number of games NBA teams play during fantasy playoff weeks. Teams with more games are more valuable.',
    example: 'Targeting players whose teams have 4 games in playoff weeks vs 2.',
    category: 'general',
    relatedTerms: ['Streaming'],
  },
];

// Category info for display
const CATEGORY_INFO: Record<GlossaryCategory, { label: string; icon: React.ElementType; color: string }> = {
  stats: { label: 'Statistics', icon: TrendingUp, color: 'text-hawk-teal' },
  strategy: { label: 'Strategy', icon: Book, color: 'text-hawk-orange' },
  platform: { label: 'Platform', icon: Settings, color: 'text-hawk-indigo' },
  general: { label: 'General', icon: HelpCircle, color: 'text-gray-400' },
};

interface GlossaryProps {
  isOpen: boolean;
  onClose: () => void;
  initialTerm?: string;
}

export function Glossary({ isOpen, onClose, initialTerm }: GlossaryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GlossaryCategory | 'all'>('all');
  const [selectedTerm, setSelectedTerm] = useState<string | null>(initialTerm || null);

  // Filter entries based on search and category
  const filteredEntries = useMemo(() => {
    return GLOSSARY_ENTRIES.filter(entry => {
      const matchesSearch = searchQuery === '' ||
        entry.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.definition.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
      return matchesSearch && matchesCategory;
    }).sort((a, b) => a.term.localeCompare(b.term));
  }, [searchQuery, selectedCategory]);

  // Get selected entry details
  const selectedEntry = selectedTerm
    ? GLOSSARY_ENTRIES.find(e => e.term === selectedTerm)
    : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" data-testid="glossary">
      <div className="bg-court-base rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Book className="w-6 h-6 text-hawk-orange" />
            <h2 className="text-xl font-semibold text-gray-100">Fantasy Basketball Glossary</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-court-surface rounded-lg text-gray-400 hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Search & List */}
          <div className="w-1/2 border-r border-white/10 flex flex-col">
            {/* Search */}
            <div className="p-4 border-b border-white/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search terms..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-court-surface rounded-lg text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-hawk-teal"
                  data-testid="glossary-search"
                />
              </div>

              {/* Category Filter */}
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1 rounded-full text-xs ${
                    selectedCategory === 'all'
                      ? 'bg-hawk-teal text-gray-900'
                      : 'bg-court-surface text-gray-400'
                  }`}
                >
                  All
                </button>
                {(Object.keys(CATEGORY_INFO) as GlossaryCategory[]).map(cat => {
                  const info = CATEGORY_INFO[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 ${
                        selectedCategory === cat
                          ? 'bg-court-surface ring-1 ring-hawk-teal text-gray-200'
                          : 'bg-court-surface text-gray-400'
                      }`}
                    >
                      <info.icon className={`w-3 h-3 ${info.color}`} />
                      {info.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Terms List */}
            <div className="flex-1 overflow-y-auto p-2">
              {filteredEntries.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No terms found matching "{searchQuery}"
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredEntries.map(entry => {
                    const catInfo = CATEGORY_INFO[entry.category];
                    return (
                      <button
                        key={entry.term}
                        onClick={() => setSelectedTerm(entry.term)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          selectedTerm === entry.term
                            ? 'bg-hawk-teal/20 text-hawk-teal'
                            : 'hover:bg-court-surface text-gray-300'
                        }`}
                        data-testid={`glossary-term-${entry.term.replace(/[^a-zA-Z0-9]/g, '-')}`}
                      >
                        <div className="flex items-center gap-2">
                          <catInfo.icon className={`w-3.5 h-3.5 ${catInfo.color}`} />
                          <span className="font-medium">{entry.term}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Definition */}
          <div className="w-1/2 p-6 overflow-y-auto">
            {selectedEntry ? (
              <div data-testid="glossary-definition">
                <div className="flex items-center gap-2 mb-2">
                  {(() => {
                    const catInfo = CATEGORY_INFO[selectedEntry.category];
                    return (
                      <span className={`text-xs px-2 py-0.5 rounded-full bg-court-surface ${catInfo.color}`}>
                        {catInfo.label}
                      </span>
                    );
                  })()}
                </div>

                <h3 className="text-2xl font-bold text-gray-100 mb-4">{selectedEntry.term}</h3>

                <p className="text-gray-300 leading-relaxed mb-4">
                  {selectedEntry.definition}
                </p>

                {selectedEntry.example && (
                  <div className="bg-court-surface rounded-lg p-4 mb-4">
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Example</div>
                    <div className="text-gray-300 text-sm">{selectedEntry.example}</div>
                  </div>
                )}

                {selectedEntry.relatedTerms && selectedEntry.relatedTerms.length > 0 && (
                  <div className="mt-6">
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Related Terms</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedEntry.relatedTerms.map(term => (
                        <button
                          key={term}
                          onClick={() => setSelectedTerm(term)}
                          className="px-3 py-1 bg-court-surface rounded-full text-sm text-gray-300 hover:text-hawk-teal transition-colors"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Book className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Select a term to see its definition</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
