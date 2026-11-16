import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Chips, Field as FormField, FormDialog } from '@/components/page';
import { SpaceIcon, useIcon } from '@/components/SpaceIcon';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useAct } from '@/lib/act';
import { FIELD_TYPES, fieldDrafts, fieldInputs, fieldTypeLabel, iconName, keyify, LAYOUTS, layoutHint, layoutLabel, parseOptions, type FieldDraft, type FieldType, type Layout, type Space } from '@/lib/spaces';
import { cn } from '@/lib/utils';

const ICONS = ['list-checks', 'plane', 'car', 'book-open', 'house', 'gift', 'briefcase', 'heart-pulse', 'wrench', 'graduation-cap', 'dog', 'music', 'shopping-bag', 'leaf', 'baby', 'lightbulb'];

/** Create a space, or change one: name, look, layout and its fields. */
export function SpaceForm({ space, onClose }: { space: Space | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { run, pending } = useAct();
  const [name, setName] = useState(space?.name ?? '');
  const [description, setDescription] = useState(space?.description ?? '');
  const [icon, setIcon] = useState(space?.icon ?? '');
  const [layout, setLayout] = useState<Layout>(space?.layout ?? 'list');
  const [fields, setFields] = useState<FieldDraft[]>(() => fieldDrafts(space?.fields ?? []));
  const [boardKey, setBoardKey] = useState(space?.board_field ?? '');
  const [error, setError] = useState<string | null>(null);
  const unknownIcon = useIcon(icon) === null && icon.trim() !== '';

  const patch = (i: number, p: Partial<FieldDraft>) => setFields((fs) => fs.map((f, n) => (n === i ? { ...f, ...p } : f)));
  const swap = (i: number, j: number) =>
    setFields((fs) => {
      const next = fs.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    // A board cannot exist without columns: start it with a sensible set.
    if (l === 'board' && !fields.some((f) => f.type === 'select')) setFields((fs) => [...fs, { label: 'Status', type: 'select', options: 'To do\nDoing\nDone' }]);
  };
  const selects = fields.filter((f) => f.type === 'select' && f.label.trim());

  const save = async () => {
    const parsed = fieldInputs(fields, layout);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    const chosen = selects.find((f) => (f.key ?? f.label) === boardKey) ?? selects[0];
    const input = {
      ...(space ? { space: space.slug } : {}),
      name: name.trim(),
      description: description.trim() || null,
      icon: iconName(icon) || null,
      layout,
      fields: parsed.fields,
      // An existing field is named by its key; a new one gets its key from its label on the server.
      ...(layout === 'board' ? { board_field: chosen ? (chosen.key ?? keyify(chosen.label)) : null } : {}),
    };
    const r = await run<Space>('space_save', input, { success: space ? 'Space saved' : 'Space created', silent: true });
    // The server says why (a field type change that a stored value cannot follow, a taken name): keep it in the form.
    if (!r.ok) return setError(r.error);
    onClose();
    if (!space) void navigate(r.result.link);
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={space ? 'Edit space' : 'New space'} description={space ? undefined : 'A page of its own for anything you want to keep track of.'} submitLabel={space ? 'Save space' : 'Create space'} pending={pending} canSubmit={name.trim().length > 0} onSubmit={() => void save()}>
      <FormField label="Name">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Portugal trip" autoFocus={!space} />}</FormField>
      <FormField label="What it’s for" hint="One line. Kevin reads this to decide what belongs here.">
        {(id) => <Input id={id} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}
      </FormField>

      <FormField label="Layout" hint={layoutHint[layout]}>
        <Chips value={layout} onChange={chooseLayout} options={LAYOUTS.map((l) => ({ value: l, label: layoutLabel[l] }))} />
      </FormField>

      <FormField label="Icon" hint={unknownIcon ? 'No icon has that name; the default shape will show.' : 'Pick one, or type any lucide icon name.'}>
        {(id) => (
          <>
            <div className="flex flex-wrap gap-1">
              {ICONS.map((n) => (
                <button key={n} type="button" onClick={() => setIcon(n)} aria-label={n.replace(/-/g, ' ')} aria-pressed={iconName(icon) === n} className={cn('grid size-10 place-items-center rounded-md border', iconName(icon) === n ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent text-muted-foreground hover:bg-secondary')}>
                  <SpaceIcon name={n} className="size-5" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="grid size-11 shrink-0 place-items-center rounded-md border bg-card lg:size-9">
                <SpaceIcon name={icon} className="size-5" />
              </span>
              <Input id={id} value={icon} maxLength={40} autoCapitalize="off" spellCheck={false} onChange={(e) => setIcon(e.target.value)} placeholder="shapes" />
            </div>
          </>
        )}
      </FormField>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Fields</div>
        <p className="text-sm text-muted-foreground">Every item already has a title, a due date, done, and notes. Add fields for anything else you want on each one.</p>
        {fields.map((f, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border bg-card p-2.5">
            <div className="flex gap-2">
              <Input value={f.label} maxLength={60} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Field name" aria-label={`Field ${i + 1} name`} className="min-w-0 flex-1" />
              <Select value={f.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })} aria-label={`Field ${i + 1} type`} className="w-32 shrink-0">
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {fieldTypeLabel[t]}
                  </option>
                ))}
              </Select>
            </div>
            {f.type === 'select' && (
              <Textarea value={f.options} rows={Math.min(6, Math.max(2, parseOptions(f.options).length + 1))} onChange={(e) => patch(i, { options: e.target.value })} placeholder={'One choice per line\nTo do\nDone'} aria-label={`Choices for ${f.label || `field ${i + 1}`}`} />
            )}
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label={`Move ${f.label || 'field'} up`}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={i === fields.length - 1} onClick={() => swap(i, i + 1)} aria-label={`Move ${f.label || 'field'} down`}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setFields((fs) => fs.filter((_, n) => n !== i))} aria-label={`Remove ${f.label || 'field'}`}>
                <X />
              </Button>
            </div>
          </div>
        ))}
        {fields.length < 20 && (
          <Button variant="outline" className="self-start" onClick={() => setFields((fs) => [...fs, { label: '', type: 'text', options: '' }])}>
            <Plus />
            Add field
          </Button>
        )}
      </div>

      {layout === 'board' && selects.length > 1 && (
        <FormField label="Columns come from">
          {(id) => (
            <Select id={id} value={selects.some((f) => (f.key ?? f.label) === boardKey) ? boardKey : (selects[0]!.key ?? selects[0]!.label)} onChange={(e) => setBoardKey(e.target.value)}>
              {selects.map((f) => (
                <option key={f.key ?? f.label} value={f.key ?? f.label}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}
