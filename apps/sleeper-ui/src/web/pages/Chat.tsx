import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { record, useApi, type ChatMessage, type LeagueBundle, type ActivityRow } from '../api';
import { Avatar, Empty, ErrorState, Loading, Panel, PlayerLink, TeamLink } from '../components';

interface ChatResponse {
  messages: ChatMessage[];
  nextCursor: string | null;
  canPost: boolean;
}

/** How often to pull new messages while the tab is visible. */
const POLL_MS = 15_000;

export default function Chat({ bundle }: { bundle: LeagueBundle }) {
  const { league } = bundle;
  const [state, setState] = useState<{
    messages: ChatMessage[];
    canPost: boolean;
    loading: boolean;
    error: string | null;
    needsLogin: boolean;
  }>({ messages: [], canPost: false, loading: true, error: null, needsLogin: false });

  // Whether this visitor has their own Sleeper account connected, which decides
  // if there is anything to disconnect from.
  const [connected, setConnected] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const refreshConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/sleeper-login');
      if (!res.ok) return setConnected(false);
      const body = await res.json();
      setConnected(!!body.connected);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(`/api/league/${league.leagueId}/chat`);
        const body = await res.json();
        if (!res.ok) {
          setState((s) => ({
            ...s,
            loading: false,
            error: body.needsLogin ? null : (body.error ?? `Request failed: ${res.status}`),
            needsLogin: !!body.needsLogin,
          }));
          return;
        }
        const data = body as ChatResponse;
        setState({
          messages: data.messages,
          canPost: data.canPost,
          loading: false,
          error: null,
          needsLogin: false,
        });
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
      }
    },
    [league.leagueId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while the tab is visible — no reason to hammer Sleeper in a
  // background tab.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  // Keep the newest message in view, but never yank the view away from someone
  // who has scrolled up to read history.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (state.needsLogin) {
    return (
      <ConnectSleeper
        onConnected={() => {
          refreshConnection();
          load();
        }}
      />
    );
  }

  return (
    // Chat beside live league context. A full-width message list is unreadable
    // and a narrow one wastes the screen — the sidebar is what made Sleeper's
    // chat feel part of the league rather than bolted on.
    <div className="pt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <Panel
        title={`${league.name} chat`}
        action={
          <span className="text-dim text-[11px]">
            {state.messages.length} recent · updates every 15s
          </span>
        }
      >
        <div
          ref={scroller}
          onScroll={onScroll}
          className="overflow-y-auto px-4 py-3 h-[calc(100vh-300px)] sm:h-[calc(100vh-210px)]"
        >
          {state.loading && !state.messages.length && <Loading label="Loading chat" />}
          {state.error && <ErrorState message={state.error} onRetry={() => load()} />}
          {!state.loading && !state.error && !state.messages.length && (
            <div className="grid place-items-center h-full">
              <div className="eyebrow">No messages yet</div>
            </div>
          )}

          <div className="max-w-[900px]">
            {state.messages.map((m) => (
              <MessageRow key={m.id} message={m} />
            ))}
          </div>
        </div>

        <Composer
          leagueId={league.leagueId}
          canPost={state.canPost}
          onSent={() => load({ quiet: true })}
        />
      </Panel>

      <ContextRail bundle={bundle} />
    </div>
  );
}

/**
 * What the league is arguing about, next to the arguing. Standings and the
 * transaction wire are the two things a chat message is usually referring to.
 */
function ContextRail({ bundle }: { bundle: LeagueBundle }) {
  const { league, standings, myRosterId } = bundle;
  const tx = useApi<{ rows: ActivityRow[] }>(
    `/api/league/${league.leagueId}/transactions?through=${Math.max(1, bundle.currentWeek)}`
  );
  const recent = (tx.data?.rows ?? []).slice(0, 8);

  return (
    <div className="hidden xl:block space-y-4 sticky top-[68px]">
      <Panel title="Standings">
        <ul>
          {standings.slice(0, 6).map((s) => (
            <li
              key={s.rosterId}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-line/50 last:border-b-0"
              style={{ background: s.rosterId === myRosterId ? 'rgba(63,191,127,.06)' : undefined }}
            >
              <span className="font-display font-semibold text-[11px] text-dim w-4">{s.rank}</span>
              <Avatar url={s.avatar} name={s.teamName} size={18} />
              <TeamLink rosterId={s.rosterId} className="entity truncate flex-1" style={{ fontSize: 'var(--t-body)' }}>
                {s.teamName}
              </TeamLink>
              <span className="text-muted text-[12px] tabular-nums">
                {record(s.wins, s.losses, s.ties)}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-3 py-1.5 border-t border-line">
          <Link to={`/l/${league.leagueId}`} className="eyebrow hover:text-ink">
            Full table →
          </Link>
        </div>
      </Panel>

      <Panel title="Latest moves">
        {!recent.length && <Empty title="Nothing yet" />}
        <ul>
          {recent.map((t) => (
            <li key={t.key} className="px-3 py-2 border-b border-line/50 last:border-b-0">
              <div className="stat-label">
                {t.action} · week {t.week}
              </div>
              <div className="leading-snug flex flex-wrap gap-x-2 mt-0.5" style={{ fontSize: 'var(--t-body)' }}>
                {(t.added.length ? t.added : t.dropped).map((x, i) => (
                  <PlayerLink key={i} id={x.playerId} name={x.name} />
                ))}
              </div>
              <TeamLink rosterId={t.rosterId} className="text-dim block truncate" style={{ fontSize: 'var(--t-meta)' }}>
                {t.teamName}
              </TeamLink>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function MessageRow({ message: m }: { message: ChatMessage }) {
  return (
    <>
      {m.dayLabel && (
        <div className="flex items-center gap-3 my-4" role="separator">
          <span className="h-px flex-1 bg-line" />
          <span className="stat-label">{m.dayLabel}</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <div
        className={`flex gap-2.5 group ${m.continues ? 'mt-0.5' : 'mt-3'}`}
        style={{ paddingLeft: m.continues ? 34 : 0 }}
      >
        {!m.continues && <Avatar url={m.authorAvatar} name={m.authorName} size={26} />}

        <div className="min-w-0 flex-1">
          {!m.continues && (
            <div className="flex items-baseline gap-2">
              <TeamLink
                rosterId={m.rosterId ?? null}
                className="entity"
                style={{ color: m.isMine ? 'var(--win)' : undefined, fontSize: 'var(--t-h2)' }}
              >
                {m.authorName}
              </TeamLink>
              <span className="text-dim text-[10px]">{clock(m.created)}</span>
              {m.edited && <span className="text-dim text-[10px]">edited</span>}
            </div>
          )}

          <div className="text-[13.5px] leading-snug break-words whitespace-pre-wrap">
            {m.text}
            {m.hasAttachment && !m.text && (
              <span className="text-dim italic">sent an attachment</span>
            )}
          </div>

          {!!m.reactions.length && (
            <div className="flex flex-wrap gap-1 mt-1">
              {m.reactions.map((r) => (
                <span
                  key={r.emoji}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-raised border border-line text-[11px]"
                >
                  <span>{r.emoji}</span>
                  <span className="text-muted tabular-nums">{r.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Composer({
  leagueId,
  canPost,
  onSent,
}: {
  leagueId: string;
  canPost: boolean;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canPost) {
    return (
      <div className="border-t border-line px-4 py-2.5 text-dim text-[12px]">
        Read only. Set <code className="text-muted">SLEEPER_ALLOW_POSTING=true</code> to send
        messages from here.
      </div>
    );
  }

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/league/${leagueId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`);
      setText('');
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-line p-3">
      {error && (
        <p className="text-[12px] mb-2" style={{ color: '#E5484D' }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Message the league"
          aria-label="Message the league"
          className="flex-1 resize-none bg-raised border border-line rounded-[3px] px-3 py-2 text-[13.5px] placeholder:text-dim focus:border-line2 outline-none"
          style={{ minHeight: 38, maxHeight: 140 }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending}
          className="tab border border-line2 px-4 disabled:opacity-40 disabled:cursor-not-allowed hover:border-dim"
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/**
 * Sleeper sign-in.
 *
 * Chat is the only Sleeper surface that requires being signed in. Credentials go
 * straight to Sleeper over TLS; this server keeps only the token Sleeper hands
 * back, encrypted, and only for the account it belongs to.
 */
function ConnectSleeper({ onConnected }: { onConnected: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !identifier.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sleeper-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`);
      setPassword('');
      onConnected();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="pt-5 max-w-[560px]">
      <Panel title="Connect your Sleeper account">
        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-muted" style={{ fontSize: 'var(--t-body)' }}>
            League chat is the only part of Sleeper that will not answer without being
            signed in. Everything else in this dashboard uses public data.
          </p>

          <div>
            <label htmlFor="sleeper-id" className="stat-label block mb-1.5">
              Sleeper username or email
            </label>
            <input
              id="sleeper-id"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full bg-raised border border-line rounded-[3px] px-3 py-2 placeholder:text-dim focus:border-line2 outline-none"
              style={{ fontSize: 'var(--t-body)' }}
            />
          </div>

          <div>
            <label htmlFor="sleeper-pw" className="stat-label block mb-1.5">
              Sleeper password
            </label>
            <input
              id="sleeper-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-raised border border-line rounded-[3px] px-3 py-2 placeholder:text-dim focus:border-line2 outline-none"
              style={{ fontSize: 'var(--t-body)' }}
            />
          </div>

          {error && <p style={{ color: 'var(--loss)', fontSize: 'var(--t-meta)' }}>{error}</p>}

          <button
            type="submit"
            disabled={busy || !identifier.trim() || !password}
            className="tab border border-line2 px-5 disabled:opacity-40 disabled:cursor-not-allowed hover:border-dim"
          >
            {busy ? 'Connecting' : 'Connect'}
          </button>

          <div
            className="border-t border-line pt-3 text-dim space-y-1.5"
            style={{ fontSize: 'var(--t-meta)' }}
          >
            <p>
              Your password goes to Sleeper to obtain a session token. It is not stored
              here, written to disk, or logged.
            </p>
            <p>
              The token is encrypted at rest and used only for your own account. Disconnect
              any time from the chat header.
            </p>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
