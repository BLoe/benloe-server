// Pieces shared by the Workouts tabs: status badges, the stepper boxes a set
// is entered with, the sheet that edits a logged set, and the exercise picker.
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Field, FormDialog } from '@/components/page';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAct } from '@/lib/act';
import { calendarDay } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { fmtDuration, fmtNum, isKnownExercise, searchExercises, setPatch, setText, step, stepDuration, type SetDraft, type SetKind } from './logic';
import type { CatalogueExercise, DayStatus, LoggedSet } from './types';

const STATUS: Record<DayStatus, { label: string; variant: BadgeVariant }> = {
  rest: { label: 'Rest', variant: 'outline' },
  planned: { label: 'Planned', variant: 'neutral' },
  in_progress: { label: 'In progress', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'outline' },
  missed: { label: 'Missed', variant: 'danger' },
};

export function StatusBadge({ status, className }: { status: DayStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} className={className}>
      {s.label}
    </Badge>
  );
}

/**
 * A number box with a button either side, sized for a thumb: 48px tall, the
 * buttons 48px wide. Typing replaces the value (the text is selected on focus).
 */
export function Stepper({ label, value, onChange, onStep, inputMode = 'decimal', placeholder, less, more }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (dir: -1 | 1) => void;
  inputMode?: 'decimal' | 'numeric' | 'text';
  placeholder?: string;
  /** Accessible names of the two buttons: "5 lb less", "5 lb more". */
  less: string;
  more: string;
}) {
  const id = useId();
  const btn = 'grid w-12 shrink-0 place-items-center text-muted-foreground hover:bg-muted active:bg-secondary [&_svg]:size-5';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex h-12 items-stretch overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <button type="button" className={btn} aria-label={less} onClick={() => onStep(-1)}>
          <Minus />
        </button>
        <input
          id={id}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          enterKeyHint="done"
          autoComplete="off"
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(e.target.value)}
          className="tabular w-full min-w-0 border-x bg-transparent text-center !text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
        />
        <button type="button" className={btn} aria-label={more} onClick={() => onStep(1)}>
          <Plus />
        </button>
      </div>
    </div>
  );
}

/** The two boxes of a set: weight and reps, or distance and time. */
export function SetFields({ kind, draft, onChange }: { kind: SetKind; draft: SetDraft; onChange: (d: SetDraft) => void }) {
  if (kind === 'reps') {
    return (
      <>
        <Stepper label="Weight (lb)" value={draft.weight} placeholder="BW" less="5 lb less" more="5 lb more" onChange={(weight) => onChange({ ...draft, weight })} onStep={(d) => onChange({ ...draft, weight: step(draft.weight, d * 5) })} />
        <Stepper label="Reps" value={draft.reps} inputMode="numeric" less="1 rep less" more="1 rep more" onChange={(reps) => onChange({ ...draft, reps })} onStep={(d) => onChange({ ...draft, reps: step(draft.reps, d) })} />
      </>
    );
  }
  return (
    <>
      <Stepper label="Distance (mi)" value={draft.distance} placeholder="—" less="Quarter mile less" more="Quarter mile more" onChange={(distance) => onChange({ ...draft, distance })} onStep={(d) => onChange({ ...draft, distance: step(draft.distance, d * 0.25) })} />
      <Stepper label="Time (min:sec)" value={draft.duration} inputMode="text" placeholder="—" less="1 minute less" more="1 minute more" onChange={(duration) => onChange({ ...draft, duration })} onStep={(d) => onChange({ ...draft, duration: stepDuration(draft.duration, d * 60) })} />
    </>
  );
}

/** Edit or delete one logged set. */
export function SetSheet({ exercise, set, onClose, onChanged }: { exercise: string; set: LoggedSet; onClose: () => void; /** Called after the set was saved or deleted. */ onChanged?: () => void }) {
  const kind: SetKind = set.reps != null ? 'reps' : 'time';
  const [draft, setDraft] = useState<SetDraft>({
    weight: set.weight_lbs != null ? fmtNum(set.weight_lbs) : '',
    reps: set.reps != null ? String(set.reps) : '',
    duration: set.duration_seconds != null ? fmtDuration(set.duration_seconds) : '',
    distance: set.distance_miles != null ? fmtNum(set.distance_miles) : '',
  });
  const [rpe, setRpe] = useState(set.rpe != null ? fmtNum(set.rpe) : '');
  const [warmup, setWarmup] = useState(set.is_warmup);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();

  const save = async () => {
    const r = setPatch(set.id, kind, draft, { rpe, warmup });
    if ('error' in r) return setError(r.error);
    const res = await run('workout_edit', { update_sets: [r.patch] }, { success: 'Set updated' });
    if (!res.ok) return;
    onChanged?.();
    onClose();
  };
  const remove = async () => {
    const res = await run('workout_edit', { delete_set_ids: [set.id] }, { success: 'Set deleted' });
    if (!res.ok) return;
    onChanged?.();
    onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${exercise}, set ${set.set_number}`}
      pending={pending}
      onSubmit={() => void save()}
      extraAction={
        <Button variant="ghost" className="w-full text-destructive lg:w-auto" disabled={pending} onClick={() => void remove()}>
          <Trash2 />
          Delete set
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <SetFields kind={kind} draft={draft} onChange={setDraft} />
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Effort (RPE 1–10)">{(id) => <Input id={id} value={rpe} inputMode="decimal" placeholder="Optional" onChange={(e) => setRpe(e.target.value)} />}</Field>
        <label className="flex h-11 items-center justify-between gap-3 rounded-md border px-3 lg:h-9">
          <span className="text-sm font-medium">Warmup</span>
          <Switch checked={warmup} onCheckedChange={setWarmup} />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

/** The exercise catalogue, most recently used first. */
export function useExercises() {
  return useView<{ exercises: CatalogueExercise[] }>('workouts/exercises');
}

/**
 * Choose an exercise from the catalogue by typing a few letters, or add a new
 * name. `exclude` hides ones already on screen.
 */
export function ExercisePicker({ title = 'Add an exercise', exclude = [], today, onPick, onClose }: {
  title?: string;
  exclude?: string[];
  today: string;
  onPick: (name: string, known: CatalogueExercise | null) => void;
  onClose: () => void;
}) {
  const view = useExercises();
  const [q, setQ] = useState('');
  const all = useMemo(() => {
    const skip = new Set(exclude.map((n) => n.toLowerCase()));
    return (view.data?.exercises ?? []).filter((e) => !skip.has(e.name.toLowerCase()));
  }, [view.data, exclude]);
  const hits = searchExercises(all, q, 40);
  const typed = q.trim();
  const canAdd = typed.length > 0 && !isKnownExercise(view.data?.exercises ?? [], typed);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[85dvh] lg:h-[70vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Search the exercises you have used, or add a new one.</DialogDescription>
          <div className="relative pt-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              autoFocus
              placeholder="Search or type a new name"
              className="pl-9"
              autoCapitalize="words"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (hits.length === 1 && hits[0]) onPick(hits[0].name, hits[0]);
                else if (canAdd) onPick(typed, null);
              }}
            />
          </div>
        </DialogHeader>
        <DialogBody className="px-2 pb-4">
          <ul>
            {canAdd && (
              <PickRow onClick={() => onPick(typed, null)} title={`Add “${typed}”`} subtitle="A new exercise" leading={<Plus className="size-4 text-primary" />} />
            )}
            {hits.map((e) => (
              <PickRow
                key={e.id}
                onClick={() => onPick(e.name, e)}
                title={e.name}
                subtitle={[e.muscle_group?.replace('_', ' ') ?? e.category, e.last_date ? `last ${calendarDay(e.last_date, today).toLowerCase()}` : 'not logged yet'].join(' · ')}
              />
            ))}
          </ul>
          {!hits.length && !canAdd && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{view.data ? 'Type a name to add your first exercise.' : 'Loading…'}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function PickRow({ title, subtitle, leading, onClick }: { title: string; subtitle: string; leading?: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted active:bg-secondary">
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>
        </span>
      </button>
    </li>
  );
}

/** A row of a logged set: its number, what was done, and marks for warmup and effort. Tap to edit. */
export function SetRow({ set, onClick, className }: { set: LoggedSet; onClick?: () => void; className?: string }) {
  const text = setText(set);
  const body = (
    <>
      <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-muted-foreground">{set.set_number}</span>
      <span className="tabular min-w-0 flex-1 font-medium">{text}</span>
      {set.is_warmup && <Badge variant="outline">Warmup</Badge>}
      {set.rpe != null && <span className="tabular text-sm text-muted-foreground">RPE {fmtNum(set.rpe)}</span>}
    </>
  );
  const cls = cn('flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left', className);
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`Edit set ${set.set_number}: ${text}`} className={cn(cls, 'hover:bg-muted active:bg-secondary')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
