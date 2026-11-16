import { useState } from 'react';
import { Field, FormDialog, List, ListRow, Meter, Section, ViewState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAct } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { compactNumber, cost, dateTime, modelLabel, money, plural } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { SpendView } from '@/lib/types';
import { useView } from '@/lib/useView';
import { DailyBars, fillDays } from './DailyBars';

const purposeLabel: Record<string, string> = {
  turn: 'Chat and scheduled tasks',
  title: 'Naming chats',
  memory: 'Memory summaries',
  compaction: 'Shortening long chats',
  vision: 'Reading photos and PDFs',
  research: 'Web research',
  embedding: 'Search index',
};

function CapDialog({ cap, onClose }: { cap: number; onClose: () => void }) {
  const [value, setValue] = useState(String(cap));
  const { run, pending } = useAct();
  const n = Number(value);
  const valid = n >= 1 && n <= 2000;
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Monthly spend cap"
      description="Kevin stops using the model for the rest of the month once this much is spent."
      submitLabel="Save cap"
      pending={pending}
      canSubmit={valid}
      onSubmit={() => void run('settings_update', { monthly_cap_usd: n }, { success: 'Cap saved' }).then((r) => r.ok && onClose())}
    >
      <Field label="Cap in dollars" error={value && !valid ? 'Between $1 and $2,000.' : null}>
        {(id) => <Input id={id} type="number" inputMode="decimal" min={1} max={2000} step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
      </Field>
    </FormDialog>
  );
}

function Share({ label, detail, amount, total }: { label: string; detail: string; amount: number; total: number }) {
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="tabular shrink-0">{cost(amount)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <Meter value={amount} max={total} className="h-1.5 flex-1" label={`${label} share of spend`} />
        <span className="tabular w-40 shrink-0 text-right text-xs text-muted-foreground">{detail}</span>
      </div>
    </li>
  );
}

export function Spend() {
  const view = useView<SpendView>('system/spend');
  const now = useNow();
  const [editing, setEditing] = useState(false);
  return (
    <ViewState view={view}>
      {(s) => {
        const ratio = s.capUsd > 0 ? s.monthUsd / s.capUsd : 0;
        const days = fillDays(s.by_day, now);
        const total30 = days.reduce((a, d) => a + d.cost_usd, 0);
        return (
          <div className="flex flex-col gap-7">
            <Section>
              <div className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Spent this month</div>
                    <div className="tabular mt-0.5 text-[28px] leading-none font-semibold tracking-tight">
                      {money(s.monthUsd)} <span className="text-base font-normal text-muted-foreground">of {money(s.capUsd, { cents: s.capUsd % 1 !== 0 })}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Change cap
                  </Button>
                </div>
                <Meter value={s.monthUsd} max={s.capUsd} tone={s.blocked ? 'danger' : ratio > 0.8 ? 'warning' : 'primary'} className="mt-4" label="Spend against the monthly cap" />
                <p className={s.blocked ? 'mt-2.5 text-sm text-destructive' : 'mt-2.5 text-sm text-muted-foreground'}>
                  {s.blocked ? 'The cap is reached. Kevin will not answer until you raise it or the month ends.' : `${money(s.remainingUsd)} left before Kevin pauses for the month.`}
                </p>
              </div>
            </Section>

            <Section title="Last 30 days" description={`${cost(total30)} in total`}>
              <div className="rounded-xl border bg-card p-4">
                <DailyBars days={days} />
              </div>
            </Section>

            {s.by_purpose.length > 0 && (
              <Section title="Where it went this month">
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {s.by_purpose.map((p) => (
                    <Share key={p.purpose} label={purposeLabel[p.purpose] ?? p.purpose} detail={plural(p.requests, 'request')} amount={p.cost_usd} total={s.monthUsd} />
                  ))}
                </ul>
              </Section>
            )}

            {s.by_model.length > 0 && (
              <Section title="By model">
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {s.by_model.map((m) => (
                    <Share key={m.model} label={modelLabel(m.model)} detail={`${compactNumber(m.input_tokens + m.cache_read_tokens + m.cache_write_tokens)} in, ${compactNumber(m.output_tokens)} out`} amount={m.cost_usd} total={s.monthUsd} />
                  ))}
                </ul>
              </Section>
            )}

            {s.recent_turns.length > 0 && (
              <Section title="Recent turns">
                <List>
                  {s.recent_turns.map((t) => (
                    <ListRow key={t.id} onClick={() => openChat({ threadId: t.thread_id })} title={t.title} subtitle={`${dateTime(t.started_at, now)}, ${modelLabel(t.model)}${t.status !== 'done' ? `, ${t.status}` : ''}`} meta={cost(t.cost_usd)} />
                  ))}
                </List>
              </Section>
            )}
            {editing && <CapDialog cap={s.capUsd} onClose={() => setEditing(false)} />}
          </div>
        );
      }}
    </ViewState>
  );
}
