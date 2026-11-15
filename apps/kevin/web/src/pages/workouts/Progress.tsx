// Progress: one exercise's chart and records, the record list for every
// exercise, and how many planned workouts got done over recent weeks.
import { MessageCircle, TrendingUp, Trophy } from 'lucide-react';
import { EmptyState, ErrorState, List, ListRow, LoadingRows, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { openChat } from '@/lib/chat';
import { calendarDay } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { LineChart } from './LineChart';
import { fmtDuration, fmtNum, fmtPace, monthDay } from './logic';
import { useExercises } from './parts';
import type { AdherenceView, PrRow, ProgressionView, Prs } from './types';

type Go = (tab: string, params?: Record<string, string>) => void;

const lb = (v: number): string => `${fmtNum(Math.round(v * 10) / 10)} lb`;

/** The records of one exercise as label/value pairs, only the ones that exist. */
function recordFacts(p: Prs, today: string): { label: string; value: string; when: string }[] {
  const on = (d: string) => calendarDay(d, today);
  return [
    p.weight && { label: 'Heaviest', value: `${fmtNum(p.weight.weight_lbs)} lb × ${p.weight.reps}`, when: on(p.weight.date) },
    p.e1rm && { label: 'Best estimated 1RM', value: `${fmtNum(p.e1rm.e1rm_lbs)} lb`, when: `${fmtNum(p.e1rm.weight_lbs)} × ${p.e1rm.reps}, ${on(p.e1rm.date)}` },
    p.reps && !p.distance && { label: 'Most reps', value: `${p.reps.reps}${p.reps.weight_lbs ? ` @ ${fmtNum(p.reps.weight_lbs)} lb` : ''}`, when: on(p.reps.date) },
    p.volume && { label: 'Most volume', value: `${Math.round(p.volume.volume_lbs).toLocaleString('en-US')} lb`, when: on(p.volume.date) },
    p.distance && { label: 'Longest', value: `${fmtNum(p.distance.distance_miles)} mi`, when: on(p.distance.date) },
    p.pace && { label: 'Fastest pace', value: fmtPace(p.pace.pace_seconds_per_mile), when: `${fmtNum(p.pace.distance_miles)} mi, ${on(p.pace.date)}` },
  ].filter((x): x is { label: string; value: string; when: string } => !!x);
}

function prLine(p: PrRow): string {
  return [
    p.weight ? `${fmtNum(p.weight.weight_lbs)} lb × ${p.weight.reps}` : '',
    p.e1rm ? `1RM est. ${fmtNum(p.e1rm.e1rm_lbs)} lb` : '',
    !p.weight && p.reps && !p.distance ? `${p.reps.reps} reps` : '',
    p.distance ? `${fmtNum(p.distance.distance_miles)} mi` : '',
    p.pace ? fmtPace(p.pace.pace_seconds_per_mile) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function ExerciseProgress({ id, today }: { id: number; today: string }) {
  const view = useView<ProgressionView>('workouts/progression', { exercise_id: id, limit: 60 });
  const data = view.data;
  if (!data) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={3} />;
  const s = data.series;
  if (!data.exercise || !s.length) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing logged for this exercise yet.</p>;
  const dates = s.map((p) => p.date);
  const has = (f: (p: (typeof s)[number]) => number | null) => s.some((p) => f(p) != null);
  const facts = data.prs ? recordFacts(data.prs, today) : [];
  const summary = (i: number) => s[i]?.summary ?? '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-5 rounded-xl border bg-card px-4 pt-3 pb-2">
        {has((p) => p.e1rm_lbs) ? (
          <LineChart
            dates={dates}
            format={lb}
            details={summary}
            series={[
              { label: 'Est. 1RM', tone: 'primary', values: s.map((p) => p.e1rm_lbs) },
              { label: 'Top weight', tone: 'muted', values: s.map((p) => p.top_weight_lbs) },
            ]}
          />
        ) : has((p) => p.pace_seconds_per_mile) || has((p) => p.distance_miles) ? (
          <>
            {has((p) => p.pace_seconds_per_mile) && <LineChart dates={dates} format={fmtPace} invert height={180} details={summary} series={[{ label: 'Pace', tone: 'primary', values: s.map((p) => p.pace_seconds_per_mile) }]} />}
            {has((p) => p.distance_miles) && <LineChart dates={dates} format={(v) => `${fmtNum(v)} mi`} height={180} series={[{ label: 'Distance', tone: 'primary', values: s.map((p) => p.distance_miles) }]} />}
          </>
        ) : has((p) => p.duration_seconds) ? (
          <LineChart dates={dates} format={fmtDuration} details={summary} series={[{ label: 'Time', tone: 'primary', values: s.map((p) => p.duration_seconds) }]} />
        ) : (
          <LineChart dates={dates} format={(v) => `${Math.round(v)}`} details={summary} series={[{ label: 'Total reps', tone: 'primary', values: s.map((p) => p.total_reps || null) }]} />
        )}
        {s.length === 1 && <p className="pb-2 text-sm text-muted-foreground">One session so far. The line starts with the next one.</p>}
      </div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 @2xl/page:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="rounded-xl border bg-card px-3.5 py-2.5">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="tabular font-semibold">{f.value}</dd>
              <dd className="text-xs text-muted-foreground">{f.when}</dd>
            </div>
          ))}
        </dl>
      )}
      <Button variant="outline" className="self-start" onClick={() => openChat({ prefill: `How is my ${data.exercise!.name} progressing? ` })}>
        <MessageCircle />
        Ask Kevin about {data.exercise.name}
      </Button>
    </div>
  );
}

function Adherence() {
  const view = useView<AdherenceView>('workouts/adherence', { weeks: 8 });
  const data = view.data;
  if (!data) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={2} />;
  const weeks = [...data.weeks].reverse();
  const top = Math.max(1, ...weeks.map((w) => Math.max(w.planned, w.completed + w.extra)));
  if (!weeks.some((w) => w.planned || w.extra)) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No planned workouts in the last eight weeks.</p>;
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-sm">
        <span className="tabular font-semibold">
          {data.totals.completed} of {data.totals.planned}
        </span>{' '}
        planned workouts done{data.totals.pct != null ? ` (${data.totals.pct}%)` : ''}
        {data.totals.extra ? `, plus ${data.totals.extra} extra` : ''}.
      </p>
      <ol className="mt-3 flex items-end gap-1.5" aria-label="Workouts done each week">
        {weeks.map((w) => (
          <li key={w.week_start} className="flex min-w-0 flex-1 flex-col items-center gap-1" aria-label={`Week of ${monthDay(w.week_start)}: ${w.completed} of ${w.planned} done`}>
            <span className="tabular text-xs text-muted-foreground">
              {w.completed}/{w.planned}
            </span>
            <span className="relative block h-20 w-full max-w-10">
              <span className="absolute inset-x-0 bottom-0 rounded-md bg-secondary" style={{ height: `${(w.planned / top) * 100}%`, minHeight: 3 }} />
              <span className={cn('absolute inset-x-0 bottom-0 rounded-md', w.is_current ? 'bg-primary/60' : 'bg-primary')} style={{ height: `${(Math.min(w.completed, w.planned || w.completed) / top) * 100}%` }} />
            </span>
            <span className={cn('tabular text-[11px] whitespace-nowrap', w.is_current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{w.is_current ? 'Now' : monthDay(w.week_start)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Each bar is a week, by its Monday: filled is done, pale is what was planned.</p>
    </div>
  );
}

export function Progress({ exercise, today, go }: { exercise: number | null; today: string; go: Go }) {
  const catalogue = useExercises();
  const prs = useView<{ prs: PrRow[] }>('workouts/prs');
  if (!catalogue.data) return catalogue.error ? <ErrorState message={catalogue.error} onRetry={catalogue.refetch} /> : <LoadingRows rows={5} />;
  const used = catalogue.data.exercises.filter((e) => e.session_count > 0);
  if (!used.length) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No progress to chart yet"
        body="Once sets are logged, each exercise gets a chart of its top weight and estimated one-rep max, and your records are listed here."
        action={<Button onClick={() => go('today')}>Go to today</Button>}
      />
    );
  }
  const selected = used.find((e) => e.id === exercise) ?? used[0]!;
  const byName = [...used].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-7">
      <Section
        title="Exercise"
        action={
          <Select aria-label="Exercise" value={String(selected.id)} className="w-auto max-w-[60vw] min-w-40 font-medium" onChange={(e) => go('progress', { exercise: e.target.value })}>
            {byName.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        }
      >
        <ExerciseProgress key={selected.id} id={selected.id} today={today} />
      </Section>

      <Section title="Consistency" description="The last eight weeks.">
        <Adherence />
      </Section>

      <Section title="Records">
        {prs.data ? (
          <List>
            {prs.data.prs.map((p) => (
              <ListRow
                key={p.exercise_id}
                leading={<Trophy className={cn(p.exercise_id === selected.id && 'text-primary')} />}
                title={p.exercise}
                subtitle={<span className="tabular">{prLine(p) || 'Logged'}</span>}
                meta={calendarDay((p.e1rm ?? p.weight ?? p.pace ?? p.distance ?? p.reps)?.date ?? null, today)}
                onClick={() => go('progress', { exercise: String(p.exercise_id) })}
              />
            ))}
          </List>
        ) : prs.error ? (
          <ErrorState message={prs.error} onRetry={prs.refetch} />
        ) : (
          <LoadingRows />
        )}
      </Section>
    </div>
  );
}
