import { useEffect, useState } from 'react';

export interface Me {
  user: { userId: string; username: string; displayName: string; avatar: string | null };
  state: { week: number; season: string; season_type: string; display_week: number };
  leagues: Array<{
    leagueId: string;
    name: string;
    season: string;
    status: string;
    totalRosters: number;
    kind: 'dynasty' | 'keeper' | 'redraft';
  }>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useApi<T>(path: string | null): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: !!path });
  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    get<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((err) => live && setState({ data: null, error: err.message, loading: false }));
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

export const fmt1 = (n: number) => n.toFixed(1);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
