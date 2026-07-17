import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { api } from '../lib/cabinet.js';
import type { ChatMessage, MessagePart, ChatSummary } from '../lib/cabinet.js';
import { streamChat, foldTurn, uploadAttachment, interruptChat } from '../lib/chat.js';
import { usingMock } from '../lib/cabinet.js';
import { loadDraft, saveDraft, clearDraft } from '../lib/draft.js';
import { Paperclip, ArrowUp, Square, X, Bold, Italic, Underline, Strikethrough, Link2, List, ListOrdered } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import './chat.css';

/** GFM + a safety pass. rehype-raw lets the composer's <u> underline through;
 *  the sanitizer then strips everything not on the allowlist (default GitHub
 *  schema + u/ins), so pasted or model-emitted HTML can't script anything. */
const MD_SCHEMA = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'ins'] };

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

/** A message submitted while a turn was already in flight — held client-side
 *  (not yet persisted) and auto-fired the moment the current turn goes idle.
 *  Not durable: a refresh/close while something sits queued loses it, same
 *  as an unsent draft. See the queue-and-auto-chain note on `submit` below. */
interface QueuedMessage {
  id: string;
  text: string;
  attachments: PendingAttachment[];
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A real Date from either timestamp shape a ChatMessage.created_at carries:
 * the DB's `datetime('now')` (SQLite: "YYYY-MM-DD HH:MM:SS", space-separated,
 * UTC, no zone marker) for history loaded from GET /api/chats/:id/messages,
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

/** "12:03 AM" — the Slack-style hover stamp on entries and tool calls. */
export function clockTime(iso: string): string {
  const d = parseServerDate(iso);
  const h = d.getHours();
  const hh = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The composer is a real contentEditable (bold/italic/underline/strike/lists
 * render live as you type, via document.execCommand — a Slack-style rich
 * composer, not a plain textarea with markdown syntax sitting in it as text)
 * — this walks its DOM at send time and serializes back to the markdown the
 * server persists and MessagePartView renders. Handles exactly the tags
 * execCommand/our toolbar can produce; anything else (a stray span from a
 * paste, say) just passes its children through unwrapped.
 */
export function htmlToMarkdown(root: Node): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'B':
      case 'STRONG':
        return inner.trim() ? `**${inner}**` : inner;
      case 'I':
      case 'EM':
        return inner.trim() ? `_${inner}_` : inner;
      case 'U':
        return inner.trim() ? `<u>${inner}</u>` : inner;
      case 'S':
      case 'STRIKE':
      case 'DEL':
        return inner.trim() ? `~~${inner}~~` : inner;
      case 'A':
        return `[${inner || el.getAttribute('href') || 'link'}](${el.getAttribute('href') ?? ''})`;
      case 'BR':
        return '\n';
      case 'LI':
        return inner;
      case 'UL':
        return `${Array.from(el.children).map((li) => `- ${walk(li).trim()}`).join('\n')}\n`;
      case 'OL':
        return `${Array.from(el.children).map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n')}\n`;
      case 'DIV':
      case 'P':
        return `${inner}\n`;
      default:
        return inner;
    }
  };
  return walk(root).replace(/\n{3,}/g, '\n\n').trim();
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
  entries: { id: string; parts: MessagePart[]; timeIso: string; isLive?: boolean }[];
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
      last.entries.push({ id: m.id, parts: m.parts, timeIso: m.created_at, isLive: m.isLive });
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
      entries: [{ id: m.id, parts: m.parts, timeIso: m.created_at, isLive: m.isLive }],
    });
  }
  return runs;
}

interface ChatProps {
  /** The conversation to show — selection lives in App (rail accordion). */
  chat: ChatSummary | null;
  /** First message to auto-send into a just-created chat (⌘K command bar). */
  seed?: string | null;
  onSeedConsumed?: () => void;
  /** Tell the rail accordion which rows to badge as "resuming". */
  onResumeState?: (chatId: string, resuming: boolean) => void;
}

/**
 * CHAT — one live conversation, full width. The archive list moved into the
 * rail accordion (components/shell/Rail.tsx); this surface only renders
 * whatever App says is selected. Every turn streams from Cabinet.
 */
export function Chat({ chat, seed, onSeedConsumed, onResumeState }: ChatProps) {
  return (
    <section className="chat" aria-label="Chat">
      {chat ? (
        <Conversation
          key={chat.id}
          chat={chat}
          seed={seed ?? undefined}
          onSeedConsumed={onSeedConsumed}
          onResumeState={onResumeState}
        />
      ) : (
        <div className="chat-reader-empty">
          <p className="chat-hint voice">Pick a conversation from the rail, or start one with ⌘K.</p>
        </div>
      )}
    </section>
  );
}


/* ---- a live conversation: history + streaming turns + a composer ---- */
function Conversation({
  chat,
  seed,
  onSeedConsumed,
  onResumeState,
}: {
  chat: ChatSummary;
  seed?: string;
  onSeedConsumed?: () => void;
  /** Tell the rail accordion which rows to badge as "resuming" (see App). */
  onResumeState?: (chatId: string, resuming: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Self-deploy / restart affordance (2026-07-15): what the status strip
  // above the composer shows. 'down' = we saw the connection die and the
  // server isn't answering /healthz yet; 'up' = server answers again but
  // hasn't confirmed a resume (this is the only state with a stand-down
  // ceiling — a plain network blip never confirms one); 'resuming' = the
  // server broadcast chat-resume-start for this chat, so we hold until
  // its resume-end however long the turn runs. null = calm.
  const [restartWait, setRestartWait] = useState<null | 'down' | 'up' | 'resuming'>(null);
  // Reattach-on-load (2026-07-15, Ben's page-refresh question): a turn keeps
  // running server-side when this tab disconnects — a refresh only loses the
  // live VIEW. When a (re)loading tab finds `live: true` on the messages
  // fetch, this flag shows the working strip and drives a follow-along poll
  // (live-persist updates the assistant row mid-turn, so each poll shows the
  // turn's real progress) until the server reports the turn over.
  const [liveTurn, setLiveTurn] = useState(false);
  const [live, setLive] = useState<MessagePart[] | null>(null);
  const [sending, setSending] = useState(false);
  // Whether the (uncontrolled — see editorRef) composer holds any text.
  // Only used to drive the Send button's disabled state; the actual content
  // is read straight off the DOM at send time (submitFromEditor).
  const [hasText, setHasText] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const readerRef = useRef<HTMLDivElement>(null);
  // The composer itself: a real contentEditable, not a plain textarea — see
  // htmlToMarkdown/exec/insertLink below. Uncontrolled by design: React
  // fighting a contentEditable's own cursor/selection management on every
  // keystroke is a well-known source of cursor-jump bugs.
  const editorRef = useRef<HTMLDivElement>(null);
  // Whether the viewer is parked at (or near) the bottom of the scrollback —
  // gates auto-scroll-on-stream so a user who scrolled up to read history
  // doesn't get yanked back down by the next token. Starts true: a freshly
  // opened/switched chat (Conversation is remounted per chat — see the
  // `key={selected.id}` on its call site) should open at the bottom.
  const stickToBottomRef = useRef(true);
  // True only while a stop-button click is in flight — lets the turn's
  // resulting 'error' SSE event (an aborted turn surfaces as one) render as
  // a calm inline notice instead of the red error banner reserved for
  // actual failures. See send()'s onEvent and stop() below.
  const interruptingRef = useRef(false);
  const seededRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);
  pendingRef.current = pending;
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  const onResumeStateRef = useRef(onResumeState);
  onResumeStateRef.current = onResumeState;
  const restartWaitRef = useRef<typeof restartWait>(null);
  restartWaitRef.current = restartWait;
  const messagesRef = useRef<ChatMessage[] | null>(null);
  messagesRef.current = messages;
  const chatIdRef = useRef(chat.id);
  chatIdRef.current = chat.id;
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // Restore a saved draft (lib/draft.ts): runs once per mount, and
  // Conversation remounts per chat (key={chat.id} at the call site — see
  // Chat()), so this fires exactly once per chat open, before the user can
  // type anything to race it.
  useEffect(() => {
    const el = editorRef.current;
    const saved = loadDraft(chat.id);
    if (el && saved) {
      el.innerHTML = saved;
      setHasText(!!el.textContent?.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setError(null);
    api
      .messages(chat.id)
      .then((res) => {
        if (!alive) return;
        setMessages(res.messages);
        setLiveTurn(!!res.live);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Couldn't pull that chat."));
    return () => {
      alive = false;
    };
  }, [chat.id]);

  // Follow a turn that's running without us (opened/reloaded mid-turn):
  // poll while the server says the chat is live. Paused during our own
  // sends — there the SSE stream is the live view. The turn-end broadcast
  // (chat-activity) usually flips this off before the poll even notices.
  useEffect(() => {
    if (!liveTurn || sending) return;
    const timer = setInterval(() => {
      api
        .messages(chat.id)
        .then((res) => {
          if (!mountedRef.current || chatIdRef.current !== chat.id) return;
          setMessages(res.messages);
          if (!res.live) setLiveTurn(false);
        })
        .catch(() => {
          /* transient — next tick retries; the restart machinery covers real outages */
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [liveTurn, sending, chat.id]);

  // Live out-of-band updates (2026-07-15 restart-UX): the server broadcasts
  // `chat-activity` on /api/events when it writes to a chat outside a
  // client-initiated stream — today that's the interrupted-turn resume
  // (gateway/pendingTurn.ts) posting into a chat after a restart killed a
  // turn mid-flight. When it's THIS chat, re-fetch the authoritative
  // history so the conversation visibly resumes without a manual reload.
  // EventSource reconnects on its own across server restarts, and the
  // server-side replay ring (Last-Event-ID) covers events that fired while
  // this tab was disconnected — exactly the restart window we care about.
  // Skipped while a send is streaming: the live stream is authoritative and
  // a mid-stream swap would clobber the folding in send() below.
  useEffect(() => {
    if (usingMock) return;
    const es = new EventSource('/api/events');
    const onActivity = (ev: MessageEvent) => {
      let touched: string | undefined;
      try {
        touched = (JSON.parse(ev.data as string) as { chatId?: string }).chatId;
      } catch {
        return; // not our payload shape; other event types have their own listeners
      }
      if (!touched || touched !== chatIdRef.current || sendingRef.current) return;
      api
        .messages(touched)
        .then((res) => {
          if (!mountedRef.current || chatIdRef.current !== touched || sendingRef.current) return;
          setMessages(res.messages);
          setError(null);
          // /api/chat broadcasts at turn start and end — this keeps the
          // working strip honest for a tab that isn't running the turn.
          setLiveTurn(!!res.live);
        })
        .catch(() => {
          /* transient — the next chat-activity or reload will catch up */
        });
    };
    es.addEventListener('chat-activity', onActivity);
    // Status-strip transitions from the server's own mouth: a resume turn
    // started (covers a tab that loaded mid-restart and never saw the drop)
    // or finished (the all-clear — strip and list badge come down).
    const forThisChat = (ev: MessageEvent): boolean => {
      try {
        return (JSON.parse(ev.data as string) as { chatId?: string }).chatId === chatIdRef.current;
      } catch {
        return false;
      }
    };
    const onResumeStart = (ev: MessageEvent) => {
      if (forThisChat(ev)) setRestartWait('resuming');
    };
    const onResumeEnd = (ev: MessageEvent) => {
      if (!forThisChat(ev)) return;
      setRestartWait(null);
      onResumeStateRef.current?.(chatIdRef.current, false);
    };
    es.addEventListener('chat-resume-start', onResumeStart);
    es.addEventListener('chat-resume-end', onResumeEnd);
    return () => es.close();
  }, [chat.id]);

  // While the strip says 'down', poll the public /healthz until the server
  // answers again. While it says 'up' (back online, resume not yet
  // confirmed), a 90s ceiling quietly stands the strip down — that's the
  // network-blip case where the server never died, no marker exists, and no
  // resume will ever come. 'resuming' has no ceiling on purpose: the server
  // confirmed the turn, and resume-end will clear it however long it runs.
  useEffect(() => {
    if (restartWait === 'down') {
      const timer = setInterval(() => {
        fetch('/healthz')
          .then((res) => {
            if (res.ok) setRestartWait('up');
          })
          .catch(() => {
            /* still down — keep polling */
          });
      }, 2000);
      return () => clearInterval(timer);
    }
    if (restartWait === 'up') {
      const ceiling = setTimeout(() => {
        setRestartWait(null);
        onResumeStateRef.current?.(chatIdRef.current, false);
      }, 90_000);
      return () => clearTimeout(ceiling);
    }
    return undefined;
  }, [restartWait]);

  // The reading pane has no scroll container of its own — the whole surface
  // (header, log, and composer together) scrolls inside <main class="surface">
  // (see shell.css). Anchoring auto-scroll to an element *inside* the log
  // (the old approach: an empty ref just before the composer, scrolled to
  // the viewport's bottom edge via scrollIntoView) put the composer itself
  // — which sits after that anchor in the DOM — below the fold on every
  // streamed token. Scroll the real host to its true bottom instead, which
  // includes the composer, and only while the viewer is already there.
  const scrollHost = useCallback((): HTMLElement | null => readerRef.current?.closest<HTMLElement>('.surface') ?? null, []);

  useEffect(() => {
    const host = scrollHost();
    if (!host) return;
    const onScroll = () => {
      stickToBottomRef.current = host.scrollHeight - host.scrollTop - host.clientHeight < 96;
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => host.removeEventListener('scroll', onScroll);
  }, [scrollHost]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const host = scrollHost();
    if (host) host.scrollTop = host.scrollHeight;
  }, [messages, live, scrollHost]);

  // Relative times ("3m ago") go stale sitting still — nudge a re-render
  // periodically so an open conversation keeps ticking forward without
  // needing a new message to land.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // A composer switch (new/different chat) abandons any in-flight or
  // finished-but-unsent uploads — release their local object URLs so we
  // don't leak blob: URLs for the life of the tab. (The uploaded file itself
  // is a separate, server-side leak — see attachments.ts's KNOWN LEAK note.)
  useEffect(() => {
    return () => {
      for (const p of pendingRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, [chat.id]);

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

  // Recover from a dropped connection without a manual reload (2026-07-15
  // follow-up to the redeploy-mid-turn bug): a network error here almost
  // always means the connection died, not that the turn didn't happen — and
  // as of the server's live-persist fix, whatever the turn got through is
  // now durably saved even if we never got to see the rest of it stream.
  // Poll the chat's real history a few times; once the server shows more
  // than just the user's own message (i.e. an assistant reply actually
  // landed — possibly a fuller one than what we folded locally before the
  // drop), swap it in as the authoritative version and clear the stale error
  // banner. Gives up silently after ~15s — the locally-folded fallback
  // message from the catch block above is still sitting there either way.
  const reconcileAfterDrop = useCallback((chatId: string, preSendCount: number) => {
    let attempt = 0;
    const tick = () => {
      // Live checks against refs, not a captured `chat` — this closure was
      // built once when the drop happened, but the user may since have
      // switched chats (this Conversation instance is reused across
      // chats, not remounted), and we must not splice a stale reconcile
      // into whatever's now on screen.
      if (!mountedRef.current || chatIdRef.current !== chatId) return;
      attempt++;
      api
        .messages(chatId)
        .then((res) => {
          if (!mountedRef.current || chatIdRef.current !== chatId) return;
          if (res.messages.length > preSendCount + 1) {
            setMessages(res.messages);
            setError(null);
            // The turn's result is on the record after all — if this was a
            // mere blip (strip at 'down'/'up'), stand down. A confirmed
            // 'resuming' strip stays: resume-end is its all-clear.
            if (restartWaitRef.current === 'down' || restartWaitRef.current === 'up') {
              setRestartWait(null);
              onResumeStateRef.current?.(chatId, false);
            }
            return;
          }
          // 12 attempts (~35s) — a self-redeploy takes 10–20s to come back,
          // and the boot-side resume turn (server: gateway/pendingTurn.ts)
          // starts a few seconds after that. Errors (server still down)
          // retry on the same schedule. Beyond the window, the /api/events
          // subscription above still catches the resume whenever it lands.
          if (attempt < 12) setTimeout(tick, attempt < 3 ? 1500 : 3000);
        })
        .catch(() => {
          if (attempt < 12) setTimeout(tick, attempt < 3 ? 1500 : 3000);
        });
    };
    setTimeout(tick, 1500);
  }, []);

  const send = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      const t = text.trim();
      const ready = attachments.filter((a) => a.id && a.mediaType && !a.error) as (PendingAttachment & { id: string; mediaType: string })[];
      if ((!t && ready.length === 0) || sending) return;
      setPending([]);
      setError(null);
      stickToBottomRef.current = true;
      interruptingRef.current = false;
      const userParts: MessagePart[] = [
        ...ready.map((a) => ({ type: 'image' as const, id: a.id, mediaType: a.mediaType })),
        ...(t ? [{ type: 'text' as const, text: t }] : []),
      ];
      const userMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', parts: userParts, created_at: new Date().toISOString() };
      const preSendCount = messagesRef.current?.length ?? 0;
      setMessages((m) => [...(m ?? []), userMsg]);
      const parts: MessagePart[] = [];
      // Set only by an actual 'turn-end' SSE event — the signal that the
      // stream ended *because the turn genuinely finished*, not because the
      // connection just happened to stop delivering. See the "silent
      // truncation" note below: a clean-looking stream close is not proof
      // of a complete one.
      let sawTurnEnd = false;
      setLive(parts);
      setSending(true);
      try {
        await streamChat(chat.id, { text: t, attachments: ready.map((a) => ({ id: a.id })) }, (e) => {
          if (e.type === 'turn-end') sawTurnEnd = true;
          if (e.type === 'error') {
            // A deliberate stop (see stop() below) surfaces here as the
            // aborted turn's own error event — show it as a calm notice,
            // not the red banner reserved for a turn that actually failed.
            if (interruptingRef.current) {
              const last = parts.at(-1);
              if (!(last?.type === 'notice' && last.text === 'Stopped.')) {
                parts.push({ type: 'notice', level: 'info', text: 'Stopped.' });
                setLive([...parts]);
              }
            } else {
              setError(e.message);
            }
            return;
          }
          foldTurn(parts, e);
          setLive([...parts]);
        });
        if (sawTurnEnd) {
          setMessages((m) => [...(m ?? []), { id: `a-${Date.now()}`, role: 'assistant', parts, created_at: new Date().toISOString() }]);
        } else {
          // Silent truncation (2026-07-15 follow-up): streamChat() returned
          // normally — no exception, so this looks like a clean finish —
          // but we never actually saw the turn-end event. Observed live: a
          // self-deploy's restart landed in the narrow gap between the
          // server-side turn finishing (already durably saved via
          // live-persist) and the last bytes of that response actually
          // reaching this tab, so the browser's fetch reader saw a
          // plain end-of-stream instead of an error. Nothing throws, so the
          // catch block below never runs and this would otherwise render a
          // truncated reply with no error banner — worse than the loud
          // failure case, since nothing looks wrong. Treat it exactly like
          // a hard drop: fold what we have so the trail isn't blank, then
          // reconcile against the server's authoritative (already-complete)
          // copy.
          if (parts.length > 0) {
            setMessages((m) => [...(m ?? []), { id: `a-${Date.now()}`, role: 'assistant', parts, created_at: new Date().toISOString() }]);
          }
          reconcileAfterDrop(chat.id, preSendCount);
        }
      } catch (err) {
        // A network drop (e.g. the server restarting mid-turn) throws here —
        // but whatever had already streamed in (tool calls included) is real
        // work that ran, and as of the 2026-07-15 persistence fix it's
        // already durably saved server-side too. Fold it into the real
        // message list exactly like the success path below does, instead of
        // wiping it via the `finally`'s setLive(null) and leaving only a bare
        // error banner where the tool-call trail used to be.
        //
        // Restart-UX follow-up (same day): a dropped connection is now a
        // *recoverable* event — reconcileAfterDrop repolls and the
        // /api/events subscription catches the server's own resume turn —
        // so a fetch-level network failure gets a calm inline notice, not
        // the red banner. The red banner stays for genuine turn failures
        // (an HTTP error status, a server-side exception).
        const msg = err instanceof Error ? err.message : 'The turn failed.';
        const isNetworkDrop = err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg);
        if (isNetworkDrop) {
          parts.push({
            type: 'notice',
            level: 'info',
            text: 'Connection dropped — likely a server restart. This chat reconnects and catches up on its own.',
          });
          // Raise the status strip + list badge immediately — the /healthz
          // poll and the server's resume broadcasts take it from here.
          setRestartWait('down');
          onResumeStateRef.current?.(chat.id, true);
        } else {
          setError(msg);
        }
        if (parts.length > 0) {
          setMessages((m) => [...(m ?? []), { id: `a-${Date.now()}`, role: 'assistant', parts, created_at: new Date().toISOString() }]);
        }
        reconcileAfterDrop(chat.id, preSendCount);
      } finally {
        setLive(null);
        setSending(false);
        interruptingRef.current = false;
      }
    },
    [chat.id, sending, reconcileAfterDrop],
  );

  // What the composer's Send button (and Enter) actually calls. Cabinet
  // can only run one turn at a time (the runtime is single-flight — see
  // AgentRuntime's `current*` fields), so a message submitted mid-turn
  // can't be handed to me to read yet; it's held here and auto-fired (via
  // the effect below) the instant the current turn goes idle, without
  // needing you to come back and hit send again. This is queue-and-fire,
  // not true mid-turn steering — I don't see it until my current turn ends.
  const submit = useCallback(
    (text: string, attachments: PendingAttachment[]) => {
      const t = text.trim();
      const ready = attachments.filter((a) => a.id && a.mediaType && !a.error);
      if (!t && ready.length === 0) return;
      if (sending) {
        setQueued((q) => [...q, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`, text, attachments }]);
        setPending([]);
        return;
      }
      void send(text, attachments);
    },
    [sending, send],
  );

  const removeQueued = useCallback((id: string) => {
    setQueued((q) => q.filter((m) => m.id !== id));
  }, []);

  // Auto-chain: the moment the active turn finishes, fire the next queued
  // message as a fresh turn — no manual re-send required. Repeats on its
  // own until the queue's empty (each completed send flips `sending` back
  // to false, which re-fires this effect for the next item, if any).
  useEffect(() => {
    if (sending || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next!.text, next!.attachments);
  }, [sending, queued, send]);

  // Formatting toolbar (Slack-style, real WYSIWYG — 2026-07-16 rewrite): the
  // composer is a contentEditable, so document.execCommand toggles real
  // <b>/<i>/<u>/<s>/<ul>/<ol> on the current selection and the browser
  // renders it live (bold text looks bold while you type — the whole point;
  // the prior version wrapped a plain textarea's value in literal "**"
  // characters, which never visually rendered anything). Serialized back to
  // markdown at send time by htmlToMarkdown above.
  const exec = useCallback((command: string) => {
    const el = editorRef.current;
    // execCommand is unimplemented in some environments (notably jsdom, our
    // test harness) — real browsers (Chrome/Firefox/Safari) still support
    // these basic commands despite the API's deprecated status. Guard so a
    // toolbar click is a no-op rather than a hard throw where it's missing.
    if (!el || typeof document.execCommand !== 'function') return;
    el.focus();
    document.execCommand(command);
    setHasText(!!el.textContent?.trim());
    saveDraft(chat.id, el.innerHTML);
  }, [chat.id]);

  // Toolbar buttons use onMouseDown+preventDefault (not onClick alone) so the
  // click never steals focus/collapses the text selection before execCommand
  // runs — the standard trick for a toolbar sitting outside the editable
  // element itself.
  const holdSelection = useCallback((e: MouseEvent) => e.preventDefault(), []);

  const insertLink = useCallback(() => {
    const el = editorRef.current;
    if (!el || typeof document.execCommand !== 'function') return;
    el.focus();
    const sel = window.getSelection();
    const hasSelection = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && el.contains(sel.anchorNode);
    const url = window.prompt(hasSelection ? 'Link URL' : 'Link URL (select text first to link existing words)');
    if (!url) return;
    if (hasSelection) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    setHasText(!!el.textContent?.trim());
    saveDraft(chat.id, el.innerHTML);
  }, [chat.id]);

  // Reads the composer's live DOM, converts to markdown, hands off to the
  // existing submit()/queue machinery, then clears the (uncontrolled) editor.
  const submitFromEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = htmlToMarkdown(el);
    submit(text, pending);
    el.textContent = '';
    setHasText(false);
    clearDraft(chat.id);
  }, [submit, pending, chat.id]);

  // Stop button: a real cancel — POSTs /api/interrupt, which aborts the
  // turn server-side (AgentRuntime.interrupt) rather than just dropping this
  // tab's connection, so the agent loop actually stops instead of running on
  // unseen. Whatever already streamed in is kept (see the `error`-as-notice
  // handling above and the server's live-persist).
  const stop = useCallback(() => {
    if (!sending) return;
    interruptingRef.current = true;
    void interruptChat(chat.id).catch(() => {
      // The turn may finish (or fail on its own) before the interrupt lands
      // — nothing useful to surface to a user who just clicked "stop".
    });
  }, [sending, chat.id]);

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
    <div className="reader" ref={readerRef}>
      <header className="reader-head">
        <div className="reader-title">
          <h2>{chat.title ?? 'New conversation'}</h2>
          <span className="reader-meta data">{chat.messages > 0 ? `${chat.messages} messages · ` : ''}Cabinet</span>
        </div>
      </header>

      <ol className="reader-log">
        {!messages && !error ? (
          <li>
            <p className="chat-loading data">Pulling the scrollback…</p>
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
                      {!entry.isLive && (
                        <span className="msg-entry-when data" title={fullStamp(entry.timeIso)}>
                          {clockTime(entry.timeIso)}
                        </span>
                      )}
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
      </ol>

      {error && <p className="reader-error voice">{error}</p>}

      {(restartWait || liveTurn) && (
        <div className="resume-strip" role="status" aria-live="polite">
          <span className="resume-dot" aria-hidden="true" />
          <span className="resume-text data">
            {restartWait === 'down'
              ? 'Cabinet is restarting — this chat resumes on its own.'
              : restartWait === 'up'
                ? 'Back online — waiting for the chat to resume…'
                : restartWait === 'resuming'
                  ? 'Resuming this chat…'
                  : 'Cabinet is working on this chat — following along…'}
          </span>
        </div>
      )}

      <form
        className="composer-form"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submitFromEditor();
        }}
      >
        {queued.length > 0 && (
          <ol className="composer-queue">
            {queued.map((q) => (
              <li className="composer-queue-item" key={q.id}>
                <span className="composer-queue-tag data">queued</span>
                <span className="composer-queue-text">{q.text}</span>
                <button type="button" className="composer-queue-remove" onClick={() => removeQueued(q.id)} aria-label="Remove queued message">
                  <X size={12} />
                </button>
              </li>
            ))}
          </ol>
        )}
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
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-tools" role="toolbar" aria-label="Formatting">
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
          {/* Pinned to the top corner of the composer (2026-07-16, Ben's
              request) — living beside the formatting tools instead of the
              main input row, where it used to sink to the bottom as the
              message grew past one line. */}
          <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach image" title="Attach image"><Paperclip size={14} /></button>
          <span className="composer-tools-sep" aria-hidden="true" />
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('bold')} aria-label="Bold" title="Bold (⌘B)"><Bold size={14} /></button>
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('italic')} aria-label="Italic" title="Italic (⌘I)"><Italic size={14} /></button>
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('underline')} aria-label="Underline" title="Underline (⌘U)"><Underline size={14} /></button>
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('strikeThrough')} aria-label="Strikethrough" title="Strikethrough (⌘⇧X)"><Strikethrough size={14} /></button>
          <span className="composer-tools-sep" aria-hidden="true" />
          <button type="button" onMouseDown={holdSelection} onClick={insertLink} aria-label="Link" title="Link (⌘⇧U)"><Link2 size={14} /></button>
          <span className="composer-tools-sep" aria-hidden="true" />
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('insertOrderedList')} aria-label="Numbered list" title="Numbered list (⌘⇧7)"><ListOrdered size={14} /></button>
          <button type="button" onMouseDown={holdSelection} onClick={() => exec('insertUnorderedList')} aria-label="Bulleted list" title="Bulleted list (⌘⇧8)"><List size={14} /></button>
        </div>
        <div className="composer">
          <div
            ref={editorRef}
            className="composer-editor"
            contentEditable
            data-placeholder={sending ? 'Message Cabinet… (queues until this turn finishes)' : 'Message Cabinet…'}
            role="textbox"
            aria-multiline="true"
            aria-label="Message Cabinet"
            onInput={() => {
              const el = editorRef.current;
              setHasText(!!el?.textContent?.trim());
              if (el) saveDraft(chat.id, el.innerHTML);
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              const files: File[] = [];
              if (items) {
                for (const item of items) {
                  if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                  }
                }
              }
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
                return;
              }
              // Plain-text paste only: pasted rich HTML (e.g. from a web page)
              // could carry arbitrary nested markup our toolbar never
              // produces — inserting as text keeps htmlToMarkdown's surface
              // exactly the tags we control.
              e.preventDefault();
              document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
            }}
            onKeyDown={(e) => {
              if (e.metaKey || e.ctrlKey) {
                // Slack's bindings; ⌘K stays with the command bar.
                const k = e.key.toLowerCase();
                const cmd =
                  k === 'b' ? 'bold'
                  : k === 'i' ? 'italic'
                  : k === 'u' && !e.shiftKey ? 'underline'
                  : e.shiftKey && k === 'x' ? 'strikeThrough'
                  : e.shiftKey && k === '7' ? 'insertOrderedList'
                  : e.shiftKey && k === '8' ? 'insertUnorderedList'
                  : null;
                if (cmd) {
                  e.preventDefault();
                  exec(cmd);
                  return;
                }
                if (k === 'u' && e.shiftKey) {
                  e.preventDefault();
                  insertLink();
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitFromEditor();
              }
            }}
          />
          {sending && (
            <button type="button" className="composer-stop-btn" aria-label="Stop" onClick={stop}>
              <Square size={14} fill="currentColor" />
            </button>
          )}
          <button
            type="submit"
            className="composer-send-btn"
            aria-label={sending ? 'Queue message' : 'Send'}
            disabled={pending.some((p) => p.uploading) || (!hasText && !pending.some((p) => p.id && !p.error))}
          >
            <ArrowUp size={18} />
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
      return (
        <div className="msg-text">
          <Markdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, MD_SCHEMA]]}
            components={{
              a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
            }}
          >
            {part.text}
          </Markdown>
        </div>
      );

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
            {part.at && (
              <span className="msg-tool-when data" title={fullStamp(part.at)}>
                {clockTime(part.at)}
              </span>
            )}
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
