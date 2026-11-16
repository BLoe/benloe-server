// Writes. The page calls the same typed tools the agent does, through
// POST /api/act/<tool>, so the two cannot disagree about what a valid write is.
import { useCallback, useState } from 'react';
import { api, ApiError } from './api';
import { toast } from './toast';

export type ActResult<T> = { ok: true; result: T } | { ok: false; error: string };

export interface ActOptions {
  /** Toast shown when the write succeeds, e.g. "Saved". */
  success?: string;
  /** Set to keep a failure quiet and handle `error` yourself. */
  silent?: boolean;
}

/**
 * Runs a write tool. Never throws: a failure is shown as a toast and comes
 * back as `{ ok: false, error }`. The server's `data_changed` event refreshes
 * every `useView` on the touched domains, so there is nothing to refetch by hand.
 */
export async function act<T = unknown>(tool: string, input: unknown = {}, opts: ActOptions = {}): Promise<ActResult<T>> {
  try {
    const r = await api.post<{ ok: true; result: T }>(`/act/${tool}`, input);
    if (opts.success) toast.success(opts.success);
    return { ok: true, result: r.result };
  } catch (e) {
    const error = e instanceof ApiError ? e.message : 'Something went wrong.';
    if (!opts.silent) toast.error('That didn’t save', error);
    return { ok: false, error };
  }
}

/** `act` plus a pending flag for disabling the button that triggered it. */
export function useAct(): { run: typeof act; pending: boolean } {
  const [count, setCount] = useState(0);
  const run = useCallback(async <T,>(tool: string, input: unknown = {}, opts: ActOptions = {}) => {
    setCount((n) => n + 1);
    try {
      return await act<T>(tool, input, opts);
    } finally {
      setCount((n) => n - 1);
    }
  }, []) as typeof act;
  return { run, pending: count > 0 };
}
