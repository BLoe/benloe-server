import { Check, Paperclip, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { dueLabel, dueState, formatValue, hasValue, safeUrl, type DueState, type Field, type Space, type SpaceRecord } from '@/lib/spaces';
import { cn } from '@/lib/utils';

/** What every layout is given. */
export interface LayoutProps {
  space: Space;
  records: SpaceRecord[];
  today: string;
  /** Opens the edit sheet. */
  onOpen: (r: SpaceRecord) => void;
  onToggle: (r: SpaceRecord) => void;
  /** Adds a record by title (plus field values, for a board column). */
  onAdd: (title: string, data?: Record<string, unknown>) => void;
  /** Opens the sheet for a new record. */
  onNew: (preset?: Record<string, unknown>) => void;
  onMove: (r: SpaceRecord, data: Record<string, unknown>) => void;
}

const dueTone: Record<DueState, BadgeVariant> = { overdue: 'danger', today: 'warning', soon: 'warning', later: 'neutral' };

export function DueChip({ record, today }: { record: Pick<SpaceRecord, 'due_on' | 'done'>; today: string }) {
  if (!record.due_on) return null;
  const state = dueState(record.due_on, today, record.done);
  // A finished record keeps its date, without the urgency.
  if (!state) return <Badge variant="outline">{formatValue({ key: 'due', label: 'Due', type: 'date' }, record.due_on, today)}</Badge>;
  return <Badge variant={dueTone[state]}>{dueLabel(record.due_on, today)}</Badge>;
}

/** A paperclip and a count, for a record that has files. */
export function Clip({ record }: { record: Pick<SpaceRecord, 'attachments'> }) {
  const n = record.attachments?.length ?? 0;
  if (!n) return null;
  return (
    <span className="tabular inline-flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground" aria-label={`${n} ${n === 1 ? 'file' : 'files'} attached`}>
      <Paperclip className="size-3.5" />
      {n}
    </span>
  );
}

/** A 44px tap target around a 22px box. */
export function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange} className="grid size-11 shrink-0 place-items-center rounded-md">
      <span className={cn('grid size-[22px] place-items-center rounded-md border-2 transition-colors', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}>
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** One line to add a record by its title; the keyboard stays up for the next one. */
export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    onAdd(title);
    setText('');
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1 rounded-xl border border-input bg-card pr-0 pl-3.5 lg:pr-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} enterKeyHint="done" maxLength={300} className="h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80" />
      <button type="submit" disabled={!text.trim()} aria-label="Add" className="grid size-11 shrink-0 place-items-center rounded-lg text-primary disabled:text-muted-foreground/50 lg:size-9">
        <Plus className="size-5" />
      </button>
    </form>
  );
}

/** A field's value for reading: links are links, everything else is text. */
export function Value({ field, value, today }: { field: Field; value: unknown; today?: string }) {
  if (!hasValue(value)) return <span className="text-muted-foreground/60">—</span>;
  const href = field.type === 'url' ? safeUrl(value) : null;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary underline underline-offset-2">
        {formatValue(field, value)}
      </a>
    );
  }
  return <span className={cn(field.type === 'number' || field.type === 'money' ? 'tabular' : undefined, 'break-words')}>{formatValue(field, value, today)}</span>;
}
