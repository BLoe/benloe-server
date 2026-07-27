import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { GamePayload, GameSummaryRow, Player } from '../lib/api';
import type { Meta } from '../pages/Dashboard';
import { FieldDiagram } from './FieldDiagram';

export function GamesPanel({ meta }: { meta: Meta }) {
  const [games, setGames] = useState<GameSummaryRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [payload, setPayload] = useState<GamePayload | null>(null);
  const [creating, setCreating] = useState(false);
  const [playedOn, setPlayedOn] = useState(new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState('');

  const loadGames = () => api.games.list().then((r) => setGames(r.games));

  useEffect(() => {
    loadGames();
    api.players.list().then((r) => setPlayers(r.players));
  }, []);

  useEffect(() => {
    if (!selected) {
      setPayload(null);
      return;
    }
    api.games.get(selected).then(setPayload);
  }, [selected]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await api.games.create({ playedOn, opponent });
      await loadGames();
      setSelected(created.game.id);
      setOpponent('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <section className="card p-5">
          <h2 className="display mb-1 text-lg">New game</h2>
          <p className="eyebrow eyebrow-ink mb-4">Add the week, then set availability</p>
          <form onSubmit={create} className="space-y-3">
            <div>
              <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="game-date">
                Date
              </label>
              <input
                id="game-date"
                type="date"
                className="field-input"
                value={playedOn}
                onChange={(e) => setPlayedOn(e.target.value)}
              />
            </div>
            <div>
              <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="game-opponent">
                Opponent
              </label>
              <input
                id="game-opponent"
                className="field-input"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="Base Invaders"
              />
            </div>
            <button className="btn btn-primary w-full" disabled={creating}>
              Add game
            </button>
          </form>
        </section>

        <section className="panel p-2">
          {games.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-chalk/45">No games yet.</p>
          ) : (
            <ul className="space-y-1">
              {games.map((game) => (
                <li key={game.id}>
                  <button
                    onClick={() => setSelected(game.id)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition ${
                      selected === game.id ? 'bg-rail' : 'hover:bg-rail/60'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{game.opponent || 'Kickball'}</span>
                      <span
                        className={`code text-[0.65rem] ${
                          game.status === 'published' ? 'text-lamp' : 'text-chalk/35'
                        }`}
                      >
                        {game.status === 'published' ? 'LIVE' : 'DRAFT'}
                      </span>
                    </span>
                    <span className="code mt-0.5 block text-xs text-chalk/40">{game.playedOn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {payload ? (
        <GameDetail
          meta={meta}
          players={players}
          payload={payload}
          onChange={(next) => {
            setPayload(next);
            loadGames();
          }}
          onDeleted={() => {
            setSelected(null);
            loadGames();
          }}
        />
      ) : (
        <section className="card grid place-items-center p-12 text-center">
          <div>
            <h2 className="display mb-2 text-xl">Pick a game</h2>
            <p className="max-w-sm text-ink-soft">
              Choose a week on the left, mark who is playing, and generate the lineups.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function GameDetail({
  meta,
  players,
  payload,
  onChange,
  onDeleted,
}: {
  meta: Meta;
  players: Player[];
  payload: GamePayload;
  onChange: (next: GamePayload) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inning, setInning] = useState(0);
  const [copied, setCopied] = useState(false);

  const game = payload.game;
  const activePlayers = players.filter((p) => p.active);
  const available = new Set(payload.availability);
  const nameOf = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);

  const womenAvailable = activePlayers.filter((p) => available.has(p.id) && p.gender !== 'man').length;
  const hasLineup = payload.battingOrder.length > 0;

  const run = async (key: string, action: () => Promise<GamePayload>) => {
    setBusy(key);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const toggleAvailable = (playerId: string) => {
    const next = new Set(available);
    if (next.has(playerId)) next.delete(playerId);
    else next.add(playerId);
    run('availability', () => api.games.setAvailability(game.id, [...next]));
  };

  /** defense[inning][positionKey] = playerId */
  const defenseGrid = useMemo(() => {
    const grid: Record<number, Record<string, { playerId: string; locked: boolean }>> = {};
    for (const entry of payload.defense) {
      grid[entry.inning] ??= {};
      grid[entry.inning][entry.position_key] = { playerId: entry.player_id, locked: entry.locked === 1 };
    }
    return grid;
  }, [payload.defense]);

  const inningCount = Object.keys(defenseGrid).length || meta.settings.innings;

  const saveDefense = (updater: (entries: typeof payload.defense) => typeof payload.defense) => {
    const next = updater(payload.defense);
    run('lineup', () =>
      api.games.saveLineup(game.id, {
        defense: next.map((e) => ({
          inning: e.inning,
          positionKey: e.position_key,
          playerId: e.player_id,
          locked: e.locked === 1,
        })),
      })
    );
  };

  const moveBatter = (index: number, direction: -1 | 1) => {
    const order = [...payload.battingOrder];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    run('lineup', () => api.games.saveLineup(game.id, { battingOrder: order }));
  };

  const shareUrl = game.slug ? `${window.location.origin}/l/${game.slug}` : null;

  return (
    <div className="min-w-0 space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow eyebrow-ink mb-2">{game.playedOn}</p>
            <h2 className="display text-2xl">{game.opponent || 'Kickball'}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {game.status === 'published' ? (
              <button
                className="btn btn-chalk"
                disabled={busy !== null}
                onClick={() => run('publish', () => api.games.unpublish(game.id))}
              >
                Unpublish
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={busy !== null || !hasLineup}
                onClick={() => run('publish', () => api.games.publish(game.id))}
              >
                Publish
              </button>
            )}
            <button
              className="btn btn-chalk text-ink-soft"
              disabled={busy !== null}
              onClick={async () => {
                await api.games.remove(game.id);
                onDeleted();
              }}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['firstPitch', 'First pitch', '7:00 pm'],
              ['field', 'Field', 'Heckscher 3'],
              ['opponent', 'Opponent', 'Base Invaders'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div key={key}>
              <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor={`game-${key}`}>
                {label}
              </label>
              <input
                id={`game-${key}`}
                className="field-input"
                defaultValue={game[key]}
                placeholder={placeholder}
                onBlur={(e) => {
                  if (e.target.value !== game[key]) {
                    run('meta', () => api.games.update(game.id, { [key]: e.target.value }));
                  }
                }}
              />
            </div>
          ))}
        </div>

        {shareUrl && (
          <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-chalk-dim/50 px-4 py-3">
            <span className="eyebrow eyebrow-ink shrink-0">Share link</span>
            <a
              className="code min-w-0 flex-1 truncate text-sm text-ink underline-offset-4 hover:underline"
              href={shareUrl}
            >
              {shareUrl}
            </a>
            <button
              className="btn btn-chalk shrink-0 px-3 py-1 text-sm"
              onClick={() => {
                navigator.clipboard?.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-rubber/10 px-4 py-3 text-sm text-rubber">{error}</p>}
      </section>

      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="display text-lg">Who's playing</h3>
            <p className="eyebrow eyebrow-ink mt-1">
              {available.size} available · {womenAvailable} count toward the field minimum
            </p>
          </div>
          <button
            className="btn btn-primary"
            disabled={busy !== null || available.size < 10}
            onClick={() => run('generate', () => api.games.generate(game.id))}
          >
            {busy === 'generate' ? 'Working out the lineup…' : hasLineup ? 'Generate again' : 'Generate lineups'}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {activePlayers.map((player) => {
            const isIn = available.has(player.id);
            return (
              <button
                key={player.id}
                onClick={() => toggleAvailable(player.id)}
                disabled={busy !== null}
                aria-pressed={isIn}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  isIn
                    ? 'border-ink bg-ink text-chalk'
                    : 'border-chalk-line text-ink-soft line-through hover:border-ink/40'
                }`}
              >
                {player.name}
              </button>
            );
          })}
        </div>

        {available.size < 10 && (
          <p className="mt-4 rounded-lg bg-lamp/15 px-4 py-3 text-sm">
            You need at least 10 available to field a defense. {10 - available.size} more to go.
          </p>
        )}
        {available.size >= 10 && womenAvailable < meta.settings.min_women_in_field && (
          <p className="mt-4 rounded-lg bg-lamp/15 px-4 py-3 text-sm">
            The league wants {meta.settings.min_women_in_field} on the field but only {womenAvailable} are
            available. The lineup will play all of them every inning.
          </p>
        )}
      </section>

      {payload.summary?.warnings && payload.summary.warnings.length > 0 && (
        <section className="panel p-5">
          <p className="eyebrow mb-2">Heads up</p>
          <ul className="space-y-1 text-sm text-chalk/75">
            {payload.summary.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {hasLineup && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card min-w-0 p-6">
              <h3 className="display mb-1 text-lg">Batting order</h3>
              <p className="eyebrow eyebrow-ink mb-4">
                {payload.summary?.expectedRuns !== undefined
                  ? `${payload.summary.expectedRuns.toFixed(1)} runs expected`
                  : 'Optimized for early runs'}
              </p>
              <ol className="divide-y divide-chalk-line">
                {payload.battingOrder.map((playerId, index) => (
                  <li key={playerId} className="flex items-center gap-3 py-2">
                    <span className="code w-5 shrink-0 text-right text-xs text-ink-soft">{index + 1}</span>
                    <span className="flex-1 truncate font-medium">{nameOf.get(playerId)}</span>
                    <span className="code shrink-0 text-xs text-ink-soft">
                      {payload.summary?.inningsPlayed?.[playerId] ?? 0} inn
                    </span>
                    <span className="flex gap-1">
                      <button
                        className="btn btn-chalk h-7 w-7 p-0 text-xs"
                        aria-label={`Move ${nameOf.get(playerId)} up`}
                        disabled={index === 0 || busy !== null}
                        onClick={() => moveBatter(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-chalk h-7 w-7 p-0 text-xs"
                        aria-label={`Move ${nameOf.get(playerId)} down`}
                        disabled={index === payload.battingOrder.length - 1 || busy !== null}
                        onClick={() => moveBatter(index, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rail-line px-5 py-4">
                <div>
                  <h3 className="display text-lg">Inning {inning + 1}</h3>
                  <p className="eyebrow mt-1">Tap a spot to change it</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: inningCount }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setInning(i)}
                      aria-label={`Inning ${i + 1}`}
                      className={`code h-8 w-8 rounded-lg border text-xs transition ${
                        i === inning ? 'border-lamp bg-lamp text-ink' : 'border-rail-line text-chalk/55'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
              <FieldDiagram
                spots={meta.positions.map((position) => ({
                  key: position.key,
                  code: position.code,
                  name: position.name,
                  alias: position.alias ?? null,
                  zone: position.zone,
                  x: position.x,
                  y: position.y,
                  playerName: nameOf.get(defenseGrid[inning]?.[position.key]?.playerId ?? '') ?? null,
                }))}
                className="w-full"
              />
            </section>
          </div>

          <section className="card p-6">
            <h3 className="display mb-1 text-lg">Inning {inning + 1} assignments</h3>
            <p className="eyebrow eyebrow-ink mb-4">
              Lock a spot to keep it through the next regenerate
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {meta.positions.map((position) => {
                const cell = defenseGrid[inning]?.[position.key];
                return (
                  <li key={position.key} className="flex items-center gap-2">
                    <span
                      className={`code w-9 shrink-0 text-xs ${position.alias ? 'text-rubber' : 'text-ink-soft'}`}
                      title={position.alias ?? position.name}
                    >
                      {position.code}
                    </span>
                    <select
                      // min-w-0 or the select refuses to shrink below its
                      // longest option and pushes the whole page sideways.
                      className="field-input min-w-0 flex-1"
                      value={cell?.playerId ?? ''}
                      disabled={busy !== null}
                      aria-label={`${position.name}, inning ${inning + 1}`}
                      onChange={(e) => {
                        const nextPlayer = e.target.value;
                        saveDefense((entries) =>
                          entries.map((entry) =>
                            entry.inning === inning && entry.position_key === position.key
                              ? { ...entry, player_id: nextPlayer }
                              : entry
                          )
                        );
                      }}
                    >
                      {[...available].map((playerId) => (
                        <option key={playerId} value={playerId}>
                          {nameOf.get(playerId)}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`btn px-2.5 py-1 text-xs ${cell?.locked ? 'btn-primary' : 'btn-chalk'}`}
                      aria-pressed={cell?.locked ?? false}
                      aria-label={`Lock ${position.name} in inning ${inning + 1}`}
                      disabled={busy !== null}
                      onClick={() =>
                        saveDefense((entries) =>
                          entries.map((entry) =>
                            entry.inning === inning && entry.position_key === position.key
                              ? { ...entry, locked: entry.locked === 1 ? 0 : 1 }
                              : entry
                          )
                        )
                      }
                    >
                      {cell?.locked ? 'Locked' : 'Lock'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-ink-soft">
              Changing a spot by hand can put someone in two places at once — the save will refuse it and tell
              you which inning.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
