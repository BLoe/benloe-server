import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { KeyValues, Markdown, Section, ViewState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { dateTime, duration, modelLabel, plural, ago, toolLabel } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { AuditRow, Health } from '@/lib/types';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';

function HealthSection() {
  const view = useView<Health>('system/health', undefined, { pollMs: 60_000 });
  const now = useNow();
  return (
    <Section title="Health">
      <ViewState view={view} rows={4}>
        {(h) => {
          const tickAge = h.runner_last_tick ? now.getTime() - Date.parse(h.runner_last_tick) : null;
          const backupOk = h.last_backup?.outcome === 'did-work';
          return (
            <KeyValues
              items={[
                {
                  label: 'Job runner',
                  value: tickAge == null ? <Badge variant="warning">Has not ticked yet</Badge> : tickAge < 5 * 60_000 ? <span>Running, last checked {ago(h.runner_last_tick, now)}</span> : <Badge variant="danger">Quiet since {dateTime(h.runner_last_tick, now)}</Badge>,
                },
                {
                  label: 'Last backup',
                  value: h.last_backup ? (
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {dateTime(h.last_backup.started_at, now)}
                        <Badge variant={backupOk ? 'success' : 'danger'}>{backupOk ? 'Succeeded' : 'Failed'}</Badge>
                      </span>
                      {h.last_backup.detail && <span className="text-sm text-muted-foreground">{h.last_backup.detail}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None yet. The first runs tonight at 3:30 AM.</span>
                  ),
                },
                { label: 'Offsite backup', value: h.offsite_backup ? <Badge variant="success">On</Badge> : <span className="flex flex-wrap items-center gap-2"><Badge variant="warning">Not configured</Badge><span className="text-sm text-muted-foreground">Backups stay on this server only.</span></span> },
                { label: 'Meaning-based search', value: h.embeddings ? <Badge variant="success">On</Badge> : <span className="flex flex-wrap items-center gap-2"><Badge>Off</Badge><span className="text-sm text-muted-foreground">Memory search matches words only.</span></span> },
                { label: 'Push devices', value: plural(h.push_devices, 'device') },
                { label: 'Models', value: Object.entries(h.models).map(([role, id]) => `${modelLabel(id)} (${role})`).join(', ') },
              ]}
            />
          );
        }}
      </ViewState>
    </Section>
  );
}

function Suggestions() {
  const view = useView<{ text: string }>('system/suggestions');
  return (
    <Section title="Kevin’s suggestions" description="Changes Kevin has asked for. Review them with Claude Code.">
      <ViewState view={view} rows={2} isEmpty={(d) => !d.text.trim()} empty={<p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Kevin has not suggested anything yet.</p>}>
        {(d) => (
          <div className="rounded-xl border bg-card p-4">
            <Markdown text={d.text} className="text-[14px]" />
          </div>
        )}
      </ViewState>
    </Section>
  );
}

const sourceLabel: Record<string, string> = { agent: 'Kevin', ui: 'You', job: 'Scheduled' };

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function AuditItem({ row, now }: { row: AuditRow; now: Date }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-muted">
        <span className={cn('size-2 shrink-0 rounded-full', row.ok ? 'bg-primary' : 'bg-destructive')} aria-label={row.ok ? 'Succeeded' : 'Failed'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{toolLabel(row.tool)}</span>
          <span className="tabular block text-xs text-muted-foreground">
            {sourceLabel[row.source] ?? row.source}, {dateTime(row.at, now)}, {duration(row.ms)}
          </span>
        </span>
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3">
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">{pretty(row.input)}</pre>
          <pre className={cn('max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap', !row.ok && 'text-destructive')}>{row.result}</pre>
        </div>
      )}
    </li>
  );
}

function Audit() {
  const view = useView<AuditRow[]>('system/audit', { limit: 50 });
  const now = useNow();
  return (
    <Section title="Recent tool activity" description="Every tool call, by Kevin or from a page, newest first.">
      <ViewState view={view} empty={<p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No tool has been used yet.</p>}>
        {(rows) => (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {rows.map((r) => (
              <AuditItem key={r.id} row={r} now={now} />
            ))}
          </ul>
        )}
      </ViewState>
    </Section>
  );
}

export function System() {
  return (
    <div className="flex flex-col gap-7">
      <HealthSection />
      <Suggestions />
      <Audit />
    </div>
  );
}
