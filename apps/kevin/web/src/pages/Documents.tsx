import { FileText, Image as ImageIcon, MessageCircle, Plus, Search, SearchX, Upload, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { EmptyState, ErrorState, List, ListRow, LoadingRows, Page, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { openChat } from '@/lib/chat';
import { plural } from '@/lib/format';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { AddDocuments } from './documents/AddDocuments';
import { DocumentDetail } from './documents/DocumentDetail';
import { categoryLabel, docDate, filtersFromSearch, hasFilters, isImage, listParams, searchTerms, withParams, type DocumentInfo, type Facets, type ListResult } from './documents/logic';
import { FacetChips, Highlight, useDebounced, useLatest } from './documents/parts';

const PAGE_SIZE = 200;
const TAGS_SHOWN = 10;

function Row({ doc, terms, onOpen }: { doc: DocumentInfo; terms: string[]; onOpen: () => void }) {
  const body = doc.snippet ?? doc.summary;
  return (
    <ListRow
      onClick={onOpen}
      wrap
      leading={isImage(doc.mime) ? <ImageIcon /> : <FileText />}
      title={
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words">
            <Highlight text={doc.title} terms={terms} />
          </span>
          {doc.document_date && <span className="tabular shrink-0 text-sm font-normal text-muted-foreground">{docDate(doc.document_date)}</span>}
        </span>
      }
      subtitle={
        <>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge>{categoryLabel(doc.category)}</Badge>
            {doc.issuer && <span>{doc.issuer}</span>}
            {doc.tax_year != null && <span className="tabular">Tax {doc.tax_year}</span>}
            {doc.tags.map((t) => (
              <span key={t} className="text-muted-foreground/80">
                #{t}
              </span>
            ))}
          </span>
          {body && (
            <span className={cn('mt-1 block break-words', doc.snippet ? 'line-clamp-3 text-foreground/80' : 'line-clamp-2')}>
              <Highlight text={body} terms={doc.snippet ? terms : []} />
            </span>
          )}
        </>
      }
    />
  );
}

/** /documents: the vault. ?q= &category= &tag= &year= filter the list; ?doc=<id> shows one document. */
export default function DocumentsPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const filters = filtersFromSearch(sp);
  const docParam = sp.get('doc');
  const docId = docParam && /^\d+$/.test(docParam) ? Number(docParam) : null;

  // The search box: typing updates the URL once it pauses; a URL changed elsewhere (back, a link) updates the box.
  const [text, setText] = useState(filters.q);
  const settled = useDebounced(text, 250);
  const pushed = useRef(filters.q);
  useEffect(() => {
    if (settled === pushed.current) return;
    pushed.current = settled;
    setSp((cur) => withParams(cur, { q: settled.trim() }), { replace: true });
  }, [settled, setSp]);
  useEffect(() => {
    if (filters.q.trim() === pushed.current.trim()) return;
    pushed.current = filters.q;
    setText(filters.q);
  }, [filters.q]);

  const [limit, setLimit] = useState(PAGE_SIZE);
  const [allTags, setAllTags] = useState(false);
  const [adding, setAdding] = useState<{ files?: File[] } | null>(null);
  const [over, setOver] = useState(false);

  const facets = useView<Facets>('documents/facets');
  const list = useView<ListResult>('documents/list', listParams(filters, limit));
  const data = useLatest(list.data);
  const terms = searchTerms(filters.q);
  const set = (patch: Record<string, string | null>) => {
    setLimit(PAGE_SIZE);
    setSp((cur) => withParams(cur, patch), { replace: true });
  };

  // Opening a document replaces the list; coming back puts the list where it was.
  const scroll = useRef(0);
  const main = () => document.querySelector('main');
  const open = (id: number) => {
    scroll.current = main()?.scrollTop ?? 0;
    setSp((cur) => withParams(cur, { doc: id }));
  };
  const showing = docId != null;
  useLayoutEffect(() => {
    const el = main();
    if (el) el.scrollTop = showing ? 0 : scroll.current;
  }, [showing, docId]);

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) setAdding({ files });
  };

  if (docId != null) {
    const rest = withParams(sp, { doc: null }).toString();
    const backTo = `/documents${rest ? `?${rest}` : ''}`;
    return (
      <Page className="gap-6">
        <DocumentDetail key={docId} id={docId} query={filters.q} backTo={backTo} onDeleted={() => void navigate(backTo, { replace: true })} />
      </Page>
    );
  }

  const total = facets.data?.total;
  const filtered = hasFilters(filters);
  const tags = facets.data?.tags ?? [];
  const shownTags = allTags ? tags : tags.filter((t, i) => i < TAGS_SHOWN || t.tag === filters.tag);

  return (
    <div
      className="min-h-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || adding) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <Page className="gap-5">
        <PageHeader
          title="Documents"
          description="Medical, insurance, tax and other papers, kept and searchable."
          actions={
            <>
              <Button variant="outline" onClick={() => openChat({ prefill: 'In my documents: ' })}>
                <MessageCircle />
                Ask Kevin
              </Button>
              <Button onClick={() => setAdding({})}>
                <Plus />
                Add document
              </Button>
            </>
          }
        />

        {over && (
          <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-accent px-4 py-6 text-sm font-medium text-accent-foreground">
            <Upload className="size-4" />
            Drop to add to your documents
          </div>
        )}

        {total === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            body="Keep the papers you would otherwise dig for: lab results and bills, insurance policies and EOBs, tax forms, statements, titles, receipts for big purchases. Add a PDF or photograph a letter; its text is read once so you can search it and ask Kevin about it."
            action={
              <>
                <Button onClick={() => setAdding({})}>
                  <Plus />
                  Add document
                </Button>
                <Button variant="outline" onClick={() => openChat({ prefill: 'File this in my documents: ' })}>
                  <MessageCircle />
                  Send one to Kevin
                </Button>
              </>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Search titles and the text inside"
                  aria-label="Search documents"
                  enterKeyHint="search"
                  className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 lg:h-10 [&::-webkit-search-cancel-button]:hidden"
                />
                {text && (
                  <button type="button" aria-label="Clear search" onClick={() => setText('')} className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground lg:size-10">
                    <X className="size-4" />
                  </button>
                )}
              </div>
              {facets.data && (
                <>
                  <FacetChips
                    label="Category"
                    value={filters.category}
                    onChange={(v) => set({ category: v || null })}
                    all={{ count: facets.data.total }}
                    options={facets.data.categories.map((c) => ({ value: c.category, label: categoryLabel(c.category), count: c.count }))}
                  />
                  {facets.data.tax_years.length > 0 && (
                    <FacetChips label="Tax year" value={filters.year} onChange={(v) => set({ year: v || null })} options={facets.data.tax_years.map((y) => ({ value: String(y.tax_year), label: String(y.tax_year), count: y.count }))} />
                  )}
                  {tags.length > 0 && (
                    <FacetChips
                      label="Tag"
                      value={filters.tag}
                      onChange={(v) => (v === '__more' ? setAllTags(true) : set({ tag: v || null }))}
                      options={[...shownTags.map((t) => ({ value: t.tag, label: t.tag, count: t.count })), ...(shownTags.length < tags.length ? [{ value: '__more', label: `${tags.length - shownTags.length} more…` }] : [])]}
                    />
                  )}
                </>
              )}
            </div>

            {data === undefined ? (
              list.error ? <ErrorState message={list.error} onRetry={list.refetch} /> : <LoadingRows rows={5} />
            ) : data.documents.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nothing matches"
                body={filters.q.trim() ? 'No document has those words in its title, tags or text. Kevin can look more loosely.' : 'No document has that combination of filters.'}
                action={
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setText('');
                        set({ q: null, category: null, tag: null, year: null });
                      }}
                    >
                      Clear filters
                    </Button>
                    {filters.q.trim() && (
                      <Button variant="outline" onClick={() => openChat({ send: `Find this in my documents: ${filters.q.trim()}`, newThread: true })}>
                        <MessageCircle />
                        Ask Kevin to find it
                      </Button>
                    )}
                  </>
                }
              />
            ) : (
              <div className={cn('flex flex-col gap-2.5 transition-opacity', list.loading && 'opacity-60')}>
                <p className="text-sm text-muted-foreground" role="status">
                  {filtered ? `${plural(data.total, 'document')} of ${total ?? data.total}${filters.q.trim() ? ', best match first' : ''}` : `${plural(data.total, 'document')}, newest document date first`}
                </p>
                <List>
                  {data.documents.map((d) => (
                    <Row key={d.id} doc={d} terms={terms} onOpen={() => open(d.id)} />
                  ))}
                </List>
                {data.total > data.documents.length && (
                  <Button variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                    Show more
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {adding && <AddDocuments initialFiles={adding.files} onClose={() => setAdding(null)} onOpenDocument={(id) => setSp((cur) => withParams(cur, { doc: id }))} />}
      </Page>
    </div>
  );
}
