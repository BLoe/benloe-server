// Reads. `useView('pantry/items', { location: 'fridge' })` fetches
// GET /api/view/pantry/items?location=fridge and keeps it fresh: it refetches
// when a write touches the view's domain (the first path segment), when the
// event stream reconnects, and when the window regains focus.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, query } from './api';
import { subscribe } from './events';
import type { AppEvent } from './types';

export type ViewParams = Record<string, string | number | boolean | null | undefined>;

export interface ViewState<T> {
  data: T | undefined;
  /** True only until the first answer arrives; refetches keep showing the old data. */
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface ViewOptions {
  /** Skip fetching, e.g. until a search box has text. */
  enabled?: boolean;
  /** Also refetch on this interval, for data that changes without an event (idle job runs). */
  pollMs?: number;
}

// Last answer per URL, so going back to a page paints at once and then refreshes.
const cache = new Map<string, unknown>();

/** Which domains an event makes stale. A finished turn changes `system` views (spend) without a data_changed of its own. */
export function staleDomains(e: AppEvent): string[] | 'all' {
  if (e.type === 'data_changed') return e.domains;
  if (e.type === 'turn_end') return ['system'];
  if (e.type === 'reconnected') return 'all';
  return [];
}

export function viewUrl(path: string, params?: ViewParams): string {
  return `/view/${path}${query(params)}`;
}

export function useView<T = unknown>(path: string, params?: ViewParams, opts: ViewOptions = {}): ViewState<T> {
  const { enabled = true, pollMs } = opts;
  const url = viewUrl(path, params);
  const domain = path.split('/')[0] ?? '';
  const [state, setState] = useState<{ url: string; data: T | undefined; error: string | null; loading: boolean }>(() => ({
    url,
    data: cache.get(url) as T | undefined,
    error: null,
    loading: enabled && !cache.has(url),
  }));
  const seq = useRef(0);
  const loadedAt = useRef(0);

  const load = useCallback(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    loadedAt.current = Date.now();
    api.get<T>(url).then(
      (data) => {
        cache.set(url, data);
        if (mine === seq.current) setState({ url, data, error: null, loading: false });
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        const error = e instanceof ApiError ? e.message : 'Could not load this.';
        setState((s) => ({ url, data: s.url === url ? s.data : undefined, error, loading: false }));
      },
    );
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) return;
    load();
    const off = subscribe((e) => {
      const stale = staleDomains(e);
      if (stale === 'all' || stale.includes(domain)) load();
    });
    const onFocus = () => {
      // focus and visibilitychange often fire together; one fetch is enough.
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 1500) load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = pollMs ? setInterval(onFocus, pollMs) : null;
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (timer) clearInterval(timer);
      seq.current++;
    };
  }, [load, domain, enabled, pollMs]);

  // A changed URL shows that URL's cached answer (or nothing) rather than the previous one's.
  const current = state.url === url ? state : { url, data: cache.get(url) as T | undefined, error: null, loading: enabled && !cache.has(url) };
  return { data: current.data, loading: current.loading, error: current.error, refetch: load };
}
