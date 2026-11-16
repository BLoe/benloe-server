import { ArrowLeft, ArrowRight, Check, ListChecks, Pause, Play, RotateCcw, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { clock, timerLabel, type RecipeFull, type RecipeIngredient } from './logic';
import { MealSheet } from './MealSheet';
import { primeAudio, ring, useWakeLock } from './sound';
import { activeKeys, anyRunning, extend, newTimer, pause, remaining, reset, start, tickAll, type Timer, type Timers } from './timers';

function Ingredients({ items, large }: { items: RecipeIngredient[]; large?: boolean }) {
  return (
    <ul className={cn('flex flex-col', large ? 'gap-3 text-[17px]' : 'gap-3 text-base')}>
      {items.map((i) => (
        <li key={i.position} className="flex gap-3 leading-snug">
          <span className="tabular w-20 shrink-0 text-right font-semibold">{i.amount || '—'}</span>
          <span className="min-w-0 flex-1">
            {i.name}
            {i.note && <span className="text-muted-foreground">, {i.note}</span>}
            {!i.in_pantry && <span className="ml-1.5 text-sm text-warning">not in pantry</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The countdown for the step on screen: a clock readable from across the counter and three big buttons. */
function TimerPanel({ timer, now, onStart, onPause, onReset, onExtend }: { timer: Timer; now: number; onStart: () => void; onPause: () => void; onReset: () => void; onExtend: () => void }) {
  const done = timer.status === 'done';
  return (
    <div className={cn('mt-6 flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:gap-6 lg:mt-8 lg:p-5', done ? 'border-warning bg-warning-soft' : 'bg-card')} data-timer={timer.status}>
      <div className="min-w-[8.5rem]">
        <p className={cn('tabular text-[46px] leading-none font-semibold lg:text-[56px]', done && 'text-warning')} role="timer" aria-live="off">
          {done ? '0:00' : clock(remaining(timer, now))}
        </p>
        <p className={cn('mt-1.5 text-sm', done ? 'font-semibold text-warning' : 'text-muted-foreground')}>{done ? 'Time’s up' : timer.status === 'paused' ? 'Paused' : `${timerLabel(Math.round(timer.duration / 1000))} timer`}</p>
      </div>
      <div className="flex flex-1 items-center gap-2">
        {done ? (
          <Button onClick={onReset} className="h-14 flex-1 px-6 text-base lg:h-14 lg:text-base">
            <Check className="size-5" />
            Stop
          </Button>
        ) : timer.status === 'running' ? (
          <Button variant="secondary" onClick={onPause} className="h-14 flex-1 px-6 text-base lg:h-14 lg:text-base">
            <Pause className="size-5" />
            Pause
          </Button>
        ) : (
          <Button onClick={onStart} className="h-14 flex-1 px-6 text-base lg:h-14 lg:text-base">
            <Play className="size-5" />
            {timer.status === 'paused' ? 'Resume' : 'Start timer'}
          </Button>
        )}
        <Button variant="outline" onClick={onExtend} className="h-14 px-4 text-base lg:h-14 lg:text-base">
          +1 min
        </Button>
        {timer.status !== 'idle' && !done && (
          <Button variant="outline" onClick={onReset} className="h-14 px-4 text-base lg:h-14 lg:text-base" aria-label="Reset timer">
            <RotateCcw className="size-5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Cooking mode: the whole screen, one step at a time, type large enough to
 * read from the stove. Each step with a wait has its own countdown; several
 * can run at once and stay visible above the buttons when Ben moves on. The
 * screen is kept awake where the browser allows. The last step leads to
 * "I made this".
 */
export function CookMode({ recipe, today, onClose }: { recipe: RecipeFull; today: string; onClose: () => void }) {
  const steps = recipe.steps;
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const awake = useWakeLock();
  const logged = useRef(false);

  const timersRef = useRef<Timers>({});
  const [timers, setTimersState] = useState<Timers>(() => {
    const t: Timers = {};
    steps.forEach((s, i) => {
      if (s.timer_seconds) t[i] = newTimer(s.timer_seconds);
    });
    timersRef.current = t;
    return t;
  });
  const [now, setNow] = useState(() => Date.now());
  const update = useCallback((key: number, fn: (t: Timer, now: number) => Timer) => {
    const t = timersRef.current[key];
    if (!t) return;
    const at = Date.now();
    timersRef.current = { ...timersRef.current, [key]: fn(t, at) };
    setNow(at);
    setTimersState(timersRef.current);
  }, []);

  // One clock for every timer. Finishing is decided against the wall clock, so a throttled tab catches up on its next tick.
  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now();
      const r = tickAll(timersRef.current, at);
      if (r.timers !== timersRef.current) {
        timersRef.current = r.timers;
        setTimersState(r.timers);
      }
      if (r.finished.length) ring();
      if (anyRunning(r.timers)) setNow(at);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // A finished timer keeps ringing every few seconds until it is stopped, for half a minute.
  const ringing = Object.values(timers).some((t) => t.status === 'done');
  useEffect(() => {
    if (!ringing) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n > 10) return clearInterval(id);
      ring();
    }, 3000);
    return () => clearInterval(id);
  }, [ringing]);

  const last = index >= steps.length - 1;
  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(steps.length - 1, to))), [steps.length]);
  const requestClose = useCallback(() => {
    if (activeKeys(timersRef.current).length) setLeaving(true);
    else onClose();
  }, [onClose]);

  const modal = showIngredients || finishing || leaving;
  useEffect(() => {
    if (modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(index + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(index - 1);
      // A sheet that just closed on this same Escape has already claimed it.
      else if (e.key === 'Escape' && !e.defaultPrevented) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, index, go, requestClose]);

  const step = steps[index];
  const timer = timers[index];
  const others = activeKeys(timers).filter((k) => k !== index);
  const long = (step?.text.length ?? 0) > 260;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Cooking ${recipe.title}`} className="fixed inset-0 z-50 flex flex-col bg-background text-foreground" data-testid="cook-mode">
      <header className="flex shrink-0 items-center gap-1 px-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 lg:px-4">
        <button type="button" onClick={requestClose} aria-label="Leave cooking mode" className="grid size-12 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-6" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{recipe.title}</p>
          <p className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
            <span className="tabular">
              Step {index + 1} of {steps.length}
            </span>
            {awake && (
              <span className="flex items-center gap-1" title="The screen will not sleep while this is open" data-testid="awake">
                <Sun className="size-3.5" />
                <span className="sr-only sm:not-sr-only">Screen stays on</span>
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowIngredients(true)} className="mr-1.5 h-12 shrink-0 lg:hidden">
          <ListChecks />
          Ingredients
        </Button>
      </header>

      <div className="flex shrink-0 gap-1 px-4 pb-1 lg:px-6" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label="Progress through the recipe">
        {steps.map((s, i) => (
          <span key={s.position} className={cn('h-1.5 min-w-0 flex-1 rounded-full', i <= index ? 'bg-primary' : 'bg-secondary')} />
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="scroll-area hidden w-[22rem] shrink-0 border-r px-6 py-6 lg:block" aria-label="Ingredients">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Ingredients{recipe.servings ? ` · serves ${recipe.servings}` : ''}</h2>
          <Ingredients items={recipe.ingredients} />
        </aside>
        <main className="scroll-area flex min-w-0 flex-1 flex-col px-5 py-5 lg:px-12 lg:py-10">
          <div className="m-auto w-full max-w-3xl" key={index}>
            <p className="mb-2 text-sm font-semibold tracking-wide text-primary uppercase">Step {index + 1}</p>
            <p className={cn('font-medium break-words whitespace-pre-line', long ? 'text-[22px] leading-[1.4] lg:text-[30px]' : 'text-[27px] leading-[1.32] lg:text-[40px] lg:leading-[1.25]')} data-testid="step-text">
              {step?.text}
            </p>
            {timer && (
              <TimerPanel
                timer={timer}
                now={now}
                onStart={() => {
                  primeAudio();
                  update(index, start);
                }}
                onPause={() => update(index, pause)}
                onReset={() => update(index, reset)}
                onExtend={() => {
                  primeAudio();
                  update(index, (t, at) => extend(t, 60_000, at));
                }}
              />
            )}
          </div>
        </main>
      </div>

      <footer className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-6">
        {others.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Other timers">
            {others.map((k) => {
              const t = timers[k]!;
              const done = t.status === 'done';
              return (
                <button key={k} type="button" onClick={() => go(k)} data-other-timer={t.status} className={cn('tabular flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-medium', done ? 'border-warning bg-warning-soft text-warning' : 'bg-card')}>
                  Step {k + 1}
                  <span className={done ? 'font-semibold' : 'text-muted-foreground'}>{done ? 'time’s up' : `${clock(remaining(t, now))}${t.status === 'paused' ? ' paused' : ''}`}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="mx-auto flex max-w-3xl gap-3">
          <Button variant="outline" disabled={index === 0} onClick={() => go(index - 1)} className="h-16 flex-1 text-lg lg:h-16 lg:text-lg">
            <ArrowLeft className="size-5" />
            Back
          </Button>
          {last ? (
            <Button onClick={() => setFinishing(true)} className="h-16 flex-[2] text-lg lg:h-16 lg:text-lg">
              <Check className="size-5" />
              I made this
            </Button>
          ) : (
            <Button onClick={() => go(index + 1)} className="h-16 flex-[2] text-lg lg:h-16 lg:text-lg">
              Next
              <ArrowRight className="size-5" />
            </Button>
          )}
        </div>
      </footer>

      <Dialog open={showIngredients} onOpenChange={setShowIngredients}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ingredients</DialogTitle>
            <DialogDescription>{recipe.servings ? `Serves ${recipe.servings}.` : recipe.title}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pt-1 pb-6">
            <Ingredients items={recipe.ingredients} large />
          </DialogBody>
        </DialogContent>
      </Dialog>
      {finishing && (
        <MealSheet
          recipe={recipe}
          today={today}
          onLogged={() => (logged.current = true)}
          onClose={() => {
            setFinishing(false);
            // Closed after logging: the meal is done, so cooking mode is too.
            if (logged.current) onClose();
          }}
        />
      )}
      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title="Leave cooking mode?" body="Timers that are running stop when you leave." confirmLabel="Leave" onConfirm={onClose} />
    </div>,
    document.body,
  );
}
