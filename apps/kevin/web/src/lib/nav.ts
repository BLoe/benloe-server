// The navigation is data: built-in pages Ben has not hidden, then the spaces
// pinned to the nav, from GET /api/view/spaces/nav. A space Kevin creates
// mid-chat appears as soon as its data_changed event arrives.
import type { NavPayload, Space } from './spaces';
import { useView } from './useView';

export interface NavEntry {
  path: string;
  label: string;
  kind: 'builtin' | 'space';
  /** space: a lucide icon name. Built-ins take their icon from the page registry. */
  icon?: string | null;
  /** Open records due within three days. */
  badge?: number;
}

export interface Nav {
  /** Visible built-ins and pinned spaces, in nav order. */
  entries: NavEntry[];
  /** Every space that is not archived, pinned or not. */
  spaces: Space[];
  hidden: string[];
}

/** `builtin` is the registry's list, used until (or instead of) the server's answer. */
export function buildNav(payload: NavPayload | undefined, builtin: { path: string; label: string }[]): Nav {
  const known = new Map(builtin.map((b) => [b.path, b]));
  const fromServer = payload?.builtin?.filter((b) => known.has(b.path));
  const hidden = (fromServer ?? []).filter((b) => b.hidden).map((b) => b.path);
  // Server order wins; a page the server does not list (a newer client) still shows.
  const order = fromServer?.length ? [...fromServer.map((b) => b.path), ...builtin.map((b) => b.path).filter((p) => !fromServer.some((b) => b.path === p))] : builtin.map((b) => b.path);
  const spaces = (payload?.spaces ?? []).filter((s) => !s.archived);
  const entries: NavEntry[] = [
    ...order.filter((p) => !hidden.includes(p)).map((p): NavEntry => ({ path: p, label: known.get(p)!.label, kind: 'builtin' })),
    ...spaces.filter((s) => s.pinned).map((s): NavEntry => ({ path: s.link, label: s.name, kind: 'space', icon: s.icon, badge: s.counts.due_soon || undefined })),
  ];
  return { entries, spaces, hidden };
}

/** The phone's tab bar holds Home, then the first `slots` entries in nav order; the rest sit behind "More". */
export function tabEntries(entries: NavEntry[], slots = 3): { tabs: NavEntry[]; rest: NavEntry[] } {
  return { tabs: entries.slice(0, slots), rest: entries.slice(slots) };
}

export function useNav(builtin: { path: string; label: string }[]): Nav {
  const view = useView<NavPayload>('spaces/nav');
  return buildNav(view.data, builtin);
}
