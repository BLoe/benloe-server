import { useState } from 'react';
import { api } from '../services/api';
import { TradeBuilder } from './trade/TradeBuilder';
import { TradeImpact } from './trade/TradeImpact';
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
          <h3 className="font-semibold text-gray-100 mb-6">Analysis Results</h3>
          <TradeImpact
            categoryImpact={analysisResult.categoryImpact}
            summary={analysisResult.summary}
            playersGiving={analysisResult.playersGiving}
            playersReceiving={analysisResult.playersReceiving}
          />
        </div>
      )}
    </div>
  );
}
