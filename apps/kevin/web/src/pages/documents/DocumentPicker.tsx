import { FileText, Search } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, LoadingRows } from '@/components/page';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { categoryLabel, docDate, type DocumentInfo, type ListResult } from './logic';
import { useDebounced, useLatest } from './parts';

/**
 * Choose a document already in the vault (to link it to a checklist item or
 * a deduction). With `taxYear` it starts on that year's documents; one tap
 * widens it to everything.
 */
export function DocumentPicker({ title, description, taxYear, onPick, onClose }: {
  title: string;
  description?: string;
  taxYear?: number;
  onPick: (doc: DocumentInfo) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [yearOnly, setYearOnly] = useState(taxYear != null);
  const q = useDebounced(text, 250).trim();
  const view = useView<ListResult>('documents/list', { q: q || undefined, tax_year: yearOnly && taxYear != null ? taxYear : undefined, limit: 50 });
  const data = useLatest(view.data);
  const scope = (on: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={yearOnly === on}
      onClick={() => setYearOnly(on)}
      className={cn('h-9 rounded-full border px-3.5 text-sm font-medium lg:h-8', yearOnly === on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[85dvh] lg:h-[70vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-2.5 px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search documents"
              aria-label="Search documents"
              enterKeyHint="search"
              className="h-11 w-full rounded-md border border-input bg-card pr-3 pl-9 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 lg:h-9"
            />
          </div>
          {taxYear != null && (
            <div className="flex gap-1.5">
              {scope(true, `Tax year ${taxYear}`)}
              {scope(false, 'All documents')}
            </div>
          )}
        </div>
        <DialogBody className="pb-5">
          {data === undefined ? (
            view.error ? <ErrorState message={view.error} onRetry={view.refetch} /> : <LoadingRows />
          ) : data.documents.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {q ? 'No document matches that.' : yearOnly && taxYear != null ? `No document is marked for tax year ${taxYear}.` : 'There are no documents yet.'}
              {yearOnly && taxYear != null && (
                <>
                  {' '}
                  <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => setYearOnly(false)}>
                    Look in all documents
                  </button>
                </>
              )}
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {data.documents.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => onPick(d)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted active:bg-secondary">
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug break-words">{d.title}</span>
                      <span className="block text-sm text-muted-foreground">{[categoryLabel(d.category), d.issuer, docDate(d.document_date)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
