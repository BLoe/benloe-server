import { Camera, CircleAlert, FileText, FolderOpen, LoaderCircle, MessageCircle, Upload as UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { act } from '@/lib/act';
import { openChat, uploadFile } from '@/lib/chat';
import { bytes } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { Upload } from '@/lib/types';
import { useView } from '@/lib/useView';
import { cn } from '@/lib/utils';
import { draftError, duplicateOf, ingestInput, newDraft, type DocumentInfo, type Draft, type Facets } from './logic';
import { MetadataFields } from './parts';

// What the server can read: photos, PDFs and text-like files (the same set the chat composer takes).
const ACCEPT = 'image/*,application/pdf,text/csv,text/plain,.csv,.tsv,.txt,.md,.json';
const MAX_BYTES = 25 * 1024 * 1024;

interface Item {
  key: number;
  name: string;
  size: number;
  state: 'waiting' | 'uploading' | 'reading' | 'ready' | 'failed' | 'done';
  progress: number;
  upload?: Upload;
  error?: string;
  /** Object URL of an image, for the thumbnail. */
  thumb?: string;
  draft: Draft;
  duplicate?: { id: number; title: string | null };
  saveError?: string;
}

let nextKey = 1;

function statusLine(i: Item): string {
  if (i.state === 'waiting') return 'Waiting to upload';
  if (i.state === 'uploading') return `Uploading ${Math.round(i.progress * 100)}%`;
  if (i.state === 'reading') return i.thumb ? 'Reading the photo. This takes a few seconds.' : 'Reading the text…';
  if (i.state === 'failed') return i.error ?? 'Upload failed';
  if (!i.upload?.extracted_preview) return 'Stored. No text could be read from it.';
  return 'Uploaded and read';
}

/**
 * The add flow: choose files (or take a photo), each uploads and is read by
 * the server, then is filed with a form — or handed to Kevin to file. Several
 * files are taken one after another. With `onFiled` it is also the
 * upload-and-link step of the Taxes page.
 */
export function AddDocuments({ onClose, initialFiles, preset, onFiled, single = false, allowKevin = true, heading, onOpenDocument }: {
  onClose: () => void;
  /** Files dropped on the page: skip the choosing step. */
  initialFiles?: File[];
  /** Values the form starts with (the Taxes page sets the category and year). */
  preset?: Partial<Draft>;
  /** Called with each document filed. A file already in the vault can be used in its place. */
  onFiled?: (doc: { id: number; title: string }) => void;
  single?: boolean;
  allowKevin?: boolean;
  heading?: string;
  /** Opens a document that turned out to be in the vault already. */
  onOpenDocument?: (id: number) => void;
}) {
  const facets = useView<Facets>('documents/facets');
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const filed = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(true);
  const thumbs = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const patch = (key: number, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = (files: File[]) => {
    const picked = single ? files.slice(0, 1) : files;
    if (!picked.length) return;
    const added: { item: Item; file: File }[] = picked.map((file) => {
      const thumb = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (thumb) thumbs.current.push(thumb);
      const tooBig = file.size > MAX_BYTES;
      return {
        file,
        item: {
          key: nextKey++, name: file.name || 'photo.jpg', size: file.size, state: tooBig ? 'failed' : 'waiting', progress: 0, thumb,
          error: tooBig ? 'That file is over 25 MB.' : undefined, draft: newDraft(file.name || 'photo.jpg', preset),
        },
      };
    });
    setItems((list) => [...list, ...added.map((a) => a.item)]);
    // One at a time: reading a photo is a model call, and order is kept.
    for (const { item, file } of added) {
      if (item.state === 'failed') continue;
      chain.current = chain.current.then(async () => {
        if (!live.current) return;
        patch(item.key, { state: 'uploading' });
        try {
          const upload = await uploadFile(file, (p) => patch(item.key, p >= 1 ? { state: 'reading', progress: 1 } : { progress: p }));
          patch(item.key, { state: 'ready', upload });
        } catch (e) {
          patch(item.key, { state: 'failed', error: e instanceof Error ? e.message : 'Upload failed' });
        }
      });
    }
  };

  useEffect(() => {
    live.current = true;
    if (initialFiles?.length) addFiles(initialFiles);
    return () => {
      live.current = false;
      for (const t of thumbs.current) URL.revokeObjectURL(t);
    };
    // Only on open: the files are handed over once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = items.filter((i) => i.state !== 'done');
  const current = pending[0];
  const position = items.length - pending.length + 1;

  /** Marks one item finished and closes the dialog after the last. */
  const finish = (key: number) => {
    const left = pending.filter((i) => i.key !== key);
    patch(key, { state: 'done' });
    if (left.length) return;
    if (filed.current > 0 && !onFiled) toast.success(filed.current === 1 ? 'Document filed' : `${filed.current} documents filed`);
    onClose();
  };

  const error = current ? draftError(current.draft) : null;
  const canFile = !!current && current.state === 'ready' && !error && !current.duplicate;

  const file = async () => {
    if (!current?.upload || !canFile) return;
    setSaving(true);
    const r = await act<DocumentInfo>('ingest_document', ingestInput(current.upload.id, current.draft), { silent: true });
    setSaving(false);
    if (!live.current) return;
    if (r.ok) {
      filed.current++;
      onFiled?.({ id: r.result.id, title: r.result.title });
      return finish(current.key);
    }
    const duplicate = duplicateOf(r.error);
    patch(current.key, duplicate ? { duplicate, saveError: undefined } : { saveError: r.error });
  };

  const kevinReady = pending.length > 0 && pending.every((i) => i.state === 'ready' || i.state === 'failed') && pending.some((i) => i.state === 'ready');
  const forKevin = pending.filter((i) => i.upload && !i.duplicate);
  const handToKevin = () => {
    const uploads = forKevin.map((i) => i.upload!);
    if (!uploads.length) return;
    openChat({ send: uploads.length === 1 ? 'File this in my documents' : 'File these in my documents', attachments: uploads, newThread: true });
    onClose();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles([...e.dataTransfer.files]);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void file();
  };

  const title = heading ?? (single ? 'Add a document' : 'Add documents');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="lg:max-w-xl"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {!current ? 'The file is stored here and its text is read once, so it can be searched later.' : items.length > 1 ? `File ${position} of ${items.length}. Check the details, then file it.` : 'Check the details, then file it.'}
            </DialogDescription>
          </DialogHeader>

          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple={!single}
            className="hidden"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />

          {!current ? (
            <DialogBody className="pb-5">
              <div className={cn('flex flex-col items-center gap-4 rounded-xl border border-dashed px-5 py-8 text-center transition-colors', over && 'border-primary bg-accent')}>
                <UploadIcon className="size-7 text-muted-foreground/70" strokeWidth={1.5} />
                <p className="max-w-xs text-sm text-muted-foreground">
                  {single ? 'A PDF, a photo or a text file, up to 25 MB.' : 'PDFs, photos and text files, up to 25 MB each. Choose several to file them one after another.'}
                  <span className="hidden lg:inline"> Or drop {single ? 'it' : 'them'} here.</span>
                </p>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  {coarse && (
                    <Button onClick={() => cameraInput.current?.click()}>
                      <Camera />
                      Take a photo
                    </Button>
                  )}
                  <Button variant={coarse ? 'outline' : 'default'} onClick={() => fileInput.current?.click()}>
                    <FolderOpen />
                    {single ? 'Choose a file' : 'Choose files'}
                  </Button>
                </div>
              </div>
            </DialogBody>
          ) : (
            <>
              <DialogBody className="flex flex-col gap-4 pt-1 [overflow-anchor:none]">
                <FileStatus item={current} />

                {current.state === 'failed' ? (
                  <p role="alert" className="text-sm text-muted-foreground">
                    This file was not uploaded, so it cannot be filed. {pending.length > 1 ? 'Skip it to go on to the next one.' : 'Close this and try again.'}
                  </p>
                ) : current.duplicate ? (
                  <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
                    <p>
                      This exact file is already in your documents{current.duplicate.title ? (
                        <>
                          {' '}as <span className="font-medium">“{current.duplicate.title}”</span>
                        </>
                      ) : null}
                      . It was not filed again.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {onFiled ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            onFiled({ id: current.duplicate!.id, title: current.duplicate!.title ?? current.draft.title });
                            finish(current.key);
                          }}
                        >
                          Use the existing document
                        </Button>
                      ) : (
                        onOpenDocument && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const id = current.duplicate!.id;
                              onClose();
                              onOpenDocument(id);
                            }}
                          >
                            Open the existing document
                          </Button>
                        )
                      )}
                      <Button size="sm" variant="outline" onClick={() => finish(current.key)}>
                        {pending.length > 1 ? 'Skip this file' : 'Close'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {current.upload?.extracted_preview && (
                      <div className="shrink-0">
                        <p className="mb-1.5 text-sm font-medium">Text read from it</p>
                        <pre className="scroll-area max-h-32 shrink-0 rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                          {current.upload.extracted_preview.trim()}
                          {current.upload.extracted_preview.length >= 500 ? ' …' : ''}
                        </pre>
                      </div>
                    )}
                    <MetadataFields draft={current.draft} onChange={(draft) => patch(current.key, { draft, saveError: undefined })} facets={facets.data} />
                    {(current.saveError || (error && current.state === 'ready')) && (
                      <p role="alert" className="text-sm text-destructive">
                        {current.saveError ?? error}
                      </p>
                    )}
                  </>
                )}
              </DialogBody>
              <DialogFooter>
                {allowKevin && forKevin.length > 0 && (
                  <div className="lg:mr-auto">
                    <Button variant="ghost" className="w-full lg:w-auto" disabled={!kevinReady || saving} onClick={handToKevin} title="Kevin reads the text and fills in the details himself.">
                      <MessageCircle />
                      {forKevin.length === 1 ? 'Have Kevin file it' : `Have Kevin file these ${forKevin.length}`}
                    </Button>
                  </div>
                )}
                {pending.length > 1 && !current.duplicate ? (
                  <Button variant="outline" disabled={saving} onClick={() => finish(current.key)}>
                    Skip
                  </Button>
                ) : (
                  !current.duplicate && (
                    <Button variant="outline" onClick={onClose}>
                      Cancel
                    </Button>
                  )
                )}
                {current.state !== 'failed' && !current.duplicate && (
                  <Button type="submit" disabled={!canFile || saving}>
                    {saving ? 'Filing…' : current.state === 'ready' ? 'File document' : 'Reading…'}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileStatus({ item }: { item: Item }) {
  const busy = item.state === 'uploading' || item.state === 'reading' || item.state === 'waiting';
  return (
    <div className={cn('relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border bg-card p-2.5', item.state === 'failed' && 'border-destructive/50')}>
      {item.thumb ? (
        <img src={item.thumb} alt="" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted">
          <FileText className="size-5 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.upload?.filename ?? item.name}</span>
        <span role="status" className={cn('flex items-center gap-1.5 text-sm', item.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
          {item.state === 'failed' && <CircleAlert className="size-3.5 shrink-0" />}
          <span className="min-w-0">
            {statusLine(item)}
            {item.state === 'ready' && <span className="tabular"> · {bytes(item.upload?.size ?? item.size)}</span>}
          </span>
        </span>
      </span>
      {item.state === 'uploading' && <span className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]" style={{ width: `${item.progress * 100}%` }} />}
    </div>
  );
}
