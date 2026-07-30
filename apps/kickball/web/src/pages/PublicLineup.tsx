import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi } from '../lib/api';
import type { PublicLineup as Lineup } from '../lib/api';
import { FieldDiagram } from '../components/FieldDiagram';

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function PublicLineup() {
  const { slug } = useParams<{ slug: string }>();
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inning, setInning] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    publicApi
      .lineup(slug)
      .then(setLineup)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load that lineup.'));
  }, [slug]);

  // Arrow keys walk the innings, which is how anyone will actually flip
  // through this on a laptop.
  //
  // The listener is bound once on mount and reads the inning count through a
  // ref. Binding it to the loaded lineup instead would leave a window where the
  // card is on screen and painted but the effect has not run yet, so the first
  // key press after load would silently do nothing.
  const inningCountRef = useRef(0);
  inningCountRef.current = lineup?.innings.length ?? 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const count = inningCountRef.current;
      if (count === 0) return;
      if (event.key === 'ArrowRight') setInning((i) => Math.min(count - 1, i + 1));
      if (event.key === 'ArrowLeft') setInning((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Position code per player per inning: the printed lineup card. */
  const grid = useMemo(() => {
    if (!lineup) return [];
    return lineup.battingOrder.map((batter) => ({
      ...batter,
      cells: lineup.innings.map((frame) => {
        const spot = frame.positions.find((p) => p.playerId === batter.playerId);
        return spot ? spot.code : null;
      }),
    }));
  }, [lineup]);

  if (error) {
    return (
      <main className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <p className="eyebrow mb-3">Foul ball</p>
          <h1 className="display text-4xl mb-3">Lineup not found</h1>
          <p className="text-chalk/60">{error}</p>
        </div>
      </main>
    );
  }

  if (!lineup) {
    return (
      <main className="min-h-dvh grid place-items-center">
        <p className="eyebrow animate-pulse">Chalking the lines…</p>
      </main>
    );
  }

  const frame = lineup.innings[inning];

  return (
    <main className="min-h-dvh px-5 pb-24 pt-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Hero: who, when, where. */}
        <header className="rise mb-10">
          <p className="eyebrow mb-4">{lineup.teamName} · Lineup card</p>
          <h1 className="display text-[clamp(2.6rem,9vw,5.5rem)] text-chalk">
            {lineup.game.opponent ? (
              <>
                <span className="text-chalk/45">vs</span> {lineup.game.opponent}
              </>
            ) : (
              'Game day'
            )}
          </h1>
          <div className="code mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-chalk/65">
            <span>{formatDate(lineup.game.playedOn)}</span>
            {lineup.game.firstPitch && (
              <span className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-lamp" />
                {lineup.game.firstPitch}
              </span>
            )}
            {lineup.game.field && (
              <span className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-lamp" />
                {lineup.game.field}
              </span>
            )}
          </div>
          {lineup.game.notes && <p className="mt-4 max-w-xl text-chalk/70">{lineup.game.notes}</p>}
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* Batting order. The numbers are the point, so they lead. */}
          <section className="card rise min-w-0 p-6 sm:p-7" style={{ animationDelay: '80ms' }}>
            <h2 className="display mb-1 text-2xl">Batting order</h2>
            <p className="eyebrow eyebrow-ink mb-5">Everyone kicks</p>
            <ol className="space-y-0">
              {lineup.battingOrder.map((batter, index) => (
                <li
                  key={batter.playerId}
                  className={`flex items-baseline gap-4 py-2.5 ${
                    index < lineup.battingOrder.length - 1 ? 'rule' : ''
                  }`}
                >
                  <span className="code w-6 shrink-0 text-right text-sm text-ink-soft">{batter.slot}</span>
                  <span className="text-lg font-semibold leading-snug">{batter.name}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Defense, inning by inning. */}
          <section className="rise min-w-0" style={{ animationDelay: '160ms' }}>
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rail-line px-5 py-4">
                <div>
                  <h2 className="display text-2xl">Defense</h2>
                  <p className="eyebrow mt-1">Inning {frame.inning} of {lineup.innings.length}</p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Innings">
                  {lineup.innings.map((f, index) => (
                    <button
                      key={f.inning}
                      role="tab"
                      aria-selected={index === inning}
                      aria-label={`Inning ${f.inning}`}
                      onClick={() => setInning(index)}
                      className={`code h-9 w-9 rounded-lg border text-sm transition ${
                        index === inning
                          ? 'border-lamp bg-lamp text-ink'
                          : 'border-rail-line text-chalk/60 hover:border-chalk/40 hover:text-chalk'
                      }`}
                    >
                      {f.inning}
                    </button>
                  ))}
                </div>
              </div>

              <FieldDiagram
                spots={frame.positions.map((p) => ({
                  key: p.key,
                  code: p.code,
                  name: p.name,
                  alias: p.alias,
                  zone: p.zone,
                  x: p.x,
                  y: p.y,
                  playerName: p.playerName,
                }))}
                activeKey={hovered}
                className="w-full"
              />

              <div className="border-t border-rail-line px-5 py-4">
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {frame.positions.map((p) => (
                    <li
                      key={p.key}
                      onMouseEnter={() => setHovered(p.key)}
                      onMouseLeave={() => setHovered(null)}
                      className="flex items-baseline gap-2 text-sm"
                    >
                      <span className={`code w-7 shrink-0 ${p.alias ? 'text-rubber' : 'text-chalk/45'}`}>
                        {p.code}
                      </span>
                      <span className="truncate">{p.playerName ?? '—'}</span>
                    </li>
                  ))}
                </ul>
                {frame.bench.length > 0 && (
                  <p className="mt-4 border-t border-rail-line pt-3 text-sm text-chalk/50">
                    <span className="eyebrow mr-2">Sitting</span>
                    {frame.bench.map((b) => b.name).join(', ')}
                  </p>
                )}
              </div>
            </div>

            <p className="mt-3 px-1 text-xs text-chalk/40">
              Third base is the <span className="text-rubber/90">striker</span> — charge every bunt. Right-center is
              the <span className="text-rubber/90">roamer</span> — move with the kicker.
            </p>
          </section>
        </div>

        {/* The whole game on one card, the way it would be written out. */}
        <section className="card rise mt-6 p-6 sm:p-7" style={{ animationDelay: '240ms' }}>
          <h2 className="display mb-1 text-2xl">Every inning</h2>
          <p className="eyebrow eyebrow-ink mb-5">A dash means you are on the bench that inning</p>
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[26rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="eyebrow eyebrow-ink pb-2 text-left font-normal">Player</th>
                  {lineup.innings.map((f) => (
                    <th key={f.inning} className="code w-11 pb-2 text-center text-xs text-ink-soft">
                      {f.inning}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.playerId} className="border-t border-chalk-line">
                    <td className="py-2 pr-3 font-medium">{row.name}</td>
                    {row.cells.map((code, index) => (
                      <td key={index} className="py-2 text-center">
                        <span
                          className={`code inline-flex h-7 w-9 items-center justify-center rounded text-xs ${
                            code
                              ? 'bg-field/8 text-ink'
                              : 'text-ink-soft/40'
                          }`}
                        >
                          {code ?? '–'}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-14 border-t border-rail-line pt-6">
          <p className="eyebrow">{lineup.teamName}</p>
        </footer>
      </div>
    </main>
  );
}
