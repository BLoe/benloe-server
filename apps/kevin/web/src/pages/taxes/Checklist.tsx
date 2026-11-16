import { Ban, Check, CircleDashed, Ellipsis, FileText, FolderOpen, ListPlus, Minus, Paperclip, Pencil, Plus, Trash2, Unlink, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog, Field, FormDialog, List, ListRow, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { act } from '@/lib/act';
import { cn } from '@/lib/utils';
import { AddDocuments } from '../documents/AddDocuments';
import { DocumentPicker } from '../documents/DocumentPicker';
import { documentLink } from '../documents/logic';
import { commonFormsLeft, groupChecklist, inferFormType, itemInput, type ChecklistItem, type ItemDraft, type YearDetail } from './logic';

/** A 44px target: empty ring while expected, a tick once received, a dash when it does not apply. */
function StatusTick({ item, onToggle }: { item: ChecklistItem; onToggle: () => void }) {
  const received = item.status === 'received';
  const na = item.status === 'not_applicable';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={received}
      aria-label={na ? `${item.label}: not applicable. Mark as expected` : `${item.label} received`}
      onClick={onToggle}
      className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-md"
    >
      <span className={cn('grid size-[22px] place-items-center rounded-full border-2 transition-colors', received ? 'border-primary bg-primary text-primary-foreground' : na ? 'border-border bg-secondary text-muted-foreground' : 'border-input bg-card')}>
        {received && <Check className="size-3.5" strokeWidth={3} />}
        {na && <Minus className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

function ItemForm({ year, item, onClose }: { year: number; item: ChecklistItem | null; onClose: () => void }) {
  const [draft, setDraft] = useState<ItemDraft>({ label: item?.label ?? '', form_type: item?.form_type ?? '', notes: item?.notes ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const r = itemInput(item, draft);
    if ('error' in r) return setError(r.error);
    if (item && Object.keys(r.item).length === 1) return onClose();
    setSaving(true);
    const res = await act('tax_checklist_update', { year, items: [r.item] }, { success: item ? 'Saved' : 'Added' });
    setSaving(false);
    if (res.ok) onClose();
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={item ? 'Edit checklist item' : 'Add checklist item'} submitLabel={item ? 'Save' : 'Add item'} pending={saving} canSubmit={draft.label.trim().length > 0} onSubmit={() => void save()}>
      <Field label="What is expected" hint="The document and who sends it.">
        {(id) => <Input id={id} value={draft.label} maxLength={160} autoFocus={!item} placeholder="W-2 from Acme" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />}
      </Field>
      <Field label="Form type" hint="The form number, when there is one.">
        {(id) => <Input id={id} value={draft.form_type} maxLength={40} placeholder="W-2, 1099-INT, 1098" onChange={(e) => setDraft({ ...draft, form_type: e.target.value })} />}
      </Field>
      <Field label="Notes">{(id) => <Textarea id={id} value={draft.notes} rows={3} maxLength={2000} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />}</Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

/** The year's document checklist: what is still expected first, each item with its form, notes and linked document. */
export function Checklist({ detail, year }: { detail: YearDetail; year: number }) {
  const [text, setText] = useState('');
  const [form, setForm] = useState<{ item: ChecklistItem | null } | null>(null);
  const [picking, setPicking] = useState<ChecklistItem | null>(null);
  const [uploading, setUploading] = useState<ChecklistItem | null>(null);
  const [deleting, setDeleting] = useState<ChecklistItem | null>(null);

  const update = (items: Record<string, unknown>[], success?: string) => act('tax_checklist_update', { year, items }, { success });
  const quickAdd = (e: FormEvent) => {
    e.preventDefault();
    const label = text.trim();
    if (!label) return;
    const form_type = inferFormType(label);
    void update([{ label, ...(form_type ? { form_type } : {}) }]);
    setText('');
  };
  const link = (item: ChecklistItem, doc: { id: number; title: string }) => void update([{ id: item.id, document_id: doc.id }], `Linked “${doc.title}”`);
  const common = commonFormsLeft(detail.checklist);
  const groups = groupChecklist(detail.checklist);

  return (
    <Section
      title="Checklist"
      action={
        <>
          {common.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ListPlus />
                  Common forms
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-[60vh] overflow-y-auto">
                {common.map((f) => (
                  // Keep the menu open so several can be added in a row.
                  <DropdownMenuItem
                    key={f.label}
                    onSelect={(e) => {
                      e.preventDefault();
                      void update([{ label: f.label, ...(f.form_type ? { form_type: f.form_type } : {}) }]);
                    }}
                  >
                    <Plus />
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" onClick={() => setForm({ item: null })}>
            <Plus />
            Add item
          </Button>
        </>
      }
    >
      <form onSubmit={quickAdd} className="flex items-center gap-1 rounded-xl border border-input bg-card pr-0 pl-3.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 lg:pr-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an expected document, e.g. W-2 from Acme"
          aria-label="Add an expected document"
          enterKeyHint="done"
          maxLength={160}
          className="h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80"
        />
        <button type="submit" disabled={!text.trim()} aria-label="Add" className="grid size-11 shrink-0 place-items-center rounded-lg text-primary disabled:text-muted-foreground/50 lg:size-9">
          <Plus className="size-5" />
        </button>
      </form>

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          List each document the return needs. Add them one by one above, pick from the common forms, or ask Kevin to draft the list from last year’s papers.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.status} className="flex flex-col gap-1.5">
          <h3 className="px-1 pt-1.5 text-sm font-medium text-muted-foreground">
            {g.title} <span className="tabular font-normal">({g.items.length})</span>
          </h3>
          <List>
            {g.items.map((item) => (
              <ListRow
                key={item.id}
                wrap
                muted={item.status === 'not_applicable'}
                leading={<StatusTick item={item} onToggle={() => void update([{ id: item.id, status: item.status === 'expected' ? 'received' : 'expected' }])} />}
                title={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 break-words">{item.label}</span>
                    {item.form_type && <Badge variant="outline">{item.form_type}</Badge>}
                  </span>
                }
                subtitle={
                  item.notes || item.document_id != null ? (
                    <>
                      {item.notes && <span className="block break-words whitespace-pre-wrap">{item.notes}</span>}
                      {item.document_id != null && (
                        <Link to={documentLink(item.document_id)} className="mt-1 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted">
                          <FileText className="size-4 shrink-0 text-primary" />
                          <span className="min-w-0 break-words">{item.document_title ?? `Document ${item.document_id}`}</span>
                        </Link>
                      )}
                    </>
                  ) : undefined
                }
                trailing={
                  <>
                    {item.document_id == null && item.status !== 'not_applicable' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Attach a document to ${item.label}`}>
                            <Paperclip />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setUploading(item)}>
                            <Upload />
                            Upload a file or photo
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setPicking(item)}>
                            <FolderOpen />
                            Choose from documents
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Options for ${item.label}`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {item.status !== 'received' && (
                          <DropdownMenuItem onSelect={() => void update([{ id: item.id, status: 'received' }])}>
                            <Check />
                            Mark received
                          </DropdownMenuItem>
                        )}
                        {item.status !== 'expected' && (
                          <DropdownMenuItem onSelect={() => void update([{ id: item.id, status: 'expected' }])}>
                            <CircleDashed />
                            Mark still expected
                          </DropdownMenuItem>
                        )}
                        {item.status !== 'not_applicable' && (
                          <DropdownMenuItem onSelect={() => void update([{ id: item.id, status: 'not_applicable' }])}>
                            <Ban />
                            Not applicable this year
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setUploading(item)}>
                          <Upload />
                          Upload and link a file
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPicking(item)}>
                          <FolderOpen />
                          {item.document_id == null ? 'Link a document' : 'Link a different document'}
                        </DropdownMenuItem>
                        {item.document_id != null && (
                          <DropdownMenuItem onSelect={() => void update([{ id: item.id, document_id: null }], 'Link removed')}>
                            <Unlink />
                            Remove the link
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setForm({ item })}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(item)}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            ))}
          </List>
        </div>
      ))}

      {form && <ItemForm key={form.item?.id ?? 'new'} year={year} item={form.item} onClose={() => setForm(null)} />}
      {picking && (
        <DocumentPicker
          title={`Link a document to “${picking.label}”`}
          taxYear={year}
          onClose={() => setPicking(null)}
          onPick={(doc) => {
            link(picking, doc);
            setPicking(null);
          }}
        />
      )}
      {uploading && (
        <AddDocuments
          single
          allowKevin={false}
          heading={`Upload “${uploading.label}”`}
          preset={{ title: `${uploading.label}, ${year}`, category: 'tax', tax_year: String(year), tags: uploading.form_type ? [uploading.form_type.toLowerCase()] : [] }}
          onFiled={(doc) => link(uploading, doc)}
          onClose={() => setUploading(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.label ?? ''}”?`}
        body="The item is removed from this year’s checklist. A linked document stays in your documents."
        confirmLabel="Delete item"
        onConfirm={() => {
          if (deleting) void update([{ id: deleting.id, delete: true }], 'Deleted');
          setDeleting(null);
        }}
      />
    </Section>
  );
}
