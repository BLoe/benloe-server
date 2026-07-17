import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router';
import { api, usingMock, type PresenceState } from './lib/cabinet.js';
import type { ChatSummary } from './lib/cabinet.js';
import { AuthRequiredError } from './lib/client.js';
import { AppShell, type SurfaceId } from './components/shell/index.js';
import { Today } from './surfaces/Today.js';
import { Domains } from './surfaces/Domains.js';
import { Ops } from './surfaces/Ops.js';
import { Brain } from './surfaces/Brain.js';
import { Chat } from './surfaces/Chat.js';
import './App.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Datestamp({ now }: { now: Date }) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <>{DAYS[now.getDay()]} · <b>{now.getDate()} {MONTHS[now.getMonth()]}</b> · {hh}:{mm}</>;
}

function toLogin() {
  window.location.href = `https://auth.benloe.com/?redirect=${encodeURIComponent(window.location.href)}`;
}

/** The v2 console: the shell + surface routing. Chat is a surface, reached
    from the rail's accordion — you direct Cabinet through the command bar (⌘K). */
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // useMatch (not useParams) because chatId is also needed by the Rail's
  // chatNav, which lives outside the <Routes> tree as sibling shell chrome —
  // useParams only resolves inside a matched Route's own element.
  const chatMatch = useMatch('/chat/:chatId');
  const chatId = chatMatch?.params.chatId ?? null;
  const active = (location.pathname.split('/')[1] || 'today') as SurfaceId;
  const onNavigate = useCallback((id: SurfaceId) => navigate('/' + id), [navigate]);
  const [presence, setPresence] = useState<PresenceState>('idle');
  const [presenceMeta, setPresenceMeta] = useState<string>('');
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'login'>('checking');
  const [now, setNow] = useState(() => new Date());

  // ---- chat state (owned here: the rail's accordion and the Chat surface
  // are two projections of the same list/selection) ----
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // A conversation opened from the command bar: chat id + a first message to send.
  const [seed, setSeed] = useState<{ id: string; text: string } | null>(null);
  // Chats being resumed after a restart (gateway/pendingTurn.ts) — badges the
  // accordion row. Fed by the server's chat-resume-start/end broadcasts (any
  // tab) and the open conversation's own drop detection (this tab, immediately).
  const [resumingIds, setResumingIds] = useState<ReadonlySet<string>>(new Set());
  const setResumeState = useCallback((chatId: string, resuming: boolean) => {
    setResumingIds((prev) => {
      if (prev.has(chatId) === resuming) return prev;
      const next = new Set(prev);
      if (resuming) next.add(chatId);
      else next.delete(chatId);
      return next;
    });
  }, []);

  const refreshChats = useCallback(() => {
    api
      .chats()
      .then((res) => {
        setChats(res.chats);
        setChatsError(null);
      })
      .catch((e: unknown) => setChatsError(e instanceof Error ? e.message : "Couldn't reach the archive."));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.health()
        .then((h) => { if (!alive) return; setPresence(h.presence); setPresenceMeta(h.presenceMeta); setAuthState('ok'); })
        .catch((e) => { if (!alive) return; setAuthState(e instanceof AuthRequiredError ? 'login' : 'ok'); });
    load();
    const health = setInterval(load, 30_000);
    const clock = setInterval(() => alive && setNow(new Date()), 30_000);
    return () => { alive = false; clearInterval(health); clearInterval(clock); };
  }, []);

  useEffect(() => {
    if (authState === 'ok') refreshChats();
  }, [authState, refreshChats]);

  // List lifecycle from the server's out-of-band channel: a turn touching a
  // chat (start/end) or an auto-title landing re-fetches the list, so the
  // accordion's ordering, counts, and titles track reality without a reload.
  // Badge lifecycle: the /api/events ring replays history to every fresh
  // EventSource — safe because resume-start/end only ever emit as a pair, so
  // replayed pairs net out to no badge.
  useEffect(() => {
    if (usingMock || authState !== 'ok') return;
    const es = new EventSource('/api/events');
    const refresh = () => refreshChats();
    es.addEventListener('chat-activity', refresh);
    es.addEventListener('chat-titled', refresh);
    const mark = (resuming: boolean) => (ev: MessageEvent) => {
      try {
        const { chatId } = JSON.parse(ev.data as string) as { chatId?: string };
        if (chatId) setResumeState(chatId, resuming);
      } catch {
        /* not our payload shape */
      }
    };
    es.addEventListener('chat-resume-start', mark(true));
    es.addEventListener('chat-resume-end', mark(false));
    return () => es.close();
  }, [authState, refreshChats, setResumeState]);

  const handleNewChat = useCallback(() => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    api
      .createChat()
      .then(({ id }) => {
        navigate(`/chat/${id}`);
        refreshChats();
      })
      .catch((e: unknown) => setCreateError(e instanceof Error ? e.message : "Couldn't start a new conversation."))
      .finally(() => setCreating(false));
  }, [creating, navigate, refreshChats]);

  // Delete an archived conversation. Rail owns the confirm dialog + the
  // in-flight/error UI around this call; here we only do the actual work —
  // hit the API, refresh the list, and bail out of the surface if the chat
  // deleted out from under it was the one open.
  const handleDeleteChat = useCallback(
    (id: string) =>
      api.deleteChat(id).then(() => {
        refreshChats();
        if (chatId === id) navigate('/chat');
      }),
    [chatId, navigate, refreshChats],
  );

  const onCommand = useCallback((intent: string) => {
    // Open a fresh conversation and send the intent as its first message.
    api.createChat()
      .then(({ id }) => {
        setSeed({ id, text: intent });
        navigate(`/chat/${id}`);
        refreshChats();
      })
      .catch(() => {});
  }, [navigate, refreshChats]);

  if (authState === 'checking') return <div className="boot"><span className="wordmark">CABINET</span></div>;
  if (authState === 'login') {
    return (
      <div className="boot login">
        <span className="wordmark">CABINET</span>
        <span className="line">Sign in with your magic link to open your office.</span>
        <button onClick={toLogin}>Sign in via auth.benloe.com</button>
      </div>
    );
  }

  // A just-created chat won't be in the fetched list yet — synthesize a stub.
  const selectedChat: ChatSummary | null =
    chats?.find((c) => c.id === chatId) ??
    (chatId
      ? { id: chatId, title: null, model_override: null, archived: 0, updated_at: new Date().toISOString(), messages: 0 }
      : null);

  return (
    <AppShell
      active={active}
      onNavigate={onNavigate}
      onCommand={onCommand}
      chatNav={{
        chats,
        loadError: chatsError,
        selectedId: chatId,
        resumingIds,
        creating,
        createError,
        onSelect: (id) => navigate(`/chat/${id}`),
        onNew: handleNewChat,
        onDelete: handleDeleteChat,
      }}
      datestamp={<Datestamp now={now} />}
      presence={presence}
      presenceMeta={presenceMeta}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<Today onNavigate={(s) => navigate('/' + s)} />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/brain" element={<Brain />} />
        <Route
          path="/chat"
          element={
            <Chat
              chat={null}
              seed={undefined}
              onSeedConsumed={() => setSeed(null)}
              onResumeState={setResumeState}
            />
          }
        />
        <Route
          path="/chat/:chatId"
          element={
            <Chat
              chat={selectedChat}
              seed={seed && seed.id === chatId ? seed.text : undefined}
              onSeedConsumed={() => setSeed(null)}
              onResumeState={setResumeState}
            />
          }
        />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </AppShell>
  );
}
