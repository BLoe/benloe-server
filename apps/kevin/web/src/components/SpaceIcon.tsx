import { Shapes, type LucideIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { iconName } from '@/lib/spaces';

// Kevin may name any lucide icon for a space. Shipping all ~1,900 would
// triple the app's first download, so nothing about them is in the main
// bundle: the name→file table is one lazy chunk, each icon another, fetched
// the first time a space icon is actually on screen and kept for the session.
const loaded = new Map<string, LucideIcon | null>(); // null: no icon has that name
const loading = new Set<string>();
const subs = new Set<() => void>();
let version = 0;

function load(name: string): void {
  if (!name || loaded.has(name) || loading.has(name)) return;
  loading.add(name);
  import('lucide-react/dynamicIconImports')
    .then(async (table) => {
      const importer = (table.default as Record<string, (() => Promise<{ default: LucideIcon }>) | undefined>)[name];
      loaded.set(name, importer ? (await importer()).default : null);
    })
    // Offline or mid-deploy: leave it unloaded so a later render tries again.
    .catch(() => undefined)
    .finally(() => {
      loading.delete(name);
      version++;
      subs.forEach((fn) => fn());
    });
}

/** The icon component for a name: undefined while loading, null when lucide has none by that name. */
export function useIcon(name: string | null | undefined): LucideIcon | null | undefined {
  const n = iconName(name);
  useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
  );
  useEffect(() => load(n), [n]);
  return n ? loaded.get(n) : null;
}

/** A space's icon by its lucide name. An unknown name, and the moment before one loads, show the default shape. */
export function SpaceIcon({ name, className, strokeWidth = 1.75 }: { name: string | null | undefined; className?: string; strokeWidth?: number }) {
  const Icon = useIcon(name) ?? Shapes;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}
