import { Ellipsis, Pause, Play, RotateCw } from 'lucide-react';
import { List, ListRow, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { act } from '@/lib/act';
import { ago } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { humanizeCadence } from '@/lib/trigger';
import type { SystemJob } from '@/lib/types';
import { useView } from '@/lib/useView';
import { OutcomeBadge } from './Ledger';
import { runNow } from './Schedules';

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function SystemJobs() {
  const view = useView<SystemJob[]>('system/jobs', undefined, { pollMs: 60_000 });
  const backup = useView<{ problem: string | null }>('system/backup', undefined, { pollMs: 60_000 });
  const now = useNow();
  return (
    <Section title="Housekeeping" description="Jobs Kevin runs on his own to stay healthy.">
      {backup.data?.problem && <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm" role="alert">{backup.data.problem}</p>}
      <ViewState view={view} rows={4}>
        {(jobs) => (
          <List>
            {jobs.map((j) => (
              <ListRow
                key={j.job_key}
                wrap
                muted={j.paused}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {title(j.name)}
                    {j.paused && <Badge variant="warning">Paused</Badge>}
                    {j.last_run?.outcome === 'errored' && <OutcomeBadge outcome="errored" />}
                  </span>
                }
                subtitle={
                  <>
                    <span className="block">{j.description}</span>
                    <span className="block">
                      {humanizeCadence(j.cadence)}. {j.last_run ? `Last ran ${ago(j.last_run.started_at, now)}` : 'Has not run yet'}
                      {j.last_work && j.last_work.outcome !== 'errored' ? `, last did work ${ago(j.last_work.started_at, now)}` : ''}.
                    </span>
                  </>
                }
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Options for ${j.name}`}>
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => void runNow(j.job_key, title(j.name))}>
                        <RotateCw />
                        Run now
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void act('job_control', { job_key: j.job_key, action: j.paused ? 'resume' : 'pause' }, { success: j.paused ? `${title(j.name)} resumed` : `${title(j.name)} paused` })}>
                        {j.paused ? <Play /> : <Pause />}
                        {j.paused ? 'Resume' : 'Pause'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
          </List>
        )}
      </ViewState>
    </Section>
  );
}
