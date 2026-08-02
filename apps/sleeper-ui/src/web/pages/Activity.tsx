import { useState } from 'react';
import { useApi, type ActivityAsset, type ActivityRow, type LeagueBundle } from '../api';
import { Empty, ErrorState, Loading, Panel, Pos, PlayerLink, TeamLink } from '../components';

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'Trade', label: 'Trades' },
  { key: 'Waivers', label: 'Waivers' },
  { key: 'Free agency', label: 'Free agency' },
] as const;

/**
 * Every row is one manager's action.
 *
 * Sleeper's own feed is shaped for machines — a `type` describing how a move was
 * made rather than what happened — which is why a drop could show up labelled
 * "add". Here the action is derived from what actually moved, and a trade is
 * split into one row per side so each row answers a single question: what did
 * this manager gain, and what did it cost them.
 */
export default function Activity({ bundle }: { bundle: LeagueBundle }) {
  const { league } = bundle;
  const [filter, setFilter] = useState<string>('all');
  const [limit, setLimit] = useState(60);

  const through = league.status === 'complete' ? 18 : Math.max(1, bundle.currentWeek);
  const { data, loading, error } = useApi<{ rows: ActivityRow[] }>(
    `/api/league/${league.leagueId}/transactions?through=${through}`
  );

  const matching = (data?.rows ?? []).filter((r) => filter === 'all' || r.method === filter);
  const rows = matching.slice(0, limit);

  return (
    <div className="pt-5 max-w-[1240px]">
      <Panel
        title="League activity"
        action={
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-dim mr-2" style={{ fontSize: 'var(--t-meta)' }}>
              {matching.length} action{matching.length === 1 ? '' : 's'}
            </span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key);
                  setLimit(60);
                }}
                className="tab"
                data-active={filter === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
        note={
          <div className="flex flex-wrap gap-x-7 gap-y-1.5">
            <span>One row per manager. A trade appears twice — once from each side.</span>
            <span>
              <strong className="text-muted">Added</strong> joined the roster;{' '}
              <strong className="text-muted">Dropped</strong> left it.
            </span>
            <span>Cost is the FAAB spent on a winning waiver claim.</span>
          </div>
        }
      >
        {loading && <Loading label="Loading activity" />}
        {error && <ErrorState message={error} />}
        {data && !rows.length && (
          <Empty title="Nothing here yet" hint="Adds, drops and trades appear as they happen." />
        )}

        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-line2">
                  <th className="th w-[110px]">When</th>
                  <th className="th w-[150px]">Action</th>
                  <th className="th min-w-[190px]">Manager</th>
                  <th className="th min-w-[230px]">Added</th>
                  <th className="th min-w-[230px]">Dropped</th>
                  <th className="th w-[90px] text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line/70 hover:bg-raised transition-colors align-top">
                    <td className="td">
                      <div className="font-display font-semibold" style={{ fontSize: 'var(--t-body)' }}>
                        Week {r.week}
                      </div>
                      <div className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>
                        {new Date(r.created).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </td>

                    <td className="td">
                      <ActionChip action={r.action} />
                      <div className="text-dim mt-1" style={{ fontSize: 'var(--t-meta)' }}>
                        {r.method}
                      </div>
                    </td>

                    <td className="td">
                      <TeamLink rosterId={r.rosterId} className="entity block truncate">
                        {r.teamName}
                      </TeamLink>
                      {r.counterparties.length > 0 && (
                        <div className="text-dim mt-0.5" style={{ fontSize: 'var(--t-meta)' }}>
                          with{' '}
                          {r.counterparties.map((c, i) => (
                            <span key={c.rosterId}>
                              {i > 0 && ', '}
                              <TeamLink rosterId={c.rosterId} className="text-muted">
                                {c.teamName}
                              </TeamLink>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="td">
                      <AssetList assets={r.added} tone="add" />
                    </td>

                    <td className="td">
                      <AssetList assets={r.dropped} tone="drop" />
                    </td>

                    <td className="td text-right">
                      {r.faab != null ? (
                        <span
                          className="font-display font-bold"
                          style={{ color: 'var(--live)', fontSize: 'var(--t-h2)' }}
                        >
                          ${r.faab}
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {matching.length > rows.length && (
          <div className="p-3 border-t border-line text-center">
            <button
              type="button"
              onClick={() => setLimit((n) => n + 60)}
              className="tab border border-line2 hover:border-dim"
            >
              Show 60 more
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ActionChip({ action }: { action: ActivityRow['action'] }) {
  const map: Record<ActivityRow['action'], string> = {
    Added: 'var(--win)',
    Dropped: 'var(--loss)',
    'Added & dropped': 'var(--pos-wr-ink)',
    Trade: 'var(--pos-k-ink)',
    Commissioner: '#93A2B2',
  };
  const color = map[action];
  return (
    <span className="chip" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {action}
    </span>
  );
}

function AssetList({ assets, tone }: { assets: ActivityAsset[]; tone: 'add' | 'drop' }) {
  if (!assets.length) {
    return <span className="text-dim" style={{ fontSize: 'var(--t-body)' }}>—</span>;
  }
  return (
    <ul className="space-y-1">
      {assets.map((a, i) => (
        <li key={i} className="flex items-center gap-2 min-w-0">
          {a.kind === 'player' ? (
            <>
              <PlayerLink
                id={a.playerId}
                name={a.name}
                className="truncate"
                style={{
                  fontSize: 'var(--t-body)',
                  color: tone === 'drop' ? '#93A2B2' : undefined,
                }}
              />
              <Pos pos={a.pos} muted={tone === 'drop'} />
            </>
          ) : (
            <span
              className="truncate"
              style={{ fontSize: 'var(--t-body)', color: tone === 'drop' ? '#93A2B2' : '#93A2B2' }}
            >
              {a.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
