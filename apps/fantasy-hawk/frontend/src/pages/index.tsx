// Page exports for route-based rendering
export { StandingsPage } from './StandingsPage';
export { CategoriesPage } from './CategoriesPage';

// Wrapper pages that pass leagueKey to existing components
import { useLeagueContext } from '../components/LeagueLayout';
import { MatchupCenter } from '../components/MatchupCenter';
import { StreamingOptimizer } from '../components/StreamingOptimizer';
import { TradeAnalyzer } from '../components/TradeAnalyzer';
import { PlayerComparison } from '../components/PlayerComparison';
import { WaiverAdvisor } from '../components/WaiverAdvisor';
import { PuntEngine } from '../components/PuntEngine';
import { LeagueInsights } from '../components/LeagueInsights';
import { SchedulePlanner } from '../components/SchedulePlanner';
import { SeasonOutlook } from '../components/SeasonOutlook';
import { AIChat } from '../components/AIChat';
import { DebugPanel } from '../components/DebugPanel';

export function MatchupPage() {
  const { leagueKey } = useLeagueContext();
  return <MatchupCenter selectedLeague={leagueKey} />;
}

export function StreamingPage() {
  const { leagueKey } = useLeagueContext();
  return <StreamingOptimizer selectedLeague={leagueKey} />;
}

export function TradePage() {
  const { leagueKey } = useLeagueContext();
  return <TradeAnalyzer selectedLeague={leagueKey} />;
}

export function ComparePage() {
  const { leagueKey } = useLeagueContext();
  return <PlayerComparison selectedLeague={leagueKey} />;
}

export function WaiverPage() {
  const { leagueKey } = useLeagueContext();
  return <WaiverAdvisor selectedLeague={leagueKey} />;
}

export function PuntPage() {
  const { leagueKey } = useLeagueContext();
  return <PuntEngine selectedLeague={leagueKey} />;
}

export function InsightsPage() {
  const { leagueKey } = useLeagueContext();
  return <LeagueInsights selectedLeague={leagueKey} />;
}

export function SchedulePage() {
  const { leagueKey } = useLeagueContext();
  return <SchedulePlanner selectedLeague={leagueKey} />;
}

export function OutlookPage() {
  const { leagueKey } = useLeagueContext();
  return <SeasonOutlook selectedLeague={leagueKey} />;
}

export function ChatPage() {
  const { leagueKey } = useLeagueContext();
  return <AIChat selectedLeague={leagueKey} />;
}

export function DebugPage() {
  const { leagueKey } = useLeagueContext();
  return <DebugPanel selectedLeague={leagueKey} />;
}
