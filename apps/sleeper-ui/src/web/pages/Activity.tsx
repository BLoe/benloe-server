import { useState } from 'react';
import { relativeTime, useApi, type LeagueBundle, type Transaction } from '../api';
import { Empty, ErrorState, Loading, Panel, Pos } from '../components';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'waiver', label: 'Waivers' },
  { key: 'free_agent', label: 'Free agents' },
] as const;

export default function Activity({ bundle }: { bundle: LeagueBundle }) {
  const { league } = bundle;
  const [filter, setFilter] = useState<string>('all');

  const through = league.status === 'complete' ? 18 : Math.max(1, bundle.currentWeek);
  const { data, loading, error } = useApi<{ transactions: Transaction[] }>(
    `/api/league/${league.leagueId}/transactions?through=${through}`
  );

  const [limit, setLimit] = useState(60);

  const matching = (data?.transactions ?? []).filter((t) => filter === 'all' || t.type === filter);
  // A full dynasty season is ~800 moves. Render a readable page of them and let
  // the reader ask for more rather than dumping the lot.
  const items = matching.slice(0, limit);

  return (
    <div className="pt-4">
      <Panel
        title="League activity"
        action={
          <div className="flex items-center gap-1">
            <span className="text-dim text-[11px] mr-2">
              {matching.length} move{matching.length === 1 ? '' : 's'}
            </span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="tab"
                data-active={filter === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {loading && <Loading label="Loading transactions" />}
        {error && <ErrorState message={error} />}
        {data && !items.length && (
          <Empty title="Nothing here yet" hint="Adds, drops and trades will show up as they happen." />
        )}

        <ul>
          {items.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-[70px_1fr_auto] gap-3 px-4 py-2.5 border-b border-line/50 hover:bg-raised transition-colors"
            >
              <div>
                <TypeChip type={t.type} />
                <div className="text-dim text-[10px] mt-1">Wk {t.week}</div>
              </div>

              <div className="min-w-0 space-y-0.5">
                {t.type === 'trade' ? (
                  <TradeBody t={t} />
                ) : (
                  <MoveBody t={t} />
                )}
              </div>

              <div className="text-right shrink-0">
                {t.bid != null && t.bid > 0 && (
                  <div className="font-display font-semibold text-[13px]" style={{ color: '#F5C518' }}>
                    ${t.bid}
                  </div>
                )}
                <div className="text-dim text-[10px]">{relativeTime(t.created)}</div>
              </div>
            </li>
          ))}
        </ul>

        {matching.length > items.length && (
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

function TypeChip({ type }: { type: string }) {
  const map: Record<string, { label: string; color: string }> = {
    trade: { label: 'Trade', color: '#B77FE0' },
    waiver: { label: 'Waiver', color: '#F5C518' },
    free_agent: { label: 'Add', color: '#4A9EFF' },
    commissioner: { label: 'Commish', color: '#8494A5' },
  };
  const m = map[type] ?? { label: type, color: '#8494A5' };
  return (
    <span
      className="chip"
      style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}
    >
      {m.label}
    </span>
  );
}

function MoveBody({ t }: { t: Transaction }) {
  return (
    <>
      <div className="font-display font-semibold uppercase text-[12px] text-muted tracking-wide">
        {t.teams.join(', ')}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {t.adds.map((a, i) => (
          <span key={`a${i}`} className="flex items-center gap-1.5 text-[13px]">
            <span style={{ color: '#3FBF7F' }}>+</span>
            {a.player}
            <Pos pos={a.pos} />
          </span>
        ))}
        {t.drops.map((d, i) => (
          <span key={`d${i}`} className="flex items-center gap-1.5 text-[13px] text-muted">
            <span style={{ color: '#E5484D' }}>−</span>
            {d.player}
            <Pos pos={d.pos} muted />
          </span>
        ))}
      </div>
    </>
  );
}

/** Trades read best grouped by who received what. */
function TradeBody({ t }: { t: Transaction }) {
  const byTeam = new Map<string, string[]>();
  for (const team of t.teams) byTeam.set(team, []);
  for (const a of t.adds) if (a.to) byTeam.get(a.to)?.push(a.player);
  for (const p of t.picks) if (p.to) byTeam.get(p.to)?.push(`${p.season} rd ${p.round}`);

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {[...byTeam.entries()].map(([team, got]) => (
        <div key={team} className="min-w-0">
          <div className="font-display font-semibold uppercase text-[12px] text-muted tracking-wide truncate">
            {team}
          </div>
          <div className="text-[13px]">
            {got.length ? got.join(', ') : <span className="text-dim">nothing</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
