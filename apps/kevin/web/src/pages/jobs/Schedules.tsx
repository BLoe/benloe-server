import { CalendarClock, Ellipsis, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState, List, ListRow, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { act } from '@/lib/act';
import { cost, dateTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { humanizeTrigger } from '@/lib/trigger';
import type { Schedule } from '@/lib/types';
import { useView } from '@/lib/useView';
import { ScheduleForm } from './ScheduleForm';

const actionLabel = { notify: 'Reminder', check: 'Check', agent_turn: 'Kevin task' } as const;

/** Runs a job by hand and says how it went. Shared with the system jobs list. */
export async function runNow(jobKey: string, name: string): Promise<void> {
  toast.info(`Running ${name}…`);
  const r = await act<{ outcome?: string; detail?: string; note?: string }>('job_control', { job_key: jobKey, action: 'run_now' });
  if (!r.ok) return;
  const { outcome, detail, note } = r.result ?? {};
  if (note) toast.info(`${name} is already running`);
  else if (outcome === 'errored') toast.error(`${name} failed`, detail);
  else if (outcome === 'nothing-to-do') toast.info(`${name} ran: nothing to do`, { body: detail });
  else toast.success(`${name} ran`, detail);
}

/** A one-time schedule whose moment has passed. Switching it on would fire it at once, so it gets no switch. */
const isSpent = (s: Schedule, now: Date) => s.trigger_type === 'once' && !s.enabled && new Date(s.trigger_value).getTime() < now.getTime();

export function Schedules() {
  const view = useView<Schedule[]>('system/schedules');
  const now = useNow();
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  return (
    <Section
      title="Schedules"
      description="Reminders and recurring jobs, made by you or by Kevin."
      action={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus />
          New schedule
        </Button>
      }
    >
      <ViewState
        view={view}
        empty={
          <EmptyState
            icon={CalendarClock}
            title="No schedules yet"
            body="Create one here, or just tell Kevin: “remind me Sunday at 6 to take out the recycling.”"
            action={<Button onClick={() => setEditing('new')}>New schedule</Button>}
          />
        }
      >
        {(schedules) => (
          <List>
            {schedules.map((s) => {
              const spent = isSpent(s, now);
              // A one-time schedule's trigger line already says when; repeating it as "Next" adds nothing.
              const when = s.enabled && s.next_run_at ? (s.trigger_type === 'once' ? 'Waiting' : `Next ${dateTime(s.next_run_at, now)}`) : spent ? 'Finished' : 'Off';
              const last = s.last_run_at ? `Last ran ${dateTime(s.last_run_at, now)}` : 'Has not run yet';
              return (
                <ListRow
                  key={s.id}
                  muted={!s.enabled}
                  wrap
                  title={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {s.name}
                      <Badge variant="outline">{actionLabel[s.action]}</Badge>
                      {s.created_by === 'kevin' && <Badge>Made by Kevin</Badge>}
                    </span>
                  }
                  subtitle={
                    <>
                      <span className="block">{humanizeTrigger(s.trigger_type, s.trigger_value, now)}</span>
                      <span className="block">
                        {when}. {last}.
                      </span>
                      {s.action === 'agent_turn' && (
                        <span className="tabular block">
                          {cost(s.spent_this_month_usd ?? 0)} of {cost(s.spend_cap_usd ?? 0)} spent this month
                        </span>
                      )}
                    </>
                  }
                  trailing={
                    <>
                      {!spent && <Switch checked={s.enabled} aria-label={`${s.name} enabled`} onCheckedChange={(enabled) => void act('schedule_update', { id: s.id, enabled })} />}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Options for ${s.name}`}>
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => void runNow(`schedule:${s.id}`, s.name)}>
                            <Play />
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(s)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setDeleting(s)}>
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  }
                />
              );
            })}
          </List>
        )}
      </ViewState>

      {editing && <ScheduleForm key={editing === 'new' ? 'new' : editing.id} schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        body="It will stop running. Its past runs stay in the history."
        confirmLabel="Delete schedule"
        onConfirm={() => {
          if (deleting) void act('schedule_delete', { id: deleting.id }, { success: 'Schedule deleted' });
          setDeleting(null);
        }}
      />
    </Section>
  );
}
