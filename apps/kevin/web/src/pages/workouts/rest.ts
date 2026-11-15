// The rest timer's one running instance. Kept outside React so it survives a
// tab switch inside the page and a trip to another page and back; the state
// transitions themselves are the pure functions in logic.ts.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { adjustRest, restState, startRest, type Rest } from './logic';

let rest: Rest | null = null;
let alerted = false;
const subs = new Set<() => void>();
const changed = () => subs.forEach((fn) => fn());

let audio: AudioContext | null = null;

/**
 * Browsers only let a page make sound after a tap. Call this from the tap
 * that logs the set, so the beep at the end of the rest is allowed.
 */
export function primeAlert(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // no sound available: the timer still shows and vibrates
  }
}

function alertDone(): void {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    // vibration not allowed here
  }
  try {
    if (!audio || audio.state !== 'running') return;
    const t = audio.currentTime;
    for (const [at, freq] of [[0, 880], [0.22, 1175]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.2);
    }
  } catch {
    // sound failed: nothing to do
  }
}

// One clock for the alert, running only while a rest is, so the beep fires
// even when the timer's bar is not on screen.
let ticker: ReturnType<typeof setInterval> | null = null;
function watch(): void {
  if (rest && !ticker) {
    ticker = setInterval(() => {
      if (!rest) return;
      const over = Date.now() - rest.endsAt;
      if (over >= 0 && !alerted) {
        alerted = true;
        alertDone();
        changed();
      }
      // A finished rest clears itself: nobody wants to dismiss it between sets.
      if (over > 20_000) clearRest();
    }, 250);
  } else if (!rest && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

export function beginRest(seconds: number, exercise: string): void {
  rest = startRest(Date.now(), seconds, exercise);
  alerted = false;
  watch();
  changed();
}

export function addRest(deltaSeconds: number): void {
  if (!rest) return;
  rest = adjustRest(rest, deltaSeconds, Date.now());
  alerted = rest.endsAt <= Date.now();
  changed();
}

export function clearRest(): void {
  rest = null;
  watch();
  changed();
}

/** The running rest with its countdown, re-rendering a few times a second while it runs; null when there is none. */
export function useRest(): (Rest & { remaining: number; fraction: number; done: boolean }) | null {
  const current = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => rest,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!current) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [current]);
  return current ? { ...current, ...restState(current, Math.max(now, 0)) } : null;
}
