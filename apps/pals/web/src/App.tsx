import { useCallback, useEffect, useRef, useState } from 'react';
import { api, redirectToLogin, streamChat, subscribeEvents, AuthRequiredError, type ApprovalPacket, type ThreadSummary, type HealthInfo } from './lib/api.js';
import { addUserMessage, applyEvent, emptyThread, loadHistory, type ThreadState } from './lib/threadStore.js';
import { MessageView, ApprovalChit } from './components/MessageView.jsx';

export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'login'>('checking');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadState>(emptyThread());
  const [inbox, setInbox] = useState<ApprovalPacket[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [draft, setDraft] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshThreads = useCallback(async () => {
    const { threads } = await api.threads();
    setThreads(threads);
    return threads;
  }, []);

  // Boot: auth probe → threads + health + approvals + event channel.
  useEffect(() => {
    let stop: (() => void) | undefined;
    (async () => {
      try {
        const [ts, h, ap] = await Promise.all([api.threads(), api.health(), api.approvals()]);
        setThreads(ts.threads);
        setHealth(h);
        setInbox(ap.approvals);
        setAuthState('ok');
        if (ts.threads[0]) setActiveId(ts.threads[0].id);
        stop = subscribeEvents((e) => {
          if (e.event === 'approval') setInbox((prev) => [...prev.filter((p) => p.id !== (e.data as ApprovalPacket).id), e.data as ApprovalPacket]);
          if (e.event === 'approval-result') setInbox((prev) => prev.filter((p) => p.id !== (e.data as { id: string }).id));
        });
      } catch (err) {
        if (err instanceof AuthRequiredError) setAuthState('login');
        else setAuthState('ok'); // degraded but usable; errors surface per-call
      }
    })();
    return () => stop?.();
  }, []);

  // Load history when the active thread changes — but NOT for a thread we
  // just created inside send(), or the reset would wipe the optimistic
  // message we're about to stream a reply into.
  const skipLoadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId) return;
    if (skipLoadRef.current === activeId) {
      skipLoadRef.current = null;
      return;
    }
    setThread(emptyThread());
    api.messages(activeId).then(({ messages }) => setThread((s) => loadHistory(s, messages)));
  }, [activeId]);

  // Pin scroll to bottom while streaming.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || thread.status === 'streaming') return;
    setDraft('');
    // Fresh install has no threads yet — create one lazily on first send so
    // the composer is never a silent no-op.
    let targetId = activeId;
    if (!targetId) {
      try {
        const { id } = await api.createThread();
        targetId = id;
        skipLoadRef.current = id; // don't let the activeId effect wipe the optimistic message
        setActiveId(id);
      } catch (err) {
        if (err instanceof AuthRequiredError) return setAuthState('login');
        setThread((s) => ({ ...s, status: 'error', error: `Could not start a thread: ${(err as Error).message}` }));
        setDraft(text);
        return;
      }
    }
    setThread((s) => addUserMessage(s, text, `local-${Date.now()}`));
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamChat(targetId, text, (e) => setThread((s) => applyEvent(s, e)), ac.signal);
    } catch (err) {
      if (err instanceof AuthRequiredError) return setAuthState('login');
      setThread((s) => ({ ...s, status: 'error', error: String((err as Error).message) }));
    } finally {
      abortRef.current = null;
      void refreshThreads();
    }
  }, [draft, thread.status, activeId, refreshThreads]);

  const interrupt = useCallback(() => {
    if (activeId) void api.interrupt(activeId);
    abortRef.current?.abort();
  }, [activeId]);

  const newThread = useCallback(async () => {
    const { id } = await api.createThread();
    await refreshThreads();
    setActiveId(id);
  }, [refreshThreads]);

  if (authState === 'checking') return <div className="login-splash"><span className="wordmark">PALS</span></div>;
  if (authState === 'login') {
    return (
      <div className="login-splash">
        <span className="wordmark">PALS</span>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>Sign in with your magic link to continue.</span>
        <button onClick={redirectToLogin}>Sign in via auth.benloe.com</button>
      </div>
    );
  }

  const streaming = thread.status === 'streaming';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="status-rail" style={{ paddingTop: 12 }}>
          <span className="wordmark">PALS</span>
        </div>
        <button className="new-thread" onClick={newThread}>+ new thread</button>
        <div className="thread-list">
          {threads.map((t) => (
            <button key={t.id} className={`thread-item${t.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(t.id)}>
              <div>{t.title ?? 'untitled'}</div>
              <div className="meta">{t.messages} msgs · {t.model_override ?? 'sonnet'}</div>
            </button>
          ))}
        </div>
      </aside>

      <div className="main">
        <div className="status-rail">
          <span className="wordmark">PALS</span>
          <span><span className={`dot ${health?.ok ? 'ok' : 'warn'}`} /> {health?.authMode ?? '…'}</span>
          {streaming && <span style={{ color: 'var(--amber)' }}>working…</span>}
          <span className="spacer" />
          {inbox.length > 0 && <span className="pill attention">{inbox.length} awaiting sign-off</span>}
          <button className="pill" onClick={newThread}>new</button>
        </div>

        <div className="chat" ref={chatRef}>
          <div className="chat-inner">
            {inbox.map((p) => <ApprovalChit key={p.id} packet={p} onDecided={(id) => setInbox((prev) => prev.filter((x) => x.id !== id))} />)}
            {thread.messages.length === 0 && !streaming && <div className="empty">NEW THREAD · PALS IS LISTENING</div>}
            {thread.messages.map((m) => <MessageView key={m.id} message={m} />)}
            {thread.error && <div className="error-banner">{thread.error}</div>}
          </div>
        </div>

        <div className="composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message PALS…"
            rows={1}
            aria-label="message input"
          />
          {streaming ? (
            <button className="stop" onClick={interrupt}>Stop</button>
          ) : (
            <button onClick={() => void send()} disabled={!draft.trim()}>Send</button>
          )}
        </div>
      </div>
    </div>
  );
}
