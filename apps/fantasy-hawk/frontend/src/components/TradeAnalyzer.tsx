import { useState } from 'react';
import { api } from '../services/api';
import { TradeBuilder } from './trade/TradeBuilder';
import { ArrowRightLeft } from 'lucide-react';

interface TradeAnalyzerProps {
  selectedLeague: string | null;
}

interface Player {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  stats: Record<string, number>;
}

interface CategoryImpact {
  statId: string;
  name: string;
  displayName: string;
  giving: number;
  receiving: number;
  netChange: number;
  isNegative: boolean;
  impact: 'positive' | 'negative' | 'neutral';
}

interface TradeAnalysisResult {
  playersGiving: Array<{ playerKey: string; name: string; position?: string; team?: string }>;
  playersReceiving: Array<{ playerKey: string; name: string; position?: string; team?: string }>;
  categoryImpact: CategoryImpact[];
  summary: {
    categoriesGained: number;
    categoriesLost: number;
    netCategories: number;
    grade: string;
    recommendation: string;
  };
}

export function TradeAnalyzer({ selectedLeague }: TradeAnalyzerProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<TradeAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(playersToGive: Player[], playersToReceive: Player[]) {
    if (!selectedLeague) return;

    try {
      setAnalyzing(true);
      setError(null);
      const result = await api.fantasy.analyzeTrade(selectedLeague, {
        playersToGive,
        playersToReceive,
      }) as TradeAnalysisResult;
      setAnalysisResult(result);
    } catch (err: any) {
      console.error('Trade analysis failed:', err);
      setError(err.message || 'Failed to analyze trade');
    } finally {
      setAnalyzing(false);
    }
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="trade-no-league">
        <ArrowRightLeft className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to analyze trades</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="trade-analyzer-page">
      {/* Page Header */}
      <div>
        <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
          <ArrowRightLeft className="w-7 h-7 text-hawk-orange" />
          Trade Analyzer
        </h2>
        <p className="text-gray-400 mt-1">
          Evaluate trades by comparing category impact
        </p>
      </div>

      {/* Trade Builder */}
      <div className="card">
        <TradeBuilder
          leagueKey={selectedLeague}
          onAnalyze={handleAnalyze}
          isAnalyzing={analyzing}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="card bg-red-900/20 border-red-800/30">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Analysis Results */}
      {analysisResult && (
        <div className="card" data-testid="trade-analysis-result">
          <h3 className="font-semibold text-gray-100 mb-4">Analysis Results</h3>

          {/* Summary */}
          <div className="flex items-center gap-6 mb-6 p-4 bg-court-base rounded-lg" data-testid="trade-fairness-meter">
            <div className={`text-4xl font-bold ${
              analysisResult.summary.grade === 'A' ? 'text-green-400' :
              analysisResult.summary.grade === 'B' ? 'text-green-300' :
              analysisResult.summary.grade === 'C' ? 'text-yellow-400' :
              analysisResult.summary.grade === 'D' ? 'text-orange-400' :
              'text-red-400'
            }`}>
              {analysisResult.summary.grade}
            </div>
            <div>
              <p className="text-gray-200">{analysisResult.summary.recommendation}</p>
              <p className="text-sm text-gray-400 mt-1">
                Categories: {analysisResult.summary.categoriesGained > 0 ? `+${analysisResult.summary.categoriesGained}` : '0'} gained,
                {' '}{analysisResult.summary.categoriesLost > 0 ? `-${analysisResult.summary.categoriesLost}` : '0'} lost
                {' '}(Net: {analysisResult.summary.netCategories >= 0 ? '+' : ''}{analysisResult.summary.netCategories})
              </p>
            </div>
          </div>

          {/* Category Impact Table */}
          <div className="overflow-x-auto" data-testid="trade-category-impact">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-white/10">
                  <th className="text-left py-2 px-3">Category</th>
                  <th className="text-right py-2 px-3">You Give</th>
                  <th className="text-right py-2 px-3">You Get</th>
                  <th className="text-right py-2 px-3">Net Change</th>
                  <th className="text-center py-2 px-3">Impact</th>
                </tr>
              </thead>
              <tbody>
                {analysisResult.categoryImpact.map((cat) => (
                  <tr
                    key={cat.statId}
                    className="border-b border-white/5"
                    data-testid={`trade-category-row-${cat.displayName}`}
                  >
                    <td className="py-2 px-3 text-gray-200">{cat.displayName || cat.name}</td>
                    <td className="py-2 px-3 text-right text-gray-400">
                      {cat.giving.toFixed(cat.name?.includes('%') ? 1 : 0)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-400">
                      {cat.receiving.toFixed(cat.name?.includes('%') ? 1 : 0)}
                    </td>
                    <td className={`py-2 px-3 text-right ${
                      cat.impact === 'positive' ? 'text-green-400' :
                      cat.impact === 'negative' ? 'text-red-400' :
                      'text-gray-400'
                    }`}>
                      {cat.netChange >= 0 ? '+' : ''}{cat.netChange.toFixed(cat.name?.includes('%') ? 1 : 0)}
                      {cat.isNegative && cat.netChange !== 0 && (
                        <span className="ml-1 text-xs text-gray-500">(TOs)</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {cat.impact === 'positive' && (
                        <span className="text-green-400">▲</span>
                      )}
                      {cat.impact === 'negative' && (
                        <span className="text-red-400">▼</span>
                      )}
                      {cat.impact === 'neutral' && (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Net Summary */}
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-gray-300">
              <strong>Net Summary:</strong>{' '}
              {analysisResult.categoryImpact.filter(c => c.impact === 'positive').length > 0 && (
                <span className="text-green-400">
                  Gains {analysisResult.categoryImpact.filter(c => c.impact === 'positive').map(c => c.displayName || c.name).join(', ')}
                </span>
              )}
              {analysisResult.categoryImpact.filter(c => c.impact === 'positive').length > 0 &&
               analysisResult.categoryImpact.filter(c => c.impact === 'negative').length > 0 && (
                <span className="text-gray-400"> | </span>
              )}
              {analysisResult.categoryImpact.filter(c => c.impact === 'negative').length > 0 && (
                <span className="text-red-400">
                  Loses {analysisResult.categoryImpact.filter(c => c.impact === 'negative').map(c => c.displayName || c.name).join(', ')}
                </span>
              )}
              {analysisResult.categoryImpact.filter(c => c.impact !== 'neutral').length === 0 && (
                <span className="text-gray-400">Even trade across all categories</span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
