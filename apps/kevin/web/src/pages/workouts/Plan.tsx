// The plan: the active one read as a week, the other plans, and the editor
// that saves a whole plan through workout_plan_save.
import { Archive, ArrowDown, ArrowUp, CircleCheck, ClipboardList, Ellipsis, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Chips, ConfirmDialog, EmptyState, ErrorState, Field, FieldRow, FormDialog, List, ListRow, LoadingRows, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { act, useAct } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { calendarDay, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import {
  WEEK, WEEKDAY_LABEL, dayPhrase, draftTarget, emptyExercise, emptyPlan, exerciseError, moveDay, moveItem, planDraft, planInput, sortDays,
  type DayDraft, type ExerciseDraft, type PlanDraft, type SetKind,
} from './logic';
import { useExercises } from './parts';
import type { Plan as PlanT, PlanSummary, PlanView, WeekdayKey } from './types';

type Go = (tab: string, params?: Record<string, string>) => void;

const REST_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240, 300];
const restLabel = (s: number): string => (s % 60 ? `${s} sec` : `${s / 60} min`);

// ---- reading -----------------------------------------------------------------------

function PlanDays({ plan }: { plan: PlanT }) {
  const rest = WEEK.filter((k) => !plan.days.some((d) => d.weekday_key === k));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 @2xl/page:grid-cols-2">
        {plan.days.map((d) => (
          <div key={d.id} className="overflow-hidden rounded-xl border bg-card">
            <div className="px-4 pt-3 pb-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{d.weekday_name}</p>
              <p className="text-[17px] leading-tight font-semibold">{d.name}</p>
              {d.notes && <p className="mt-1 text-sm text-muted-foreground">{d.notes}</p>}
            </div>
            {d.exercises.length ? (
              <ul className="divide-y border-t">
                {d.exercises.map((x) => (
                  <li key={x.id} className="px-4 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-medium">{x.exercise}</span>
                      <span className="tabular shrink-0 text-right text-sm">{x.target || '—'}</span>
                    </div>
                    {(x.rest_seconds || x.notes) && <p className="text-sm text-muted-foreground">{[x.rest_seconds ? `rest ${restLabel(x.rest_seconds)}` : '', x.notes ?? ''].filter(Boolean).join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t px-4 py-2.5 text-sm text-muted-foreground">No exercises listed.</p>
            )}
          </div>
        ))}
      </div>
      {rest.length > 0 && <p className="text-sm text-muted-foreground">Rest: {rest.map((k) => WEEKDAY_LABEL[k]).join(', ')}.</p>}
    </div>
  );
}

function PlanMenu({ plan, go, onDelete }: { plan: PlanSummary; go: Go; onDelete: () => void }) {
  const change = (action: string, success: string) => void act('workout_edit', { plan: { plan_id: plan.id, action } }, { success });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Options for ${plan.name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => go('plan', { edit: String(plan.id) })}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {plan.is_active ? (
          <DropdownMenuItem onSelect={() => change('deactivate', 'No plan is active now')}>
            <CircleCheck />
            Stop following it
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => change('activate', `Now following ${plan.name}`)}>
            <CircleCheck />
            Make it the active plan
          </DropdownMenuItem>
        )}
        {!plan.archived && (
          <DropdownMenuItem onSelect={() => change('archive', 'Archived')}>
            <Archive />
            Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlanRead({ today, go }: { today: string; go: Go }) {
  const [archived, setArchived] = useState(false);
  const view = useView<PlanView>('workouts/plan', archived ? { include_archived: 1 } : undefined);
  const [deleting, setDeleting] = useState<PlanSummary | null>(null);
  const data = view.data;
  if (!data) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={5} />;
  const plan = data.plan;
  const active = data.plans.find((p) => p.is_active);
  const others = data.plans.filter((p) => !p.is_active);

  return (
    <div className="flex flex-col gap-6">
      {plan && active ? (
        <Section
          title={plan.name}
          description={[plan.goal, plan.active_from ? `Following since ${dayPhrase(calendarDay(plan.active_from, today))}` : ''].filter(Boolean).join(' · ') || undefined}
          action={
            <>
              <Button variant="outline" size="sm" onClick={() => go('plan', { edit: String(plan.id) })}>
                <Pencil />
                Edit
              </Button>
              <PlanMenu plan={active} go={go} onDelete={() => setDeleting(active)} />
            </>
          }
        >
          {plan.notes && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{plan.notes}</p>}
          <PlanDays plan={plan} />
        </Section>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={others.length ? 'No plan is active' : 'No plan yet'}
          body={others.length ? 'Pick one of your plans below to follow it, or start a new one.' : 'A plan is the week’s schedule: a workout for each training day, with targets. Tell Kevin what you want, or write it yourself.'}
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
            </>
          }
        />
      )}

      {plan && active && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openChat({ prefill: `Change my ${plan.name} plan: ` })}>
            <MessageCircle />
            Ask Kevin to change it
          </Button>
          <Button variant="outline" onClick={() => go('plan', { edit: 'new' })}>
            <Plus />
            New plan
          </Button>
        </div>
      )}

      {(others.length > 0 || archived) && (
        <Section
          title="Other plans"
          action={
            <Button variant="ghost" size="sm" onClick={() => setArchived(!archived)}>
              {archived ? 'Hide archived' : 'Show archived'}
            </Button>
          }
        >
          {others.length ? (
            <List>
              {others.map((p) => (
                <ListRow
                  key={p.id}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {p.name}
                      {p.archived && <Badge variant="outline">Archived</Badge>}
                    </span>
                  }
                  subtitle={[plural(p.day_count, 'day'), p.goal ?? ''].filter(Boolean).join(' · ')}
                  onClick={() => go('plan', { edit: String(p.id) })}
                  trailing={<PlanMenu plan={p} go={go} onDelete={() => setDeleting(p)} />}
                />
              ))}
            </List>
          ) : (
            <p className="text-sm text-muted-foreground">No other plans.</p>
          )}
        </Section>
      )}
      {!others.length && !archived && data.plans.length > 0 && (
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setArchived(true)}>
          Show archived plans
        </Button>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete “${deleting.name}”?`}
          body={`The plan and its ${plural(deleting.day_count, 'day')} are removed. Sessions you logged are kept.${deleting.is_active ? ' It is your active plan, so the week will show no schedule.' : ''}`}
          confirmLabel="Delete plan"
          onConfirm={() => void act('workout_edit', { plan: { plan_id: deleting.id, action: 'delete' } }, { success: 'Plan deleted' })}
        />
      )}
    </div>
  );
}

// ---- editing ------------------------------------------------------------------------

function ExerciseDialog({ initial, isNew, onSave, onDelete, onClose }: { initial: ExerciseDraft; isNew: boolean; onSave: (x: ExerciseDraft) => void; onDelete: () => void; onClose: () => void }) {
  const [x, setX] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const catalogue = useExercises().data?.exercises ?? [];
  const set = (patch: Partial<ExerciseDraft>) => setX((cur) => ({ ...cur, ...patch }));
  const rest = Number(x.rest);
  const restChoices = x.rest && !REST_CHOICES.includes(rest) && Number.isFinite(rest) ? [...REST_CHOICES, rest].sort((a, b) => a - b) : REST_CHOICES;

  const setKindTo = (kind: SetKind) => set(kind === x.kind ? {} : kind === 'reps' ? { kind, sets: x.sets || '3', reps: x.reps || '8-12', rest: x.rest || '90' } : { kind, sets: x.sets === '3' ? '' : x.sets, rest: x.rest === '90' ? '' : x.rest });
  // A catalogue exercise that is not a lift starts as time and distance.
  const matchKind = () => {
    if (!isNew) return;
    const hit = catalogue.find((e) => e.name.toLowerCase() === x.exercise.trim().toLowerCase());
    if (hit && hit.category !== 'strength' && x.kind === 'reps' && !x.weight) setKindTo('time');
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Add exercise' : 'Edit exercise'}
      submitLabel={isNew ? 'Add' : 'Done'}
      onSubmit={() => {
        const err = exerciseError(x);
        if (err) return setError(err);
        onSave({ ...x, exercise: x.exercise.trim() });
      }}
      extraAction={
        !isNew && (
          <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={onDelete}>
            <Trash2 />
            Remove
          </Button>
        )
      }
    >
      <Field label="Exercise">
        {(id) => (
          <>
            <Input id={id} value={x.exercise} list={`${id}-names`} autoFocus={isNew} autoComplete="off" autoCapitalize="words" maxLength={80} placeholder="Bench Press" onChange={(e) => set({ exercise: e.target.value })} onBlur={matchKind} />
            <datalist id={`${id}-names`}>
              {catalogue.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Chips value={x.kind} onChange={setKindTo} className="!mx-0 !px-0" options={[{ value: 'reps', label: 'Sets and reps' }, { value: 'time', label: 'Time and distance' }]} />
      {x.kind === 'reps' ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Sets">{(id) => <Input id={id} value={x.sets} inputMode="numeric" className="tabular" onChange={(e) => set({ sets: e.target.value })} />}</Field>
          <Field label="Reps">{(id) => <Input id={id} value={x.reps} inputMode="text" className="tabular" placeholder="5 or 8-12" onChange={(e) => set({ reps: e.target.value })} />}</Field>
          <Field label="Weight (lb)">{(id) => <Input id={id} value={x.weight} inputMode="decimal" className="tabular" placeholder="Start" onChange={(e) => set({ weight: e.target.value })} />}</Field>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Distance (mi)">{(id) => <Input id={id} value={x.distance} inputMode="decimal" className="tabular" onChange={(e) => set({ distance: e.target.value })} />}</Field>
          <Field label="Time">{(id) => <Input id={id} value={x.duration} inputMode="text" className="tabular" placeholder="30:00" onChange={(e) => set({ duration: e.target.value })} />}</Field>
          <Field label="Rounds">{(id) => <Input id={id} value={x.sets} inputMode="numeric" className="tabular" placeholder="1" onChange={(e) => set({ sets: e.target.value })} />}</Field>
        </div>
      )}
      {x.kind === 'reps' && <p className="-mt-2 text-sm text-muted-foreground">With a range, reaching the top on every set earns the next weight. The starting weight only matters until there is history.</p>}
      <Field label="Rest between sets">
        {(id) => (
          <Select id={id} value={x.rest} onChange={(e) => set({ rest: e.target.value })}>
            <option value="">None</option>
            {restChoices.map((s) => (
              <option key={s} value={String(s)}>
                {restLabel(s)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Notes">{(id) => <Input id={id} value={x.notes} maxLength={500} placeholder="Form cues, tempo, equipment" onChange={(e) => set({ notes: e.target.value })} />}</Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

function DayEditor({ day, taken, onChange, onMove, onRemove }: { day: DayDraft; taken: WeekdayKey[]; onChange: (d: DayDraft) => void; onMove: (to: WeekdayKey) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState<{ index: number; draft: ExerciseDraft } | null>(null);
  const label = WEEKDAY_LABEL[day.weekday];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <Select aria-label={`Weekday of ${day.name || label}`} value={day.weekday} className="h-10 w-auto min-w-36 font-medium lg:h-8" onChange={(e) => onMove(e.target.value as WeekdayKey)}>
            {WEEK.map((k) => (
              <option key={k} value={k}>
                {WEEKDAY_LABEL[k]}
                {k !== day.weekday && taken.includes(k) ? ' (swap)' : ''}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onRemove}>
            <Trash2 />
            Make it a rest day
          </Button>
        </div>
        <Input aria-label={`${label} workout name`} value={day.name} maxLength={60} placeholder="Name: Push, Legs, Long run" className="font-semibold" onChange={(e) => onChange({ ...day, name: e.target.value })} />
      </div>
      {day.exercises.length > 0 && (
        <ul className="divide-y border-t">
          {day.exercises.map((x, i) => (
            <ListRow
              key={x.key}
              title={x.exercise}
              subtitle={[draftTarget(x), x.rest ? `rest ${restLabel(Number(x.rest))}` : '', x.notes].filter(Boolean).join(' · ') || 'No target'}
              onClick={() => setEditing({ index: i, draft: x })}
              trailing={
                <>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${x.exercise} up`} disabled={i === 0} onClick={() => onChange({ ...day, exercises: moveItem(day.exercises, i, -1) })}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${x.exercise} down`} disabled={i === day.exercises.length - 1} onClick={() => onChange({ ...day, exercises: moveItem(day.exercises, i, 1) })}>
                    <ArrowDown />
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      )}
      <div className="border-t px-2 py-1.5">
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => setEditing({ index: -1, draft: emptyExercise() })}>
          <Plus />
          Add exercise
        </Button>
      </div>
      {editing && (
        <ExerciseDialog
          initial={editing.draft}
          isNew={editing.index < 0}
          onClose={() => setEditing(null)}
          onDelete={() => {
            onChange({ ...day, exercises: day.exercises.filter((_x, i) => i !== editing.index) });
            setEditing(null);
          }}
          onSave={(x) => {
            onChange({ ...day, exercises: editing.index < 0 ? [...day.exercises, x] : day.exercises.map((old, i) => (i === editing.index ? x : old)) });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditorForm({ initial, go }: { initial: PlanDraft; go: Go }) {
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { run, pending } = useAct();
  const change = (patch: Partial<PlanDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setError(null);
  };
  const taken = draft.days.map((d) => d.weekday);

  const save = async () => {
    const r = planInput(draft);
    if ('error' in r) return setError(r.error);
    const res = await run('workout_plan_save', r.input, { success: draft.plan_id == null ? 'Plan created' : 'Plan saved' });
    if (res.ok) go('plan');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[19px] leading-tight font-semibold">{draft.plan_id == null ? 'New plan' : 'Edit plan'}</h2>
        <Button variant="outline" size="sm" onClick={() => openChat({ prefill: draft.plan_id == null ? 'Build me a workout plan: ' : `Change my ${draft.name} plan: ` })}>
          <MessageCircle />
          Ask Kevin instead
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <FieldRow>
          <Field label="Name">{(id) => <Input id={id} value={draft.name} maxLength={80} placeholder="4-day strength" onChange={(e) => change({ name: e.target.value })} />}</Field>
          <Field label="Goal">{(id) => <Input id={id} value={draft.goal} maxLength={300} placeholder="Bench 225 by March" onChange={(e) => change({ goal: e.target.value })} />}</Field>
        </FieldRow>
        <Field label="Notes">{(id) => <Textarea id={id} value={draft.notes} rows={2} maxLength={2000} onChange={(e) => change({ notes: e.target.value })} />}</Field>
        {draft.plan_id == null && (
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2">
            <span>
              <span className="block font-medium">Start following it now</span>
              <span className="block text-sm text-muted-foreground">It replaces the active plan; the old one is kept.</span>
            </span>
            <Switch checked={draft.activate} onCheckedChange={(activate) => change({ activate })} />
          </label>
        )}
      </div>

      <Section title="The week" description="One workout per training day. Days you leave out are rest days.">
        <div className="flex flex-col gap-2.5">
          {WEEK.map((k) => {
            const day = draft.days.find((d) => d.weekday === k);
            if (!day) {
              return (
                <div key={k} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-1">
                  <span className="text-muted-foreground">
                    {WEEKDAY_LABEL[k]} <span className="text-sm">· rest</span>
                  </span>
                  <Button variant="ghost" size="sm" className="text-primary" aria-label={`Add a workout on ${WEEKDAY_LABEL[k]}`} onClick={() => change({ days: sortDays([...draft.days, { weekday: k, name: '', notes: '', exercises: [] }]) })}>
                    <Plus />
                    Add workout
                  </Button>
                </div>
              );
            }
            return (
              <DayEditor
                key={k}
                day={day}
                taken={taken}
                onChange={(d) => change({ days: draft.days.map((old) => (old.weekday === k ? d : old)) })}
                onMove={(to) => change({ days: moveDay(draft.days, k, to) })}
                onRemove={() => change({ days: draft.days.filter((d) => d.weekday !== k) })}
              />
            );
          })}
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background px-4 py-3 lg:-mx-8 lg:px-8">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2 @lg/page:justify-end">
          <Button variant="outline" className="flex-1 @lg/page:flex-none" onClick={() => (dirty ? setLeaving(true) : go('plan'))}>
            Cancel
          </Button>
          <Button className="flex-1 @lg/page:flex-none" disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : draft.plan_id == null ? 'Create plan' : 'Save plan'}
          </Button>
        </div>
      </div>

      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title="Discard your changes?" body="The plan stays as it was." confirmLabel="Discard" onConfirm={() => go('plan')} />
    </div>
  );
}

function PlanEditor({ edit, go }: { edit: string; go: Go }) {
  const isNew = edit === 'new';
  const view = useView<PlanView>('workouts/plan', { id: isNew ? 0 : edit }, { enabled: !isNew });
  // The draft starts from the plan as first loaded; a refetch mid-edit must not reset what was typed.
  const [loaded, setLoaded] = useState<PlanT | null>(null);
  if (!isNew && !loaded && view.data?.plan) setLoaded(view.data.plan);
  if (isNew) return <EditorForm initial={emptyPlan()} go={go} />;
  if (loaded) return <EditorForm key={loaded.id} initial={planDraft(loaded)} go={go} />;
  if (view.data && !view.data.plan) {
    return (
      <EmptyState
        title="That plan no longer exists"
        action={
          <Button variant="outline" onClick={() => go('plan')}>
            Back to plans
          </Button>
        }
      />
    );
  }
  return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={5} />;
}

export function Plan({ edit, today, go }: { edit: string | null; today: string; go: Go }) {
  return edit ? <PlanEditor key={edit} edit={edit} go={go} /> : <PlanRead today={today} go={go} />;
}
