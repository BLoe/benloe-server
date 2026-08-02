import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { record, useApi, type ChatMessage, type LeagueBundle, type Transaction } from '../api';
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
    needsToken: boolean;
    notChatOwner: boolean;
  }>({
    messages: [],
    canPost: false,
    loading: true,
    error: null,
    needsToken: false,
    notChatOwner: false,
  });

  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

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
            error: body.error ?? `Request failed: ${res.status}`,
            needsToken: !!body.needsToken,
            notChatOwner: !!body.notChatOwner,
          }));
          return;
        }
        const data = body as ChatResponse;
        setState({
          messages: data.messages,
          canPost: data.canPost,
          loading: false,
          error: null,
          needsToken: false,
          notChatOwner: false,
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

  if (state.notChatOwner) return <ChatUnavailable />;
  if (state.needsToken) return <TokenSetup />;

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
          className="overflow-y-auto px-4 py-3"
          style={{ height: 'calc(100vh - 190px)' }}
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
  const tx = useApi<{ transactions: Transaction[] }>(
    `/api/league/${league.leagueId}/transactions?through=${Math.max(1, bundle.currentWeek)}`
  );
  const recent = (tx.data?.transactions ?? []).slice(0, 8);

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
            <li key={t.id} className="px-3 py-2 border-b border-line/50 last:border-b-0">
              <div className="text-dim text-[10px] uppercase tracking-wide">
                {t.type === 'free_agent' ? 'Add' : t.type} · wk {t.week}
              </div>
              <div className="leading-snug flex flex-wrap gap-x-2" style={{ fontSize: 'var(--t-body)' }}>
                {(t.adds.length ? t.adds : t.drops).map((x: any, i: number) => (
                  <PlayerLink key={i} id={x.playerId} name={x.player} />
                ))}
                {!t.adds.length && !t.drops.length && '—'}
              </div>
              <div className="text-dim truncate" style={{ fontSize: 'var(--t-meta)' }}>
                {t.teams.map((x) => x.teamName).join(', ')}
              </div>
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
 * Chat is the one section that cannot be per-visitor: it rides a single Sleeper
 * token, so it belongs to exactly one account. Everyone else gets this.
 */
function ChatUnavailable() {
  return (
    <div className="pt-4">
      <Panel title="Chat is not available for this account">
        <div className="p-6 max-w-2xl space-y-3 text-[13.5px] leading-relaxed">
          <p className="text-muted">
            League chat requires being signed in to Sleeper, and this server holds a
            session for one account only. Chat is shown to that account and nobody else.
          </p>
          <p className="text-dim text-[12px]">
            Everything else in the dashboard works normally for your leagues — standings,
            matchups, rosters and activity are all public data.
          </p>
        </div>
      </Panel>
    </div>
  );
}

/** Shown to the token's owner when no token is configured at all. */
function TokenSetup() {
  return (
    <div className="pt-4">
      <Panel title="Chat needs a Sleeper token">
        <div className="p-6 max-w-2xl space-y-4 text-[13.5px] leading-relaxed">
          <p className="text-muted">
            League chat is the one part of Sleeper that will not answer without being signed
            in. Everything else in this dashboard uses public endpoints.
          </p>

          <ol className="space-y-2 text-muted list-decimal pl-5">
            <li>Open sleeper.com in Chrome and sign in.</li>
            <li>Open DevTools, then the Application tab.</li>
            <li>
              Under Local Storage, find the entry holding your session token and copy its
              value.
            </li>
            <li>
              Add it to <code className="text-ink">/srv/benloe/.env</code> as{' '}
              <code className="text-ink">SLEEPER_TOKEN=…</code> and restart the app.
            </li>
          </ol>

          <p className="text-dim text-[12px]">
            The token stays on this server and is never committed. Posting stays disabled
            until <code>SLEEPER_ALLOW_POSTING=true</code> is set separately.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
