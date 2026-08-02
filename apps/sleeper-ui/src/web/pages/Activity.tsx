import { useState } from 'react';
import { relativeTime, useApi, type LeagueBundle, type Transaction } from '../api';
import { Empty, ErrorState, Loading, Panel, Pos, PlayerLink, TeamLink } from '../components';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'waiver', label: 'Waivers' },
  { key: 'free_agent', label: 'Free agents' },
] as const;

export default function Activity({ bundle }: { bundle: LeagueBundle }) {
  const { league } = bundle;
  const [filter, setFilter] = useState<string>('all');
  const [limit, setLimit] = useState(50);

  const through = league.status === 'complete' ? 18 : Math.max(1, bundle.currentWeek);
  const { data, loading, error } = useApi<{ transactions: Transaction[] }>(
    `/api/league/${league.leagueId}/transactions?through=${through}`
  );

  const matching = (data?.transactions ?? []).filter((t) => filter === 'all' || t.type === filter);
  const items = matching.slice(0, limit);

  return (
    // Constrained measure: a transaction is one short sentence, and stretching it
    // across a 1700px screen put the money 1000px from the player it bought.
    <div className="pt-5 max-w-[1000px]">
      <Panel
        title="League activity"
        action={
          <div className="flex items-center gap-1">
            <span className="text-dim mr-2" style={{ fontSize: 'var(--t-meta)' }}>
              {matching.length} move{matching.length === 1 ? '' : 's'}
            </span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key);
                  setLimit(50);
                }}
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
          <Empty title="Nothing here yet" hint="Adds, drops and trades appear as they happen." />
        )}

        <ul>
          {items.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-[86px_minmax(0,1fr)_auto] gap-4 px-4 py-3 border-b border-line/60 last:border-b-0 hover:bg-raised transition-colors"
            >
              <div>
                <TypeChip type={t.type} />
                <div className="text-dim mt-1.5" style={{ fontSize: 'var(--t-meta)' }}>
                  Week {t.week}
                </div>
              </div>

              <div className="min-w-0">
                {t.type === 'trade' ? <TradeBody t={t} /> : <MoveBody t={t} />}
              </div>

              <div className="text-right shrink-0">
                {t.bid != null && t.bid > 0 && (
                  <div className="font-display font-bold" style={{ color: 'var(--live)', fontSize: 'var(--t-h2)' }}>
                    ${t.bid}
                  </div>
                )}
                <div className="text-dim" style={{ fontSize: 'var(--t-meta)' }}>
                  {relativeTime(t.created)}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {matching.length > items.length && (
          <div className="p-3 border-t border-line text-center">
            <button
              type="button"
              onClick={() => setLimit((n) => n + 50)}
              className="tab border border-line2 hover:border-dim"
            >
              Show 50 more
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  const map: Record<string, { label: string; color: string }> = {
    trade: { label: 'Trade', color: 'var(--pos-k-ink)' },
    waiver: { label: 'Waiver', color: 'var(--live)' },
    free_agent: { label: 'Add', color: 'var(--pos-wr-ink)' },
    commissioner: { label: 'Commish', color: '#93A2B2' },
  };
  const m = map[type] ?? { label: type, color: '#93A2B2' };
  return (
    <span className="chip" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 16%, transparent)` }}>
      {m.label}
    </span>
  );
}

/**
 * The team is the actor and leads the line; the players are what it did.
 * Previously the team name was smaller than the player names, which read
 * backwards.
 */
function MoveBody({ t }: { t: Transaction }) {
  return (
    <>
      <div className="mb-1">
        {t.teams.map((team, i) => (
          <span key={team.rosterId}>
            {i > 0 && <span className="text-dim">, </span>}
            <TeamLink rosterId={team.rosterId} className="entity" style={{ fontSize: 'var(--t-h2)' }}>
              {team.teamName}
            </TeamLink>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {t.adds.map((a, i) => (
          <span key={`a${i}`} className="flex items-center gap-1.5" style={{ fontSize: 'var(--t-body)' }}>
            <span style={{ color: 'var(--win)' }}>+</span>
            <PlayerLink id={a.playerId} name={a.player} />
            <Pos pos={a.pos} />
          </span>
        ))}
        {t.drops.map((d, i) => (
          <span key={`d${i}`} className="flex items-center gap-1.5 text-muted" style={{ fontSize: 'var(--t-body)' }}>
            <span style={{ color: 'var(--loss)' }}>−</span>
            <PlayerLink id={d.playerId} name={d.player} />
            <Pos pos={d.pos} muted />
          </span>
        ))}
      </div>
    </>
  );
}

/** Trades read best grouped by who received what. */
function TradeBody({ t }: { t: Transaction }) {
  const byRoster = new Map<number, { name: string; got: React.ReactNode[] }>();
  for (const team of t.teams) byRoster.set(team.rosterId, { name: team.teamName, got: [] });

  t.adds.forEach((a, i) => {
    if (a.toRosterId == null) return;
    byRoster.get(a.toRosterId)?.got.push(
      <span key={`p${i}`} className="flex items-center gap-1.5">
        <PlayerLink id={a.playerId} name={a.player} />
        <Pos pos={a.pos} />
      </span>
    );
  });
  t.picks.forEach((p, i) => {
    if (p.toRosterId == null) return;
    byRoster.get(p.toRosterId)?.got.push(
      <span key={`k${i}`} className="text-muted">
        {p.season} round {p.round}
      </span>
    );
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
      {[...byRoster.entries()].map(([rosterId, v]) => (
        <div key={rosterId} className="min-w-0">
          <TeamLink rosterId={rosterId} className="entity block truncate" style={{ fontSize: 'var(--t-h2)' }}>
            {v.name}
          </TeamLink>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1" style={{ fontSize: 'var(--t-body)' }}>
            {v.got.length ? v.got : <span className="text-dim">nothing</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
