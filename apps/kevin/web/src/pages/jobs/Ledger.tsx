import { History } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, List, ListRow, Section, ViewState } from '@/components/page';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cost, dateTime, duration } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { JobRun, Outcome, Schedule, SystemJob } from '@/lib/types';
import { useView } from '@/lib/useView';

const outcomes: Record<Outcome | 'running', { label: string; variant: BadgeVariant }> = {
  'did-work': { label: 'Did work', variant: 'success' },
  'nothing-to-do': { label: 'Nothing to do', variant: 'neutral' },
  errored: { label: 'Failed', variant: 'danger' },
  running: { label: 'Running', variant: 'warning' },
};

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  const o = outcomes[outcome ?? 'running'] ?? { label: String(outcome), variant: 'neutral' as const };
  return <Badge variant={o.variant}>{o.label}</Badge>;
}

function runName(r: JobRun): string {
  if (r.schedule_name) return r.schedule_name;
  if (r.job_key.startsWith('system:')) {
    const n = r.job_key.slice(7);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  return `Deleted schedule #${r.job_key.replace('schedule:', '')}`;
}

const PAGE = 50;

/** The run ledger: every time a job fired and how it ended. */
export function Ledger() {
  const [jobKey, setJobKey] = useState('');
  const [idle, setIdle] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const now = useNow();
  // A finished run that did work or failed publishes data_changed for `system`, which refreshes this.
  const runs = useView<JobRun[]>('system/job_runs', { job_key: jobKey, idle, limit });
  const schedules = useView<Schedule[]>('system/schedules');
  const jobs = useView<SystemJob[]>('system/jobs');

  return (
    <Section title="Run history" description="Each time a job fired, and how it ended.">
      <div className="flex flex-col gap-3 @lg/page:flex-row @lg/page:items-center">
        <Select value={jobKey} onChange={(e) => { setJobKey(e.target.value); setLimit(PAGE); }} aria-label="Show runs of" className="@lg/page:max-w-64">
          <option value="">All jobs</option>
          {!!schedules.data?.length && (
            <optgroup label="Schedules">
              {schedules.data.map((s) => (
                <option key={s.id} value={`schedule:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Housekeeping">
            {(jobs.data ?? []).map((j) => (
              <option key={j.job_key} value={j.job_key}>
                {j.name.charAt(0).toUpperCase() + j.name.slice(1)}
              </option>
            ))}
          </optgroup>
        </Select>
        {/* The server always includes idle runs when one job is picked. */}
        <label className="flex min-h-11 items-center gap-2.5 text-sm lg:min-h-0">
          <Switch checked={idle || !!jobKey} disabled={!!jobKey} onCheckedChange={setIdle} />
          Include runs with nothing to do
        </label>
      </div>
      <ViewState view={runs} empty={<EmptyState icon={History} title="No runs to show" body={idle || jobKey ? 'This job has not run yet.' : 'Nothing has done work or failed yet. Turn on “nothing to do” runs to see every check.'} />}>
        {(rows) => (
          <>
            <List>
              {rows.map((r) => {
                const took = r.ended_at ? duration(Date.parse(r.ended_at) - Date.parse(r.started_at)) : '';
                return (
                  <ListRow
                    key={r.id}
                    wrap
                    title={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {runName(r)}
                        <OutcomeBadge outcome={r.outcome} />
                      </span>
                    }
                    subtitle={
                      <>
                        {r.detail && <span className="block break-words whitespace-pre-line">{r.detail}</span>}
                        <span className="tabular block">
                          {dateTime(r.started_at, now)}
                          {took ? `, took ${took}` : ''}
                          {r.cost_usd ? `, cost ${cost(r.cost_usd)}` : ''}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </List>
            {rows.length >= limit && limit < 500 && (
              <Button variant="outline" className="self-center" onClick={() => setLimit((l) => Math.min(500, l + PAGE))}>
                Show more
              </Button>
            )}
          </>
        )}
      </ViewState>
    </Section>
  );
}
