import { useState } from 'react';
import { Target, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Users } from 'lucide-react';

interface PuntArchetype {
  id: string;
  name: string;
  description: string;
  puntCategories: string[];
  strengthCategories: string[];
  matchScore: number;
  isRecommended: boolean;
}

interface ArchetypeDefinition {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  puntCategories: string[];
  strengthCategories: string[];
  examplePlayerTypes: string[];
  tradeTips: string[];
}

// Detailed archetype definitions
const ARCHETYPE_DEFINITIONS: ArchetypeDefinition[] = [
  {
    id: 'punt-ast',
    name: 'Punt Assists',
    description: 'Big man focus with emphasis on boards, blocks, and efficiency',
    longDescription:
      'This build focuses on centers and power forwards who dominate the paint. By ignoring assists, you can target elite rebounders and shot blockers who typically have lower assist numbers. This is one of the most popular and effective punt strategies.',
    puntCategories: ['AST'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'PTS'],
    examplePlayerTypes: [
      'Traditional centers (Rudy Gobert, Clint Capela)',
      'Athletic bigs (Giannis, AD when at C)',
      'Rim runners (Mitchell Robinson, Javale McGee)',
      'Scoring wings who dont facilitate (Jaylen Brown type)',
    ],
    tradeTips: [
      'Target players whose assist totals drag down their value',
      'Elite PGs like Trae Young are overvalued for your build',
      'Look for 2-guard types who score but dont pass',
    ],
  },
  {
    id: 'punt-ft',
    name: 'Punt Free Throws',
    description: 'High-volume centers and rim protectors who struggle at the line',
    longDescription:
      'By punting FT%, you can roster dominant bigs who hurt most teams at the line. Players like Giannis, Gobert, and Capela become more valuable when you dont care about their free throw shooting.',
    puntCategories: ['FT%'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'PTS'],
    examplePlayerTypes: [
      'Elite rim protectors (Gobert, Mitchell Robinson)',
      'Athletic finishers (Giannis, Zion)',
      'Traditional bigs (Clint Capela, Jarrett Allen)',
      'Offensive bigs with poor FT (Ben Simmons)',
    ],
    tradeTips: [
      'Avoid guards who depend on free throws for points',
      'Target high-volume shooters at the rim',
      'You can often get discounts on players with poor FT%',
    ],
  },
  {
    id: 'punt-3pm',
    name: 'Punt Three Pointers',
    description: 'Traditional bigs and slashers who dominate inside',
    longDescription:
      'This build focuses on players who score efficiently at the rim and mid-range, ignoring three-point shooting. Works well in leagues where 3PM is a separate category from 3P%.',
    puntCategories: ['3PM'],
    strengthCategories: ['REB', 'FG%', 'AST', 'BLK'],
    examplePlayerTypes: [
      'Post-up centers (Nikola Jokic for non-3s)',
      'Slashing wings (Zion, Giannis)',
      'Traditional point guards (older Westbrook style)',
      'Rim-running bigs (Clint Capela)',
    ],
    tradeTips: [
      'Volume 3-point shooters are overvalued for your build',
      'Target efficient 2-point scorers',
      'Look for playmakers who dont shoot threes',
    ],
  },
  {
    id: 'punt-blk',
    name: 'Punt Blocks',
    description: 'Guard-heavy build focused on perimeter play',
    longDescription:
      'By ignoring blocks, you can focus on guards and wings who excel at steals, assists, and three-point shooting. This build is often guard-heavy and fast-paced.',
    puntCategories: ['BLK'],
    strengthCategories: ['AST', 'STL', '3PM', 'FT%'],
    examplePlayerTypes: [
      'Elite point guards (Trae Young, Luka Doncic)',
      'Shooting guards (Steph Curry, CJ McCollum)',
      'Perimeter wings (Mikal Bridges)',
      'Combo guards (De Aaron Fox, Tyrese Haliburton)',
    ],
    tradeTips: [
      'Centers are generally overvalued for your build',
      'Target multi-category guards',
      'Look for high-steal players',
    ],
  },
  {
    id: 'punt-to',
    name: 'Punt Turnovers',
    description: 'High-usage playmakers who dominate volume stats',
    longDescription:
      'Accept turnovers in exchange for elite production. High-usage stars like Luka, Trae, and Harden turn the ball over but provide massive counting stats. This can be effective but risky.',
    puntCategories: ['TO'],
    strengthCategories: ['PTS', 'AST', 'STL', 'REB'],
    examplePlayerTypes: [
      'Ball-dominant superstars (Luka, Trae, Harden)',
      'High-usage scorers (Embiid, Booker)',
      'Triple-double threats (Westbrook, Jokic)',
      'Usage-heavy combo guards',
    ],
    tradeTips: [
      'Target high-turnover players at a discount',
      'Low-usage role players hurt your counting stats',
      'Focus on accumulating raw totals',
    ],
  },
  {
    id: 'punt-ast-ft',
    name: 'Punt AST + FT%',
    description: 'Classic big man build with traditional centers',
    longDescription:
      'The double-punt of assists and free throws lets you roster the most dominant bigs who typically struggle in both categories. This is the purest "big man build" strategy.',
    puntCategories: ['AST', 'FT%'],
    strengthCategories: ['REB', 'BLK', 'FG%', 'STL'],
    examplePlayerTypes: [
      'Elite centers (Gobert, Mitchell Robinson)',
      'Athletic bigs (Giannis, Zion)',
      'Versatile forwards (AD, Bam)',
      'Rim protectors of all types',
    ],
    tradeTips: [
      'Point guards are generally useless for your build',
      'Target the best bigs regardless of FT%',
      'Look for versatile forwards who can guard multiple positions',
    ],
  },
];

interface ArchetypesProps {
  archetypes: PuntArchetype[];
}

export function Archetypes({ archetypes }: ArchetypesProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Merge API archetype data with detailed definitions
  const enrichedArchetypes = ARCHETYPE_DEFINITIONS.map(def => {
    const apiData = archetypes.find(a => a.id === def.id);
    return {
      ...def,
      matchScore: apiData?.matchScore || 0,
      isRecommended: apiData?.isRecommended || false,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);

  return (
    <div className="card" data-testid="archetypes-panel">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5 text-hawk-teal" />
        <h3 className="font-semibold text-gray-100">Build Archetypes</h3>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        Click on any archetype to learn more about the strategy and which players fit.
      </p>

      <div className="space-y-3">
        {enrichedArchetypes.map(arch => (
          <ArchetypeDetailCard
            key={arch.id}
            archetype={arch}
            isExpanded={expandedId === arch.id}
            onToggle={() => setExpandedId(expandedId === arch.id ? null : arch.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ArchetypeDetailCard({
  archetype,
  isExpanded,
  onToggle,
}: {
  archetype: ArchetypeDefinition & { matchScore: number; isRecommended: boolean };
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400 bg-green-500/20';
    if (score >= 55) return 'text-hawk-teal bg-hawk-teal/20';
    if (score >= 40) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-gray-400 bg-gray-500/20';
  };

  return (
    <div
      className={`rounded-lg border transition-all ${
        archetype.isRecommended
          ? 'bg-hawk-indigo/10 border-hawk-indigo/50'
          : 'bg-court-base border-white/10 hover:border-white/20'
      }`}
      data-testid={`archetype-detail-${archetype.id}`}
    >
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          {archetype.isRecommended && (
            <Target className="w-5 h-5 text-hawk-indigo" />
          )}
          <div>
            <div className="font-medium text-gray-100">{archetype.name}</div>
            <div className="text-sm text-gray-400">{archetype.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`px-2 py-1 rounded text-sm font-semibold ${getScoreColor(archetype.matchScore)}`}
          >
            {archetype.matchScore}%
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          {/* Long description */}
          <p className="text-sm text-gray-300">{archetype.longDescription}</p>

          {/* Categories */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-red-400 flex items-center gap-1 mb-2">
                <TrendingDown className="w-4 h-4" /> Categories to Punt
              </h4>
              <div className="flex flex-wrap gap-2">
                {archetype.puntCategories.map(cat => (
                  <span
                    key={cat}
                    className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-sm"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-green-400 flex items-center gap-1 mb-2">
                <TrendingUp className="w-4 h-4" /> Categories to Target
              </h4>
              <div className="flex flex-wrap gap-2">
                {archetype.strengthCategories.map(cat => (
                  <span
                    key={cat}
                    className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-sm"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Example player types */}
          <div>
            <h4 className="text-sm font-medium text-gray-300 mb-2">Example Player Types</h4>
            <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
              {archetype.examplePlayerTypes.map((type, i) => (
                <li key={i}>{type}</li>
              ))}
            </ul>
          </div>

          {/* Trade tips */}
          <div>
            <h4 className="text-sm font-medium text-hawk-orange mb-2">Trade & Waiver Tips</h4>
            <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
              {archetype.tradeTips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
