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

/**
 * A real Date from either timestamp shape a ChatMessage.created_at carries:
 * the DB's `datetime('now')` (SQLite: "YYYY-MM-DD HH:MM:SS", space-separated,
 * UTC, no zone marker) for history loaded from GET /api/threads/:id/messages,
 * or a proper `Date.prototype.toISOString()` (has a trailing 'Z') for the
 * locally-synthesized echo/live bubbles in `send()` below. Naively handing
 * the former to `new Date()` gets silently misread as the *browser's* local
 * zone instead of UTC — normalize first.
 */
export function parseServerDate(iso: string): Date {
  const hasZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasZone ? iso : `${iso.replace(' ', 'T')}Z`);
}

/** Calendar-day divider label, in the viewer's local timezone. */
export function dayLabel(d: Date, now: Date): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${MONTHS[d.getMonth() + 1] ?? ''} ${d.getDate()}`;
}

/** "just now" / "3m ago" / a 12-hour clock time — a day-divider row already
 *  carries the date, so a run's meta row only needs to say *when today*. */
export function relativeTime(d: Date, now: Date): string {
  const diffMin = (now.getTime() - d.getTime()) / 60_000;
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  const h = d.getHours();
  const hh = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Full precision, for the `title` hover attribute — nothing lost to the calm view. */
export function fullStamp(iso: string): string {
  const d = parseServerDate(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth() + 1] ?? ''} ${d.getDate()}, ${d.getFullYear()} · ${hh}:${mm}`;
}

/** One run's worth of consecutive same-sender, same-calendar-day messages —
 *  a single meta row (sender + time) up top, one `.msg-parts` block per
 *  message underneath. A day change always breaks a run even if the sender
 *  didn't, so `dividerLabel` only ever needs checking at run boundaries. */
export interface RenderRun {
  key: string;
  identityKey: string;
  dayKey: string;
  dividerLabel?: string;
  who: string;
  fromAgent: boolean;
  role: ChatMessage['role'];
  timeIso: string;
  entries: { id: string; parts: MessagePart[]; isLive?: boolean }[];
}

export function buildRenderRuns(messages: ChatMessage[], live: MessagePart[] | null, now: Date): RenderRun[] {
  type Raw = { id: string; role: ChatMessage['role']; author?: string | null; parts: MessagePart[]; created_at: string; isLive?: boolean };
  const all: Raw[] = messages.map((m) => ({ id: m.id, role: m.role, author: m.author, parts: m.parts, created_at: m.created_at }));
  if (live) all.push({ id: '__live__', role: 'assistant', parts: live, created_at: now.toISOString(), isLive: true });

  const runs: RenderRun[] = [];
  for (const m of all) {
    const date = parseServerDate(m.created_at);
    const dayKey = date.toDateString();
    const identityKey = `${m.role}:${m.author ?? ''}`;
    const last = runs.at(-1);
    if (last && last.identityKey === identityKey && last.dayKey === dayKey) {
      last.entries.push({ id: m.id, parts: m.parts, isLive: m.isLive });
      continue;
    }
    const fromAgent = m.role === 'user' && agentName(m.author) !== null;
    runs.push({
      key: m.id,
      identityKey,
      dayKey,
      dividerLabel: !last || last.dayKey !== dayKey ? dayLabel(date, now) : undefined,
      who: m.role === 'assistant' ? 'Cabinet' : m.role === 'system' ? 'System' : (agentName(m.author) ?? 'You'),
      fromAgent,
      role: m.role,
      timeIso: m.created_at,
      entries: [{ id: m.id, parts: m.parts, isLive: m.isLive }],
    });
  }
  return runs;
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

  // Relative times ("3m ago") go stale sitting still — nudge a re-render
  // periodically so an open conversation keeps ticking forward without
  // needing a new message to land.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
        // A network drop (e.g. the server restarting mid-turn) throws here —
        // but whatever had already streamed in (tool calls included) is real
        // work that ran, and as of the 2026-07-15 persistence fix it's
        // already durably saved server-side too. Fold it into the real
        // message list exactly like the success path below does, instead of
        // wiping it via the `finally`'s setLive(null) and leaving only a bare
        // error banner where the tool-call trail used to be.
        if (parts.length > 0) {
          setMessages((m) => [...(m ?? []), { id: `a-${Date.now()}`, role: 'assistant', parts, created_at: new Date().toISOString() }]);
        }
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

  // Recomputed on every render (cheap — one pass over a page of messages),
  // deliberately not memoized: it needs to pick up the fresh `now` from the
  // 30s tick above even when `messages`/`live` haven't changed, so "Today"
  // and "3m ago" don't go stale in a conversation left open quietly.
  const runs = buildRenderRuns(messages ?? [], live, new Date());

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
          runs.flatMap((run) => {
            const rows = [];
            if (run.dividerLabel) {
              rows.push(
                <li key={`${run.key}-divider`} className="day-divider" role="separator" aria-label={run.dividerLabel}>
                  <span>{run.dividerLabel}</span>
                </li>,
              );
            }
            rows.push(
              <li key={run.key}>
                <div className={`msg msg--${run.role}${run.fromAgent ? ' msg--agent' : ''}`}>
                  <div className="msg-meta">
                    <span className={`msg-who data${run.fromAgent ? ' msg-who--agent' : ''}`}>{run.who}</span>
                    <span className="msg-when data" title={fullStamp(run.timeIso)}>
                      {run.entries.some((e) => e.isLive) ? 'now' : relativeTime(parseServerDate(run.timeIso), new Date())}
                    </span>
                  </div>
                  {run.entries.map((entry) => (
                    <div className="msg-parts" key={entry.id}>
                      {entry.parts.map((p, i) => (
                        <MessagePartView key={i} part={p} />
                      ))}
                      {entry.isLive && <span className="msg-cursor" aria-hidden="true" />}
                    </div>
                  ))}
                </div>
              </li>,
            );
            return rows;
          })
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
export function agentName(author?: string | null): string | null {
  const m = (author ?? '').match(/^([a-z0-9-]+)@agents\.benloe\.com$/i);
  return m ? m[1]!.replace(/^\w/, (c) => c.toUpperCase()) : null;
}

function truncate(v: unknown, n: number): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Last path segment or two — enough to place a file without a full path dump. */
function shortPath(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  const parts = s.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || s;
}

/**
 * The UI is a human projection, not the model's raw transcript (§ chat-UX
 * pass, change 2): one plain-English line per tool call, keyed by tool name,
 * with a generic fallback for anything not worth a bespoke formatter.
 * Deliberately covers the common judgment-write tools + the handful of
 * built-ins Cabinet reaches for constantly (Bash/Read/Write/Edit) — not
 * every tool in the catalog.
 */
const TOOL_SUMMARIES: Record<string, (i: Record<string, unknown>) => string> = {
  // cabinet MCP tools (mcp__cabinet__* — prefix stripped before lookup)
  log_food: (i) => `Logged food: ${truncate(i.description ?? 'entry', 60)}${i.meal ? ` (${i.meal})` : ''}`,
  log_workout: (i) => `Logged workout${i.name ? `: ${i.name}` : ''}${Array.isArray(i.sets) ? ` — ${i.sets.length} set${i.sets.length === 1 ? '' : 's'}` : ''}`,
  log_body_metric: (i) => `Logged ${i.metric ?? 'metric'}: ${i.value ?? ''}`,
  log_mood: () => 'Logged a mood/energy/stress check-in',
  upsert_goal: (i) => `Saved goal: ${i.title ?? i.domain ?? 'goal'}${i.target_value != null ? ` — ${i.target_value}${i.unit ?? ''}` : ''}`,
  upsert_task: (i) => `${i.id != null ? 'Updated' : 'Added'} task: ${truncate(i.title, 50)}`,
  upsert_contact: (i) => `Saved contact: ${i.name ?? ''}`,
  upsert_constraint: (i) => (i.confirmedNone ? `Confirmed no ${i.kind ?? ''} constraints` : `Recorded ${i.kind ?? ''} constraint: ${i.subject ?? ''}`),
  update_pantry: (i) => `Updated pantry: ${i.name ?? 'item'}${i.quantityDelta != null ? ` (${Number(i.quantityDelta) > 0 ? '+' : ''}${i.quantityDelta}${i.unit ? ` ${i.unit}` : ''})` : ''}`,
  decrement_pantry_for: (i) => `Used ${i.quantity ?? ''}${i.unit ?? ''} of ${i.name ?? 'a pantry item'}`,
  add_recipe: (i) => `Saved recipe: ${truncate(i.title, 50)}`,
  plan_meal: (i) => `Planned ${i.meal ?? 'a meal'} on ${i.localDay ?? ''}${i.adHocDescription ? `: ${truncate(i.adHocDescription, 40)}` : ''}`,
  update_plan_entry: (i) => `Updated meal plan entry${i.status ? `: marked ${i.status}` : ''}`,
  remove_plan_entry: () => 'Removed a meal-plan entry',
  consume_plan_entry: () => 'Logged a planned meal as eaten',
  generate_shopping_list: () => 'Rebuilt the shopping list from the meal plan',
  plan_activity: (i) => `Planned ${i.kind ?? 'activity'} on ${i.localDay ?? ''}${i.title ? `: ${truncate(i.title, 40)}` : ''}`,
  update_activity_entry: (i) => `Updated activity entry${i.status ? `: marked ${i.status}` : ''}`,
  remove_activity_entry: () => 'Removed an activity-plan entry',
  seed_trainer_anchors: () => 'Topped up trainer-session anchors',
  add_journal: () => 'Added a journal entry',
  log_claim: (i) => `Logged insurance claim${i.provider ? `: ${i.provider}` : ''}`,
  log_lab: (i) => `Logged lab result: ${i.analyte ?? ''}${i.value != null ? ` ${i.value}${i.unit ?? ''}` : ''}`,
  log_medication: (i) => `Added medication: ${i.name ?? ''}`,
  log_hsa_contribution: (i) => `Logged HSA contribution: $${i.amount ?? ''}`,
  import_transactions_csv: () => 'Imported transactions',
  add_price_watch: (i) => `Watching price: ${i.item ?? ''}`,
  add_lesson: () => 'Stored a lesson',
  retire_lesson: (i) => (i.superseded ? 'Marked a lesson superseded' : 'Retired a lesson'),
  promote_lesson: () => 'Promoted a lesson into memory',
  update_memory: (i) => `Updated memory: ${i.file ?? ''}`,
  render_widget: (i) => `Rendered a ${i.widgetType ?? ''} card`,
  enqueue_approval: (i) => `Asked you to confirm: ${truncate(i.action, 50)}`,
  query_db: () => 'Queried Cabinet’s database',
  search_episodic: (i) => `Recalled memory: “${truncate(i.query, 40)}”`,
  search_documents: (i) => `Searched documents: “${truncate(i.query, 40)}”`,
  recall_lessons: () => 'Recalled relevant lessons',
  list_constraints: () => 'Checked constraints',
  list_meal_plan: () => 'Checked the meal plan',
  list_activity_plan: () => 'Checked the activity plan',
  list_grocery_list: () => 'Checked the grocery list',
  list_promotable_lessons: () => 'Checked for promotable lessons',
  // built-ins reached for constantly during self-hosting work
  Bash: (i) => `Ran: ${truncate(i.command, 60)}`,
  Read: (i) => `Read ${shortPath(i.file_path ?? i.path)}`,
  Write: (i) => `Wrote ${shortPath(i.file_path ?? i.path)}`,
  Edit: (i) => `Edited ${shortPath(i.file_path ?? i.path)}`,
  WebSearch: (i) => `Searched the web: “${truncate(i.query, 50)}”`,
  WebFetch: (i) => `Fetched ${truncate(i.url, 50)}`,
  TodoWrite: () => 'Updated the task list',
};

export function summarizeToolCall(name: string, input: unknown): string {
  const bare = name.replace(/^mcp__cabinet__/, '');
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const formatter = TOOL_SUMMARIES[bare];
  if (formatter) {
    try {
      const s = formatter(i);
      if (s.trim()) return s;
    } catch {
      // fall through to the generic line below
    }
  }
  return `Ran ${bare.replace(/_/g, ' ')}`;
}

function MessagePartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <p className="msg-text">{part.text}</p>;

    case 'image':
      return <img className="msg-image" src={`/api/attachments/${encodeURIComponent(part.id)}`} alt="Attached" loading="lazy" />;

    case 'tool-run': {
      const input = safeJson(part.input);
      const hasDetails = !!input || !!part.output;
      return (
        <div className={`msg-tool${part.isError ? ' is-error' : ''}${!part.done ? ' is-running' : ''}`}>
          <div className="msg-tool-head">
            <span className="msg-tool-summary">
              {!part.done && <span className="msg-tool-pulse" aria-hidden="true" />}
              {summarizeToolCall(part.name, part.input)}
            </span>
            <span className="msg-tool-state data">{!part.done ? 'running…' : part.isError ? 'error' : 'ok'}</span>
          </div>
          {hasDetails && (
            <details className="msg-tool-details">
              <summary>Details · {part.name}</summary>
              {input && <pre className="msg-tool-io data">{input}</pre>}
              {part.output && <pre className="msg-tool-io data">{part.output}</pre>}
            </details>
          )}
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
