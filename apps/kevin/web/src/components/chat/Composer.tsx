import { ArrowUp, Brain, FileText, LoaderCircle, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { addFiles, removeAttachment, sendBlocker, sendDraft, setDeep, setDraft, stopTurn, type ChatState, type DraftAttachment } from '@/lib/chat';
import { cn } from '@/lib/utils';

// What Kevin can read: photos, PDFs, and text-like files.
const ACCEPT = 'image/*,application/pdf,text/csv,text/plain,.csv,.tsv,.txt,.md,.json';

function Chip({ a }: { a: DraftAttachment }) {
  const busy = a.state === 'uploading' || a.state === 'reading';
  const label = a.state === 'uploading' ? `Uploading ${Math.round(a.progress * 100)}%` : a.state === 'reading' ? 'Kevin is reading it…' : a.state === 'failed' ? (a.error ?? 'Upload failed') : a.upload?.extract_status === 'failed' ? 'Uploaded; text could not be read' : 'Ready';
  return (
    <div className={cn('relative flex h-14 max-w-56 shrink-0 items-center gap-2 overflow-hidden rounded-lg border bg-card pr-9 pl-1.5', a.state === 'failed' && 'border-destructive/50')}>
      {a.preview ? (
        <img src={a.preview} alt="" className="size-11 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-muted">
          <FileText className="size-5 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm">{a.name}</span>
        <span className={cn('flex items-center gap-1 truncate text-xs', a.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')} role="status">
          {busy && <LoaderCircle className="size-3 shrink-0 animate-spin" />}
          <span className="truncate">{label}</span>
        </span>
      </span>
      <button type="button" onClick={() => removeAttachment(a.key)} aria-label={`Remove ${a.name}`} className="absolute top-1/2 right-0 grid size-9 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
      {a.state === 'uploading' && <span className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]" style={{ width: `${a.progress * 100}%` }} />}
    </div>
  );
}

export function Composer({ chat }: { chat: ChatState }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const running = !!chat.thread?.running;
  const blocker = sendBlocker(chat);

  // Grow with the text up to a third of the window, then scroll.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.max(120, window.innerHeight * 0.33))}px`;
  }, [chat.draft]);

  useEffect(() => {
    if (!chat.focusTick) return;
    const el = input.current;
    if (!el) return;
    // On a phone, focusing would throw the keyboard up over what was just opened; only do it when there is text to edit.
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (fine || chat.draft) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.focusTick]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    // A phone keyboard's return key makes a new line; the button sends.
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    sendDraft();
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };

  return (
    <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      {chat.attachments.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-0.5">
          {chat.attachments.map((a) => (
            <Chip key={a.key} a={a} />
          ))}
        </div>
      )}
      {blocker && <p className="mb-1.5 px-1 text-xs text-muted-foreground">{blocker}</p>}
      <div className="rounded-2xl border border-input bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
        <textarea
          ref={input}
          rows={1}
          value={chat.draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={running ? 'Add something for Kevin…' : 'Message Kevin'}
          aria-label="Message Kevin"
          enterKeyHint="enter"
          className="block w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 leading-snug outline-none placeholder:text-muted-foreground/80"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <input
            ref={file}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
          <button type="button" onClick={() => file.current?.click()} aria-label="Attach a photo or file" className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground lg:size-9">
            <Paperclip className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setDeep(!chat.deep)}
            aria-pressed={chat.deep}
            title="Use the deeper, slower model for this message. Costs several times more."
            className={cn(
              'flex h-10 items-center gap-1.5 rounded-full px-3 text-sm lg:h-9',
              chat.deep ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Brain className="size-[18px]" />
            Think hard
          </button>
          <div className="flex-1" />
          {running && (
            <button type="button" onClick={() => void stopTurn()} aria-label="Stop Kevin" className="flex h-10 items-center gap-1.5 rounded-full border bg-card px-3.5 text-sm font-medium hover:bg-muted lg:h-9">
              <Square className="size-3 fill-current" />
              Stop
            </button>
          )}
          {(!running || chat.draft.trim() !== '') && (
            <button
              type="button"
              onClick={sendDraft}
              disabled={blocker !== null}
              aria-label={running ? 'Send to Kevin while he works' : 'Send'}
              className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35 lg:size-9"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
