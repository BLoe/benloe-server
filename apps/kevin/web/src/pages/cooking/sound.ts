// The timer alarm and the screen wake lock. Both are best-effort: a browser
// that has neither still gets the on-screen "Time's up".
import { useEffect, useState } from 'react';

let ctx: AudioContext | null = null;

/** Call from a tap (starting a timer): browsers only allow sound that a gesture has unlocked. */
export function primeAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // no audio: the alarm is visual and haptic only
  }
}

/** Three short beeps and a buzz. */
export function ring(): void {
  try {
    navigator.vibrate?.([250, 120, 250, 120, 400]);
  } catch {
    // not allowed here
  }
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const at = t0 + i * 0.3;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.25);
  }
}

interface Sentinel {
  release: () => Promise<void>;
  addEventListener: (type: 'release', fn: () => void) => void;
}
type WakeLockNav = { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } };

/** Keeps the screen on while mounted, re-acquiring after the tab comes back. Returns whether the lock is held. */
export function useWakeLock(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const api = (navigator as unknown as WakeLockNav).wakeLock;
    if (!api) return;
    let lock: Sentinel | null = null;
    let live = true;
    const acquire = async () => {
      if (!live || lock || document.visibilityState !== 'visible') return;
      try {
        const l = await api.request('screen');
        if (!live) return void l.release();
        lock = l;
        setHeld(true);
        l.addEventListener('release', () => {
          lock = null;
          if (live) setHeld(false);
        });
      } catch {
        // low battery or not allowed: nothing to do
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
  return held;
}
