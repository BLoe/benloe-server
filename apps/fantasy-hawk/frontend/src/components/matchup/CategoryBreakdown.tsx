import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface CategoryData {
  statId: number;
  name: string;
  displayName: string;
  yourValue: string;
  opponentValue: string;
  winner: 'you' | 'opponent' | 'tie';
  margin: string;
  isPercentage: boolean;
  isNegative?: boolean;
}

interface CategoryBreakdownProps {
  categories: CategoryData[];
  expanded: number | null;
  onToggle: (statId: number | null) => void;
}

export function CategoryBreakdown({ categories, expanded, onToggle }: CategoryBreakdownProps) {
  const formatValue = (value: string, isPercentage: boolean) => {
    if (isPercentage) {
      const num = parseFloat(value);
      return isNaN(num) ? value : `${(num * 100).toFixed(1)}%`;
    }
    return value;
  };

  const getCategoryIcon = (winner: 'you' | 'opponent' | 'tie') => {
    switch (winner) {
      case 'you':
        return <TrendingUp className="w-4 h-4 text-hawk-teal" />;
      case 'opponent':
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      case 'tie':
        return <Minus className="w-4 h-4 text-yellow-400" />;
    }
  };

  const getCategoryBg = (winner: 'you' | 'opponent' | 'tie') => {
    switch (winner) {
      case 'you':
        return 'bg-hawk-teal/5 hover:bg-hawk-teal/10 border-hawk-teal/20';
      case 'opponent':
        return 'bg-red-900/5 hover:bg-red-900/10 border-red-400/20';
      case 'tie':
        return 'bg-yellow-900/5 hover:bg-yellow-900/10 border-yellow-400/20';
    }
  };

  const getMarginAnalysis = (cat: CategoryData) => {
    const yourVal = parseFloat(cat.yourValue);
    const oppVal = parseFloat(cat.opponentValue);

    if (isNaN(yourVal) || isNaN(oppVal) || yourVal === oppVal) {
      return { severity: 'neutral', message: 'Categories are tied' };
    }

    const diff = Math.abs(yourVal - oppVal);
    const avgVal = (yourVal + oppVal) / 2;
    const percentDiff = avgVal > 0 ? (diff / avgVal) * 100 : 0;

    if (cat.winner === 'you') {
      if (percentDiff > 20) return { severity: 'strong', message: 'Comfortable lead' };
      if (percentDiff > 10) return { severity: 'moderate', message: 'Solid advantage' };
      return { severity: 'close', message: 'Close margin - could swing' };
    } else {
      if (percentDiff > 20) return { severity: 'strong', message: 'Large deficit' };
      if (percentDiff > 10) return { severity: 'moderate', message: 'Notable gap' };
      return { severity: 'close', message: 'Within reach' };
    }
  };

  return (
    <div className="space-y-2" data-testid="category-breakdown">
      {categories.map((cat) => {
        const isExpanded = expanded === cat.statId;
        const analysis = getMarginAnalysis(cat);

        return (
          <div
            key={cat.statId}
            className={`rounded-lg border transition-all ${getCategoryBg(cat.winner)}`}
          >
            {/* Clickable header row */}
            <button
              onClick={() => onToggle(isExpanded ? null : cat.statId)}
              className="w-full px-4 py-3 flex items-center justify-between text-left"
              data-testid={`category-row-${cat.statId}`}
            >
              <div className="flex items-center gap-3">
                {getCategoryIcon(cat.winner)}
                <span className="font-medium text-gray-200">{cat.displayName}</span>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={cat.winner === 'you' ? 'text-hawk-teal font-semibold' : 'text-gray-400'}>
                    {formatValue(cat.yourValue, cat.isPercentage)}
                  </span>
                  <span className="text-gray-600">vs</span>
                  <span className={cat.winner === 'opponent' ? 'text-red-400 font-semibold' : 'text-gray-400'}>
                    {formatValue(cat.opponentValue, cat.isPercentage)}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </div>
            </button>

            {/* Expanded detail section */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-700/50 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* Your side */}
                  <div className="space-y-2">
                    <div className="text-gray-400 text-xs uppercase tracking-wider">Your Team</div>
                    <div className={`text-2xl font-display ${cat.winner === 'you' ? 'text-hawk-teal' : 'text-gray-300'}`}>
                      {formatValue(cat.yourValue, cat.isPercentage)}
                    </div>
                  </div>

                  {/* Opponent side */}
                  <div className="space-y-2 text-right">
                    <div className="text-gray-400 text-xs uppercase tracking-wider">Opponent</div>
                    <div className={`text-2xl font-display ${cat.winner === 'opponent' ? 'text-red-400' : 'text-gray-300'}`}>
                      {formatValue(cat.opponentValue, cat.isPercentage)}
                    </div>
                  </div>
                </div>

                {/* Analysis */}
                <div className="mt-4 pt-3 border-t border-gray-700/30">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">Margin</span>
                    <span className={`text-sm ${
                      cat.winner === 'you' ? 'text-hawk-teal' :
                      cat.winner === 'opponent' ? 'text-red-400' :
                      'text-yellow-400'
                    }`}>
                      {cat.winner !== 'tie' ? cat.margin : 'Tied'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-gray-500 text-xs">Analysis</span>
                    <span className="text-gray-400 text-sm">{analysis.message}</span>
                  </div>
                  {cat.isNegative && (
                    <div className="text-xs text-gray-500 mt-2 italic">
                      Lower is better for this category
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
