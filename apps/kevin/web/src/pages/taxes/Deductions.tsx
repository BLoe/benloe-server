import { ExternalLink, FileText, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog, Field, FieldRow, FormDialog, List, ListRow, Money, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { act } from '@/lib/act';
import { DocumentPicker } from '../documents/DocumentPicker';
import { docDate, documentLink } from '../documents/logic';
import { DEDUCTION_CATEGORIES, DEDUCTION_LABELS, deductionDraft, deductionInput, type Deduction, type DeductionDraft, type YearDetail } from './logic';

function DeductionForm({ year, row, category, onClose }: { year: number; row: Deduction | null; category: string; onClose: () => void }) {
  const [draft, setDraft] = useState<DeductionDraft>(() => deductionDraft(row, category));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const payment = draft.category === 'payment';
  const noun = payment ? 'payment' : 'deduction';

  const save = async () => {
    const r = deductionInput(row, draft);
    if ('error' in r) return setError(r.error);
    setError(null);
    if (row && Object.keys(r.item).length === 1) return onClose();
    setSaving(true);
    const res = await act('tax_deductions_update', { year, items: [r.item] }, { success: row ? 'Saved' : 'Added' });
    setSaving(false);
    if (res.ok) onClose();
  };

  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={row ? `Edit ${noun}` : `Add a ${noun}`}
        submitLabel={row ? 'Save' : `Add ${noun}`}
        pending={saving}
        canSubmit={draft.description.trim().length > 0 && draft.amount.trim().length > 0}
        onSubmit={() => void save()}
        extraAction={
          row && (
            <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => setDeleting(true)}>
              <Trash2 />
              Delete
            </Button>
          )
        }
      >
        <Field label="Category" hint={payment ? 'Estimated tax paid or withholding. Kept apart from deductions.' : undefined}>
          {(id) => (
            <Select id={id} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {DEDUCTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DEDUCTION_LABELS[c]}
                </option>
              ))}
              <option value="payment">Tax payment (not a deduction)</option>
            </Select>
          )}
        </Field>
        <Field label="Description">
          {(id) => <Input id={id} value={draft.description} maxLength={300} autoFocus={!row} placeholder={payment ? 'Q2 federal estimated payment' : 'Donation to City Harvest'} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}
        </Field>
        <FieldRow>
          <Field label="Amount">
            {(id) => (
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
                <Input id={id} value={draft.amount} inputMode="decimal" className="tabular pl-7" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
              </div>
            )}
          </Field>
          <Field label="Date paid">{(id) => <Input id={id} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />}</Field>
        </FieldRow>
        <Field label="Receipt or statement">
          {draft.document_id != null ? (
            <div className="flex flex-col gap-2">
              <Link to={documentLink(draft.document_id)} className="flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted lg:min-h-9">
                <FileText className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 break-words">{draft.document_title ?? `Document ${draft.document_id}`}</span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </Link>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                  Change
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, document_id: null, document_title: null })}>
                  Remove the link
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="justify-start" onClick={() => setPicking(true)}>
              <Paperclip />
              Link a document
            </Button>
          )}
        </Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={draft.notes} rows={2} maxLength={2000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />}</Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FormDialog>
      {picking && (
        <DocumentPicker
          title="Link a receipt or statement"
          taxYear={year}
          onClose={() => setPicking(false)}
          onPick={(doc) => {
            setDraft({ ...draft, document_id: doc.id, document_title: doc.title });
            setPicking(false);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${row?.description ?? ''}”?`}
        body="The amount is removed from this year’s totals."
        confirmLabel={`Delete ${noun}`}
        onConfirm={() => {
          if (row) void act('tax_deductions_update', { year, items: [{ id: row.id, delete: true }] }, { success: 'Deleted' });
          onClose();
        }}
      />
    </>
  );
}

function Rows({ rows, onOpen }: { rows: Deduction[]; onOpen: (d: Deduction) => void }) {
  return (
    <List>
      {rows.map((d) => (
        <ListRow
          key={d.id}
          onClick={() => onOpen(d)}
          wrap
          title={<span className="break-words">{d.description}</span>}
          subtitle={
            d.date || d.notes || d.document_id != null ? (
              <>
                {[docDate(d.date), d.notes].filter(Boolean).join(' · ')}
                {d.document_id != null && (
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="min-w-0 break-words">{d.document_title ?? `Document ${d.document_id}`}</span>
                  </span>
                )}
              </>
            ) : undefined
          }
          meta={<Money amount={d.amount} className="text-[15px] text-foreground" />}
        />
      ))}
    </List>
  );
}

/** Deductions by category with totals, and tax payments kept apart with their own total. */
export function Deductions({ detail, year }: { detail: YearDetail; year: number }) {
  const [form, setForm] = useState<{ row: Deduction | null; category: string } | null>(null);
  return (
    <>
      <Section
        title="Deductions"
        description={detail.deduction_groups.length ? undefined : 'Charitable gifts, medical costs, property tax, mortgage interest and anything else that belongs on the return.'}
        action={
          <Button variant="outline" size="sm" onClick={() => setForm({ row: null, category: 'charity' })}>
            <Plus />
            Add deduction
          </Button>
        }
      >
        {detail.deduction_groups.map((g) => (
          <div key={g.category} className="flex flex-col gap-1.5">
            <h3 className="flex items-baseline justify-between gap-3 px-1 pt-1.5 text-sm font-medium text-muted-foreground">
              <span>{g.label}</span>
              <Money amount={g.total} className="pr-3 text-foreground" />
            </h3>
            <Rows rows={g.items} onOpen={(row) => setForm({ row, category: row.category })} />
          </div>
        ))}
        {detail.deduction_groups.length > 0 && (
          <p className="flex items-baseline justify-between gap-3 rounded-xl border bg-card px-4 py-3 font-semibold">
            <span>Total deductions</span>
            <Money amount={detail.deductions_total} />
          </p>
        )}
      </Section>

      <Section
        title="Tax payments"
        description={detail.payments.length ? 'Estimated tax paid and withholding. Not counted as deductions.' : 'Estimated tax payments and withholding notes go here, apart from deductions.'}
        action={
          <Button variant="outline" size="sm" onClick={() => setForm({ row: null, category: 'payment' })}>
            <Plus />
            Add payment
          </Button>
        }
      >
        {detail.payments.length > 0 && (
          <>
            <Rows rows={detail.payments} onOpen={(row) => setForm({ row, category: row.category })} />
            <p className="flex items-baseline justify-between gap-3 rounded-xl border bg-card px-4 py-3 font-semibold">
              <span>Total payments</span>
              <Money amount={detail.payments_total} />
            </p>
          </>
        )}
      </Section>

      {form && <DeductionForm key={form.row?.id ?? `new-${form.category}`} year={year} row={form.row} category={form.category} onClose={() => setForm(null)} />}
    </>
  );
}
