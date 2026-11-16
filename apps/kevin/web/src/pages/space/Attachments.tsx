import { Camera, FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { uploadFile } from '@/lib/chat';
import type { RecordAttachment } from '@/lib/spaces';
import { toast } from '@/lib/toast';

// The same kinds the chat composer takes.
const ACCEPT = 'image/*,application/pdf,text/csv,text/plain,.csv,.tsv,.txt,.md,.json';

/**
 * The files on a record: thumbnails for images, named chips for the rest,
 * each removable, plus the ways to add one. Uploads go through the composer's
 * helper (photos are downscaled first); the record keeps only the ids.
 */
export function Attachments({ files, onChange, onBusy }: { files: RecordAttachment[]; onChange: (files: RecordAttachment[]) => void; onBusy: (busy: boolean) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ key: number; name: string; progress: number }[]>([]);
  const latest = useRef(files);
  latest.current = files;
  const inFlight = useRef(0);

  const add = (picked: FileList | null) => {
    for (const file of picked ?? []) {
      const key = Math.random();
      inFlight.current++;
      onBusy(true);
      setUploading((u) => [...u, { key, name: file.name || 'photo.jpg', progress: 0 }]);
      uploadFile(file, (progress) => setUploading((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))))
        .then(
          // Several uploads can finish in any order: append to whatever the list is by then.
          (up) => onChange([...latest.current, { id: up.id, filename: up.filename, mime: up.mime, kind: up.kind, url: `/api/attachments/${up.id}/raw` }]),
          (e: unknown) => toast.error(`${file.name || 'File'} not uploaded`, e instanceof Error ? e.message : undefined),
        )
        .finally(() => {
          setUploading((u) => u.filter((x) => x.key !== key));
          if (--inFlight.current === 0) onBusy(false);
        });
    }
  };
  const remove = (id: number) => onChange(files.filter((f) => f.id !== id));
  const input = (ref: React.RefObject<HTMLInputElement | null>, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      className="hidden"
      {...(capture ? { accept: 'image/*', capture: 'environment' as const } : { accept: ACCEPT, multiple: true })}
      onChange={(e) => {
        add(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">Files</div>
      {(files.length > 0 || uploading.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id} className="relative">
              {f.kind === 'image' || f.mime.startsWith('image/') ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border" aria-label={`Open ${f.filename}`}>
                  <img src={f.url} alt={f.filename} loading="lazy" className="size-20 object-cover" />
                </a>
              ) : (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex h-11 max-w-56 items-center gap-1.5 rounded-lg border bg-card pr-10 pl-2.5 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.filename}</span>
                </a>
              )}
              <button type="button" onClick={() => remove(f.id)} aria-label={`Remove ${f.filename}`} className="absolute top-0 right-0 grid size-9 place-items-center">
                <span className="grid size-6 place-items-center rounded-full border bg-popover text-muted-foreground shadow-sm">
                  <X className="size-3.5" />
                </span>
              </button>
            </li>
          ))}
          {uploading.map((u) => (
            <li key={u.key} role="status" className="flex h-11 max-w-56 items-center gap-1.5 rounded-lg border border-dashed px-2.5 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
              <span className="truncate">{u.progress >= 1 ? 'Kevin is reading it…' : `Uploading ${Math.round(u.progress * 100)}%`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {input(picker, false)}
        {input(camera, true)}
        <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
          <Paperclip />
          Attach file
        </Button>
        {/* A phone's file picker does not always offer the camera; this goes straight to it. */}
        <Button variant="outline" size="sm" className="lg:hidden" onClick={() => camera.current?.click()}>
          <Camera />
          Take photo
        </Button>
      </div>
    </div>
  );
}
