import { ChevronDown, ChevronLeft, ChevronUp, Download, ExternalLink, MessageCircle, Pencil, Receipt, Search, SearchX, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog, EmptyState, ErrorState, FormDialog, KeyValues, LoadingRows, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/act';
import { openChat } from '@/lib/chat';
import { bytes, shortDate } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import type { YearDetail, YearsView } from '../taxes/logic';
import { askPrompt, categoryLabel, countHits, docDate, draftError, draftOf, fileKind, findTerms, highlightParts, isImage, searchTerms, updateInput, type DocumentFull, type Draft, type Facets } from './logic';
import { MetadataFields, useDebounced } from './parts';

/** One document: what it is, the file, the text read from it, and what can be done with it. */
export function DocumentDetail({ id, query, backTo, onDeleted }: { id: number; query: string; backTo: string; onDeleted: () => void }) {
  const view = useView<{ document: DocumentFull | null }>('documents/get', { id });
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const back = (
    <Link to={backTo} className="-ml-1.5 flex h-10 w-fit items-center gap-1 rounded-md pr-2.5 pl-1 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground lg:h-8">
      <ChevronLeft className="size-4" />
      Documents
    </Link>
  );

  if (view.data === undefined) {
    return (
      <>
        {back}
        {view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows />}
      </>
    );
  }
  const doc = view.data.document;
  if (!doc) {
    return (
      <>
        {back}
        <EmptyState icon={SearchX} title="There’s no document here" body="It may have been deleted." />
      </>
    );
  }

  const facts: { label: string; value: React.ReactNode }[] = [
    doc.issuer && { label: 'From', value: doc.issuer },
    doc.document_date && { label: 'Document date', value: docDate(doc.document_date) },
    doc.tax_year != null && { label: 'Tax year', value: <span className="tabular">{doc.tax_year}</span> },
    { label: 'File', value: <span className="break-all">{doc.original_filename} <span className="text-muted-foreground">· {fileKind(doc.mime)}, {bytes(doc.size_bytes)}</span></span> },
    { label: 'Filed', value: shortDate(doc.created_at, me?.timezone) },
  ].flatMap((f) => (f ? [f] : []));

  return (
    <>
      <div className="flex flex-col gap-2">
        {back}
        <header className="flex flex-col gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight break-words lg:text-[26px]">{doc.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge>{categoryLabel(doc.category)}</Badge>
              {doc.tags.map((t) => (
                <Link key={t} to={`/documents?tag=${encodeURIComponent(t)}`}>
                  <Badge variant="outline" className="hover:text-foreground">
                    {t}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 @lg/page:flex @lg/page:flex-wrap">
            <Button asChild>
              <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open file
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${doc.file_url}?download=1`} download={doc.original_filename}>
                <Download />
                Download
              </a>
            </Button>
            <Button variant="outline" onClick={() => openChat({ prefill: askPrompt(doc) })} className="col-span-2 @lg/page:col-span-1">
              <MessageCircle />
              Ask Kevin about this document
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              Edit details
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 />
              Delete
            </Button>
          </div>
        </header>
      </div>

      {doc.summary && (
        <Section title="Summary">
          <p className="rounded-xl border bg-card px-4 py-3 leading-relaxed whitespace-pre-wrap break-words">{doc.summary}</p>
        </Section>
      )}

      <Section title="Details">
        <KeyValues items={facts} />
      </Section>

      {doc.notes && (
        <Section title="Notes">
          <p className="rounded-xl border bg-card px-4 py-3 leading-relaxed whitespace-pre-wrap break-words">{doc.notes}</p>
        </Section>
      )}

      <TaxLinks doc={doc} />

      {isImage(doc.mime) && (
        <Section title="The file">
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="block w-fit max-w-full overflow-hidden rounded-xl border bg-card">
            <img src={doc.file_url} alt={`Image of ${doc.title}`} loading="lazy" className="max-h-[70vh] w-auto max-w-full" />
          </a>
        </Section>
      )}

      <ExtractedText key={doc.id} text={doc.extracted_text} initialQuery={query} />

      {editing && <EditDocument doc={doc} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${doc.title}”?`}
        body="The document and its stored file are removed for good. Tax checklist items and deductions that point to it are kept, without the link."
        confirmLabel="Delete document"
        onConfirm={() =>
          void act('document_update', { id: doc.id, delete: true }, { success: 'Document deleted' }).then((r) => {
            if (r.ok) onDeleted();
          })
        }
      />
    </>
  );
}

function EditDocument({ doc, onClose }: { doc: DocumentFull; onClose: () => void }) {
  const facets = useView<Facets>('documents/facets');
  const [draft, setDraft] = useState<Draft>(() => draftOf(doc));
  const [saving, setSaving] = useState(false);
  const error = draftError(draft);
  const save = async () => {
    const input = updateInput(doc, draft);
    if (Object.keys(input).length === 1) return onClose();
    setSaving(true);
    const r = await act('document_update', input, { success: 'Saved' });
    setSaving(false);
    if (r.ok) onClose();
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Edit details" pending={saving} canSubmit={!error} onSubmit={() => void save()}>
      <MetadataFields draft={draft} onChange={setDraft} facets={facets.data} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

/** Where the document is used on the Taxes page: its tax year, and any checklist item or deduction that links to it. */
function TaxLinks({ doc }: { doc: DocumentFull }) {
  const years = useView<YearsView>('taxes/years');
  // The linked rows can sit in any year, so each started year is checked (newest six, plus the document's own).
  const all = (years.data?.years ?? []).map((y) => y.year);
  const check = [...new Set([...(doc.tax_year != null && all.includes(doc.tax_year) ? [doc.tax_year] : []), ...all.slice(0, 6)])];
  if (doc.tax_year == null && !check.length) return null;
  const started = doc.tax_year != null && all.includes(doc.tax_year);
  return (
    <Section title="Taxes">
      <div className="divide-y overflow-hidden rounded-xl border bg-card empty:hidden">
        {doc.tax_year != null && (
          <Link to={`/taxes?year=${doc.tax_year}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted">
            <Receipt className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Belongs to the {doc.tax_year} tax year</span>
              <span className="block text-sm text-muted-foreground">{started ? `Open the ${doc.tax_year} checklist` : `${doc.tax_year} has not been started on the Taxes page yet`}</span>
            </span>
          </Link>
        )}
        {check.map((y) => (
          <YearLinks key={y} year={y} docId={doc.id} />
        ))}
      </div>
    </Section>
  );
}

function YearLinks({ year, docId }: { year: number; docId: number }) {
  const view = useView<YearDetail>('taxes/year', { year });
  const d = view.data;
  if (!d?.exists) return null;
  const items = d.checklist.filter((i) => i.document_id === docId);
  const amounts = [...d.deduction_groups.flatMap((g) => g.items), ...d.payments].filter((x) => x.document_id === docId);
  if (!items.length && !amounts.length) return null;
  return (
    <>
      {items.map((i) => (
        <Link key={`i${i.id}`} to={`/taxes?year=${year}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{i.label}</span>
            <span className="block text-sm text-muted-foreground">Checklist item for {year}</span>
          </span>
          <Badge variant={i.status === 'received' ? 'success' : 'neutral'}>{i.status === 'received' ? 'Received' : i.status === 'expected' ? 'Expected' : 'Not applicable'}</Badge>
        </Link>
      ))}
      {amounts.map((x) => (
        <Link key={`d${x.id}`} to={`/taxes?year=${year}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{x.description}</span>
            <span className="block text-sm text-muted-foreground">{x.category === 'payment' ? 'Tax payment' : 'Deduction'} for {year}</span>
          </span>
          <span className="tabular text-sm text-muted-foreground">${x.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </Link>
      ))}
    </>
  );
}

const COLLAPSED_CHARS = 1500;

/** The text read from the file: collapsed to its start, searchable, with matches marked and stepped through. */
function ExtractedText({ text, initialQuery }: { text: string; initialQuery: string }) {
  const [find, setFind] = useState(initialQuery);
  const [open, setOpen] = useState(() => searchTerms(initialQuery).length > 0);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLPreElement>(null);
  const settled = useDebounced(find, 200);
  const terms = useMemo(() => findTerms(text, settled), [text, settled]);
  const parts = useMemo(() => highlightParts(text, terms), [text, terms]);
  const hits = useMemo(() => countHits(parts), [parts]);
  const long = text.length > COLLAPSED_CHARS;
  const expanded = open || !long;

  // Searching opens the text; the first match is brought into view.
  useEffect(() => {
    if (terms.length && hits > 0) setOpen(true);
    setAt(0);
  }, [terms, hits]);
  // Arriving from a search scrolls to the first match once; after that only stepping scrolls, so typing does not jump the page.
  const scrollNext = useRef(searchTerms(initialQuery).length > 0);
  useLayoutEffect(() => {
    if (!expanded || !hits) return;
    const marks = box.current?.querySelectorAll('mark');
    const el = marks?.[Math.min(at, marks.length - 1)];
    if (!el) return;
    marks.forEach((m) => m.classList.remove('ring-2', 'ring-primary'));
    el.classList.add('ring-2', 'ring-primary');
    if (scrollNext.current) el.scrollIntoView({ block: 'center' });
    scrollNext.current = false;
  }, [at, expanded, hits, parts]);
  const step = (by: number) => {
    scrollNext.current = true;
    setAt((n) => (n + by + hits) % hits);
  };

  if (!text) {
    return (
      <Section title="Text">
        <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">No text could be read from this file, so only its title, summary and notes are searchable.</p>
      </Section>
    );
  }

  // Collapsed, only the start is rendered: a statement can be 200,000 characters.
  const shown = expanded ? parts : highlightParts(text.slice(0, COLLAPSED_CHARS), terms);
  return (
    <Section title="Text" description={`${text.length.toLocaleString('en-US')} characters read from the file`}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find in this text"
            aria-label="Find in this text"
            enterKeyHint="search"
            className="h-11 w-full rounded-md border border-input bg-card pr-9 pl-9 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 lg:h-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits) step(e.shiftKey ? -1 : 1);
            }}
          />
          {find && (
            <button type="button" aria-label="Clear" onClick={() => setFind('')} className="absolute top-1/2 right-0 grid size-10 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground lg:size-9">
              <X className="size-4" />
            </button>
          )}
        </div>
        {terms.length > 0 && (
          <>
            <span role="status" className="tabular shrink-0 text-sm text-muted-foreground">
              {hits ? `${Math.min(at, hits - 1) + 1} of ${hits}` : 'No matches'}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Previous match" disabled={!hits} onClick={() => step(-1)}>
              <ChevronUp />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next match" disabled={!hits} onClick={() => step(1)}>
              <ChevronDown />
            </Button>
          </>
        )}
      </div>
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <pre ref={box} className={cn('px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words', !expanded && 'max-h-56 overflow-hidden')}>
          {shown.map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded-[3px] bg-warning-soft px-0.5 text-foreground">
                {p.text}
              </mark>
            ) : (
              p.text
            ),
          )}
        </pre>
        {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />}
      </div>
      {long && (
        <Button variant="outline" className="self-start" onClick={() => setOpen(!expanded)}>
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? 'Show less' : 'Show all of the text'}
        </Button>
      )}
    </Section>
  );
}
