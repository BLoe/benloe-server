import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Player } from '../lib/api';
import type { Meta } from '../pages/Dashboard';

const GENDER_LABELS: Record<Player['gender'], string> = {
  woman: 'Woman',
  man: 'Man',
  nonbinary: 'Non-binary',
};

export function RosterPanel({ meta }: { meta: Meta }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Player['gender']>('woman');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.players.list().then((r) => setPlayers(r.players));
  useEffect(() => {
    load();
  }, []);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.players.create({ name, gender });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that player.');
    } finally {
      setBusy(false);
    }
  };

  const counted = players.filter((p) => p.active && p.gender !== 'man').length;

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="card h-fit p-6">
        <h2 className="display mb-1 text-xl">Add a player</h2>
        <p className="eyebrow eyebrow-ink mb-5">Name and how they count for the field minimum</p>
        <form onSubmit={add} className="space-y-3">
          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="player-name">
              Name
            </label>
            <input
              id="player-name"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Casey Alvarez"
            />
          </div>
          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="player-gender">
              Counts as
            </label>
            <select
              id="player-gender"
              className="field-input"
              value={gender}
              onChange={(e) => setGender(e.target.value as Player['gender'])}
            >
              <option value="woman">Woman</option>
              <option value="nonbinary">Non-binary</option>
              <option value="man">Man</option>
            </select>
          </div>
          {error && <p className="text-sm text-rubber">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy || !name.trim()}>
            Add to roster
          </button>
        </form>
        <p className="mt-5 border-t border-chalk-line pt-4 text-sm text-ink-soft">
          The league needs {meta.settings.min_women_in_field} of the 10 fielders to be women or non-binary players.
          You have <strong className="text-ink">{counted}</strong> on the active roster.
        </p>
      </section>

      <section className="card p-6">
        <div className="mb-5 flex items-baseline justify-between">
          <div>
            <h2 className="display text-xl">Roster</h2>
            <p className="eyebrow eyebrow-ink mt-1">{players.length} players</p>
          </div>
        </div>

        {players.length === 0 ? (
          <div className="rounded-lg border border-dashed border-chalk-line px-6 py-12 text-center">
            <p className="font-semibold">No players yet</p>
            <p className="mt-1 text-sm text-ink-soft">Add everyone on the team to get started.</p>
          </div>
        ) : (
          <ul className="divide-y divide-chalk-line">
            {players.map((player) => (
              <li key={player.id} className="py-3">
                {editing === player.id ? (
                  <PlayerEditor
                    player={player}
                    positions={meta.positions}
                    onDone={async () => {
                      setEditing(null);
                      await load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`flex-1 font-semibold ${player.active ? '' : 'text-ink-soft line-through'}`}>
                      {player.name}
                    </span>
                    <span className="code text-xs text-ink-soft">{GENDER_LABELS[player.gender]}</span>
                    {player.excludedPositions.length > 0 && (
                      <span className="code rounded bg-lamp/25 px-2 py-0.5 text-[0.65rem] text-ink">
                        avoids {player.excludedPositions.length}
                      </span>
                    )}
                    {!player.active && <span className="code text-xs text-ink-soft">inactive</span>}
                    <button className="btn btn-chalk px-3 py-1 text-sm" onClick={() => setEditing(player.id)}>
                      Edit
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlayerEditor({
  player,
  positions,
  onDone,
  onCancel,
}: {
  player: Player;
  positions: Meta['positions'];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [gender, setGender] = useState(player.gender);
  const [active, setActive] = useState(player.active);
  const [excluded, setExcluded] = useState<string[]>(player.excludedPositions);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (key: string) =>
    setExcluded((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  return (
    <div className="space-y-4 rounded-lg bg-chalk-dim/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <select
          className="field-input"
          value={gender}
          onChange={(e) => setGender(e.target.value as Player['gender'])}
          aria-label="Counts as"
        >
          <option value="woman">Woman</option>
          <option value="nonbinary">Non-binary</option>
          <option value="man">Man</option>
        </select>
      </div>

      <div>
        <p className="eyebrow eyebrow-ink mb-2">Won't play</p>
        <div className="flex flex-wrap gap-1.5">
          {positions.map((position) => (
            <button
              key={position.key}
              type="button"
              onClick={() => toggle(position.key)}
              className={`code rounded border px-2.5 py-1 text-xs transition ${
                excluded.includes(position.key)
                  ? 'border-rubber bg-rubber text-white'
                  : 'border-chalk-line text-ink-soft hover:border-ink/40'
              }`}
            >
              {position.code}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          The optimizer treats these as off limits, not just unlikely.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        On the active roster
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.players.update(player.id, { name, gender, active, excludedPositions: excluded });
            onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-chalk" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className="flex-1" />
        {confirmDelete ? (
          <>
            <span className="text-sm text-ink-soft">Delete and lose their ratings?</span>
            <button
              className="btn btn-chalk text-rubber"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await api.players.remove(player.id);
                onDone();
              }}
            >
              Yes, delete
            </button>
            <button className="btn btn-chalk" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn btn-chalk text-ink-soft" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
