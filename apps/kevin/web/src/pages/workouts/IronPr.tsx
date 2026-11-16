// IRON PR is the separate app where Ben logs lifts with his trainer. Kevin
// holds a read-only copy; this file shows it. Nothing here writes, and the
// only way offered to change those lifts is the link to IRON PR itself.
import { ExternalLink, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { List, ListRow, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { openChat } from '@/lib/chat';
import { ago, plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { linePath, points } from './chart';
import { LineChart } from './LineChart';
import { fmtNum, matchLift, recordLine, shortDay, trainerLine } from './logic';

export interface IronEntry {
  date: string;
  weight_lbs: number;
  reps: number;
  one_rm_lbs: number;
}

export interface IronExercise {
  id: string;
  name: string;
  entries: number;
  best_weight_lbs: number | null;
  best_reps: number | null;
  best_date: string | null;
  best_one_rm_lbs: number | null;
  last_weight_lbs: number | null;
  last_reps: number | null;
  last_date: string | null;
  first_date: string | null;
  /** Oldest first. */
  history: IronEntry[];
}

export interface IronOverview {
  available: boolean;
  error: string | null;
  synced_at: string | null;
  app_url: string;
  totals: { exercises: number; entries: number; first_date: string | null; last_date: string | null };
  /** Most recently trained first. */
  exercises: IronExercise[];
  recent_prs: { exercise: string; date: string; weight_lbs: number; previous_weight_lbs: number | null }[];
}

/** The mirror, refetched when the server says `ironpr` changed. */
export function useIronPr() {
  return useView<IronOverview>('ironpr/overview');
}

/** One muted line under an exercise of Kevin's when IRON PR has the same lift. Renders nothing otherwise. */
export function TrainerLine({ name, iron, today, className }: { name: string; iron: IronOverview | undefined; today: string; className?: string }) {
  const hit = iron ? matchLift(name, iron.exercises.filter((e) => e.entries > 0)) : undefined;
  const line = hit ? trainerLine(hit, today) : null;
  return line ? <p className={className ?? 'tabular text-sm text-muted-foreground'}>{line}</p> : null;
}

/** The weight history as a line a few dozen pixels wide: the shape, not the numbers. */
function Sparkline({ history }: { history: IronEntry[] }) {
  const w = 64;
  const h = 24;
  const values = history.map((e) => e.weight_lbs);
  if (values.length < 2) return <span className="block w-16" aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = points(values, { min: lo === hi ? lo - 1 : lo, max: lo === hi ? hi + 1 : hi, ticks: [] }, { left: 3, top: 3, width: w - 6, height: h - 6 });
  const end = pts.at(-1)!;
  return (
    <svg width={w} height={h} aria-hidden="true" className="block shrink-0">
      <path d={linePath(pts)} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-primary" />
      <circle cx={end.x} cy={end.y} r="2.5" className="fill-primary" />
    </svg>
  );
}

function ExerciseSheet({ x, appUrl, today, onClose }: { x: IronExercise; appUrl: string; today: string; onClose: () => void }) {
  const newest = [...x.history].reverse();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] lg:max-w-xl">
        <DialogHeader>
          <DialogTitle>{x.name}</DialogTitle>
          <DialogDescription>
            {plural(x.entries, 'lift')} with your trainer{x.first_date ? ` since ${shortDay(x.first_date, today)}` : ''}. A read-only copy from IRON PR.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card px-4 pt-3 pb-2">
            <LineChart
              dates={x.history.map((e) => e.date)}
              format={(v) => `${fmtNum(Math.round(v * 10) / 10)} lb`}
              details={(i) => (x.history[i] ? `${fmtNum(x.history[i].weight_lbs)} lb × ${x.history[i].reps}` : '')}
              height={190}
              series={[
                { label: 'Weight', tone: 'primary', values: x.history.map((e) => e.weight_lbs) },
                { label: 'Est. 1RM', tone: 'muted', values: x.history.map((e) => e.one_rm_lbs) },
              ]}
            />
          </div>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {newest.map((e, i) => (
              <li key={`${e.date}:${i}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-1.5">
                <span className="tabular font-medium">
                  {fmtNum(e.weight_lbs)} lb × {e.reps}
                  {e.weight_lbs === x.best_weight_lbs && e.date === x.best_date && <span className="ml-2 text-xs font-normal text-accent-foreground">best</span>}
                </span>
                <span className="tabular text-sm text-muted-foreground">
                  {e.reps > 1 ? `1RM est. ${fmtNum(Math.round(e.one_rm_lbs))} lb · ` : ''}
                  {shortDay(e.date, today)}
                </span>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button asChild variant="outline">
            <a href={appUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Open IRON PR
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The trainer's log on the Progress tab. Hidden while loading and when IRON PR holds no lifts. */
export function IronPrSection({ today }: { today: string }) {
  const view = useIronPr();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const data = view.data;
  if (!data) return null;
  if (!data.available) {
    return (
      <Section title="With your trainer">
        <p className="text-sm text-muted-foreground">IRON PR can’t be read right now{data.error ? `: ${data.error}` : ''}.</p>
      </Section>
    );
  }
  if (!data.totals.entries) return null;
  const lifted = data.exercises.filter((e) => e.entries > 0);
  const shown = all ? lifted : lifted.slice(0, 8);
  const t = data.totals;
  const picked = lifted.find((e) => e.id === open);
  const link = (
    <Button asChild variant="outline" size="sm">
      <a href={data.app_url} target="_blank" rel="noopener noreferrer">
        <ExternalLink />
        Open IRON PR
      </a>
    </Button>
  );

  return (
    <Section title="With your trainer" description="From IRON PR, where those sessions are logged." action={link}>
      <p className="text-sm">
        <span className="tabular font-semibold">{plural(t.entries, 'lift')}</span> across {plural(lifted.length, 'exercise')}
        {t.first_date ? ` since ${shortDay(t.first_date, today)}` : ''}
        {t.last_date ? `, last on ${shortDay(t.last_date, today)}` : ''}.
      </p>
      <List>
        {shown.map((x) => (
          <ListRow
            key={x.id}
            title={x.name}
            subtitle={
              <span className="tabular">
                Best {fmtNum(x.best_weight_lbs ?? 0)} lb × {x.best_reps ?? 1} · last {fmtNum(x.last_weight_lbs ?? 0)} × {x.last_reps ?? 1}, {x.last_date ? shortDay(x.last_date, today) : ''}
              </span>
            }
            trailing={<Sparkline history={x.history} />}
            onClick={() => setOpen(x.id)}
          />
        ))}
      </List>
      {lifted.length > 8 && (
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${lifted.length} exercises`}
        </Button>
      )}

      {data.recent_prs.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Recent records with your trainer</h3>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {data.recent_prs.slice(0, 6).map((r, i) => (
              <li key={`${r.exercise}:${r.date}:${i}`} className="tabular px-4 py-2.5 text-sm">
                {recordLine(r, today)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button variant="outline" onClick={() => openChat({ prefill: 'Compare my trainer lifts in IRON PR with what I’ve logged here and tell me what to work on.' })}>
          <MessageCircle />
          Ask Kevin to compare
        </Button>
        <p className="text-xs text-muted-foreground">Read-only copy{data.synced_at ? `, updated ${ago(data.synced_at)}` : ''}. Log or change these lifts in IRON PR.</p>
      </div>

      {picked && <ExerciseSheet x={picked} appUrl={data.app_url} today={today} onClose={() => setOpen(null)} />}
    </Section>
  );
}
