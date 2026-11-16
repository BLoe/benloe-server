// A step's countdown as a small state machine. Time is wall-clock (`endsAt`),
// not a count of ticks, so a timer stays right when the browser throttles a
// background tab or the phone sleeps for a moment.

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface Timer {
  /** The full length, in ms. */
  duration: number;
  status: TimerStatus;
  /** Epoch ms the countdown reaches zero; set while running. */
  endsAt: number | null;
  /** ms left when it is not running (the full duration when idle, 0 when done). */
  left: number;
}

export const newTimer = (seconds: number): Timer => ({ duration: seconds * 1000, status: 'idle', endsAt: null, left: seconds * 1000 });

/** ms left at `now`. */
export function remaining(t: Timer, now: number): number {
  return t.status === 'running' && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.left;
}

/** Starts an idle timer, resumes a paused one, restarts a finished one. */
export function start(t: Timer, now: number): Timer {
  if (t.status === 'running') return t;
  const left = t.status === 'done' ? t.duration : t.left;
  return { ...t, status: 'running', endsAt: now + left, left };
}

export function pause(t: Timer, now: number): Timer {
  if (t.status !== 'running') return t;
  const left = remaining(t, now);
  return left <= 0 ? { ...t, status: 'done', endsAt: null, left: 0 } : { ...t, status: 'paused', endsAt: null, left };
}

export const reset = (t: Timer): Timer => ({ ...t, status: 'idle', endsAt: null, left: t.duration });

/** Adds time: to a running or paused timer in place; a finished or idle one starts counting the extra. */
export function extend(t: Timer, ms: number, now: number): Timer {
  if (t.status === 'running') return { ...t, endsAt: (t.endsAt ?? now) + ms };
  if (t.status === 'paused') return { ...t, left: t.left + ms };
  return { ...t, status: 'running', endsAt: now + ms, left: ms };
}

/** Moves a running timer to done once its time is up. Returns the same object when nothing changed. */
export function tick(t: Timer, now: number): Timer {
  return t.status === 'running' && t.endsAt != null && now >= t.endsAt ? { ...t, status: 'done', endsAt: null, left: 0 } : t;
}

export type Timers = Record<number, Timer>;

/** Ticks every timer; `finished` lists the keys that reached zero on this tick. Returns the same map when nothing changed. */
export function tickAll(timers: Timers, now: number): { timers: Timers; finished: number[] } {
  const finished: number[] = [];
  let next: Timers | null = null;
  for (const [k, t] of Object.entries(timers)) {
    const after = tick(t, now);
    if (after !== t) {
      next ??= { ...timers };
      next[Number(k)] = after;
      finished.push(Number(k));
    }
  }
  return { timers: next ?? timers, finished };
}

/** Keys of timers that are counting, paused or ringing: the ones worth showing when Ben is on another step. */
export function activeKeys(timers: Timers): number[] {
  return Object.entries(timers)
    .filter(([, t]) => t.status !== 'idle')
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
}

export const anyRunning = (timers: Timers): boolean => Object.values(timers).some((t) => t.status === 'running');
