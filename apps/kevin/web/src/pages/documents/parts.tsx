// Small pieces shared by the Documents and Taxes pages.
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Field, FieldRow } from '@/components/page';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CATEGORIES, categoryLabel, cleanTags, highlightParts, parseTagInput, tagSuggestions, type Draft, type Facets } from './logic';

/** A value that follows `value` after it has been still for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The last defined value: keeps a list on screen while its next answer loads. */
export function useLatest<T>(value: T | undefined): T | undefined {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return value ?? ref.current;
}

/** Text with the search terms marked. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-warning-soft px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

export interface FacetOption { value: string; label: ReactNode; count?: number }

/**
 * One row of filter chips with counts. Tapping the chosen chip clears it.
 * Scrolls sideways on a phone, wraps on desktop.
 */
export function FacetChips({ label, options, value, onChange, all }: { label: string; options: FacetOption[]; value: string; onChange: (v: string) => void; all?: { count: number } }) {
  const chip = (active: boolean) =>
    cn(
      'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors lg:h-8',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
    );
  const count = (n: number | undefined, active: boolean) => (n === undefined ? null : <span className={cn('tabular text-xs font-normal', active ? 'opacity-80' : 'opacity-70')}>{n}</span>);
  return (
    <div role="group" aria-label={label} className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      {all && (
        <button type="button" aria-pressed={!value} onClick={() => onChange('')} className={chip(!value)}>
          All {count(all.count, !value)}
        </button>
      )}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value === value ? '' : o.value)} className={chip(o.value === value)}>
          {o.label} {count(o.count, o.value === value)}
        </button>
      ))}
    </div>
  );
}

/** Tags as removable chips, a box to type more (Enter or comma adds), and existing tags to tap. */
export function TagInput({ id, value, onChange, suggestions }: { id?: string; value: string[]; onChange: (tags: string[]) => void; suggestions: { tag: string; count: number }[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = cleanTags([...value, ...parseTagInput(raw)]);
    if (next.join('\n') !== value.join('\n')) onChange(next);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter must not submit the form while a tag is being typed.
      if (text.trim() || e.key === ',') e.preventDefault();
      if (text.trim()) add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const offered = tagSuggestions(suggestions, value, text);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 lg:min-h-9 lg:py-1">
        {value.map((t) => (
          <span key={t} className="flex h-8 items-center gap-0.5 rounded-full bg-secondary pr-0.5 pl-3 text-sm lg:h-7">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:text-foreground lg:size-6">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? 'Add another' : 'e.g. dental, hsa'}
          autoCapitalize="off"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={40}
          className="h-8 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground/80 lg:h-7"
        />
      </div>
      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {offered.map((t) => (
            <button key={t} type="button" onClick={() => add(t)} className="h-8 rounded-full border border-dashed px-3 text-sm text-muted-foreground hover:border-solid hover:text-foreground lg:h-7">
              + {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The metadata fields of a document, used when filing a new one and when editing. */
export function MetadataFields({ draft, onChange, facets, autoFocusTitle }: { draft: Draft; onChange: (d: Draft) => void; facets?: Facets; autoFocusTitle?: boolean }) {
  const set = <K extends keyof Draft>(key: K, v: Draft[K]) => onChange({ ...draft, [key]: v });
  return (
    <>
      <Field label="Title" hint="What it is, from whom, for when.">
        {(id) => <Input id={id} value={draft.title} maxLength={200} autoFocus={autoFocusTitle} onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <FieldRow>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={draft.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Document date">{(id) => <Input id={id} type="date" value={draft.document_date} onChange={(e) => set('document_date', e.target.value)} />}</Field>
      </FieldRow>
      <FieldRow>
        <Field label="From">{(id) => <Input id={id} value={draft.issuer} maxLength={120} placeholder="Aetna, IRS, Dr. Alvarez" onChange={(e) => set('issuer', e.target.value)} />}</Field>
        <Field label="Tax year" hint={draft.tax_year ? undefined : 'Only if it matters for a return.'}>
          {(id) => <Input id={id} value={draft.tax_year} inputMode="numeric" maxLength={4} placeholder="None" className="tabular" onChange={(e) => set('tax_year', e.target.value.replace(/\D/g, ''))} />}
        </Field>
      </FieldRow>
      <Field label="Tags">{(id) => <TagInput id={id} value={draft.tags} onChange={(tags) => set('tags', tags)} suggestions={facets?.tags ?? []} />}</Field>
      <Field label="Summary" hint="The facts you would look this up for: amounts, dates, the account or claim.">
        {(id) => <Textarea id={id} value={draft.summary} rows={3} maxLength={1500} onChange={(e) => set('summary', e.target.value)} />}
      </Field>
      <Field label="Notes">{(id) => <Textarea id={id} value={draft.notes} rows={2} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />}</Field>
    </>
  );
}
