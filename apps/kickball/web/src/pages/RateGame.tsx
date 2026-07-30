/**
 * The public rating game.
 *
 * One question, two names, one tap. Everything else — which stat to ask about,
 * which pair is worth asking, how the answers become ratings — happens on the
 * server. The only jobs here are to stay fast and to never make anyone feel
 * like they are grading their friends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { publicApi } from '../lib/api';
import type { Matchup } from '../lib/api';

const RATER_KEY = 'kickball.raterId';
const PASSCODE_KEY = 'kickball.passcode';

type Phase = 'loading' | 'passcode' | 'pick-rater' | 'playing' | 'error';

export function RateGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [teamName, setTeamName] = useState('');
  const [roster, setRoster] = useState<{ id: string; name: string }[]>([]);
  const [raterId, setRaterId] = useState<string | null>(null);
  const [passcode, setPasscode] = useState(localStorage.getItem(PASSCODE_KEY) ?? '');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [counts, setCounts] = useState({ yours: 0, total: 0 });
  const [choosing, setChoosing] = useState<string | null>(null);

  /**
   * Pairs the game should not come back to yet, and the matchups already
   * prefetched but not shown.
   *
   * A pair is marked seen when it is *shown*, not when it is answered. Marking
   * it on answer leaves the pair currently on screen out of the exclusion list,
   * so the prefetch that replaces it happily returns that same pair and it
   * appears twice in a row. The queue is part of the exclusion list for the same
   * reason: two prefetches issued together, with the same exclusions, can both
   * come back with the same matchup.
   */
  const seenRef = useRef<string[]>([]);
  const queueRef = useRef<Matchup[]>([]);
  const QUEUE_DEPTH = 2;
  const SEEN_MEMORY = 10;

  const markSeen = (pairKey: string) => {
    seenRef.current = [...seenRef.current.filter((k) => k !== pairKey), pairKey].slice(-SEEN_MEMORY);
  };

  const fetchMatchup = useCallback(
    async (code: string) =>
      publicApi.matchup([...seenRef.current, ...queueRef.current.map((m) => m.pairKey)], code),
    []
  );

  /**
   * Refills the queue one request at a time. Sequentially, deliberately: each
   * request has to be able to see the previous result already in the queue.
   */
  const topUpQueue = useCallback(
    async (code: string) => {
      while (queueRef.current.length < QUEUE_DEPTH) {
        try {
          const next = await fetchMatchup(code);
          if (
            queueRef.current.some((m) => m.pairKey === next.pairKey) ||
            seenRef.current.includes(next.pairKey)
          ) {
            // The server had nothing new to offer; stop rather than spin.
            break;
          }
          queueRef.current = [...queueRef.current, next];
        } catch {
          break;
        }
      }
    },
    [fetchMatchup]
  );

  /** Takes the next queued matchup, dropping any that have since been shown. */
  const takeQueued = (): Matchup | null => {
    queueRef.current = queueRef.current.filter((m) => !seenRef.current.includes(m.pairKey));
    const next = queueRef.current.shift() ?? null;
    if (next) markSeen(next.pairKey);
    return next;
  };

  useEffect(() => {
    (async () => {
      try {
        const [team, raters] = await Promise.all([publicApi.team(), publicApi.raters()]);
        setTeamName(team.teamName);
        setRoster(raters.players);

        if (raters.players.length < 2) {
          setError('The roster needs at least two players before the game can start.');
          setPhase('error');
          return;
        }

        if (team.passcodeRequired) {
          const stored = localStorage.getItem(PASSCODE_KEY) ?? '';
          try {
            await publicApi.checkPasscode(stored);
          } catch {
            setPhase('passcode');
            return;
          }
          setPasscode(stored);
        }

        const stored = localStorage.getItem(RATER_KEY);
        if (stored && raters.players.some((p) => p.id === stored)) {
          setRaterId(stored);
          setPhase('playing');
        } else {
          setPhase('pick-rater');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not reach the server.');
        setPhase('error');
      }
    })();
  }, []);

  // Load the first matchup and keep one queued behind it, so answering feels
  // instant instead of waiting on a round trip every time.
  useEffect(() => {
    if (phase !== 'playing') return;
    let cancelled = false;
    (async () => {
      try {
        const progress = await publicApi.progress(raterId);
        const first = await fetchMatchup(passcode);
        if (cancelled) return;
        markSeen(first.pairKey);
        setCounts({ yours: progress.yourComparisons, total: progress.totalComparisons });
        setMatchup(first);
        // Only now fill the queue, so it cannot duplicate what is on screen.
        void topUpQueue(passcode);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load a matchup.');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, raterId, passcode, fetchMatchup, topUpQueue]);

  const answer = useCallback(
    async (winnerId: string | null) => {
      if (!matchup || choosing) return;
      setChoosing(winnerId ?? 'tie');

      markSeen(matchup.pairKey);
      const queued = takeQueued();

      try {
        const result = await publicApi.submit({
          statKey: matchup.stat.key,
          playerA: matchup.playerA.id,
          playerB: matchup.playerB.id,
          winnerId,
          raterId,
          passcode,
        });
        setCounts({ yours: result.yourComparisons, total: result.totalComparisons });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That answer did not save.');
        setPhase('error');
        return;
      }

      // Show the queued matchup immediately, then refill behind it.
      setMatchup(queued);
      setChoosing(null);
      if (!queued) {
        fetchMatchup(passcode)
          .then((next) => {
            markSeen(next.pairKey);
            setMatchup(next);
          })
          .catch(() => undefined);
      }
      void topUpQueue(passcode);
    },
    [matchup, choosing, raterId, passcode, fetchMatchup, topUpQueue]
  );

  // Bound once on mount and driven through refs, so the very first key press
  // after a matchup appears is never dropped waiting for an effect to re-run.
  const liveRef = useRef<{ phase: Phase; matchup: Matchup | null; answer: typeof answer }>({
    phase,
    matchup,
    answer,
  });
  liveRef.current = { phase, matchup, answer };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const live = liveRef.current;
      if (live.phase !== 'playing' || !live.matchup) return;
      if (event.key === 'ArrowLeft') live.answer(live.matchup.playerA.id);
      if (event.key === 'ArrowRight') live.answer(live.matchup.playerB.id);
      if (event.key === 'ArrowDown' || event.key === ' ') {
        event.preventDefault();
        live.answer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Gates ---------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="eyebrow animate-pulse">Warming up…</p>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="eyebrow mb-3">Timeout</p>
          <h1 className="display mb-3 text-4xl">{error}</h1>
          <button className="btn btn-ghost mt-2" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (phase === 'passcode') {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <form
          className="card w-full max-w-sm p-7"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await publicApi.checkPasscode(passcodeInput);
              localStorage.setItem(PASSCODE_KEY, passcodeInput);
              setPasscode(passcodeInput);
              setError(null);
              setPhase(localStorage.getItem(RATER_KEY) ? 'playing' : 'pick-rater');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That code did not work.');
            }
          }}
        >
          <p className="eyebrow eyebrow-ink mb-3">Team code</p>
          <h1 className="display mb-4 text-3xl">Come on in</h1>
          <input
            className="field-input"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Enter the code"
            autoFocus
          />
          {error && <p className="mt-3 text-sm text-rubber">{error}</p>}
          <button className="btn btn-primary mt-5 w-full" type="submit">
            Start rating
          </button>
        </form>
      </main>
    );
  }

  if (phase === 'pick-rater') {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16">
        <p className="eyebrow mb-4">{teamName}</p>
        <h1 className="display mb-3 text-[clamp(2.2rem,7vw,3.8rem)]">Who's rating?</h1>
        <p className="mb-9 max-w-md text-chalk/65">
          Pick your name. It keeps your answers together so nobody has to start over, and yes, you'll be asked
          about yourself.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {roster.map((player) => (
            <button
              key={player.id}
              className="panel px-4 py-3.5 text-left text-lg font-semibold transition hover:border-lamp hover:bg-rail"
              onClick={() => {
                localStorage.setItem(RATER_KEY, player.id);
                setRaterId(player.id);
                setPhase('playing');
              }}
            >
              {player.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ---- The game ------------------------------------------------------------

  const raterName = roster.find((p) => p.id === raterId)?.name;

  return (
    <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-8">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
        <p className="eyebrow">{teamName}</p>
        <div className="flex items-center gap-4">
          <p className="code text-xs text-chalk/50">
            <span className="text-lamp">{counts.yours}</span> yours · {counts.total} team
          </p>
          {raterName && (
            <button
              className="code text-xs text-chalk/40 underline-offset-4 hover:text-chalk hover:underline"
              onClick={() => {
                localStorage.removeItem(RATER_KEY);
                setRaterId(null);
                setPhase('pick-rater');
              }}
            >
              {raterName}
            </button>
          )}
        </div>
      </header>

      {!matchup ? (
        <div className="grid flex-1 place-items-center">
          <p className="eyebrow animate-pulse">Picking a matchup…</p>
        </div>
      ) : (
        <div key={matchup.pairKey + matchup.stat.key} className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center py-8">
          <div className="rise mb-9 text-center">
            <p className="eyebrow mb-3">
              {matchup.stat.category === 'offense' ? 'Offense' : 'Defense'} · {matchup.stat.name}
            </p>
            <h1 className="display text-[clamp(1.8rem,5.5vw,3.2rem)] text-chalk">{matchup.stat.prompt}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-chalk/55">{matchup.stat.description}</p>
          </div>

          <div className="rise grid gap-3 sm:grid-cols-2" style={{ animationDelay: '70ms' }}>
            {[matchup.playerA, matchup.playerB].map((player, index) => (
              <button
                key={player.id}
                disabled={Boolean(choosing)}
                onClick={() => answer(player.id)}
                className={`card group relative overflow-hidden px-6 py-10 text-center transition disabled:cursor-wait sm:py-14 ${
                  choosing === player.id ? 'ring-4 ring-lamp' : ''
                } hover:-translate-y-0.5 hover:shadow-2xl`}
              >
                <span className="code absolute left-4 top-4 text-xs text-ink-soft/50">
                  {index === 0 ? '←' : '→'}
                </span>
                <span className="display block text-[clamp(1.5rem,4.5vw,2.4rem)] leading-tight">{player.name}</span>
                <span className="mt-3 block text-sm text-ink-soft opacity-0 transition group-hover:opacity-100">
                  Pick {player.name.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>

          <div className="rise mt-4 text-center" style={{ animationDelay: '140ms' }}>
            <button
              className="btn btn-ghost"
              disabled={Boolean(choosing)}
              onClick={() => answer(null)}
            >
              Too close to call
            </button>
            <p className="code mt-5 text-[0.7rem] text-chalk/30">
              Arrow keys work: ← → to pick, ↓ for a tie
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
