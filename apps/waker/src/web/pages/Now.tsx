import { useApi } from '../api';
import { ErrorNote, Loading, Sheet } from '../components';
import { TideStrip } from '../TideStrip';
import { DecisionFeed } from '../Decisions';
import { phaseAdvice, type CyclePosition } from '../../lib/analysis/cycle';
import type { Decision } from '../../lib/analysis/decisions';

interface CycleResponse {
  cycle: CyclePosition;
  week: number | null;
  season: string;
  status: string;
}

interface FeedResponse {
  decisions: Decision[];
  sources: {
    fantasyCalc: number;
    ktc: number;
    joined: number;
    snaps: number;
    usage: number;
    injuries: number;
    usageSeason: string;
  };
}

/**
 * NOW — what needs you in the next few days.
 *
 * Opens with the tide, because everything below is conditional on where in the
 * week you are standing, then the feed itself.
 */
export default function Now({ league }: { league: { leagueId: string; name: string } }) {
  // Fixture-mode screenshot controls ride through from the page URL so the
  // harness can render a Sunday-lock page on a Tuesday. Ignored in live mode.
  const controls = window.location.search.replace(/^\?/, '');
  const q = controls ? `?${controls}` : '';

  const cycle = useApi<CycleResponse>(`/api/league/${league.leagueId}/cycle${q}`);
  const feed = useApi<FeedResponse>(`/api/league/${league.leagueId}/feed`);

  if (cycle.loading) return <Loading label="Reading the tide" />;
  if (cycle.error) return <ErrorNote message={cycle.error} />;
  if (!cycle.data) return null;

  return (
    <>
      <TideStrip cycle={cycle.data.cycle} />

      <p
        className="px-1"
        style={{ fontSize: 'var(--t-body)', color: 'var(--graphite)', maxWidth: '68ch', lineHeight: 1.5 }}
      >
        {phaseAdvice(cycle.data.cycle.phase)}
      </p>

      <Sheet
        title="What needs you"
        count={feed.data ? `${feed.data.decisions.length} open` : undefined}
        note={feed.data ? sourceNote(feed.data.sources) : undefined}
      >
        {feed.loading && <Loading label="Weighing it up" />}
        {feed.error && !feed.loading && (
          <div className="px-4 py-6" style={{ fontSize: 'var(--t-body)', color: 'var(--graphite)' }}>
            {feed.error}
          </div>
        )}
        {feed.data && <DecisionFeed decisions={feed.data.decisions} />}
      </Sheet>
    </>
  );
}

/**
 * Say which sources actually answered.
 *
 * Coverage is never implied. A feed built with the value market down is a
 * different feed, and the reader is entitled to know which one they are looking
 * at rather than assuming everything was consulted.
 */
function sourceNote(s: FeedResponse['sources']): string {
  const live = [
    s.joined ? `${s.joined} players priced by FantasyCalc and KeepTradeCut` : null,
    s.usage ? `${s.usage} usage histories from nflverse (${s.usageSeason})` : null,
    s.injuries ? `${s.injuries} injury reports` : null,
  ].filter(Boolean);
  return live.length
    ? `Ranked by points at stake. Reading ${live.join(', ')}.`
    : 'Ranked by points at stake. No third-party sources answered, so this is Sleeper data alone.';
}
