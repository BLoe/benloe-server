/**
 * The board's state, and the sync that must never be able to break it.
 *
 * LOCAL FIRST, DELIBERATELY. A pick is applied to the screen and written to
 * localStorage synchronously, then POSTed. If the POST fails — server
 * restarting, Caddy reloading, laptop's wifi dropping — the pick is queued and
 * retried, the board carries on unaffected, and a badge says so. Nothing on the
 * critical path of an auction waits on the network.
 *
 * The consequence worth stating: the browser is the source of truth DURING a
 * draft, and the server is the source of truth ACROSS reloads. On load, the
 * server's log and the local queue are merged (server wins on anything it
 * already has), so a refresh mid-draft is safe even with picks still in flight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LeagueConfig } from '../lib/league.js';
import type { PlayerValue } from '../lib/valuation.js';
import { deriveState, type Pick, type TeamMeta } from '../lib/draft.js';

export interface LeaguePayload {
  id: string;
  name: string;
  config: LeagueConfig;
  values: PlayerValue[];
  teams: TeamMeta[];
  myTeamId: string | null;
  capturedAt: number;
  draftStartTime: number | null;
  /** What these prices were calibrated against. Null means the raw model. */
  calibration: { source: string; seasons: string[] } | null;
  picks: Pick[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), {
      status: res.status,
      needsAuth: body.needsAuth,
    });
  }
  return res.json() as Promise<T>;
}

export const fetchMe = () =>
  api<{ authed: boolean; signedIn: boolean; email: string | null }>('/me');

export interface LeagueSummary {
  id: string;
  name: string;
  teams: number;
  budget: number;
  draftStartTime: number | null;
}

export const fetchLeagues = () => api<{ leagues: LeagueSummary[] }>('/leagues');

/** A pick that has not yet been acknowledged by the server. */
interface PendingPick extends Pick {
  pending: true;
}

const queueKey = (leagueId: string) => `gavel:queue:${leagueId}`;

function loadQueue(leagueId: string): PendingPick[] {
  try {
    const raw = localStorage.getItem(queueKey(leagueId));
    return raw ? (JSON.parse(raw) as PendingPick[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(leagueId: string, queue: PendingPick[]): void {
  try {
    localStorage.setItem(queueKey(leagueId), JSON.stringify(queue));
  } catch {
    // A full or disabled localStorage must not take the board down; the queue
    // simply lives in memory for this tab.
  }
}

export function useLeague(leagueId: string | null) {
  const [league, setLeague] = useState<LeaguePayload | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [queue, setQueue] = useState<PendingPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const flushing = useRef(false);

  const load = useCallback(async () => {
    if (!leagueId) return;
    try {
      const data = await api<LeaguePayload>(`/league/${leagueId}`);
      setLeague(data);
      setPicks(data.picks);
      // Anything queued that the server already has is done.
      const known = new Set(data.picks.map((p) => p.playerId));
      const stillPending = loadQueue(leagueId).filter((p) => !known.has(p.playerId));
      setQueue(stillPending);
      saveQueue(leagueId, stillPending);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      if (err.needsAuth) throw err;
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    setLoading(true);
    load().catch(() => {});
  }, [load]);

  /**
   * Retry anything unsent. Runs on a timer and after every successful call.
   *
   * Crucially it also RECONCILES ids. A pick is created locally with a
   * temporary negative `seq`; once the server accepts it, that row's real id
   * has to replace the temporary one. Without this the pick keeps its negative
   * id for the life of the page, and a later undraft skips the server entirely
   * — the player vanishes from the screen and comes back on the next reload.
   */
  const flush = useCallback(async () => {
    if (!leagueId || flushing.current) return;
    const pending = loadQueue(leagueId);
    if (pending.length === 0) return;
    flushing.current = true;
    try {
      const sent: string[] = [];
      const realSeq = new Map<string, number>();
      let sawConflict = false;

      for (const p of pending) {
        try {
          const res = await api<{ pick: Pick }>(`/league/${leagueId}/picks`, {
            method: 'POST',
            body: JSON.stringify({
              playerId: p.playerId,
              teamId: p.teamId,
              price: p.price,
              keeper: !!p.keeper,
            }),
          });
          sent.push(p.playerId);
          realSeq.set(p.playerId, res.pick.seq);
        } catch (err: any) {
          // 409 means the server already has it — success, but it did not tell
          // us the id, so the log has to be re-read to learn it.
          if (err.status === 409) {
            sent.push(p.playerId);
            sawConflict = true;
          } else break;
        }
      }

      if (sent.length) {
        const remaining = loadQueue(leagueId).filter((p) => !sent.includes(p.playerId));
        saveQueue(leagueId, remaining);
        setQueue(remaining);
        setPicks((prev) =>
          prev.map((p) =>
            realSeq.has(p.playerId) ? { ...p, seq: realSeq.get(p.playerId)! } : p
          )
        );
      }

      if (sawConflict) {
        const fresh = await api<{ picks: Pick[] }>(`/league/${leagueId}/picks`).catch(() => null);
        if (fresh) setPicks(fresh.picks);
      }
    } finally {
      flushing.current = false;
    }
  }, [leagueId]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), 4000);
    return () => clearInterval(timer);
  }, [flush]);

  const addPick = useCallback(
    (playerId: string, teamId: string, price: number, keeper = false) => {
      if (!leagueId) return;
      // Applied to the screen before anything is sent. This is the whole point.
      const optimistic: PendingPick = {
        seq: -Date.now(),
        playerId,
        teamId,
        price,
        at: Date.now(),
        keeper,
        pending: true,
      };
      setPicks((prev) => [...prev, optimistic]);
      const next = [...loadQueue(leagueId), optimistic];
      saveQueue(leagueId, next);
      setQueue(next);
      void flush();
    },
    [leagueId, flush]
  );

  const undo = useCallback(async () => {
    if (!leagueId) return;
    const last = picks[picks.length - 1];
    if (!last) return;
    setPicks((prev) => prev.slice(0, -1));
    // An unsent pick is dropped from the queue rather than undone on a server
    // that never heard about it.
    const pending = loadQueue(leagueId);
    if (pending.some((p) => p.playerId === last.playerId)) {
      const remaining = pending.filter((p) => p.playerId !== last.playerId);
      saveQueue(leagueId, remaining);
      setQueue(remaining);
      return;
    }
    try {
      await api(`/league/${leagueId}/undo`, { method: 'POST' });
    } catch {
      // Put it back rather than show a board the server disagrees with.
      setPicks((prev) => [...prev, last]);
    }
  }, [leagueId, picks]);

  const removePick = useCallback(
    async (seq: number) => {
      if (!leagueId) return;
      const doomed = picks.find((p) => p.seq === seq);
      setPicks((prev) => prev.filter((p) => p.seq !== seq));

      // A pick the server has never seen must also leave the retry queue, or
      // the next flush cheerfully puts it back.
      if (doomed) {
        const pending = loadQueue(leagueId);
        if (pending.some((p) => p.playerId === doomed.playerId)) {
          const remaining = pending.filter((p) => p.playerId !== doomed.playerId);
          saveQueue(leagueId, remaining);
          setQueue(remaining);
        }
      }
      if (seq < 0) return;

      try {
        await api(`/league/${leagueId}/picks/${seq}`, { method: 'DELETE' });
      } catch {
        void load();
      }
    },
    [leagueId, load, picks]
  );

  const setMyTeam = useCallback(
    async (teamId: string) => {
      if (!leagueId) return;
      setLeague((prev) => (prev ? { ...prev, myTeamId: teamId } : prev));
      await api(`/league/${leagueId}/my-team`, {
        method: 'POST',
        body: JSON.stringify({ teamId }),
      }).catch(() => {});
    },
    [leagueId]
  );

  /**
   * Team names and keeper commitments — the one part of a league no platform
   * tells us reliably, and the part that moves every price in a keeper league.
   */
  const saveTeams = useCallback(
    async (teams: TeamMeta[]) => {
      if (!leagueId) return;
      setLeague((prev) => (prev ? { ...prev, teams } : prev));
      await api(`/league/${leagueId}/teams`, {
        method: 'POST',
        body: JSON.stringify({ teams }),
      }).catch(() => void load());
    },
    [leagueId, load]
  );

  const state = useMemo(() => {
    if (!league) return null;
    return deriveState(picks, league.teams, league.values, league.config);
  }, [league, picks]);

  return {
    league,
    picks,
    state,
    unsynced: queue.length,
    error,
    loading,
    addPick,
    undo,
    removePick,
    setMyTeam,
    saveTeams,
    reload: load,
  };
}
