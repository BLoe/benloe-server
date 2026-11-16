import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Me } from './types';

const DESKTOP = '(min-width: 64rem)';

/** True from the desktop breakpoint (1024px) up: left nav and docked chat instead of tab bar and sheet. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(DESKTOP).matches,
  );
}

let me: Promise<Me> | null = null;
/** Who is signed in, Ben's time zone, the push key. Fetched once. */
export function useMe(): Me | null {
  const [value, setValue] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    me ??= api.get<Me>('/me');
    me.then(
      (m) => live && setValue(m),
      () => {
        me = null;
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/**
 * The part of the window not covered by the on-screen keyboard. A full-screen
 * sheet sized to this keeps its composer above the keyboard on iOS, where
 * the layout viewport does not shrink.
 */
export function useVisualViewport(): { height: number; top: number } | null {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ height: vv.height, top: vv.offsetTop });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return box;
}

/** Re-renders on an interval so "5 min ago" stays true. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
