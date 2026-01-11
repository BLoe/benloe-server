import { useState, useRef, useEffect, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { useLearningMode } from '../../contexts/LearningModeContext';

interface TooltipProps {
  term: string;
  children: ReactNode;
  showIcon?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

// Tooltip content definitions for fantasy basketball terms
export const TOOLTIP_CONTENT: Record<string, { title: string; description: string; example?: string }> = {
  // Category abbreviations
  'FG%': {
    title: 'Field Goal Percentage',
    description: 'The percentage of shots made from the field. Higher is better.',
    example: '50% means making half of all shot attempts.',
  },
  'FT%': {
    title: 'Free Throw Percentage',
    description: 'The percentage of free throws made. Higher is better.',
    example: '85% means making 85 out of 100 free throws.',
  },
  '3PM': {
    title: 'Three-Pointers Made',
    description: 'Total three-point shots made. More is better in this category.',
  },
  '3P%': {
    title: 'Three-Point Percentage',
    description: 'The percentage of three-point shots made. Higher is better.',
  },
  'PTS': {
    title: 'Points',
    description: 'Total points scored. More points = better.',
  },
  'REB': {
    title: 'Rebounds',
    description: 'Total rebounds (offensive + defensive). More is better.',
  },
  'AST': {
    title: 'Assists',
    description: 'Passes that directly lead to a made basket. More assists = better.',
  },
  'STL': {
    title: 'Steals',
    description: 'Times a player takes the ball from an opponent. More is better.',
  },
  'BLK': {
    title: 'Blocks',
    description: 'Shots blocked by a defensive player. More blocks = better.',
  },
  'TO': {
    title: 'Turnovers',
    description: 'Times possession is lost to the opponent. FEWER is better!',
    example: 'This is a negative category - lower numbers win.',
  },
  'OREB': {
    title: 'Offensive Rebounds',
    description: 'Rebounds on the offensive end after a missed shot. More is better.',
  },
  'DREB': {
    title: 'Defensive Rebounds',
    description: 'Rebounds on the defensive end after the opponent misses. More is better.',
  },
  'DD': {
    title: 'Double-Doubles',
    description: 'Games with 10+ in two stat categories (e.g., points and rebounds).',
  },
  'TD': {
    title: 'Triple-Doubles',
    description: 'Games with 10+ in three stat categories. Very rare and valuable!',
  },
  'A/T': {
    title: 'Assist-to-Turnover Ratio',
    description: 'Assists divided by turnovers. Higher means more efficient ball handling.',
  },

  // Strategy terms
  'punt': {
    title: 'Punt Strategy',
    description: 'Intentionally ignoring one or more categories to dominate the others.',
    example: 'Punting FT% means drafting players regardless of free throw shooting.',
  },
  'streaming': {
    title: 'Streaming',
    description: 'Adding and dropping players frequently based on their upcoming schedule.',
    example: 'Picking up a player who has 4 games this week vs your opponent\'s 2.',
  },
  'waiver': {
    title: 'Waiver Wire',
    description: 'The pool of free agents available to add to your team.',
  },
  'FAAB': {
    title: 'Free Agent Acquisition Budget',
    description: 'A dollar budget ($100 typically) used to bid on waiver players.',
  },
  'trade value': {
    title: 'Trade Value',
    description: 'An estimate of a player\'s worth in trades based on their stats.',
  },
  'sell high': {
    title: 'Sell High',
    description: 'Trading a player while their value is inflated (playing above their usual level).',
  },
  'buy low': {
    title: 'Buy Low',
    description: 'Acquiring a player while their value is deflated (playing below their usual level).',
  },
  'category league': {
    title: 'Category League (H2H)',
    description: 'Each stat category is a separate matchup. Win more categories to win the week.',
    example: 'If you win 5 categories and lose 4, you win that week\'s matchup.',
  },
  'roto': {
    title: 'Rotisserie League',
    description: 'Season-long cumulative stats. Highest totals win (no weekly matchups).',
  },
  'points league': {
    title: 'Points League',
    description: 'All stats converted to fantasy points. Highest weekly total wins.',
  },

  // UI/App terms
  'magic number': {
    title: 'Magic Number',
    description: 'The combination of your wins + competitor losses needed to clinch playoffs.',
  },
  'playoff odds': {
    title: 'Playoff Odds',
    description: 'Estimated percentage chance of making the playoffs based on current pace.',
  },
  'win pace': {
    title: 'Win Pace',
    description: 'Your average category wins per week, projected across the season.',
  },
  'games played': {
    title: 'Games Played',
    description: 'Number of NBA games a player or team plays in a given week.',
    example: 'More games = more chances to accumulate stats.',
  },
  'playoff schedule': {
    title: 'Playoff Schedule',
    description: 'The number of games NBA teams play during fantasy playoff weeks.',
    example: 'Teams with 4 games are more valuable than teams with 2.',
  },
  'category winner': {
    title: 'Category Winner',
    description: 'The team with the best total in a stat category wins that category.',
  },
  'bubble team': {
    title: 'Bubble Team',
    description: 'A team on the edge of playoff contention - could go either way.',
  },
  'clinched': {
    title: 'Clinched Playoffs',
    description: 'Mathematically guaranteed a playoff spot regardless of remaining games.',
  },
  'eliminated': {
    title: 'Eliminated',
    description: 'Mathematically eliminated from playoff contention.',
  },
};

export function Tooltip({ term, children, showIcon = false, position = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { isEnabled } = useLearningMode();

  const content = TOOLTIP_CONTENT[term];

  // Calculate tooltip position
  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      let x = 0;
      let y = 0;

      switch (position) {
        case 'top':
          x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          y = triggerRect.top - tooltipRect.height - 8;
          break;
        case 'bottom':
          x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          y = triggerRect.bottom + 8;
          break;
        case 'left':
          x = triggerRect.left - tooltipRect.width - 8;
          y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          break;
        case 'right':
          x = triggerRect.right + 8;
          y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          break;
      }

      // Keep tooltip within viewport
      x = Math.max(8, Math.min(x, window.innerWidth - tooltipRect.width - 8));
      y = Math.max(8, Math.min(y, window.innerHeight - tooltipRect.height - 8));

      setTooltipPosition({ x, y });
    }
  }, [isVisible, position]);

  // If learning mode is disabled or no content, just render children
  if (!isEnabled || !content) {
    return <>{children}</>;
  }

  const handleMouseEnter = () => setIsVisible(true);
  const handleMouseLeave = () => setIsVisible(false);
  const handleClick = () => setIsVisible(!isVisible);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="inline-flex items-center gap-1 cursor-help border-b border-dashed border-hawk-teal/50"
        data-testid="tooltip-trigger"
      >
        {children}
        {showIcon && <HelpCircle className="w-3.5 h-3.5 text-hawk-teal" />}
      </span>

      {isVisible && (
        <div
          ref={tooltipRef}
          className="fixed z-50 w-64 p-3 bg-gray-900 border border-gray-700 rounded-lg shadow-xl animate-fadeIn"
          style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
          data-testid="tooltip"
        >
          <div className="text-sm font-semibold text-hawk-teal mb-1">{content.title}</div>
          <div className="text-xs text-gray-300">{content.description}</div>
          {content.example && (
            <div className="text-xs text-gray-500 mt-2 italic">
              Example: {content.example}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Simpler inline tooltip for just showing a help icon
export function HelpTooltip({ term }: { term: string }) {
  return (
    <Tooltip term={term} showIcon>
      <span className="sr-only">{term}</span>
    </Tooltip>
  );
}
