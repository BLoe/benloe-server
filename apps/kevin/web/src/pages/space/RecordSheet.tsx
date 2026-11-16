import { ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Field as FormField, FieldRow, FormDialog } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Attachments } from './Attachments';
import { draftOf, recordInput, safeUrl, type Field, type RecordInput, type Space, type SpaceRecord } from '@/lib/spaces';

function FieldInput({ id, field, value, onChange }: { id: string; field: Field; value: string; onChange: (v: string) => void }) {
  switch (field.type) {
    case 'longtext':
      return <Textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input id={id} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />;
    case 'money':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
          <Input id={id} value={value} inputMode="decimal" className="tabular pl-7" onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'date':
      return <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <Switch id={id} checked={value === 'true'} onCheckedChange={(on) => onChange(on ? 'true' : '')} />;
    case 'select':
      return (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">None</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {/* A value from before the choices changed stays selectable until it is replaced. */}
          {value && !(field.options ?? []).includes(value) && <option value={value}>{value}</option>}
        </Select>
      );
    case 'url': {
      const href = safeUrl(value) ?? safeUrl(`https://${value}`);
      return (
        <div className="flex gap-2">
          <Input id={id} type="url" inputMode="url" autoCapitalize="off" value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
          {value.trim() && href && (
            <Button asChild variant="outline" size="icon" aria-label="Open the link">
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
              </a>
            </Button>
          )}
        </div>
      );
    }
    default:
      return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Add or edit one record: title, the space's own fields with inputs that fit their types, due date, done, notes. */
export function RecordSheet({ space, record, preset, onSave, onClose }: {
  space: Space;
  /** null adds a new record. */
  record: SpaceRecord | null;
  /** Field values a new record starts with (the board column it was added to). */
  preset?: Record<string, unknown>;
  onSave: (records: (RecordInput & { delete?: boolean })[], opts?: { success?: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(space, record, preset));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const notes = space.layout === 'notes';
  const noun = notes ? 'note' : 'item';

  const save = async () => {
    const r = recordInput(space, record, draft);
    if ('error' in r) return setError(r.error);
    setError(null);
    // Nothing changed: just close.
    if (record && Object.keys(r.input).length === 1) return onClose();
    setSaving(true);
    const ok = await onSave([r.input], { success: record ? 'Saved' : 'Added' });
    setSaving(false);
    if (ok) onClose();
  };

  const body = (
    <FormField label={notes ? 'Note' : 'Notes'} hint="Markdown works here: lists, links, **bold**.">
      {(id) => <Textarea id={id} value={draft.body} rows={notes ? 12 : 4} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
    </FormField>
  );

  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={record ? `Edit ${noun}` : `New ${noun}`}
        submitLabel={record ? 'Save' : `Add ${noun}`}
        pending={saving}
        canSubmit={draft.title.trim().length > 0 && !uploading}
        onSubmit={() => void save()}
        extraAction={
          record && (
            <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => setDeleting(true)}>
              <Trash2 />
              Delete
            </Button>
          )
        }
      >
        <FormField label="Title">{(id) => <Input id={id} value={draft.title} maxLength={300} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus={!record} />}</FormField>
        {notes && body}
        {space.fields.map((f) => (
          <FormField key={f.key} label={f.label}>
            {(id) => <FieldInput id={id} field={f} value={draft.data[f.key] ?? ''} onChange={(v) => setDraft({ ...draft, data: { ...draft.data, [f.key]: v } })} />}
          </FormField>
        ))}
        <FieldRow>
          <FormField label="Due">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="date" value={draft.due_on} onChange={(e) => setDraft({ ...draft, due_on: e.target.value })} />
                {draft.due_on && (
                  <Button variant="outline" onClick={() => setDraft({ ...draft, due_on: '' })}>
                    Clear
                  </Button>
                )}
              </div>
            )}
          </FormField>
          <FormField label="Done">{(id) => <Switch id={id} checked={draft.done} onCheckedChange={(done) => setDraft({ ...draft, done })} />}</FormField>
        </FieldRow>
        {!notes && body}
        <Attachments files={draft.attachments} onChange={(attachments) => setDraft((d) => ({ ...d, attachments }))} onBusy={setUploading} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FormDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${record?.title ?? ''}”?`}
        body="This cannot be undone."
        confirmLabel={`Delete ${noun}`}
        onConfirm={() => {
          if (record) void onSave([{ id: record.id, delete: true }], { success: 'Deleted' });
          onClose();
        }}
      />
    </>
  );
}
