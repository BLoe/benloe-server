import { CircleCheck, MessageCircle, Plus, Receipt, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, Field, FormDialog, LoadingRows, Meter, Page, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { act, useAct } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { localDay, money } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { useLatest } from './documents/parts';
import { Checklist } from './taxes/Checklist';
import { Deductions } from './taxes/Deductions';
import { copySource, defaultNewYear, newYearError, progressLine, yearChipNote, type YearDetail, type YearSummary, type YearsView } from './taxes/logic';
import { PacketSection, PreparerNotes } from './taxes/Packet';

function NewYear({ years, initial, onClose, onStarted }: { years: YearSummary[]; initial: number; onClose: () => void; onStarted: (year: number) => void }) {
  const [text, setText] = useState(String(initial));
  const [copy, setCopy] = useState(true);
  const [from, setFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const error = newYearError(text, years.map((y) => y.year));
  const sources = years.filter((y) => y.progress.total > 0);
  const source = from ?? (error ? null : copySource(Number(text), years)) ?? sources[0]?.year ?? null;
  const start = async () => {
    if (error) return;
    const year = Number(text);
    setSaving(true);
    const r = await act('tax_checklist_update', { year, ...(copy && source != null && source !== year ? { copy_from_year: source } : {}) }, { success: `${year} started` });
    setSaving(false);
    if (r.ok) onStarted(year);
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Start a tax year" submitLabel="Start the year" pending={saving} canSubmit={!error} onSubmit={() => void start()}>
      <Field label="Tax year" hint="The year the income was earned: 2026 for the return filed in spring 2027." error={text.trim().length === 4 ? error : null}>
        {(id) => <Input id={id} value={text} inputMode="numeric" maxLength={4} className="tabular" onChange={(e) => setText(e.target.value.replace(/\D/g, ''))} />}
      </Field>
      {sources.length > 0 && source != null && (
        <>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="copy-checklist" className="min-w-0">
              <span className="block text-sm font-medium">Copy an earlier checklist</span>
              <span className="block text-sm text-muted-foreground">Every item is added as still expected, with no document linked.</span>
            </label>
            <Switch id="copy-checklist" checked={copy} onCheckedChange={setCopy} />
          </div>
          {copy && (
            <Field label="Copy from">
              {(id) => (
                <Select id={id} value={String(source)} onChange={(e) => setFrom(Number(e.target.value))}>
                  {sources.map((y) => (
                    <option key={y.year} value={y.year}>
                      {y.year} ({y.progress.total} items)
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

/** Progress, totals and the filed state of the selected year. */
function YearSummaryCard({ detail, year }: { detail: YearDetail; year: number }) {
  const { run, pending } = useAct();
  const filed = detail.status === 'filed';
  const needed = detail.progress.received + detail.progress.expected;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="break-words">{progressLine(detail.progress, detail.missing)}</span>
            {filed && (
              <Badge variant="success">
                <CircleCheck />
                Filed
              </Badge>
            )}
          </p>
          {needed > 0 && <Meter value={detail.progress.received} max={needed} className="mt-2.5" label={`${detail.progress.received} of ${needed} documents received`} />}
        </div>
        {filed ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => void run('tax_checklist_update', { year, status: 'open' }, { success: `${year} reopened` })}>
            <RotateCcw />
            Reopen
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => void run('tax_checklist_update', { year, status: 'filed' }, { success: `${year} marked filed` })}>
            <CircleCheck />
            Mark as filed
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm @lg/page:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Deductions</dt>
          <dd className="tabular text-[15px] font-medium">{money(detail.deductions_total)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tax payments</dt>
          <dd className="tabular text-[15px] font-medium">{money(detail.payments_total)}</dd>
        </div>
        <div className="col-span-2 @lg/page:col-span-1">
          <dt className="text-muted-foreground">Packets built</dt>
          <dd className="tabular text-[15px] font-medium">{detail.packets.length}</dd>
        </div>
      </dl>
    </div>
  );
}

/** /taxes: one tax year at a time (?year=, default the newest): checklist, deductions, payments, notes and the packet. */
export default function TaxesPage() {
  const [sp, setSp] = useSearchParams();
  const me = useMe();
  const param = sp.get('year');
  const wanted = param && /^\d{4}$/.test(param) ? Number(param) : undefined;
  const years = useView<YearsView>('taxes/years');
  const view = useView<YearDetail>('taxes/year', { year: wanted });
  const detail = useLatest(view.data);
  const [starting, setStarting] = useState<{ year: number } | null>(null);

  const list = years.data?.years ?? [];
  const today = localDay(new Date(), me?.timezone);
  const select = (year: number) => setSp({ year: String(year) }, { replace: true });
  const startDialog = starting && (
    <NewYear
      key={starting.year}
      years={list}
      initial={starting.year}
      onClose={() => setStarting(null)}
      onStarted={(y) => {
        setStarting(null);
        select(y);
      }}
    />
  );
  const header = (actions?: React.ReactNode) => <PageHeader title="Taxes" description="What each return needs, what is deductible, and the packet for your preparer." actions={actions} />;

  if (years.data === undefined || detail === undefined) {
    const error = years.error ?? view.error;
    return (
      <Page>
        {header()}
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              years.refetch();
              view.refetch();
            }}
          />
        ) : (
          <LoadingRows rows={4} />
        )}
      </Page>
    );
  }

  if (list.length === 0 && wanted === undefined) {
    const year = defaultNewYear(today, []);
    return (
      <Page>
        {header()}
        <EmptyState
          icon={Receipt}
          title="No tax year started"
          body="Start a year to list the documents its return needs (W-2s, 1099s, the mortgage statement), track deductions and payments as they happen, and build one packet for your preparer when everything is in."
          action={
            <>
              <Button onClick={() => setStarting({ year })}>
                <Plus />
                Start {year}
              </Button>
              <Button variant="outline" onClick={() => openChat({ send: `Start my ${year} taxes: draft the checklist of documents I should expect`, newThread: true })}>
                <MessageCircle />
                Have Kevin draft it
              </Button>
            </>
          }
        />
        {startDialog}
      </Page>
    );
  }

  const year = wanted ?? detail.year ?? list[0]?.year ?? defaultNewYear(today, []);
  // While another year loads, the previous year's detail stays on screen, dimmed.
  const current = detail.year === year ? detail : null;

  return (
    <Page className="gap-6">
      {header(
        <Button variant="outline" onClick={() => openChat({ send: `Am I missing anything for my ${year} taxes?`, newThread: true })}>
          <MessageCircle />
          Am I missing anything?
        </Button>,
      )}

      <div role="tablist" aria-label="Tax year" className="-mx-4 -mt-2 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden">
        {list.map((y) => (
          <button
            key={y.year}
            type="button"
            role="tab"
            aria-selected={y.year === year}
            onClick={() => select(y.year)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors lg:h-9',
              y.year === year ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="tabular text-[15px]">{y.year}</span>
            <span className={cn('tabular text-xs font-normal', y.year === year ? 'opacity-85' : 'opacity-80')}>{yearChipNote(y)}</span>
          </button>
        ))}
        <button type="button" onClick={() => setStarting({ year: defaultNewYear(today, list.map((y) => y.year)) })} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3.5 text-sm font-medium text-muted-foreground hover:border-solid hover:text-foreground lg:h-9">
          <Plus className="size-4" />
          New year
        </button>
      </div>

      {!current ? (
        <LoadingRows rows={4} />
      ) : !current.exists ? (
        <EmptyState
          icon={Receipt}
          title={`${year} has not been started`}
          body="Start it to build its checklist, optionally copying an earlier year’s."
          action={
            <Button onClick={() => setStarting({ year })}>
              <Plus />
              Start {year}
            </Button>
          }
        />
      ) : (
        <>
          <YearSummaryCard detail={current} year={year} />
          <Checklist detail={current} year={year} />
          <Deductions detail={current} year={year} />
          <PreparerNotes key={year} detail={current} year={year} />
          <PacketSection detail={current} year={year} />
        </>
      )}
      {startDialog}
    </Page>
  );
}
