import { TrendingUp, TrendingDown, Target, AlertTriangle, Award } from 'lucide-react';

interface CategoryData {
  statId: string;
  name: string;
  displayName: string;
  isNegative: boolean;
  value: number;
  rank: number;
  percentile: number;
}

interface PuntArchetype {
  id: string;
  name: string;
  description: string;
  puntCategories: string[];
  strengthCategories: string[];
  matchScore: number;
  isRecommended: boolean;
}

interface PuntAnalysis {
  detectedBuild: string;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  categoryRanks: CategoryData[];
  archetypes: PuntArchetype[];
  recommendation: string;
}

interface StrategyAnalyzerProps {
  analysis: PuntAnalysis;
  totalTeams: number;
}

export function StrategyAnalyzer({ analysis, totalTeams }: StrategyAnalyzerProps) {
  return (
    <div className="space-y-6" data-testid="punt-analyzer">
      {/* Current Build Detection */}
      <div className="card bg-gradient-to-r from-hawk-indigo/10 to-hawk-teal/10 border border-hawk-indigo/30" data-testid="punt-current-build">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-6 h-6 text-hawk-indigo" />
          <h3 className="font-semibold text-gray-100 text-lg">Your Current Build</h3>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Detected Strategy */}
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <div className="text-2xl font-bold text-hawk-teal">
                {analysis.detectedBuild}
              </div>
              <div className="px-2 py-1 bg-hawk-teal/20 rounded text-sm text-hawk-teal">
                {analysis.confidence}% Confidence
              </div>
            </div>
            <p className="text-gray-400 mt-2">{analysis.recommendation}</p>
          </div>

          {/* Strengths & Weaknesses */}
          <div className="flex gap-6">
            <div>
              <h4 className="text-sm text-green-400 font-medium mb-2 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" /> Strengths
              </h4>
              <ul className="space-y-1">
                {analysis.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-gray-300">{s}</li>
                ))}
                {analysis.strengths.length === 0 && (
                  <li className="text-sm text-gray-500">No standout strengths</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-sm text-red-400 font-medium mb-2 flex items-center gap-1">
                <TrendingDown className="w-4 h-4" /> Weaknesses
              </h4>
              <ul className="space-y-1">
                {analysis.weaknesses.map((w, i) => (
                  <li key={i} className="text-sm text-gray-300">{w}</li>
                ))}
                {analysis.weaknesses.length === 0 && (
                  <li className="text-sm text-gray-500">No major weaknesses</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Category Ranks Visualization */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Category Ranks Chart */}
        <div className="card" data-testid="punt-category-ranks">
          <h3 className="font-semibold text-gray-100 mb-4">Category Ranks (1-{totalTeams})</h3>
          <div className="space-y-3">
            {analysis.categoryRanks.map(cat => (
              <CategoryRankBar
                key={cat.statId}
                category={cat}
                totalTeams={totalTeams}
              />
            ))}
          </div>
        </div>

        {/* Strategy Archetypes */}
        <div className="card" data-testid="punt-archetypes">
          <h3 className="font-semibold text-gray-100 mb-4">Build Archetypes</h3>
          <div className="space-y-3">
            {analysis.archetypes.map(arch => (
              <ArchetypeCard
                key={arch.id}
                archetype={arch}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryRankBar({
  category,
  totalTeams,
}: {
  category: CategoryData;
  totalTeams: number;
}) {
  // Calculate position (1 = best, totalTeams = worst)
  const position = ((category.rank - 1) / (totalTeams - 1)) * 100;
  const isPuntCandidate = category.rank >= Math.ceil(totalTeams * 0.67);
  const isStrength = category.rank <= Math.floor(totalTeams * 0.33);

  const getBarColor = () => {
    if (isStrength) return 'bg-green-500';
    if (isPuntCandidate) return 'bg-red-500';
    return 'bg-gray-500';
  };

  return (
    <div
      className="flex items-center gap-3"
      data-testid={`punt-category-rank-${category.displayName}`}
    >
      <div className="w-16 text-sm text-gray-300 truncate" title={category.name}>
        {category.displayName}
      </div>
      <div className="flex-1 relative">
        <div className="h-6 bg-gray-800 rounded-full overflow-hidden">
          {/* Background gradient indicating good (left) to bad (right) */}
          <div className="absolute inset-0 bg-gradient-to-r from-green-900/30 via-gray-800 to-red-900/30" />
          {/* Rank indicator */}
          <div
            className={`absolute top-0 h-full w-4 rounded-full ${getBarColor()} shadow-lg transform -translate-x-1/2`}
            style={{ left: `${position}%` }}
          />
        </div>
      </div>
      <div className={`w-12 text-right text-sm font-medium ${
        isStrength ? 'text-green-400' : isPuntCandidate ? 'text-red-400' : 'text-gray-400'
      }`}>
        {category.rank}{ordinalSuffix(category.rank)}
      </div>
      {isPuntCandidate && (
        <span title="Punt candidate">
          <AlertTriangle className="w-4 h-4 text-red-400" />
        </span>
      )}
    </div>
  );
}

function ArchetypeCard({ archetype }: { archetype: PuntArchetype }) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400 bg-green-500/20';
    if (score >= 55) return 'text-hawk-teal bg-hawk-teal/20';
    if (score >= 40) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-gray-400 bg-gray-500/20';
  };

  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${
        archetype.isRecommended
          ? 'bg-hawk-indigo/10 border-hawk-indigo/50'
          : 'bg-court-base border-white/5'
      }`}
      data-testid={`punt-archetype-${archetype.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {archetype.isRecommended && (
            <Award className="w-4 h-4 text-hawk-indigo" />
          )}
          <span className="font-medium text-gray-100">{archetype.name}</span>
        </div>
        <div
          className={`px-2 py-0.5 rounded text-sm font-semibold ${getScoreColor(archetype.matchScore)}`}
          data-testid={`punt-archetype-match-${archetype.id}`}
        >
          {archetype.matchScore}% Match
        </div>
      </div>
      <p className="text-sm text-gray-400">{archetype.description}</p>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
