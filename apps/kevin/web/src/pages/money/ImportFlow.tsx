// Importing a bank CSV: pick the file and the account, look at exactly what
// would be saved (money_import with commit: false), then commit. The preview
// and the commit send the same arguments, built by importArgs().
import { Check, CircleAlert, FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Field, FieldRow } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { act } from '@/lib/act';
import { api, ApiError } from '@/lib/api';
import { money, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_TYPE_LABELS, categorizeMerchantInput, dayLabel, emptyImport, flipped, headerCandidates, importArgs, importError, isFlipped, MAPPING_FIELDS, MAPPING_LABELS, setMapping, shownMapping,
  type ImportDraft, type MappingField,
} from './logic';
import { Amount, CategorySelect, FormError, useMoney } from './shared';
import type { ImportPreview, ImportResult } from './types';

type Step = 'pick' | 'preview' | 'done';

export function ImportFlow({ onClose }: { onClose: () => void }) {
  const { accounts, categories, today, go } = useMoney();
  const open = accounts.filter((a) => a.active);
  const [step, setStep] = useState<Step>('pick');
  const [d, setD] = useState<ImportDraft>(() => ({ ...emptyImport(), account: open.length === 1 ? String(open[0]!.id) : open.length === 0 ? 'new' : '' }));
  const [uploading, setUploading] = useState<number | null>(null);
  const [localHeaders, setLocalHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [autoApplied, setAutoApplied] = useState<'as_is' | 'invert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [categorized, setCategorized] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the newest preview may land: switches can be flipped faster than the server answers.
  const seq = useRef(0);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setUploading(0);
    try {
      const head = await file.slice(0, 64 * 1024).text();
      setLocalHeaders(headerCandidates(head));
      const up = await api.upload(file, file.name, (p) => setUploading(p));
      if (up.kind !== 'text') {
        setD((x) => ({ ...x, upload: null }));
        setError(`${up.filename} is ${up.kind === 'pdf' ? 'a PDF' : up.kind === 'image' ? 'an image' : 'not a CSV'}. Choose the CSV download from your bank's website (often called "Export" or "Download transactions").`);
      } else setD((x) => ({ ...x, upload: { id: up.id, filename: up.filename }, mapping: {}, amountSign: 'auto' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The file could not be uploaded.');
    } finally {
      setUploading(null);
    }
  };

  const runPreview = async (draft: ImportDraft) => {
    const args = importArgs(draft, accounts, false);
    if ('error' in args) return setError(args.error);
    const mine = ++seq.current;
    setError(null);
    setBusy(true);
    const r = await act<ImportPreview>('money_import', args.input, { silent: true });
    if (mine !== seq.current) return;
    setBusy(false);
    if (!r.ok) {
      setError(importError(r.error));
      setPreview(null);
      setStep('pick');
      return;
    }
    setPreview(r.result);
    if (draft.amountSign === 'auto') setAutoApplied(r.result.amount_sign.applied);
    setStep('preview');
  };

  /** A change made while looking at the preview re-runs it. */
  const change = (next: ImportDraft) => {
    setD(next);
    if (step === 'preview') void runPreview(next);
  };

  const commit = async () => {
    const args = importArgs(d, accounts, true);
    if ('error' in args) return setError(args.error);
    setBusy(true);
    const r = await act<ImportResult>('money_import', args.input, { silent: true });
    setBusy(false);
    if (!r.ok) return setError(importError(r.error));
    setResult(r.result);
    setStep('done');
  };

  const categorize = async (merchant: string, category: string) => {
    if (!result?.batch_id || !category) return;
    setCategorized((c) => ({ ...c, [merchant]: category }));
    const r = await act('money_transactions_update', categorizeMerchantInput(result.batch_id, merchant, category));
    if (!r.ok) setCategorized((c) => Object.fromEntries(Object.entries(c).filter(([m]) => m !== merchant)));
  };

  const headers = preview?.file.headers ?? localHeaders;
  const mappingEditor = headers.length > 0 && (
    <div className="grid gap-3 sm:grid-cols-2">
      {MAPPING_FIELDS.map((f) => (
        <MappingSelect key={f} field={f} headers={headers} value={shownMapping(d, preview)[f] ?? ''} onChange={(h) => change(setMapping(d, f, h))} />
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{step === 'done' ? 'Import finished' : 'Import a bank CSV'}</DialogTitle>
          <DialogDescription>
            {step === 'pick' ? 'Nothing is saved until you have seen the preview.' : step === 'preview' ? `${preview?.file.filename} into ${preview?.account.name}${preview?.account.will_create ? ' (new account)' : ''}` : `${result?.account.name}${result?.account.created ? ' was created' : ''}`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 pt-1">
          {step === 'pick' && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  void pickFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading != null}
                className={cn('flex min-h-20 items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left hover:bg-muted', d.upload && 'border-solid bg-card')}
              >
                {uploading != null ? <LoaderCircle className="size-5 shrink-0 animate-spin text-primary" /> : d.upload ? <FileSpreadsheet className="size-5 shrink-0 text-primary" /> : <Upload className="size-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{uploading != null ? (uploading >= 1 ? 'Reading the file…' : `Uploading ${Math.round(uploading * 100)}%`) : (d.upload?.filename ?? 'Choose a CSV file')}</span>
                  <span className="block text-sm text-muted-foreground">{d.upload ? 'Tap to choose a different file' : 'The transactions export from your bank or card website'}</span>
                </span>
              </button>

              <Field label="Account this file is from">
                {(id) => (
                  <Select id={id} value={d.account} onChange={(e) => setD({ ...d, account: e.target.value })}>
                    <option value="">Choose…</option>
                    {open.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name} ({ACCOUNT_TYPE_LABELS[a.type] ?? a.type})
                      </option>
                    ))}
                    <option value="new">New account…</option>
                  </Select>
                )}
              </Field>
              {d.account === 'new' && (
                <>
                  <Field label="Account name" hint="Your own name for it: Chase checking, Amex Gold.">
                    {(id) => <Input id={id} value={d.newName} maxLength={80} onChange={(e) => setD({ ...d, newName: e.target.value })} />}
                  </Field>
                  <FieldRow>
                    <Field label="Type">
                      {(id) => (
                        <Select id={id} value={d.newType} onChange={(e) => setD({ ...d, newType: e.target.value })}>
                          {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Institution">{(id) => <Input id={id} value={d.newInstitution} maxLength={80} placeholder="Chase" onChange={(e) => setD({ ...d, newInstitution: e.target.value })} />}</Field>
                  </FieldRow>
                </>
              )}

              {error && (
                <div role="alert" className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive-soft px-3.5 py-3 text-sm">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span className="min-w-0 break-words">{error}</span>
                </div>
              )}
              {error && d.upload && mappingEditor && (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">Choose the columns yourself</p>
                    <p className="text-sm text-muted-foreground">Set at least the date, the description and the amount (or money out and money in), then preview again.</p>
                  </div>
                  {mappingEditor}
                </div>
              )}
            </>
          )}

          {step === 'preview' && preview && (
            <div className={cn('flex flex-col gap-4 transition-opacity', busy && 'opacity-60')}>
              <div className="grid grid-cols-3 gap-2">
                <Count n={preview.new_count} label="new" strong />
                <Count n={preview.duplicate_count} label={preview.duplicate_count === 1 ? 'duplicate' : 'duplicates'} />
                <Count n={preview.skipped_count} label="skipped" />
              </div>
              <p className="tabular text-sm text-muted-foreground">
                {preview.date_from && preview.date_to && (
                  <>
                    {dayLabel(preview.date_from, today)} to {dayLabel(preview.date_to, today)}
                    <span className="mx-1.5">·</span>
                  </>
                )}
                in <Amount value={preview.total_in} />
                <span className="mx-1.5">·</span>out <Amount value={preview.total_out} />
                {preview.new_count > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    {preview.uncategorized_count} uncategorized
                    {preview.transfer_count > 0 && `, ${plural(preview.transfer_count, 'transfer')}`}
                  </>
                )}
              </p>
              {preview.duplicate_count > 0 && <p className="text-sm text-muted-foreground">Duplicates are already recorded for this account and will be left alone.</p>}

              <div className="rounded-lg border bg-card">
                <div className="px-3.5 py-3">
                  <p className="text-sm font-medium">How amounts were read</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{importError(preview.amount_sign.explanation)}</p>
                </div>
                {preview.amount_sign.decided_by === 'amount_column' && (
                  <div className="flex min-h-12 items-center justify-between gap-4 border-t px-3.5 py-2">
                    <label htmlFor="import-invert" className="text-sm">
                      <span className="font-medium">Amounts look inverted</span>
                      <span className="block text-muted-foreground">Purchases below should be negative. Flip them if they are not.</span>
                    </label>
                    <Switch id="import-invert" checked={isFlipped(d, autoApplied)} onCheckedChange={(on) => change({ ...d, amountSign: on && autoApplied ? flipped(autoApplied) : 'auto' })} />
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium">First {preview.sample.length} of {preview.parsed_count} rows, as they would be saved</p>
                <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                  {preview.sample.map((s) => (
                    <li key={s.row} className={cn('flex items-center gap-3 px-3.5 py-2', s.duplicate && 'opacity-55')}>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{s.merchant}</span>
                          {s.duplicate && <Badge variant="outline">Duplicate</Badge>}
                          {s.pending && <Badge variant="outline">Pending</Badge>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {dayLabel(s.date, today)} · {s.category ? (categories.find((c) => c.name === s.category)?.label ?? s.category) : 'Uncategorized'} · {s.description}
                        </span>
                      </span>
                      <Amount value={s.amount} className="shrink-0 text-sm font-medium" />
                    </li>
                  ))}
                </ul>
              </div>

              {preview.skipped.length > 0 && (
                <details className="rounded-lg border bg-card px-3.5 py-2.5 text-sm">
                  <summary className="cursor-pointer font-medium">Why {plural(preview.skipped_count, 'row')} {preview.skipped_count === 1 ? 'was' : 'were'} skipped</summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {preview.skipped.map((s) => (
                      <li key={s.row} className="break-words">
                        Row {s.row}: {s.reason}
                      </li>
                    ))}
                    {preview.skipped_count > preview.skipped.length && <li>and {preview.skipped_count - preview.skipped.length} more.</li>}
                  </ul>
                </details>
              )}

              {preview.ending_balance && (
                <div className="flex min-h-12 items-center justify-between gap-4 rounded-lg border bg-card px-3.5 py-2">
                  <label htmlFor="import-balance" className="text-sm">
                    <span className="font-medium">Set the balance from this file</span>
                    <span className="tabular block text-muted-foreground">
                      {money(preview.ending_balance.balance)} as of {dayLabel(preview.ending_balance.date, today)}
                    </span>
                  </label>
                  <Switch id="import-balance" checked={d.updateBalance} onCheckedChange={(updateBalance) => setD({ ...d, updateBalance })} />
                </div>
              )}

              <details className="rounded-lg border bg-card px-3.5 py-2.5 text-sm">
                <summary className="cursor-pointer font-medium">
                  Columns used
                  <span className="ml-2 font-normal text-muted-foreground">
                    {Object.entries(preview.mapping).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}
                  </span>
                </summary>
                <div className="mt-3 pb-1">{mappingEditor}</div>
              </details>
              <FormError>{error}</FormError>
            </div>
          )}

          {step === 'done' && result && (
            <>
              <div className="flex items-start gap-3 rounded-lg bg-success-soft px-3.5 py-3">
                <Check className="mt-0.5 size-5 shrink-0 text-accent-foreground" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{result.inserted > 0 ? `${plural(result.inserted, 'transaction')} added to ${result.account.name}` : 'Nothing new in this file'}</p>
                  <p className="tabular text-muted-foreground">
                    {result.note ??
                      ([
                        result.duplicate_count ? `${plural(result.duplicate_count, 'duplicate')} left alone` : '',
                        result.skipped_count ? `${plural(result.skipped_count, 'row')} skipped` : '',
                        result.transfer_count ? `${plural(result.transfer_count, 'transfer')}` : '',
                        result.balance_updated ? `balance ${result.balance_updated.is_current ? 'set to' : 'recorded as'} ${money(result.balance_updated.balance)} as of ${dayLabel(result.balance_updated.as_of, today)}` : '',
                      ]
                        .filter(Boolean)
                        .join(', ') || 'Everything was read and categorized.')}
                  </p>
                </div>
              </div>
              {!!result.top_uncategorized?.length && result.batch_id != null && (
                <div>
                  <p className="text-sm font-medium">{plural(result.uncategorized_count, 'transaction')} without a category</p>
                  <p className="mb-2 text-sm text-muted-foreground">Pick a category for a merchant and it is remembered as a rule.</p>
                  <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                    {result.top_uncategorized.map((u) => (
                      <li key={u.merchant} className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{u.merchant}</span>
                          <span className="tabular block text-xs text-muted-foreground">
                            {plural(u.count, 'transaction')}, {money(u.total)}
                          </span>
                        </span>
                        <CategorySelect aria-label={`Category for ${u.merchant}`} className="sm:w-52" value={categorized[u.merchant] ?? ''} onChange={(c) => void categorize(u.merchant, c)} none="Choose a category" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 'pick' && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!d.upload || !d.account || busy || uploading != null || (d.account === 'new' && !d.newName.trim())} onClick={() => void runPreview(d)}>
                {busy ? 'Reading…' : 'Preview'}
              </Button>
            </>
          )}
          {step === 'preview' && preview && (
            <>
              <Button variant="outline" onClick={() => setStep('pick')}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => void commit()}>
                {busy ? 'Working…' : preview.new_count > 0 ? `Import ${plural(preview.new_count, 'transaction')}` : 'Nothing new to import'}
              </Button>
            </>
          )}
          {step === 'done' && result && (
            <>
              {result.batch_id != null && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    go('transactions', { batch: String(result.batch_id) });
                  }}
                >
                  See what was added
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Count({ n, label, strong }: { n: number; label: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2.5', strong && n > 0 && 'border-primary/40 bg-accent/50')}>
      <div className="tabular text-xl leading-tight font-semibold">{n.toLocaleString('en-US')}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function MappingSelect({ field, headers, value, onChange }: { field: MappingField; headers: string[]; value: string; onChange: (header: string) => void }) {
  // Detection compares names loosely; show the stored name even if its spelling differs from the header list.
  const known = headers.some((h) => h === value);
  return (
    <Field label={MAPPING_LABELS[field]}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not used</option>
          {value && !known && <option value={value}>{value}</option>}
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
