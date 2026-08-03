import { useApi } from '../api';
import { ErrorNote, Loading, Sheet } from '../components';
import { TideStrip } from '../TideStrip';
import { phaseAdvice, type CyclePosition } from '../../lib/analysis/cycle';

interface CycleResponse {
  cycle: CyclePosition;
  week: number | null;
  season: string;
  status: string;
}

/**
 * NOW — what needs you in the next few days.
 *
 * Opens with the tide, because everything below it is conditional on where in
 * the week you are standing.
 */
export default function Now({ league }: { league: { leagueId: string; name: string } }) {
  // Fixture-mode screenshot controls ride through from the page URL, so the
  // harness can render a Sunday-lock page on a Tuesday. Ignored in live mode
  // by the server.
  const controls = window.location.search.replace(/^\?/, '');
  const cycle = useApi<CycleResponse>(
    `/api/league/${league.leagueId}/cycle${controls ? `?${controls}` : ''}`
  );

  if (cycle.loading) return <Loading label="Reading the tide" />;
  if (cycle.error) return <ErrorNote message={cycle.error} />;
  if (!cycle.data) return null;

  return (
    <>
      <TideStrip cycle={cycle.data.cycle} />

      <Sheet title="What this means">
        <p className="px-4 py-3" style={{ fontSize: 'var(--t-body)', lineHeight: 1.55, maxWidth: '64ch' }}>
          {phaseAdvice(cycle.data.cycle.phase)}
        </p>
      </Sheet>

      <Sheet title="What needs you" count="not built yet">
        <div className="px-4 py-8">
          <p className="slab" style={{ fontSize: 'var(--t-lede)' }}>Decision cards land here.</p>
        </div>
      </Sheet>
    </>
  );
}
