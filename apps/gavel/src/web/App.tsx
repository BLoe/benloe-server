/**
 * Gavel — an auction draft TRACKER.
 *
 * It sits beside a real draft room rather than replacing one. Everything the
 * draft room already shows — rival budgets, rival rosters, the clock — is
 * deliberately absent. What is here is the ranking, the tiers, a price that
 * responds to how the room has actually spent, and a fast way to mark players
 * gone.
 *
 * The whole interaction is: click a name, type a price, type a manager, Enter.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlayerValue } from '../lib/valuation.js';
import { fetchLeagues, fetchMe, useLeague, type LeagueSummary } from './store.js';
import { Board, Drafted, ManagersDialog, MyTeam, RoomBar } from './panels.js';
import { PickModal, type PickTarget } from './PickModal.js';

export default function App() {
  const [me, setMe] = useState<{ authed: boolean; signedIn: boolean; email: string | null } | null>(
    null
  );

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe({ authed: false, signedIn: false, email: null }));
  }, []);

  if (me === null) return <Splash>Loading…</Splash>;
  if (!me.authed) return <SignIn me={me} />;
  return <Draft />;
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center" style={{ color: 'var(--muted)' }}>
      {children}
    </div>
  );
}

const AUTH_URL = 'https://auth.benloe.com';

/** Sign-in is artanis's job; a browser already signed in never sees this. */
function SignIn({ me }: { me: { signedIn: boolean; email: string | null } }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="sheet p-6 w-96 text-center">
        <div className="slab" style={{ fontSize: 30, color: 'var(--brass)' }}>
          Gavel
        </div>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>Auction draft board.</p>
        {me.signedIn ? (
          <p style={{ color: 'var(--live)', marginTop: 16 }}>
            Signed in as {me.email}, which is not the owner of this board.
          </p>
        ) : (
          <a
            href={`${AUTH_URL}?redirect=${encodeURIComponent(window.location.href)}`}
            className="block mt-5 py-2"
            style={{ background: 'var(--brass)', color: '#14110e', fontWeight: 600 }}
          >
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}

function Draft() {
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem('gavel:league') || 'columbus'
  );
  const { league, state, unsynced, loading, error, addPick, undo, removePick, setMyTeam, saveTeams } =
    useLeague(leagueId);

  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [managers, setManagers] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    fetchLeagues()
      .then((r) => setLeagues(r.leagues))
      .catch(() => setLeagues([]));
  }, []);

  useEffect(() => {
    localStorage.setItem('gavel:league', leagueId);
  }, [leagueId]);

  /** Clicking any player opens the one dialog — new pick or correction. */
  const select = useCallback(
    (player: PlayerValue) => {
      const existing = state?.picks.find((p) => p.playerId === player.id);
      setTarget({ player, existing });
    },
    [state]
  );

  const submit = useCallback(
    (playerId: string, teamId: string, price: number) => {
      const player = league?.values.find((v) => v.id === playerId);
      const existing = target?.existing;
      // A correction is a removal and a re-entry: the pick log is append-only
      // and every number is a fold over it, so there is nothing else to update.
      if (existing) removePick(existing.seq);
      addPick(playerId, teamId, price);
      setFlash(`${player?.name ?? 'Player'} — $${price}`);
      setTimeout(() => setFlash(null), 2000);
      setTarget(null);
      setFilter('');
    },
    [addPick, removePick, league, target]
  );

  const remove = useCallback(
    (seq: number) => {
      removePick(seq);
      setTarget(null);
    },
    [removePick]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo();
        return;
      }
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName);
      if (e.key === 'Escape' && !typing) {
        setFilter('');
        setTarget(null);
        setManagers(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const currentLeague = useMemo(
    () => leagues.find((l) => l.id === leagueId),
    [leagues, leagueId]
  );

  if (loading) return <Splash>Loading board…</Splash>;
  if (!league || !state) {
    return (
      <Splash>
        <div className="text-center">
          <div>{error ?? 'No board loaded.'}</div>
          <div style={{ color: 'var(--dim)', marginTop: 8 }}>
            Run <code>npm run snapshot -- &lt;leagueId&gt; {leagueId}</code> on the server.
          </div>
        </div>
      </Splash>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2 p-2">
      <header className="flex items-center gap-4 shrink-0">
        <span className="slab" style={{ fontSize: 22, color: 'var(--brass)', lineHeight: 1 }}>
          Gavel
        </span>
        {leagues.length > 1 ? (
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            aria-label="League"
            style={{ padding: '2px 6px' }}
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: 'var(--muted)' }}>{currentLeague?.name ?? league.name}</span>
        )}

        {/* A filter, not an entry field: it narrows the columns and can never
            record anything. Finding one name among three thousand needs to be
            possible without scrolling five columns. */}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter players"
          aria-label="Filter players"
          style={{ padding: '3px 8px', width: 180 }}
        />

        <RoomBar state={state} />

        <div className="ml-auto flex items-center gap-3">
          {unsynced > 0 && (
            <span
              className="fig"
              title="Picks held locally; they sync automatically. The board is unaffected."
              style={{ color: 'var(--warn)' }}
            >
              ⟳ {unsynced} unsynced
            </span>
          )}
          <button onClick={() => setManagers(true)} className="px-2 py-1" style={{ color: 'var(--muted)' }}>
            Managers
          </button>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>
            <kbd>ctrl+z</kbd> undo
          </span>
        </div>
      </header>

      {flash && (
        <div className="shrink-0 px-1" style={{ color: 'var(--good)' }}>
          Drafted: {flash}
        </div>
      )}

      <div className="flex gap-2 flex-1 min-h-0">
        <Board league={league} state={state} filter={filter} onSelect={select} />
        <div
          className="flex flex-col gap-2 shrink-0 min-h-0"
          style={{ width: 'clamp(224px, 18vw, 280px)' }}
        >
          <MyTeam league={league} state={state} />
          <Drafted league={league} state={state} onSelect={select} />
        </div>
      </div>

      {target && (
        <PickModal
          target={target}
          teams={league.teams}
          state={state}
          config={league.config}
          onSubmit={submit}
          onRemove={remove}
          onClose={() => setTarget(null)}
        />
      )}

      {managers && (
        <ManagersDialog
          league={league}
          onSetMyTeam={setMyTeam}
          onSaveTeams={saveTeams}
          onClose={() => setManagers(false)}
        />
      )}
    </div>
  );
}
