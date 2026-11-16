// The seven days of a week: what is planned, what happened, and moving a
// workout to another day of the same week.
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, RotateCcw, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, List, ListRow, LoadingRows, Meter } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAct } from '@/lib/act';
import { calendarDay, longDate } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { monthDay, moveInput, moveTargets, weekdayName, weekLabel } from './logic';
import { StatusBadge } from './parts';
import { SessionSheet } from './SessionSheet';
import type { DayWorkout, WeekAdherence, WeekDay, WeekView } from './types';

type Go = (tab: string, params?: Record<string, string>) => void;

/** "3 of 4 done · 1 skipped · 1 to go" */
export function adherenceText(a: WeekAdherence): string {
  if (!a.planned) return a.extra ? `${a.extra} unplanned ${a.extra === 1 ? 'session' : 'sessions'}` : 'Nothing planned';
  return [
    `${a.completed} of ${a.planned} done`,
    a.skipped ? `${a.skipped} skipped` : '',
    a.missed ? `${a.missed} missed` : '',
    a.remaining ? `${a.remaining} to go` : '',
    a.extra ? `${a.extra} extra` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const pending = (w: DayWorkout): boolean => w.status === 'planned' || w.status === 'missed';

function daySubtitle(d: WeekDay): string | undefined {
  const moved = d.workouts.find((w) => w.plan_day?.moved_from_date)?.plan_day?.moved_from_date;
  const done = d.sessions.filter((s) => s.set_count > 0);
  if (done.length) return [moved ? `Moved from ${weekdayName(moved)}` : '', ...done.flatMap((s) => s.exercises.map((e) => `${e.exercise} ${e.summary}`))].filter(Boolean).join(' · ');
  const names = d.workouts.flatMap((w) => w.plan_day?.exercises ?? []);
  return [moved ? `Moved from ${weekdayName(moved)}` : '', names.join(', ')].filter(Boolean).join(' · ') || undefined;
}

function DaySheet({ day, week, onClose, go }: { day: WeekDay; week: WeekView; onClose: () => void; go: Go }) {
  const { run, pending: busy } = useAct();
  const [moving, setMoving] = useState<number | null>(null);
  const [session, setSession] = useState<number | null>(null);
  const today = week.today;
  const targets = moveTargets(week.days.map((d) => d.date), day.date, today);
  const dayName = weekdayName;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{longDate(`${day.date}T12:00:00Z`, 'UTC')}</DialogTitle>
            <DialogDescription>{[Math.abs(Date.parse(day.date) - Date.parse(today)) <= 86_400_000 ? calendarDay(day.date, today) : weekLabel(week.week_start, today), day.workouts.length ? '' : 'Rest day, nothing planned'].filter(Boolean).join(' · ')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {day.workouts.map((w, i) => {
              const sessions = day.sessions.filter((s) => w.session_ids.includes(s.id));
              const planned = sessions.find((s) => s.status === 'planned');
              const canMove = pending(w) && (w.plan_day || planned) && targets.length > 0;
              return (
                <div key={`${w.title}:${i}`} className="overflow-hidden rounded-xl border bg-card">
                  <div className="px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {w.title}
                      <StatusBadge status={w.status} />
                    </p>
                    {w.plan_day?.moved_from_date && <p className="mt-0.5 text-sm text-muted-foreground">Moved from {dayName(w.plan_day.moved_from_date)}.</p>}
                    {w.plan_day && w.plan_day.exercises.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{w.plan_day.exercises.join(', ')}</p>}
                    {!w.plan_day && !sessions.length && <p className="mt-1 text-sm text-muted-foreground">Outside the plan.</p>}
                  </div>
                  {sessions.filter((s) => s.status !== 'planned').length > 0 && (
                    <ul className="divide-y border-t">
                      {sessions
                        .filter((s) => s.status !== 'planned')
                        .map((s) => (
                          <ListRow
                            key={s.id}
                            title={s.status === 'skipped' ? 'Skipped' : s.exercises.map((e) => `${e.exercise} ${e.summary}`).join(' · ') || 'No sets logged'}
                            subtitle={[s.duration_minutes ? `${s.duration_minutes} min` : '', s.notes ?? ''].filter(Boolean).join(' · ') || undefined}
                            wrap
                            onClick={() => setSession(s.id)}
                          />
                        ))}
                    </ul>
                  )}
                  {(canMove || pending(w) || (planned && w.plan_day?.moved_from_date)) && (
                    <div className="flex flex-wrap gap-2 border-t px-3 py-2.5">
                      {canMove && (
                        <Button variant="outline" size="sm" aria-expanded={moving === i} onClick={() => setMoving(moving === i ? null : i)}>
                          <ArrowLeftRight />
                          Move to another day
                        </Button>
                      )}
                      {planned && w.plan_day?.moved_from_date && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run('workout_edit', { delete_session_id: planned.id }, { success: `Back on ${dayName(w.plan_day!.moved_from_date!)}` }).then((r) => {
                              if (r.ok) onClose();
                            })
                          }
                        >
                          <RotateCcw />
                          Move back
                        </Button>
                      )}
                      {pending(w) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run('workout_log', planned ? { session_id: planned.id, status: 'skipped' } : { date: day.date, plan_day: w.plan_day?.id ?? 'none', status: 'skipped' }, { success: 'Skipped' }).then((r) => {
                              if (r.ok) onClose();
                            })
                          }
                        >
                          <SkipForward />
                          Skip
                        </Button>
                      )}
                      {moving === i && (
                        <div className="flex w-full flex-col gap-1.5 pt-1">
                          <p className="text-sm text-muted-foreground">Move {w.title} to:</p>
                          <div className="grid grid-cols-2 gap-2 @lg/page:grid-cols-3">
                            {targets.map((t) => {
                              const there = week.days.find((d) => d.date === t);
                              return (
                                <Button
                                  key={t}
                                  variant="secondary"
                                  className="h-auto min-h-11 flex-col items-start gap-0 py-1.5 whitespace-normal lg:h-auto"
                                  disabled={busy}
                                  onClick={() => {
                                    const input = moveInput(w, day.date, t);
                                    if (!input) return;
                                    void run('workout_log', input, { success: `${w.title} moved to ${dayName(t)}` }).then((r) => {
                                      if (r.ok) onClose();
                                    });
                                  }}
                                >
                                  <span>
                                    {dayName(t)} <span className="tabular font-normal text-muted-foreground">{monthDay(t)}</span>
                                  </span>
                                  <span className="text-xs font-normal text-muted-foreground">{there?.workouts.length ? `with ${there.workouts.map((x) => x.title).join(', ')}` : 'rest day'}</span>
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {day.date <= today && (
              <Button onClick={() => go('today', day.date === today ? undefined : { date: day.date })}>
                <CalendarDays />
                {day.workouts.length ? 'Open this day' : 'Log a workout'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {session != null && <SessionSheet id={session} today={today} onClose={() => setSession(null)} />}
    </>
  );
}

export function Week({ start, go }: { start: string | null; go: Go }) {
  const view = useView<WeekView>('workouts/week', start ? { start } : undefined);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const week = view.data;
  if (!week) return view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows rows={7} />;
  const a = week.adherence;
  const open = week.days.find((d) => d.date === openDate);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => go('week', { start: week.prev_week_start })}>
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="tabular font-semibold">
            {monthDay(week.week_start)} – {monthDay(week.week_end)}
          </p>
          <p className="text-sm text-muted-foreground">{weekLabel(week.week_start, week.today)}</p>
        </div>
        <Button variant="outline" size="icon" aria-label="Next week" onClick={() => go('week', { start: week.next_week_start })}>
          <ChevronRight />
        </Button>
      </div>

      <div className="rounded-xl border bg-card px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{adherenceText(a)}</p>
          {a.pct != null && <p className="tabular text-sm text-muted-foreground">{a.pct}%</p>}
        </div>
        {a.planned > 0 && <Meter className="mt-2" value={a.completed} max={a.planned} label="Workouts done this week" />}
      </div>

      <List>
        {week.days.map((d) => (
          <ListRow
            key={d.date}
            onClick={() => setOpenDate(d.date)}
            className={cn(d.is_today && 'bg-accent/40')}
            leading={
              <span className={cn('flex w-10 flex-col items-center leading-tight', d.is_today ? 'text-primary' : 'text-muted-foreground')}>
                <span className="text-xs font-medium uppercase">{d.weekday_name.slice(0, 3)}</span>
                <span className="tabular text-lg font-semibold">{Number(d.date.slice(8))}</span>
              </span>
            }
            title={d.workouts.length ? d.workouts.map((w) => w.title).join(' + ') : 'Rest'}
            subtitle={daySubtitle(d)}
            muted={!d.workouts.length}
            meta={d.status !== 'rest' ? <StatusBadge status={d.status} /> : undefined}
          />
        ))}
      </List>

      {!a.is_current && (
        <Button variant="outline" className="self-center" onClick={() => go('week')}>
          Back to this week
        </Button>
      )}

      {open && <DaySheet day={open} week={week} onClose={() => setOpenDate(null)} go={go} />}
    </div>
  );
}
