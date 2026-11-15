// One session in full (sets by exercise, editable), and the sheet that
// records how a session went: used to finish a workout and to correct one.
import { CalendarDays, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, ErrorState, Field, FormDialog, LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { act, useAct } from '@/lib/act';
import { calendarDay, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { fmtNum, parseNum } from './logic';
import { SetRow, SetSheet, StatusBadge } from './parts';
import type { LoggedSet, Session } from './types';

/** Minutes since the session began, when that is a plausible workout length. */
function elapsedMinutes(s: Session, now = Date.now()): number | null {
  if (s.status !== 'in_progress' || !s.started_at) return null;
  const mins = Math.round((now - Date.parse(s.started_at)) / 60_000);
  return mins >= 1 && mins <= 360 ? mins : null;
}

/**
 * Duration, how hard it felt, notes. `finish` also marks the session
 * completed; without it this edits a session's details in place.
 */
export function DetailsSheet({ session, finish = false, onClose, onDone }: { session: Session; finish?: boolean; onClose: () => void; onDone?: () => void }) {
  const [minutes, setMinutes] = useState(() => String(session.duration_minutes ?? (finish ? (elapsedMinutes(session) ?? '') : '')));
  const [effort, setEffort] = useState<number | null>(session.perceived_effort);
  const [notes, setNotes] = useState(session.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();

  const save = async () => {
    const mins = minutes.trim() ? parseNum(minutes) : undefined;
    if (mins === null || (mins != null && (!Number.isInteger(mins) || mins < 1 || mins > 1440))) return setError('Duration is a whole number of minutes.');
    const r = await run(
      'workout_log',
      {
        session_id: session.id,
        ...(finish ? { status: 'completed' } : {}),
        // Left blank when finishing, the server times the session from when logging began.
        ...(mins != null ? { duration_minutes: mins } : finish ? {} : { duration_minutes: null }),
        perceived_effort: effort,
        notes: notes.trim() || null,
      },
      { success: finish ? 'Workout finished' : 'Saved' },
    );
    if (r.ok) {
      onDone?.();
      onClose();
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={finish ? 'Finish workout' : 'Session details'}
      description={finish ? `${session.title} · ${plural(session.set_count, 'set')} logged` : `${session.title} · ${session.weekday_name}`}
      submitLabel={finish ? 'Finish workout' : 'Save'}
      pending={pending}
      onSubmit={() => void save()}
    >
      <Field label="Duration (minutes)" hint={finish && !minutes.trim() ? 'Leave empty to use the time since your first set.' : undefined}>
        {(id) => <Input id={id} value={minutes} inputMode="numeric" className="tabular" onChange={(e) => setMinutes(e.target.value)} />}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">How hard was it? {effort != null && <span className="font-normal text-muted-foreground">{effort} of 10</span>}</span>
        <div role="radiogroup" aria-label="Perceived effort, 1 to 10" className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_x, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={effort === n}
              onClick={() => setEffort(effort === n ? null : n)}
              className={cn(
                'tabular h-11 rounded-md border text-sm font-medium transition-colors lg:h-9',
                effort === n ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <Field label="Notes">{(id) => <Textarea id={id} value={notes} rows={3} placeholder="How it went" onChange={(e) => setNotes(e.target.value)} />}</Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

/** "42 min · effort 7 · 12 sets · 8,450 lb" */
export function sessionFacts(s: Session): string {
  return [
    s.duration_minutes ? `${s.duration_minutes} min` : '',
    s.perceived_effort != null ? `effort ${fmtNum(s.perceived_effort)}` : '',
    s.set_count ? plural(s.set_count, 'set') : '',
    s.volume_lbs ? `${Math.round(s.volume_lbs).toLocaleString('en-US')} lb moved` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The exercises of a session with every set; a set opens its editor when `onSet` is given. */
export function SessionSets({ session, onSet }: { session: Session; onSet?: (exercise: string, set: LoggedSet) => void }) {
  if (!session.exercises.length) return <p className="text-sm text-muted-foreground">No sets logged.</p>;
  return (
    <div className="flex flex-col gap-3">
      {session.exercises.map((e) => (
        <div key={e.exercise_id} className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1.5">
            <span className="min-w-0 font-semibold">{e.exercise}</span>
            <span className="tabular shrink-0 text-sm text-muted-foreground">{e.summary}</span>
          </div>
          <div className="divide-y border-t">{(e.sets ?? []).map((s) => <SetRow key={s.id} set={s} onClick={onSet ? () => onSet(e.exercise, s) : undefined} />)}</div>
        </div>
      ))}
    </div>
  );
}

/** A session opened from History or the week: read it, fix a set, edit its details, delete it. */
export function SessionSheet({ id, today, onClose, onOpenDay }: { id: number; today: string; onClose: () => void; onOpenDay?: (date: string) => void }) {
  const view = useView<{ session: Session | null }>('workouts/session', { id });
  const [editing, setEditing] = useState<{ exercise: string; set: LoggedSet } | null>(null);
  const [details, setDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const s = view.data?.session;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] lg:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {s?.title ?? 'Session'}
              {s && <StatusBadge status={s.status} />}
            </DialogTitle>
            <DialogDescription>{s ? [calendarDay(s.date, today), sessionFacts(s)].filter(Boolean).join(' · ') : 'Loading…'}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {view.data === undefined ? (
              view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows />
            ) : !s ? (
              <p className="py-6 text-center text-sm text-muted-foreground">This session no longer exists.</p>
            ) : (
              <>
                {s.moved_from_date && <p className="text-sm text-muted-foreground">Moved from {calendarDay(s.moved_from_date, today)}.</p>}
                {s.notes && <p className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{s.notes}</p>}
                {s.status === 'planned' || s.status === 'skipped' ? (
                  <p className="text-sm text-muted-foreground">{s.status === 'planned' ? 'Scheduled, nothing logged yet.' : 'Skipped, nothing logged.'}</p>
                ) : (
                  <SessionSets session={s} onSet={(exercise, set) => setEditing({ exercise, set })} />
                )}
              </>
            )}
          </DialogBody>
          {s && (
            <DialogFooter className="lg:justify-start">
              <Button variant="ghost" className="text-destructive lg:order-last lg:ml-auto" onClick={() => setDeleting(true)}>
                <Trash2 />
                Delete session
              </Button>
              {onOpenDay && s.date <= today && (
                <Button variant="outline" onClick={() => onOpenDay(s.date)}>
                  <CalendarDays />
                  Open this day
                </Button>
              )}
              {s.status !== 'planned' && s.status !== 'skipped' && (
                <Button variant="outline" onClick={() => setDetails(true)}>
                  <Pencil />
                  Edit details
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {editing && <SetSheet exercise={editing.exercise} set={editing.set} onClose={() => setEditing(null)} />}
      {details && s && <DetailsSheet session={s} onClose={() => setDetails(false)} />}
      {s && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete “${s.title}”?`}
          body={`${calendarDay(s.date, today)}${s.set_count ? `, ${plural(s.set_count, 'set')}` : ''}. This cannot be undone.`}
          confirmLabel="Delete session"
          onConfirm={() =>
            void act('workout_edit', { delete_session_id: s.id }, { success: 'Session deleted' }).then((r) => {
              if (r.ok) onClose();
            })
          }
        />
      )}
    </>
  );
}
