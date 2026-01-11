import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { LoadingSpinner } from './LoadingSpinner';
import { StrategyAnalyzer } from './punt/StrategyAnalyzer';
import { Archetypes } from './punt/Archetypes';
import { Target, HelpCircle } from 'lucide-react';

interface PuntEngineProps {
  selectedLeague: string | null;
}

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
  teamKey?: string;
  totalTeams?: number;
  detectedBuild: string;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  categoryRanks: CategoryData[];
  archetypes: PuntArchetype[];
  recommendation: string;
}

export function PuntEngine({ selectedLeague }: PuntEngineProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PuntAnalysis | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (selectedLeague) {
      loadAnalysis();
    }
  }, [selectedLeague]);

  async function loadAnalysis() {
    if (!selectedLeague) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.fantasy.getPuntAnalysis(selectedLeague) as PuntAnalysis;
      setAnalysis(data);
    } catch (err: any) {
      console.error('Failed to load punt analysis:', err);
      setError(err.message || 'Failed to load punt analysis');
    } finally {
      setLoading(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="punt-no-league">
        <Target className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to analyze punt strategies</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner message="Analyzing punt strategies..." />;
  }

  if (error) {
    return (
      <div className="card text-center py-12" data-testid="punt-error">
        <p className="text-red-400">{error}</p>
        <button
          onClick={loadAnalysis}
          className="mt-4 px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="punt-page">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
            <Target className="w-7 h-7 text-hawk-indigo" />
            Punt Strategy Engine
          </h2>
          <p className="text-gray-400 mt-1">
            Analyze your team build and optimize your category strategy
          </p>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            showHelp ? 'bg-hawk-indigo/20 text-hawk-indigo' : 'bg-court-base text-gray-400 hover:text-gray-200'
          }`}
        >
          <HelpCircle className="w-5 h-5" />
          What is Punting?
        </button>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div className="card bg-hawk-indigo/10 border border-hawk-indigo/30">
          <h3 className="font-semibold text-gray-100 mb-3">Understanding Punt Strategies</h3>
          <div className="text-gray-300 space-y-2 text-sm">
            <p>
              <strong>"Punting"</strong> is a fantasy basketball strategy where you intentionally ignore
              certain statistical categories to dominate the remaining ones.
            </p>
            <p>
              For example, if you "Punt Assists," you'd focus on building a team of players who
              excel in other areas (rebounds, blocks, efficiency) while accepting you'll likely lose
              the assists category each week.
            </p>
            <p>
              The key is to <strong>fully commit</strong> to your strategy. Half-committing to a punt
              leaves you mediocre in all categories instead of dominant in your target categories.
            </p>
            <div className="flex gap-6 mt-4">
              <div>
                <span className="text-green-400 font-medium">Benefits:</span>
                <ul className="list-disc list-inside text-gray-400 mt-1">
                  <li>Dominate 6-7 categories consistently</li>
                  <li>Clearer trade targets and waiver priorities</li>
                  <li>More efficient roster construction</li>
                </ul>
              </div>
              <div>
                <span className="text-red-400 font-medium">Trade-offs:</span>
                <ul className="list-disc list-inside text-gray-400 mt-1">
                  <li>Guaranteed to lose 1-2 categories</li>
                  <li>Requires roster commitment</li>
                  <li>May limit trade partners</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Content */}
      {analysis ? (
        <>
          <StrategyAnalyzer
            analysis={analysis}
            totalTeams={analysis.totalTeams || 12}
          />

          {/* Build Archetypes Guide */}
          <Archetypes archetypes={analysis.archetypes} />
        </>
      ) : (
        <div className="card text-center py-12" data-testid="punt-empty">
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No analysis data available</p>
        </div>
      )}

      {/* Refresh Button */}
      {analysis && (
        <div className="text-center">
          <button
            onClick={loadAnalysis}
            className="text-sm text-gray-400 hover:text-gray-200 underline"
          >
            Refresh Analysis
          </button>
        </div>
      )}
    </div>
  );
}
