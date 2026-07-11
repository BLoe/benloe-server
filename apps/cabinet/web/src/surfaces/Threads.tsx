import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { ChatMessage, MessagePart, ThreadSummary } from '../lib/cabinet.js';
import { streamChat, foldTurn, uploadAttachment } from '../lib/chat.js';
import { SectionLabel } from '../components/instruments/index.js';
import './threads.css';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** One composer attachment, from the moment a file is picked/pasted/dropped
 *  through upload completion. `previewUrl` is a local object URL (instant
 *  thumbnail, no round trip); `id`/`mediaType` arrive once the upload
 *  resolves and are what actually gets sent to /api/chat. */
interface PendingAttachment {
  tempId: string;
  previewUrl: string;
  uploading: boolean;
  error?: string;
  id?: string;
  mediaType?: string;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse the wall-clock time literally from the ISO string — deterministic,
 *  no dependence on the runner's timezone (matches the Ops convention). */
function stamp(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const mo = MONTHS[Number(m[2])] ?? '';
  return `${mo} ${Number(m[3])} · ${m[4]}:${m[5]}`;
}

function matches(t: ThreadSummary, needle: string): boolean {
  const hay = `${t.title ?? ''} ${t.preview ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

interface ThreadsProps {
  /** Open (and, if new, seed) a specific thread — used by the ⌘K command bar. */
  openThreadId?: string | null;
  openSeed?: string | null;
  onConsumed?: () => void;
}

/**
 * THREADS — where conversations live. A searchable archive on the left; the
 * right pane is a LIVE conversation: pick a thread up where it left off, or
 * start a new one from the command bar. Every turn streams from Cabinet.
 */
export function Threads({ openThreadId, openSeed, onConsumed }: ThreadsProps) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .threads()
      .then((res) => alive && setThreads(res.threads))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : "Couldn't reach the archive."));
    return () => {
      alive = false;
    };
  }, []);

  // The command bar opens a specific (often brand-new) thread.
  useEffect(() => {
    if (openThreadId) setSelectedId(openThreadId);
  }, [openThreadId]);

  const filtered = useMemo(() => {
    if (!threads) return null;
    const needle = query.trim().toLowerCase();
    return needle ? threads.filter((t) => matches(t, needle)) : threads;
  }, [threads, query]);

  // A just-created thread won't be in the fetched list yet — synthesize a stub.
  const selected: ThreadSummary | null =
    threads?.find((t) => t.id === selectedId) ??
    (selectedId
      ? { id: selectedId, title: null, model_override: null, archived: 0, updated_at: new Date().toISOString(), messages: 0 }
      : null);

  const seedForSelected = selected && selected.id === openThreadId ? openSeed ?? undefined : undefined;

  return (
    <section className="threads" aria-label="Conversations">
      <header className="threads-head">
        <div>
          <SectionLabel n="00">Conversations</SectionLabel>
          <p className="threads-lede voice">Every conversation, on the record — pick one up, or start a new one with ⌘K.</p>
        </div>
        <div className="threads-search">
          <input
            type="search"
            className="threads-search-input data"
            placeholder="Search title or preview…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search conversations"
          />
        </div>
      </header>

      <div className={`threads-body${selectedId ? ' has-selection' : ''}`}>
        <div className="threads-list-pane">
          {loadError ? (
            <p className="threads-empty voice">{loadError}</p>
          ) : !threads ? (
            <p className="threads-loading data">Opening the archive…</p>
          ) : filtered && filtered.length > 0 ? (
            <ul className="threads-list" role="listbox" aria-label="Conversations">
              {filtered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`threads-row${t.id === selectedId ? ' active' : ''}`}
                    role="option"
                    aria-selected={t.id === selectedId}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="threads-row-top">
                      <span className="threads-row-title">{t.title ?? 'Untitled thread'}</span>
                      <span className="threads-row-count data">{t.messages}</span>
                    </div>
                    {t.preview && <p className="threads-row-preview">{t.preview}</p>}
                    <span className="threads-row-when data">{stamp(t.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : threads.length === 0 ? (
            <p className="threads-empty voice">Nothing filed yet. Start one with ⌘K.</p>
          ) : (
            <p className="threads-empty voice">Nothing matches “{query.trim()}.”</p>
          )}
        </div>

        <div className="threads-reading-pane">
          {selected ? (
            <Conversation key={selected.id} thread={selected} seed={seedForSelected} onSeedConsumed={onConsumed} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="threads-reader-empty">
              <p className="threads-hint voice">Pick a conversation, or press ⌘K to start one.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---- a live conversation: history + streaming turns + a composer ---- */
function Conversation({
  thread,
  seed,
  onSeedConsumed,
  onBack,
}: {
  thread: ThreadSummary;
  seed?: string;
  onSeedConsumed?: () => void;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<MessagePart[] | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);
  pendingRef.current = pending;

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setError(null);
    api
      .messages(thread.id)
      .then((res) => alive && setMessages(res.messages))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Couldn't pull that thread."));
    return () => {
      alive = false;
    };
  }, [thread.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, live]);

  // A composer switch (new/different thread) abandons any in-flight or
  // finished-but-unsent uploads — release their local object URLs so we
  // don't leak blob: URLs for the life of the tab. (The uploaded file itself
  // is a separate, server-side leak — see attachments.ts's KNOWN LEAK note.)
  useEffect(() => {
    return () => {
      for (const p of pendingRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, [thread.id]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (list.length === 0) return;
    const drafts: PendingAttachment[] = list.map((f) => ({
      tempId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }));
    setPending((p) => [...p, ...drafts]);
    drafts.forEach((d, i) => {
      const file = list[i]!;
      uploadAttachment(file)
        .then(({ id, mediaType }) => {
          setPending((p) => p.map((x) => (x.tempId === d.tempId ? { ...x, uploading: false, id, mediaType } : x)));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Upload failed.';
          setPending((p) => p.map((x) => (x.tempId === d.tempId ? { ...x, uploading: false, error: message } : x)));
        });
    });
  }, []);

  const removeAttachment = useCallback((tempId: string) => {
    setPending((p) => {
      const gone = p.find((x) => x.tempId === tempId);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return p.filter((x) => x.tempId !== tempId);
    });
  }, []);

  const send = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      const t = text.trim();
      const ready = attachments.filter((a) => a.id && a.mediaType && !a.error) as (PendingAttachment & { id: string; mediaType: string })[];
      if ((!t && ready.length === 0) || sending) return;
      setDraft('');
      setPending([]);
      setError(null);
      const userParts: MessagePart[] = [
        ...ready.map((a) => ({ type: 'image' as const, id: a.id, mediaType: a.mediaType })),
        ...(t ? [{ type: 'text' as const, text: t }] : []),
      ];
      const userMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', parts: userParts, created_at: new Date().toISOString() };
      setMessages((m) => [...(m ?? []), userMsg]);
      const parts: MessagePart[] = [];
      setLive(parts);
      setSending(true);
      try {
        await streamChat(thread.id, { text: t, attachments: ready.map((a) => ({ id: a.id })) }, (e) => {
          if (e.type === 'error') {
            setError(e.message);
            return;
          }
          foldTurn(parts, e);
          setLive([...parts]);
        });
        setMessages((m) => [...(m ?? []), { id: `a-${Date.now()}`, role: 'assistant', parts, created_at: new Date().toISOString() }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The turn failed.');
      } finally {
        setLive(null);
        setSending(false);
      }
    },
    [thread.id, sending],
  );

  // Auto-send the seed (from the command bar) once history has loaded.
  useEffect(() => {
    if (seed && !seededRef.current && messages !== null) {
      seededRef.current = true;
      onSeedConsumed?.();
      void send(seed);
    }
  }, [seed, messages, send, onSeedConsumed]);

  return (
    <div className="reader">
      <header className="reader-head">
        <button type="button" className="threads-back" onClick={onBack}>
          ← Conversations
        </button>
        <div className="reader-title">
          <h2>{thread.title ?? 'New conversation'}</h2>
          <span className="reader-meta data">{thread.messages > 0 ? `${thread.messages} messages · ` : ''}Cabinet</span>
        </div>
      </header>

      <ol className="reader-log">
        {!messages && !error ? (
          <li>
            <p className="threads-loading data">Pulling the scrollback…</p>
          </li>
        ) : (
          (messages ?? []).map((m) => (
            <li key={m.id}>
              <MessageRow message={m} />
            </li>
          ))
        )}
        {live && (
          <li>
            <StreamingRow parts={live} />
          </li>
        )}
        <div ref={bottomRef} />
      </ol>

      {error && <p className="reader-error voice">{error}</p>}

      <form
        className="composer-form"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft, pending);
        }}
      >
        {pending.length > 0 && (
          <div className="composer-attachments">
            {pending.map((p) => (
              <div className={`composer-attachment${p.error ? ' is-error' : ''}`} key={p.tempId}>
                <img src={p.previewUrl} alt="" />
                {p.uploading && <span className="composer-attachment-status data">uploading…</span>}
                {p.error && <span className="composer-attachment-status data">{p.error}</span>}
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => removeAttachment(p.tempId)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="composer-attach-btn" onClick={() => fileInputRef.current?.click()} aria-label="Attach image">
            Attach
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                  const f = item.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft, pending);
              }
            }}
            placeholder="Message Cabinet…"
            rows={1}
            aria-label="Message Cabinet"
          />
          <button
            type="submit"
            disabled={sending || pending.some((p) => p.uploading) || (!draft.trim() && !pending.some((p) => p.id && !p.error))}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The agent's local name if the author is an agent principal, else null. */
function agentName(author?: string | null): string | null {
  const m = (author ?? '').match(/^([a-z0-9-]+)@agents\.benloe\.com$/i);
  return m ? m[1]!.replace(/^\w/, (c) => c.toUpperCase()) : null;
}

function whoLabel(message: ChatMessage): string {
  if (message.role === 'assistant') return 'Cabinet';
  if (message.role === 'system') return 'System';
  return agentName(message.author) ?? 'You';
}

function MessageRow({ message }: { message: ChatMessage }) {
  const fromAgent = message.role === 'user' && agentName(message.author) !== null;
  return (
    <div className={`msg msg--${message.role}${fromAgent ? ' msg--agent' : ''}`}>
      <div className="msg-meta">
        <span className={`msg-who data${fromAgent ? ' msg-who--agent' : ''}`}>{whoLabel(message)}</span>
        <span className="msg-when data">{stamp(message.created_at)}</span>
      </div>
      <div className="msg-parts">
        {message.parts.map((p, i) => (
          <MessagePartView key={i} part={p} />
        ))}
      </div>
    </div>
  );
}

function StreamingRow({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="msg msg--assistant msg--streaming">
      <div className="msg-meta">
        <span className="msg-who data">Cabinet</span>
        <span className="msg-when data">now</span>
      </div>
      <div className="msg-parts">
        {parts.map((p, i) => (
          <MessagePartView key={i} part={p} />
        ))}
        <span className="msg-cursor" aria-hidden="true" />
      </div>
    </div>
  );
}

function MessagePartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <p className="msg-text">{part.text}</p>;

    case 'image':
      return <img className="msg-image" src={`/api/attachments/${encodeURIComponent(part.id)}`} alt="Attached" loading="lazy" />;

    case 'tool-run': {
      const input = safeJson(part.input);
      return (
        <div className={`msg-tool data${part.isError ? ' is-error' : ''}${!part.done ? ' is-running' : ''}`}>
          <div className="msg-tool-head">
            <span className="msg-tool-name">{part.name}</span>
            <span className="msg-tool-state">{!part.done ? 'running…' : part.isError ? 'error' : 'ok'}</span>
          </div>
          {input && <pre className="msg-tool-io">{input}</pre>}
          {part.output && <pre className="msg-tool-io">{part.output}</pre>}
        </div>
      );
    }

    case 'notice':
      return <p className={`msg-notice msg-notice--${part.level}`}>{part.text}</p>;

    case 'approval':
      return (
        <div className="msg-tool data">
          <div className="msg-tool-head">
            <span className="msg-tool-name">approval · {part.packet.action}</span>
            <span className="msg-tool-state">tier {part.packet.tier}</span>
          </div>
          <p className="msg-tool-io">{part.packet.reasoning}</p>
        </div>
      );

    case 'widget':
      return (
        <div className="msg-tool data">
          <div className="msg-tool-head">
            <span className="msg-tool-name">{part.widgetType}</span>
          </div>
          <pre className="msg-tool-io">{safeJson(part.data) ?? String(part.data)}</pre>
        </div>
      );

    default:
      return null;
  }
}

function safeJson(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
