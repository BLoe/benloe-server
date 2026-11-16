import { useState } from 'react';
import { Chips, Field, FieldRow, FormDialog } from '@/components/page';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAct } from '@/lib/act';
import { useMe } from '@/lib/hooks';
import { cronFromForm, defaultCronForm, formFromCron, humanizeCron, humanizeInterval, isoToLocalInput, localInputToIso, type CronForm, type Repeat } from '@/lib/trigger';
import type { Schedule, ScheduleAction, TriggerType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { pages } from '@/pages/registry';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

interface FormState {
  name: string;
  action: ScheduleAction;
  title: string;
  body: string;
  link: string;
  sql: string;
  prompt: string;
  deep: boolean;
  writes: boolean;
  cap: string;
  triggerType: TriggerType;
  once: string;
  cron: CronForm;
  every: string;
  unit: Unit;
}

function tomorrowAt9(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return isoToLocalInput(d.toISOString());
}

function initial(s: Schedule | null): FormState {
  const base: FormState = {
    name: '', action: 'notify', title: '', body: '', link: '', sql: '', prompt: '', deep: false, writes: false, cap: '1',
    triggerType: 'once', once: tomorrowAt9(), cron: defaultCronForm, every: '2', unit: 'hours',
  };
  if (!s) return base;
  const minutes = Number(s.trigger_value);
  const unit: Unit = s.trigger_type !== 'interval' ? 'hours' : minutes % 1440 === 0 ? 'days' : minutes % 60 === 0 ? 'hours' : 'minutes';
  return {
    ...base,
    name: s.name,
    action: s.action,
    title: s.payload.title ?? '',
    body: s.payload.body ?? '',
    link: s.payload.link ?? '',
    sql: s.payload.sql ?? '',
    prompt: s.payload.prompt ?? '',
    deep: !!s.payload.deep,
    writes: !!s.payload.writes,
    cap: String(s.spend_cap_usd ?? 1),
    triggerType: s.trigger_type,
    once: s.trigger_type === 'once' ? isoToLocalInput(s.trigger_value) : base.once,
    cron: s.trigger_type === 'cron' ? formFromCron(s.trigger_value) : base.cron,
    every: s.trigger_type === 'interval' ? String(minutes / UNIT_MINUTES[unit]) : base.every,
    unit,
  };
}

/** The trigger as the server stores it, or the reason it is not valid yet. */
function triggerValue(f: FormState): { value: string } | { problem: string } {
  if (f.triggerType === 'once') {
    const iso = localInputToIso(f.once);
    return iso ? { value: iso } : { problem: 'Pick a date and time.' };
  }
  if (f.triggerType === 'interval') {
    const n = Number(f.every) * UNIT_MINUTES[f.unit];
    return Number.isFinite(n) && n >= 1 ? { value: String(Math.round(n)) } : { problem: 'Enter how often, at least 1 minute.' };
  }
  if (f.cron.repeat === 'weekly' && !f.cron.days.length) return { problem: 'Pick at least one day.' };
  const expr = cronFromForm(f.cron);
  return expr.split(/\s+/).length === 5 ? { value: expr } : { problem: 'A cron expression has five fields: minute hour day month weekday.' };
}

export function ScheduleForm({ schedule, onClose }: { schedule: Schedule | null; onClose: () => void }) {
  const [f, setF] = useState<FormState>(() => initial(schedule));
  const { run, pending } = useAct();
  const me = useMe();
  const up = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const upCron = (patch: Partial<CronForm>) => setF((s) => ({ ...s, cron: { ...s.cron, ...patch } }));
  const editing = !!schedule;
  const trig = triggerValue(f);
  const cap = Number(f.cap);

  const missing =
    !f.name.trim() ? 'Give it a name.'
    : f.action === 'notify' && !f.title.trim() ? 'A reminder needs a title.'
    : f.action === 'check' && (!f.title.trim() || !f.sql.trim()) ? 'A check needs a title and a query.'
    : f.action === 'agent_turn' && !f.prompt.trim() ? 'Say what Kevin should do.'
    : f.action === 'agent_turn' && !(cap >= 0.05 && cap <= 50) ? 'The monthly cap is between $0.05 and $50.'
    : 'problem' in trig ? trig.problem
    : null;

  const submit = async () => {
    if (missing || 'problem' in trig) return;
    const payload =
      f.action === 'notify' ? { title: f.title.trim(), body: f.body.trim(), link: f.link }
      : f.action === 'check' ? { title: f.title.trim(), sql: f.sql.trim(), link: f.link }
      : { prompt: f.prompt.trim(), deep: f.deep, writes: f.writes, spend_cap_usd: cap };
    let r;
    if (schedule) {
      // Sending the trigger re-arms the schedule on the server, so it goes only when it changed.
      const moved = f.triggerType !== schedule.trigger_type || trig.value !== schedule.trigger_value;
      r = await run('schedule_update', { id: schedule.id, name: f.name.trim(), ...payload, ...(moved ? { trigger_type: f.triggerType, trigger_value: trig.value, enabled: true } : {}) }, { success: 'Schedule saved' });
    } else {
      // Empty optional text is left out; on an update it is sent so a field can be cleared.
      const filled = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== ''));
      r = await run('schedule_create', { name: f.name.trim(), action: f.action, trigger_type: f.triggerType, trigger_value: trig.value, ...filled }, { success: 'Schedule created' });
    }
    if (r.ok) onClose();
  };

  const linkField = (
    <Field label="Opens" hint="The page a tap on the notification goes to.">
      {(id) => (
        <Select id={id} value={f.link} onChange={(e) => up({ link: e.target.value })}>
          <option value="">Home</option>
          {pages.filter((p) => p.path !== '/').map((p) => (
            <option key={p.path} value={p.path}>
              {p.label}
            </option>
          ))}
          {f.link && !pages.some((p) => p.path === f.link) && <option value={f.link}>{f.link}</option>}
        </Select>
      )}
    </Field>
  );

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={editing ? 'Edit schedule' : 'New schedule'} submitLabel={editing ? 'Save schedule' : 'Create schedule'} pending={pending} canSubmit={!missing} onSubmit={() => void submit()}>
      <Field label="Name">{(id) => <Input id={id} value={f.name} maxLength={80} onChange={(e) => up({ name: e.target.value })} placeholder="Take out the recycling" autoFocus={!editing} />}</Field>

      {!editing && (
        <Field label="What it does" hint={f.action === 'notify' ? 'Sends you a fixed message. Free.' : f.action === 'check' ? 'Runs a query and notifies you only when it finds rows. Free.' : 'Kevin wakes up and does what you describe. Uses the model, so it costs money.'}>
          <Chips
            value={f.action}
            onChange={(action) => up({ action })}
            options={[
              { value: 'notify', label: 'Reminder' },
              { value: 'check', label: 'Check' },
              { value: 'agent_turn', label: 'Kevin task' },
            ]}
          />
        </Field>
      )}

      {f.action !== 'agent_turn' && <Field label="Notification title">{(id) => <Input id={id} value={f.title} maxLength={120} onChange={(e) => up({ title: e.target.value })} />}</Field>}
      {f.action === 'notify' && <Field label="Message">{(id) => <Textarea id={id} value={f.body} maxLength={1000} rows={2} onChange={(e) => up({ body: e.target.value })} />}</Field>}
      {f.action === 'check' && (
        <Field label="Query" hint="One SELECT. The rows it returns become the notification’s text.">
          {(id) => <Textarea id={id} value={f.sql} rows={4} spellCheck={false} className="font-mono text-[13px]" onChange={(e) => up({ sql: e.target.value })} placeholder="SELECT name FROM pantry_items WHERE expires_on <= date('now', '+2 days')" />}
        </Field>
      )}
      {f.action !== 'agent_turn' && linkField}
      {f.action === 'agent_turn' && (
        <>
          <Field label="What Kevin should do">{(id) => <Textarea id={id} value={f.prompt} rows={4} onChange={(e) => up({ prompt: e.target.value })} placeholder="Look at what’s expiring this week and suggest three dinners." />}</Field>
          <FieldRow>
            <Field label="Monthly spend cap ($)" hint="This schedule stops for the month once it has spent this.">
              {(id) => <Input id={id} type="number" inputMode="decimal" min={0.05} max={50} step={0.05} value={f.cap} onChange={(e) => up({ cap: e.target.value })} />}
            </Field>
            <Field label="Think hard" hint="Uses the deeper model. Costs several times more.">
              {(id) => <Switch id={id} checked={f.deep} onCheckedChange={(deep) => up({ deep })} />}
            </Field>
          </FieldRow>
          <Field label="May change your data" hint="Off: it can read, research and notify you, nothing more. On: it can also update your records while nobody is watching.">
            {(id) => <Switch id={id} checked={f.writes} onCheckedChange={(writes) => up({ writes })} />}
          </Field>
        </>
      )}

      <Field label="When">
        <Chips
          value={f.triggerType}
          onChange={(triggerType) => up({ triggerType })}
          options={[
            { value: 'once', label: 'Once' },
            { value: 'cron', label: 'On a schedule' },
            { value: 'interval', label: 'Every so often' },
          ]}
        />
      </Field>

      {f.triggerType === 'once' && <Field label="Date and time" hint="In this device’s time zone.">{(id) => <Input id={id} type="datetime-local" value={f.once} onChange={(e) => up({ once: e.target.value })} />}</Field>}

      {f.triggerType === 'interval' && (
        <Field label="Every" hint={'value' in trig ? `${humanizeInterval(Number(trig.value))}, counted from its last run.` : undefined}>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} type="number" inputMode="numeric" min={1} value={f.every} onChange={(e) => up({ every: e.target.value })} className="w-24" />
              <Select value={f.unit} onChange={(e) => up({ unit: e.target.value as Unit })} aria-label="Unit" className="flex-1">
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </Select>
            </div>
          )}
        </Field>
      )}

      {f.triggerType === 'cron' && (
        <>
          <FieldRow>
            <Field label="Repeats">
              {(id) => (
                <Select id={id} value={f.cron.repeat} onChange={(e) => upCron({ repeat: e.target.value as Repeat, expr: cronFromForm(f.cron) })}>
                  <option value="daily">Every day</option>
                  <option value="weekly">On certain days of the week</option>
                  <option value="monthly">Once a month</option>
                  <option value="custom">Custom (cron)</option>
                </Select>
              )}
            </Field>
            {f.cron.repeat !== 'custom' && <Field label="At">{(id) => <Input id={id} type="time" value={f.cron.time} onChange={(e) => upCron({ time: e.target.value || '09:00' })} />}</Field>}
          </FieldRow>
          {f.cron.repeat === 'weekly' && (
            <Field label="Days">
              <div className="flex gap-1.5">
                {DAY_LETTERS.map((letter, d) => {
                  const on = f.cron.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[d]}
                      onClick={() => upCron({ days: on ? f.cron.days.filter((x) => x !== d) : [...f.cron.days, d] })}
                      className={cn('h-10 flex-1 rounded-md border text-sm font-medium lg:h-9', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {f.cron.repeat === 'monthly' && (
            <Field label="Day of the month" hint="A month without that day is skipped.">
              {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={31} value={f.cron.dayOfMonth} onChange={(e) => upCron({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} className="w-24" />}
            </Field>
          )}
          {f.cron.repeat === 'custom' && (
            <Field label="Cron expression" hint="minute hour day-of-month month day-of-week">
              {(id) => <Input id={id} value={f.cron.expr} spellCheck={false} autoCapitalize="off" className="font-mono" onChange={(e) => upCron({ expr: e.target.value })} placeholder="0 18 * * 0" />}
            </Field>
          )}
          {'value' in trig && (
            <p className="-mt-1 text-sm text-muted-foreground">
              {humanizeCron(trig.value)}
              {me?.timezone ? `, ${me.timezone.replace(/_/g, ' ')} time.` : '.'}
            </p>
          )}
        </>
      )}

      {missing && <p className="text-sm text-muted-foreground">{missing}</p>}
    </FormDialog>
  );
}
