/**
 * Ratings, coverage, and position fit.
 *
 * Every number here is a magnitude on one scale, so everything uses a single
 * green ramp from light to dark — no red-to-green heat map. That is partly the
 * correct encoding for a single measure and partly a judgement call: these are
 * ratings of your friends, and nobody's bunting should ever render in warning
 * red. The value is always printed alongside the fill, so colour is never the
 * only thing carrying the number.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Player } from '../lib/api';
import type { Meta } from '../pages/Dashboard';

interface RatingData {
  ratings: Record<string, Record<string, { rating: number; confidence: number; comparisons: number }>>;
  counts: Record<string, number>;
  fits: { playerId: string; fits: Record<string, number> }[];
}

/** One hue, light to dark. `value` is 0-1. */
function rampStyle(value: number): React.CSSProperties {
  const clamped = Math.max(0, Math.min(1, value));
  // Lightness runs from a pale wash to the deep field green.
  const lightness = 92 - clamped * 52;
  const chroma = 8 + clamped * 26;
  return { backgroundColor: `oklch(${lightness}% ${chroma / 100} 152)` };
}

type FitSort = { key: string; direction: 'asc' | 'desc' } | null;

/**
 * The sort arrow. It keeps its width when inactive so that clicking between
 * columns does not shuffle the header widths around.
 */
function SortMark({ direction }: { direction?: 'asc' | 'desc' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2 text-[0.55rem] leading-none ${direction ? 'opacity-70' : 'opacity-0'}`}
    >
      {direction === 'asc' ? '▲' : '▼'}
    </span>
  );
}

/**
 * Shared look for the sortable column headers. The button fills its cell so the
 * whole header is the click target, and it carries a pointer cursor and a soft
 * hover wash — a bare <button> defaults to cursor:default, which makes a
 * clickable header feel like inert text.
 */
const sortHeaderClass =
  'flex w-full cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-chalk-dim/70 hover:text-ink';

function ariaSort(sort: FitSort, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const fraction = Math.max(0, Math.min(1, value / max));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-chalk-dim" aria-hidden="true">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(fraction * 100, 1.5)}%`, ...rampStyle(fraction) }}
      />
    </div>
  );
}

export function RatingsPanel({ meta }: { meta: Meta }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [data, setData] = useState<RatingData | null>(null);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [fitSort, setFitSort] = useState<FitSort>(null);

  // The chosen stat rides in the query string so a refresh keeps the view.
  // Replaced rather than pushed, so Back leaves the tab instead of walking
  // through every chip that was clicked on the way here.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('stat');
  const statKey =
    requested && meta.stats.some((s) => s.key === requested) ? requested : meta.stats[0]?.key ?? '';
  const setStatKey = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('stat', key);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    api.players.list().then((r) => setPlayers(r.players.filter((p) => p.active)));
  }, []);

  useEffect(() => {
    api.ratings(includeSelf).then(setData);
  }, [includeSelf]);

  const ranked = useMemo(() => {
    if (!data || !statKey) return [];
    return players
      .map((player) => ({
        player,
        ...(data.ratings[statKey]?.[player.id] ?? { rating: 50, confidence: 0, comparisons: 0 }),
      }))
      .sort((a, b) => b.rating - a.rating);
  }, [data, players, statKey]);

  const totalComparisons = useMemo(
    () => (data ? Object.values(data.counts).reduce((s, v) => s + v, 0) : 0),
    [data]
  );

  const fitsById = useMemo(
    () => new Map((data?.fits ?? []).map((entry) => [entry.playerId, entry.fits])),
    [data]
  );

  /**
   * A first click sorts names A to Z but positions best-first, since the
   * question a position column answers is "who should be playing here".
   * Clicking the same column again flips it.
   */
  const toggleFitSort = (key: string) =>
    setFitSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' ? 'asc' : 'desc' }
    );

  const sortedForFit = useMemo(() => {
    if (!fitSort) return players;
    const byName = (a: Player, b: Player) => a.name.localeCompare(b.name);
    return [...players].sort((a, b) => {
      if (fitSort.key === 'name') {
        return fitSort.direction === 'asc' ? byName(a, b) : byName(b, a);
      }
      const left = fitsById.get(a.id)?.[fitSort.key] ?? 0;
      const right = fitsById.get(b.id)?.[fitSort.key] ?? 0;
      // Ties fall back to the name so the order never looks arbitrary.
      const compared = left === right ? byName(a, b) : left - right;
      return fitSort.direction === 'asc' ? compared : -compared;
    });
  }, [players, fitSort, fitsById]);

  if (!data) {
    return <p className="eyebrow animate-pulse">Fitting ratings…</p>;
  }

  if (players.length < 2) {
    return (
      <div className="card p-8 text-center">
        <h2 className="display mb-2 text-xl">Nothing to rate yet</h2>
        <p className="text-ink-soft">Add at least two players to the roster, then share the rating game.</p>
      </div>
    );
  }

  const maxCount = Math.max(1, ...Object.values(data.counts));
  const thinnest = [...meta.stats].sort((a, b) => (data.counts[a.key] ?? 0) - (data.counts[b.key] ?? 0))[0];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="display text-xl">Coverage</h2>
            <p className="eyebrow eyebrow-ink mt-1">Comparisons collected per stat</p>
          </div>
          <p className="code text-sm text-ink-soft">{totalComparisons} total</p>
        </div>

        {totalComparisons === 0 ? (
          <div className="rounded-lg border border-dashed border-chalk-line px-6 py-10 text-center">
            <p className="font-semibold">No comparisons yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
              Share <span className="code">/rate</span> with the team. A few hundred answers across everyone is
              plenty.
            </p>
          </div>
        ) : (
          <>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {meta.stats.map((stat) => {
                const count = data.counts[stat.key] ?? 0;
                return (
                  <li key={stat.key} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3">
                    <div>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{stat.name}</span>
                      </div>
                      <Meter value={count} max={maxCount} />
                    </div>
                    <span className="code text-right text-sm text-ink-soft">{count}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 border-t border-chalk-line pt-4 text-sm text-ink-soft">
              The game already favours whatever is thinnest — right now that's{' '}
              <strong className="text-ink">{thinnest.name}</strong>.
            </p>
          </>
        )}
      </section>

      <section className="card p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="display text-xl">Ratings</h2>
            <p className="eyebrow eyebrow-ink mt-1">50 is the team average</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />
            Count self-ratings
          </label>
        </div>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {meta.stats.map((stat) => (
            <button
              key={stat.key}
              onClick={() => setStatKey(stat.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                statKey === stat.key
                  ? 'border-ink bg-ink text-chalk'
                  : 'border-chalk-line text-ink-soft hover:border-ink/40'
              }`}
            >
              {stat.name}
            </button>
          ))}
        </div>

        <ul className="space-y-2.5">
          {ranked.map((row, index) => (
            <li key={row.player.id} className="grid grid-cols-[1.5rem_minmax(0,10rem)_minmax(0,1fr)_3rem] items-center gap-3">
              <span className="code text-xs text-ink-soft/60">{index + 1}</span>
              <span className="truncate font-medium">{row.player.name}</span>
              <Meter value={row.rating} />
              <span className="code text-right text-sm">
                {Math.round(row.rating)}
                <span
                  className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                  style={{ backgroundColor: `oklch(60% 0.14 152 / ${0.15 + row.confidence * 0.85})` }}
                  title={`${row.comparisons} comparisons`}
                />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-chalk-line pt-4 text-xs text-ink-soft">
          The dot after each number shows how settled the rating is. Faint means we have barely asked about
          that person on this stat, and their rating is being held near the team average until we have.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="display text-xl">Position fit</h2>
        <p className="eyebrow eyebrow-ink mb-5 mt-1">
          How well each player suits each spot · click a column to sort
        </p>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort(fitSort, 'name')} className="pb-2 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => toggleFitSort('name')}
                    title="Sort by player name"
                    className={`${sortHeaderClass} eyebrow ${
                      fitSort?.key === 'name' ? 'bg-chalk-dim/70 text-ink' : 'eyebrow-ink'
                    }`}
                  >
                    Player
                    <SortMark direction={fitSort?.key === 'name' ? fitSort.direction : undefined} />
                  </button>
                </th>
                {meta.positions.map((position) => (
                  <th
                    key={position.key}
                    scope="col"
                    aria-sort={ariaSort(fitSort, position.key)}
                    className="pb-2 text-center"
                  >
                    <button
                      type="button"
                      onClick={() => toggleFitSort(position.key)}
                      title={`Sort by ${position.alias ?? position.name}`}
                      className={`${sortHeaderClass} code justify-center gap-0.5 px-1.5 text-xs ${
                        fitSort?.key === position.key ? 'bg-chalk-dim/70 text-ink' : 'text-ink-soft'
                      }`}
                    >
                      {position.code}
                      <SortMark direction={fitSort?.key === position.key ? fitSort.direction : undefined} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedForFit.map((player) => {
                const fits = data.fits.find((f) => f.playerId === player.id)?.fits ?? {};
                const best = Math.max(...meta.positions.map((p) => fits[p.key] ?? 0));
                return (
                  <tr key={player.id} className="border-t border-chalk-line">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{player.name}</td>
                    {meta.positions.map((position) => {
                      const value = fits[position.key] ?? 0.5;
                      const isBest = value === best;
                      return (
                        <td key={position.key} className="p-0.5 text-center">
                          <span
                            className={`code inline-flex h-7 w-9 items-center justify-center rounded text-[0.7rem] ${
                              value > 0.62 ? 'text-chalk' : 'text-ink'
                            } ${isBest ? 'ring-2 ring-lamp' : ''}`}
                            style={rampStyle((value - 0.3) / 0.5)}
                          >
                            {Math.round(value * 100)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-ink-soft">
          Ringed in amber is each player's best spot. Third base is the striker and right-center is the roamer,
          so those two lean on charging bunts and reading the play rather than raw range.
        </p>
      </section>
    </div>
  );
}
