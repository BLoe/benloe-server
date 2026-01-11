import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Award } from 'lucide-react';

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

interface TradeSummary {
  categoriesGained: number;
  categoriesLost: number;
  netCategories: number;
  grade: string;
  recommendation: string;
}

interface TradeImpactProps {
  categoryImpact: CategoryImpact[];
  summary: TradeSummary;
  playersGiving: Array<{ playerKey: string; name: string; position?: string; team?: string }>;
  playersReceiving: Array<{ playerKey: string; name: string; position?: string; team?: string }>;
}

export function TradeImpact({
  categoryImpact,
  summary,
  playersGiving,
  playersReceiving,
}: TradeImpactProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Animate on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const positiveCategories = categoryImpact.filter(c => c.impact === 'positive');
  const negativeCategories = categoryImpact.filter(c => c.impact === 'negative');
  const neutralCategories = categoryImpact.filter(c => c.impact === 'neutral');

  return (
    <div
      className={`space-y-6 transition-all duration-500 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
      data-testid="trade-impact"
    >
      {/* Grade Badge & Summary */}
      <div className="flex flex-col md:flex-row gap-6 items-center md:items-start" data-testid="trade-fairness-meter">
        {/* Large Grade */}
        <div
          className={`
            w-24 h-24 rounded-2xl flex items-center justify-center font-bold text-5xl
            transition-all duration-500 delay-100
            ${isVisible ? 'scale-100' : 'scale-50'}
            ${getGradeBgColor(summary.grade)}
          `}
        >
          <span className={getGradeTextColor(summary.grade)}>{summary.grade}</span>
        </div>

        {/* Summary Text */}
        <div className="flex-1 text-center md:text-left">
          <h3 className="text-xl font-semibold text-gray-100 mb-2">
            {summary.recommendation}
          </h3>
          <div className="flex flex-wrap gap-4 justify-center md:justify-start text-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-gray-300">
                <span className="text-green-400 font-semibold">+{summary.categoriesGained}</span> categories gained
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-gray-300">
                <span className="text-red-400 font-semibold">-{summary.categoriesLost}</span> categories lost
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-hawk-teal" />
              <span className="text-gray-300">
                Net: <span className={`font-semibold ${summary.netCategories >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {summary.netCategories >= 0 ? '+' : ''}{summary.netCategories}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Players Involved */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 bg-red-900/10 rounded-lg border border-red-800/20">
          <h4 className="text-sm font-medium text-red-400 mb-2">You Give Up</h4>
          <div className="space-y-1">
            {playersGiving.map(p => (
              <div key={p.playerKey} className="text-gray-200">
                {p.name}
                <span className="text-gray-500 text-sm ml-2">{p.position} - {p.team}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 bg-green-900/10 rounded-lg border border-green-800/20">
          <h4 className="text-sm font-medium text-green-400 mb-2">You Receive</h4>
          <div className="space-y-1">
            {playersReceiving.map(p => (
              <div key={p.playerKey} className="text-gray-200">
                {p.name}
                <span className="text-gray-500 text-sm ml-2">{p.position} - {p.team}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category Impact Visualization */}
      <div data-testid="trade-category-impact">
        <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
          Category-by-Category Impact
        </h4>

        <div className="space-y-3">
          {categoryImpact.map((cat, index) => (
            <CategoryRow
              key={cat.statId}
              category={cat}
              delay={index * 50}
              isVisible={isVisible}
            />
          ))}
        </div>
      </div>

      {/* Net Summary Footer */}
      <div className="p-4 bg-court-base rounded-lg border border-white/10">
        <div className="flex flex-wrap gap-6">
          {positiveCategories.length > 0 && (
            <div>
              <span className="text-sm text-gray-400">Gains: </span>
              <span className="text-green-400">
                {positiveCategories.map(c => c.displayName || c.name).join(', ')}
              </span>
            </div>
          )}
          {negativeCategories.length > 0 && (
            <div>
              <span className="text-sm text-gray-400">Loses: </span>
              <span className="text-red-400">
                {negativeCategories.map(c => c.displayName || c.name).join(', ')}
              </span>
            </div>
          )}
          {neutralCategories.length > 0 && (
            <div>
              <span className="text-sm text-gray-400">Neutral: </span>
              <span className="text-gray-500">
                {neutralCategories.map(c => c.displayName || c.name).join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Individual category row with bar visualization
function CategoryRow({
  category,
  delay,
  isVisible,
}: {
  category: CategoryImpact;
  delay: number;
  isVisible: boolean;
}) {
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => setShowBar(true), delay + 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible, delay]);

  // Calculate bar width based on relative change magnitude
  const maxChange = 100; // Normalize to percentage for visual
  const changePercent = Math.min(Math.abs(category.netChange) / maxChange * 100, 100);

  const formatValue = (value: number) => {
    if (category.name?.toLowerCase().includes('%') || category.displayName?.toLowerCase().includes('%')) {
      return value.toFixed(1) + '%';
    }
    if (Math.abs(value) >= 100) {
      return Math.round(value).toString();
    }
    if (Math.abs(value) >= 10) {
      return value.toFixed(0);
    }
    return value.toFixed(1);
  };

  return (
    <div
      className={`
        p-3 rounded-lg bg-court-base border transition-all duration-300
        ${category.impact === 'positive' ? 'border-green-800/30' :
          category.impact === 'negative' ? 'border-red-800/30' :
          'border-white/5'}
      `}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0)' : 'translateX(-10px)',
      }}
      data-testid={`trade-category-row-${category.displayName || category.name}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {category.impact === 'positive' && <TrendingUp className="w-4 h-4 text-green-400" />}
          {category.impact === 'negative' && <TrendingDown className="w-4 h-4 text-red-400" />}
          {category.impact === 'neutral' && <Minus className="w-4 h-4 text-gray-500" />}
          <span className="font-medium text-gray-200">
            {category.displayName || category.name}
          </span>
          {category.isNegative && (
            <span className="text-xs text-gray-500">(lower is better)</span>
          )}
        </div>
        <div className={`font-semibold ${
          category.impact === 'positive' ? 'text-green-400' :
          category.impact === 'negative' ? 'text-red-400' :
          'text-gray-400'
        }`}>
          {category.netChange >= 0 ? '+' : ''}{formatValue(category.netChange)}
        </div>
      </div>

      {/* Visual bar */}
      <div className="flex items-center gap-3 text-sm">
        <div className="w-16 text-right text-gray-500">
          -{formatValue(category.giving)}
        </div>
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              category.impact === 'positive' ? 'bg-green-500' :
              category.impact === 'negative' ? 'bg-red-500' :
              'bg-gray-600'
            }`}
            style={{
              width: showBar ? `${Math.max(changePercent, 5)}%` : '0%',
              transitionDelay: `${delay + 200}ms`,
            }}
          />
        </div>
        <div className="w-16 text-left text-gray-500">
          +{formatValue(category.receiving)}
        </div>
      </div>
    </div>
  );
}

// Helper functions for grade styling
function getGradeBgColor(grade: string): string {
  switch (grade) {
    case 'A': return 'bg-green-500/20';
    case 'B': return 'bg-green-400/20';
    case 'C': return 'bg-yellow-500/20';
    case 'D': return 'bg-orange-500/20';
    case 'F': return 'bg-red-500/20';
    default: return 'bg-gray-500/20';
  }
}

function getGradeTextColor(grade: string): string {
  switch (grade) {
    case 'A': return 'text-green-400';
    case 'B': return 'text-green-300';
    case 'C': return 'text-yellow-400';
    case 'D': return 'text-orange-400';
    case 'F': return 'text-red-400';
    default: return 'text-gray-400';
  }
}
