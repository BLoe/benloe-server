// The workout in focus for one date: each exercise as a card with last time,
// the suggestion and the sets logged so far; one tap logs the next set.
import { ArrowLeftRight, Check, ChevronDown, Dumbbell, Ellipsis, Flag, MessageCircle, Moon, Pencil, Plus, RotateCcw, SkipForward, Timer, Trash2, Trophy, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { ConfirmDialog, EmptyState, ErrorState, List, ListRow, LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { act, useAct } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { calendarDay, longDate, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { fmtDuration, logEntry, logTarget, prefill, restSeconds, setKind, setText, shownStatus, type LogEntry, type SetDraft, type SetKind } from './logic';
import { ExercisePicker, SetFields, SetRow, SetSheet, StatusBadge } from './parts';
import { addRest, beginRest, clearRest, primeAlert, useRest } from './rest';
import { DetailsSheet, SessionSheet, sessionFacts } from './SessionSheet';
import type { ExerciseCard, LoggedSet, LogResult, ProgressionView, Session, TodayView } from './types';

// Records broken in a session, as the tool reported them, kept while the app is open.
const prStore = new Map<number, string[]>();
const prSubs = new Set<() => void>();
function addPrs(sessionId: number, lines: string[]): void {
  prStore.set(sessionId, [...new Set([...(prStore.get(sessionId) ?? []), ...lines])]);
  prSubs.forEach((fn) => fn());
}
/** A corrected or deleted set may have been the record: its exercise's lines go rather than stay wrong. */
function dropPrs(sessionId: number, exercise: string): void {
  const kept = (prStore.get(sessionId) ?? []).filter((line) => !line.startsWith(`${exercise}:`));
  prStore.set(sessionId, kept);
  prSubs.forEach((fn) => fn());
}
const NONE: string[] = [];
function usePrs(sessionId: number | undefined): string[] {
  return useSyncExternalStore(
    (fn) => {
      prSubs.add(fn);
      return () => prSubs.delete(fn);
    },
    () => (sessionId != null ? (prStore.get(sessionId) ?? NONE) : NONE),
  );
}

type Go = (tab: string, params?: Record<string, string>) => void;

interface Extra {
  name: string;
  category: string | null;
}

/** The next set's row: two boxes with steppers, pre-filled, and one button. */
function SetEntry({ card, kind, pending, onLog }: { card: ExerciseCard; kind: SetKind; pending: boolean; onLog: (entry: LogEntry) => Promise<boolean> }) {
  const [draft, setDraft] = useState<SetDraft>(() => prefill(card, kind));
  const [error, setError] = useState<string | null>(null);
  const n = card.logged_sets.length + 1;
  const submit = () => {
    const r = logEntry(card.exercise, kind, draft);
    if ('error' in r) return setError(r.error);
    setError(null);
    void onLog(r.entry);
  };
  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-4">
      <div className="grid grid-cols-2 items-end gap-2 @lg/page:grid-cols-[1fr_1fr_auto]">
        <SetFields kind={kind} draft={draft} onChange={setDraft} />
        <Button size="lg" className="col-span-2 h-12 text-base @lg/page:col-span-1 @lg/page:min-w-32 lg:h-12" disabled={pending} onClick={submit}>
          <Check />
          {kind === 'reps' ? `Log set ${n}` : n > 1 ? 'Log another' : 'Log it'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function CardView({ card, kind, open, canLog, pending, today, onToggle, onLog, onSet, onRemove, kindToggle }: {
  card: ExerciseCard;
  kind: SetKind;
  open: boolean;
  canLog: boolean;
  pending: boolean;
  today: string;
  onToggle: () => void;
  onLog: (entry: LogEntry) => Promise<boolean>;
  onSet: (set: LoggedSet) => void;
  /** Off-plan cards with nothing logged yet can be taken off the list again. */
  onRemove?: () => void;
  kindToggle?: (k: SetKind) => void;
}) {
  const p = card.planned;
  const working = card.logged_sets.filter((s) => !s.is_warmup).length;
  const target = p?.target_sets ?? null;
  const done = p ? card.done : card.logged_sets.length > 0;
  const loggedLine = card.logged_sets.length ? card.logged_sets.map((s) => (s.reps != null ? `${s.weight_lbs ?? 'BW'}×${s.reps}` : setText(s))).join(', ') : '';
  return (
    <li className={cn('overflow-hidden rounded-xl border bg-card', open && canLog && 'border-primary/50 shadow-sm')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
          {done ? <Check className="size-4" /> : <span className="tabular">{working}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-snug font-semibold">{card.exercise}</span>
          <span className="tabular mt-0.5 block truncate text-sm text-muted-foreground">
            {!open && loggedLine ? loggedLine : p?.target || (card.previous ? `Last: ${card.previous.summary}` : 'Off plan')}
          </span>
        </span>
        {target != null && kind === 'reps' && (
          <span className="tabular shrink-0 text-sm text-muted-foreground">
            {working}/{target}
          </span>
        )}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground/70 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t">
          <div className="flex flex-col gap-0.5 px-4 py-2.5 text-sm">
            {card.previous ? (
              <p className="text-muted-foreground">
                Last time <span className="tabular font-medium text-foreground">{card.previous.summary}</span> · {calendarDay(card.previous.date, today)}
              </p>
            ) : (
              <p className="text-muted-foreground">No history yet.</p>
            )}
            {card.suggestion && card.logged_sets.length === 0 && <p className="font-medium text-accent-foreground">{card.suggestion.text}</p>}
            {p?.notes && <p className="text-muted-foreground">{p.notes}</p>}
          </div>
          {card.logged_sets.length > 0 && (
            <div className="divide-y border-t">
              {card.logged_sets.map((s) => (
                <SetRow key={s.id} set={s} onClick={() => onSet(s)} />
              ))}
            </div>
          )}
          {canLog && (
            <div className={cn(card.logged_sets.length > 0 && 'border-t')}>
              {kindToggle && card.logged_sets.length === 0 && (
                <div className="flex gap-1.5 px-4 pt-3">
                  {(['reps', 'time'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => kindToggle(k)}
                      className={cn('h-9 rounded-full border px-3.5 text-sm font-medium lg:h-8', kind === k ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}
                    >
                      {k === 'reps' ? 'Weight and reps' : 'Time and distance'}
                    </button>
                  ))}
                </div>
              )}
              <SetEntry key={`${kind}:${card.logged_sets.length}`} card={card} kind={kind} pending={pending} onLog={onLog} />
            </div>
          )}
          {onRemove && card.logged_sets.length === 0 && (
            <div className="border-t px-2 py-1">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onRemove}>
                <X />
                Remove from today
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** An exercise added from the picker that has no set yet: its history comes from the progression view. */
function ExtraCard({ extra, ...rest }: { extra: Extra } & Omit<Parameters<typeof CardView>[0], 'card' | 'kind' | 'kindToggle'>) {
  const view = useView<ProgressionView>('workouts/progression', { exercise: extra.name, limit: 1 });
  const [chosen, setChosen] = useState<SetKind | null>(null);
  const card: ExerciseCard = {
    exercise_id: view.data?.exercise?.id ?? -1,
    exercise: view.data?.exercise?.name ?? extra.name,
    category: view.data?.exercise?.category ?? extra.category ?? 'strength',
    muscle_group: view.data?.exercise?.muscle_group ?? null,
    planned: null,
    logged_sets: [],
    previous: view.data?.last_session ?? null,
    suggestion: null,
    done: false,
  };
  const kind = chosen ?? setKind(card);
  // The kind is only a question for an exercise with no history to answer it.
  return <CardView {...rest} key={`${kind}:${card.previous?.session_id ?? 0}`} card={card} kind={kind} kindToggle={card.previous ? undefined : setChosen} />;
}

function RestBar() {
  const rest = useRest();
  if (!rest) return null;
  return (
    <div className="pointer-events-none sticky bottom-3 z-10 mt-1">
      <div
        role="timer"
        aria-label={rest.done ? 'Rest over' : `Rest, ${rest.remaining} seconds left`}
        className={cn('pointer-events-auto relative overflow-hidden rounded-xl border shadow-lg', rest.done ? 'border-primary bg-primary text-primary-foreground' : 'bg-popover')}
      >
        <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
          <Timer className="size-5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1">
            <span className="tabular block text-2xl leading-tight font-semibold">{rest.done ? 'Go' : fmtDuration(rest.remaining)}</span>
            <span className={cn('block truncate text-xs', rest.done ? 'opacity-80' : 'text-muted-foreground')}>{rest.done ? `Rest over · ${rest.exercise}` : `Rest · ${rest.exercise}`}</span>
          </span>
          {!rest.done && (
            <>
              <Button variant="ghost" className="tabular px-2.5" aria-label="30 seconds less" onClick={() => addRest(-30)}>
                −30
              </Button>
              <Button variant="ghost" className="tabular px-2.5" aria-label="30 seconds more" onClick={() => addRest(30)}>
                +30
              </Button>
            </>
          )}
          <Button variant={rest.done ? 'ghost' : 'secondary'} onClick={clearRest}>
            {rest.done ? 'Dismiss' : 'Skip'}
          </Button>
        </div>
        {!rest.done && (
          <div className="h-1 bg-secondary">
            <div className="h-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${(1 - rest.fraction) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ session, prs }: { session: Session; prs: string[] }) {
  const facts = sessionFacts(session);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="px-4 py-3">
        <p className="flex items-center gap-2 font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" />
          </span>
          {session.title} done
        </p>
        {facts && <p className="tabular mt-1 text-sm text-muted-foreground">{facts}</p>}
        {session.notes && <p className="mt-2 text-sm whitespace-pre-wrap">{session.notes}</p>}
        <PrLines prs={prs} className="mt-2" />
      </div>
      {session.exercises.length > 0 && (
        <ul className="divide-y border-t">
          {session.exercises.map((e) => (
            <li key={e.exercise_id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 font-medium">{e.exercise}</span>
              <span className="tabular shrink-0 text-right text-sm text-muted-foreground">{e.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrLines({ prs, className }: { prs: string[]; className?: string }) {
  if (!prs.length) return null;
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {prs.map((line) => (
        <li key={line} className="flex items-start gap-2 text-sm font-medium text-accent-foreground">
          <Trophy className="mt-0.5 size-4 shrink-0" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export function Today({ date, today, go }: { date: string | null; today: string; go: Go }) {
  const view = useView<TodayView>('workouts/today', date ? { date } : undefined);
  const data = view.data;
  const { run, pending } = useAct();
  const prs = usePrs(data?.session?.id);

  const [manual, setManual] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false); // logging into a finished session
  const [editing, setEditing] = useState<{ exercise: string; set: LoggedSet } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [details, setDetails] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [openSession, setOpenSession] = useState<number | null>(null);

  if (!data) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={4} />;

  const session = data.session;
  const status = shownStatus(data.status, data.date, today);
  const isToday = data.date === today;
  const dayWord = isToday ? 'today' : 'this day';
  const title = session?.title ?? data.plan_day?.name ?? (data.status === 'rest' ? (data.plan ? 'Rest day' : 'Nothing planned') : 'Workout');
  const movedFrom = session?.moved_from_date ?? data.plan_day?.moved_from_date ?? null;

  const names = new Set(data.exercises.map((c) => c.exercise.toLowerCase()));
  const pendingExtras = extras.filter((x) => !names.has(x.name.toLowerCase()));
  const finished = data.status === 'completed';
  const skipped = data.status === 'skipped';
  const canLog = data.date <= today && !skipped && (!finished || adding);
  const showCards = !skipped && (!finished || adding);
  const firstOpen = data.exercises.find((c) => c.planned && !c.done)?.exercise ?? (finished ? null : (data.exercises.find((c) => !c.planned)?.exercise ?? null));
  const openName = manual ?? pendingExtras.at(-1)?.name ?? firstOpen;

  const log = async (card: ExerciseCard, kind: SetKind, entry: LogEntry): Promise<boolean> => {
    primeAlert();
    const r = await run<LogResult>('workout_log', { ...logTarget(data), exercises: [entry] });
    if (!r.ok) return false;
    if (r.result.new_prs.length) addPrs(r.result.session.id, r.result.new_prs);
    const secs = restSeconds(card.planned, kind);
    if (secs) beginRest(secs, card.exercise);
    // A card that just reached its target gives way to the next one.
    const logged = card.logged_sets.filter((s) => !s.is_warmup).length + 1;
    if (!card.planned || logged >= (card.planned.target_sets ?? 1)) setManual(card.planned ? null : card.exercise);
    return true;
  };

  const cardProps = (name: string) => ({
    open: openName === name,
    canLog,
    pending,
    today,
    onToggle: () => setManual(openName === name ? '' : name),
  });

  const primary = data.workouts.find((w) => (session ? w.session_ids.includes(session.id) : w.plan_day?.id === data.plan_day?.id));
  const others = data.workouts.filter((w) => w !== primary);
  const listed = new Set(others.flatMap((w) => w.session_ids));
  const sameWorkout = data.other_sessions.filter((s) => !listed.has(s.id));

  const noPlan = !data.plan && data.status === 'rest';
  const resting = data.status === 'rest' && !pendingExtras.length;

  return (
    <div className="flex flex-col gap-4">
      {!isToday && (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted px-4 py-2 text-sm">
          <span>
            Viewing <span className="font-medium">{calendarDay(data.date, today)}</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => go('today')}>
            Back to today
          </Button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{longDate(`${data.date}T12:00:00Z`, 'UTC')}</p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[22px] leading-tight font-semibold">
            {title}
            {data.status !== 'rest' && <StatusBadge status={status} />}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              movedFrom ? `Moved from ${calendarDay(movedFrom, today)}` : '',
              data.week.planned ? `${data.week.completed} of ${data.week.planned} done this week` : '',
              data.plan_day?.notes ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {(session || data.plan_day) && !finished && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Workout options">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {!skipped && !session?.set_count && (
                <DropdownMenuItem onSelect={() => void run('workout_log', { ...logTarget(data), status: 'skipped' }, { success: 'Skipped' })}>
                  <SkipForward />
                  Skip {dayWord}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => go('week')}>
                <ArrowLeftRight />
                Move to another day
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openChat({ prefill: `About ${isToday ? 'today’s' : `the ${calendarDay(data.date, today)}`} ${title} workout: ` })}>
                <MessageCircle />
                Ask Kevin about it
              </DropdownMenuItem>
              {session && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setDiscarding(true)}>
                    <Trash2 />
                    Discard this session
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!finished && <PrLines prs={prs} />}

      {noPlan && !pendingExtras.length ? (
        <EmptyState
          icon={Dumbbell}
          title="No plan yet"
          body="A plan sets the week: which workout falls on which day, with targets that move up as you do. Kevin can build one from a sentence, or write it yourself."
          action={
            <>
              <Button onClick={() => openChat({ prefill: 'Build me a workout plan: ' })}>
                <MessageCircle />
                Ask Kevin to build a plan
              </Button>
              <Button variant="outline" onClick={() => go('plan', { edit: 'new' })}>
                <Pencil />
                Write a plan
              </Button>
              <Button variant="outline" onClick={() => setPicking(true)}>
                <Plus />
                Log a workout
              </Button>
            </>
          }
        />
      ) : resting ? (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center">
          <Moon className="mb-2 size-7 text-muted-foreground/70" strokeWidth={1.5} />
          <p className="font-medium">Nothing planned {dayWord}</p>
          <p className="text-sm text-muted-foreground">{data.next ? `Next up: ${data.next.name}, ${calendarDay(data.next.date, today).toLowerCase()}.` : 'Nothing else is planned this week.'}</p>
          {data.date <= today && (
            <Button variant="outline" className="mt-3" onClick={() => setPicking(true)}>
              <Plus />
              Log something anyway
            </Button>
          )}
        </div>
      ) : null}

      {skipped && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium">Skipped</p>
            <p className="text-sm text-muted-foreground">{data.next ? `Next up: ${data.next.name}, ${calendarDay(data.next.date, today).toLowerCase()}.` : 'It stays out of this week’s count.'}</p>
          </div>
          {session && (
            <Button variant="outline" disabled={pending} onClick={() => void run('workout_log', { session_id: session.id, status: 'planned' }, { success: 'Back on' })}>
              <RotateCcw />
              Do it after all
            </Button>
          )}
        </div>
      )}

      {finished && session && (
        <>
          <Summary session={session} prs={prs} />
          <div className="grid grid-cols-2 gap-2 @lg/page:flex @lg/page:flex-wrap">
            {!adding && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus />
                Add to this session
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setAdding(false);
                setExtras([]);
                setManual(null);
                void run('workout_log', { ...logTarget(data, true), status: 'in_progress', plan_day: 'none' });
              }}
            >
              <Dumbbell />
              Start another
            </Button>
            <Button variant="outline" onClick={() => setDetails(true)}>
              <Pencil />
              Edit details
            </Button>
            <Button variant="outline" onClick={() => setOpenSession(session.id)}>
              All sets
            </Button>
          </div>
          {adding && <p className="text-sm text-muted-foreground">Sets you log now are added to the finished session.</p>}
        </>
      )}

      {showCards && (data.exercises.length > 0 || pendingExtras.length > 0) && (
        <ul className="flex flex-col gap-2.5">
          {data.exercises.map((card) => {
            const kind = setKind(card);
            return <CardView key={card.exercise_id} card={card} kind={kind} {...cardProps(card.exercise)} onLog={(e) => log(card, kind, e)} onSet={(set) => setEditing({ exercise: card.exercise, set })} />;
          })}
          {pendingExtras.map((x) => (
            <ExtraCardHost key={x.name} extra={x} props={cardProps(x.name)} log={log} onRemove={() => setExtras((list) => list.filter((e) => e.name !== x.name))} />
          ))}
        </ul>
      )}

      {canLog && !resting && (
        <Button variant="outline" className="border-dashed" onClick={() => setPicking(true)}>
          <Plus />
          Add an exercise
        </Button>
      )}

      {data.status === 'in_progress' && session && (
        <Button size="lg" className="h-12 lg:h-11" onClick={() => setFinishing(true)}>
          <Flag />
          Finish workout
        </Button>
      )}

      {(others.length > 0 || sameWorkout.length > 0) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Also {dayWord}</h3>
          <List>
            {others.map((w, i) => {
              const sid = w.session_ids.at(-1);
              const startable = sid == null && w.plan_day && data.status !== 'in_progress' && data.date <= today;
              return (
                <ListRow
                  key={`${w.title}:${i}`}
                  title={w.title}
                  subtitle={w.plan_day?.exercises.slice(0, 4).join(', ') || (w.plan_day ? undefined : 'Outside the plan')}
                  meta={<StatusBadge status={shownStatus(w.status, data.date, today)} />}
                  onClick={sid != null ? () => setOpenSession(sid) : undefined}
                  trailing={
                    startable ? (
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => void run('workout_log', { date: data.date, plan_day: w.plan_day!.id, status: 'in_progress' })}>
                        Start
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
            {sameWorkout.map((s) => (
              <ListRow key={s.id} title={s.title} subtitle={s.exercises.map((e) => `${e.exercise} ${e.summary}`).join(' · ') || plural(s.set_count, 'set')} meta={<StatusBadge status={s.status} />} onClick={() => setOpenSession(s.id)} />
            ))}
          </List>
        </section>
      )}

      <RestBar />

      {picking && (
        <ExercisePicker
          today={today}
          exclude={[...data.exercises.map((c) => c.exercise), ...pendingExtras.map((x) => x.name)]}
          onClose={() => setPicking(false)}
          onPick={(name, known) => {
            setExtras((list) => [...list.filter((e) => e.name.toLowerCase() !== name.toLowerCase()), { name, category: known?.category ?? null }]);
            setManual(name);
            setPicking(false);
          }}
        />
      )}
      {editing && <SetSheet exercise={editing.exercise} set={editing.set} onClose={() => setEditing(null)} onChanged={() => session && dropPrs(session.id, editing.exercise)} />}
      {finishing && session && (
        <DetailsSheet
          session={session}
          finish
          onClose={() => setFinishing(false)}
          onDone={() => {
            clearRest();
            setExtras([]);
            setManual(null);
          }}
        />
      )}
      {details && session && <DetailsSheet session={session} onClose={() => setDetails(false)} />}
      {openSession != null && <SessionSheet id={openSession} today={today} onClose={() => setOpenSession(null)} />}
      {session && (
        <ConfirmDialog
          open={discarding}
          onOpenChange={setDiscarding}
          title={`Discard “${session.title}”?`}
          body={session.set_count ? `${plural(session.set_count, 'set')} logged in it will be deleted. This cannot be undone.` : 'The session is removed and the day goes back to what the plan says.'}
          confirmLabel="Discard session"
          onConfirm={() => {
            clearRest();
            setExtras([]);
            setManual(null);
            void act('workout_edit', { delete_session_id: session.id }, { success: 'Session discarded' });
          }}
        />
      )}
    </div>
  );
}

/** Binds an off-plan card's log call to the card it builds (the card only exists inside ExtraCard). */
function ExtraCardHost({ extra, props, log, onRemove }: {
  extra: Extra;
  props: { open: boolean; canLog: boolean; pending: boolean; today: string; onToggle: () => void };
  log: (card: ExerciseCard, kind: SetKind, entry: LogEntry) => Promise<boolean>;
  onRemove: () => void;
}) {
  const stub: ExerciseCard = { exercise_id: -1, exercise: extra.name, category: extra.category ?? 'strength', muscle_group: null, planned: null, logged_sets: [], previous: null, suggestion: null, done: false };
  return <ExtraCard extra={extra} {...props} onRemove={onRemove} onSet={() => undefined} onLog={(entry) => log(stub, entry.reps != null ? 'reps' : 'time', entry)} />;
}
