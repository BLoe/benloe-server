/**
 * Gavel — the auction board.
 *
 * The entry bar is the hot path and everything else defers to it. One nomination
 * is: type part of a name, Enter, type a price, Enter, type part of a team name,
 * Enter. Four keystrokes plus two short words, no mouse, no confirmation step.
 * That budget is what the layout is built around; a pick that takes longer than
 * the auctioneer does is a pick that gets entered wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adjustedValue, contenders } from '../lib/draft.js';
import type { PlayerValue } from '../lib/valuation.js';
import { fetchMe, useLeague } from './store.js';
import { searchPlayers } from './search.js';
import { Board, Log, MyTeam, RoomBar, Teams, money, Pos } from './panels.js';

type Stage = 'player' | 'price' | 'team';

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

/**
 * Sign-in is artanis's job. A browser already signed in anywhere on benloe.com
 * never sees this screen, because the cookie is issued on the parent domain.
 */
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
  const { league, state, unsynced, loading, error, addPick, undo, removePick, setMyTeam } =
    useLeague(leagueId);

  const [stage, setStage] = useState<Stage>('player');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [player, setPlayer] = useState<PlayerValue | null>(null);
  const [price, setPrice] = useState('');
  const [teamQuery, setTeamQuery] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const playerRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('gavel:league', leagueId);
  }, [leagueId]);

  const candidates = useMemo(
    () => (league && state ? searchPlayers(query, league.values, state.drafted) : []),
    [query, league, state]
  );

  const teamMatches = useMemo(() => {
    if (!league) return [];
    const q = teamQuery.toLowerCase().trim();
    if (!q) return league.teams;
    return league.teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teamQuery, league]);

  const reset = useCallback(() => {
    setStage('player');
    setQuery('');
    setPlayer(null);
    setPrice('');
    setTeamQuery('');
    setCursor(0);
    playerRef.current?.focus();
  }, []);

  const choosePlayer = useCallback((p: PlayerValue) => {
    setPlayer(p);
    setQuery(p.name);
    setStage('price');
    setTimeout(() => priceRef.current?.focus(), 0);
  }, []);

  const commit = useCallback(
    (teamId: string) => {
      if (!player) return;
      const amount = Math.round(Number(price));
      if (!Number.isFinite(amount) || amount < 0) return;
      addPick(player.id, teamId, amount);
      setFlash(`${player.name} — ${money(amount)}`);
      setTimeout(() => setFlash(null), 2200);
      reset();
    },
    [player, price, addPick, reset]
  );

  // Typing anywhere starts a nomination. During an auction the hands are not on
  // the mouse and the eyes are on the other monitor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.key === 'Escape') {
        reset();
        return;
      }
      if (!typing && /^[a-zA-Z]$/.test(e.key)) {
        playerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, reset]);

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

  const suggested = player ? adjustedValue(player, state, league.config) : 0;
  const rivals = player && price ? contenders(state, Math.round(Number(price)) || 0) : [];
  const me = state.teams.find((t) => t.teamId === league.myTeamId);

  return (
    <div className="h-full flex flex-col gap-2 p-2">
      {/* ---- header ---- */}
      <header className="flex items-center gap-4 shrink-0">
        <span className="slab" style={{ fontSize: 22, color: 'var(--brass)', lineHeight: 1 }}>
          Gavel
        </span>
        <span style={{ color: 'var(--muted)' }}>{league.name}</span>
        <RoomBar state={state} league={league} />
        <div className="ml-auto flex items-center gap-3">
          {unsynced > 0 && (
            <span
              className="fig"
              title="Picks held locally; they will sync automatically. The board is unaffected."
              style={{ color: 'var(--warn)' }}
            >
              ⟳ {unsynced} unsynced
            </span>
          )}
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>
            <kbd>esc</kbd> clear · <kbd>ctrl+z</kbd> undo
          </span>
        </div>
      </header>

      {/* ---- entry bar: the hot path ---- */}
      <div className="sheet shrink-0 relative" style={{ borderColor: 'var(--brass)' }}>
        <div className="flex items-stretch">
          <div className="flex-1 relative">
            <input
              ref={playerRef}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPlayer(null);
                setStage('player');
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, candidates.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  const chosen = candidates[cursor];
                  if (chosen && !chosen.drafted) {
                    e.preventDefault();
                    choosePlayer(chosen.player);
                  }
                }
              }}
              placeholder="Nominate — type a name"
              className="w-full border-0"
              style={{ background: 'transparent', fontSize: 16, padding: '10px 12px' }}
            />
            {stage === 'player' && candidates.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-20 sheet"
                style={{ borderColor: 'var(--brass)' }}
              >
                {candidates.map((c, i) => (
                  <button
                    key={c.player.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!c.drafted) choosePlayer(c.player);
                    }}
                    className={`w-full flex items-baseline gap-3 px-3 py-1 text-left ${c.drafted ? 'gone' : ''}`}
                    style={{ background: i === cursor ? 'var(--raised)' : 'transparent' }}
                  >
                    <span className="fig w-10 text-right" style={{ color: 'var(--brass)', fontWeight: 600 }}>
                      {money(adjustedValue(c.player, state, league.config))}
                    </span>
                    <Pos position={c.player.position} />
                    <span className="flex-1 truncate">{c.player.name}</span>
                    <span className="fig" style={{ color: 'var(--dim)', fontSize: 11 }}>
                      {c.player.team ?? '--'} · T{c.player.tier}
                    </span>
                    {c.drafted && (
                      <span className="fig" style={{ color: 'var(--live)', fontSize: 11 }}>
                        already sold
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center border-l" style={{ borderColor: 'var(--rule)' }}>
            <span className="label px-2">Price</span>
            <input
              ref={priceRef}
              value={price}
              inputMode="numeric"
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && price !== '') {
                  e.preventDefault();
                  setStage('team');
                  setTimeout(() => teamRef.current?.focus(), 0);
                }
              }}
              placeholder={player ? String(Math.round(suggested)) : '--'}
              className="border-0 w-20"
              style={{ background: 'transparent', fontSize: 16, padding: '10px 4px' }}
            />
          </div>

          <div className="flex items-center border-l relative" style={{ borderColor: 'var(--rule)' }}>
            <span className="label px-2">To</span>
            <input
              ref={teamRef}
              value={teamQuery}
              onChange={(e) => setTeamQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && teamMatches[0]) {
                  e.preventDefault();
                  commit(teamMatches[0].teamId);
                }
              }}
              placeholder="team"
              className="border-0 w-40"
              style={{ background: 'transparent', fontSize: 16, padding: '10px 4px' }}
            />
            {stage === 'team' && teamMatches.length > 0 && (
              <div
                className="absolute right-0 top-full z-20 sheet w-56"
                style={{ borderColor: 'var(--brass)' }}
              >
                {teamMatches.slice(0, 12).map((t, i) => (
                  <button
                    key={t.teamId}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(t.teamId);
                    }}
                    className="w-full text-left px-3 py-1"
                    style={{ background: i === 0 ? 'var(--raised)' : 'transparent' }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Instant read on the lot in front of you. No network, no waiting. */}
        {player && (
          <div
            className="flex items-center gap-5 px-3 py-1 rule-b"
            style={{ borderTop: '1px solid var(--rule)', background: 'var(--raised)' }}
          >
            <span className="flex items-baseline gap-2">
              <span className="label">Board</span>
              <span className="fig" style={{ color: 'var(--brass)', fontWeight: 600 }}>
                {money(suggested)}
              </span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="label">Tier</span>
              <span className="fig">
                {player.tier} · {league.values.filter((v) => v.position === player.position && v.tier === player.tier && !state.drafted.has(v.id)).length} left
              </span>
            </span>
            {me && (
              <span className="flex items-baseline gap-2">
                <span className="label">Your max</span>
                <span className="fig" style={{ color: me.maxBid < suggested ? 'var(--bad)' : 'var(--ink)' }}>
                  {money(me.maxBid)}
                </span>
              </span>
            )}
            {price !== '' && (
              <span className="flex items-baseline gap-2">
                <span className="label">Can outbid</span>
                <span className="fig">{rivals.filter((t) => t.teamId !== league.myTeamId).length}</span>
                <span style={{ color: 'var(--dim)', fontSize: 11 }}>
                  {rivals
                    .filter((t) => t.teamId !== league.myTeamId)
                    .slice(0, 4)
                    .map((t) => t.name)
                    .join(', ')}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {flash && (
        <div className="shrink-0 px-2" style={{ color: 'var(--good)' }}>
          Sold: {flash}
        </div>
      )}

      {/* ---- board + panels ---- */}
      <div className="flex gap-2 flex-1 min-h-0">
        <Board league={league} state={state} onPick={choosePlayer} />
        <div
          className="flex flex-col gap-2 shrink-0"
          style={{ width: 'clamp(232px, 19vw, 300px)' }}
        >
          <MyTeam league={league} state={state} />
          <Teams league={league} state={state} onSetMyTeam={setMyTeam} />
          <Log league={league} state={state} onRemove={removePick} />
        </div>
      </div>
    </div>
  );
}
