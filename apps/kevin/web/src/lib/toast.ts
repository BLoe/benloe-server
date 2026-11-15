// Toasts as a tiny store; <Toaster /> in the shell renders them.
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  title: string;
  body?: string;
  /** In-app path opened when the toast is tapped. */
  link?: string | null;
  onClick?: () => void;
}

let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const changed = () => subs.forEach((fn) => fn());

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  changed();
}

function show(t: Omit<Toast, 'id'>, ms: number): number {
  const id = nextId++;
  // A confirmation replaces the last one rather than stacking: three "Saved" in a row is noise.
  const kept = t.kind === 'success' ? toasts.filter((x) => x.kind !== 'success') : toasts;
  toasts = [...kept.slice(-2), { ...t, id }];
  changed();
  setTimeout(() => dismissToast(id), ms);
  return id;
}

export const toast = {
  info: (title: string, opts: Partial<Omit<Toast, 'id' | 'kind' | 'title'>> = {}) => show({ kind: 'info', title, ...opts }, 6000),
  success: (title: string, body?: string) => show({ kind: 'success', title, body }, 3000),
  error: (title: string, body?: string) => show({ kind: 'error', title, body }, 7000),
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => toasts,
  );
}
