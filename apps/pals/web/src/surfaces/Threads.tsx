import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { ChatMessage, MessagePart, ThreadSummary } from '../lib/cabinet.js';
import { SectionLabel } from '../components/instruments/index.js';
import './threads.css';

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

/**
 * THREADS — the conversation archive. A record, not the spine: past
 * conversations, searchable, with their scrollback restyled into the design
 * system. Selecting one opens the reading pane; nothing here is live.
 */
export function Threads() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .threads()
      .then((res) => {
        if (!alive) return;
        setThreads(res.threads);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "Couldn't reach the archive.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!threads) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((t) => matches(t, needle));
  }, [threads, query]);

  const selected = filtered?.find((t) => t.id === selectedId) ?? threads?.find((t) => t.id === selectedId) ?? null;

  return (
    <section className="threads" aria-label="Thread archive">
      <header className="threads-head">
        <div>
          <SectionLabel n="00">Archive</SectionLabel>
          <p className="threads-lede voice">Every conversation, on the record. Nothing here is live.</p>
        </div>
        <div className="threads-search">
          <input
            type="search"
            className="threads-search-input data"
            placeholder="Search title or preview…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the archive"
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
            <p className="threads-empty voice">Nothing filed yet. Conversations land here once they start.</p>
          ) : (
            <p className="threads-empty voice">Nothing matches “{query.trim()}.”</p>
          )}
        </div>

        <div className="threads-reading-pane">
          {selected ? (
            <ThreadReader key={selected.id} thread={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="threads-reader-empty">
              <p className="threads-hint voice">Pick a thread to read it back.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---- reading pane: fetches + renders one thread's messages ---- */
function ThreadReader({ thread, onBack }: { thread: ThreadSummary; onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setMessages(null);
    setError(null);
    api
      .messages(thread.id)
      .then((res) => {
        if (alive) setMessages(res.messages);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't pull that thread.");
      });
    return () => {
      alive = false;
    };
  }, [thread.id]);

  return (
    <div className="reader">
      <header className="reader-head">
        <button type="button" className="threads-back" onClick={onBack}>
          ← Archive
        </button>
        <div className="reader-title">
          <h2>{thread.title ?? 'Untitled thread'}</h2>
          <span className="reader-meta data">
            {thread.messages} messages · {stamp(thread.updated_at)}
          </span>
        </div>
      </header>

      {error ? (
        <p className="threads-empty voice">{error}</p>
      ) : !messages ? (
        <p className="threads-loading data">Pulling the scrollback…</p>
      ) : messages.length === 0 ? (
        <p className="threads-empty voice">Empty thread. Nothing was said.</p>
      ) : (
        <ol className="reader-log">
          {messages.map((m) => (
            <li key={m.id}>
              <MessageRow message={m} />
            </li>
          ))}
        </ol>
      )}
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
  // user turn — attribute it: agents by name, everyone else (Ben) as "You"
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

function MessagePartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <p className="msg-text">{part.text}</p>;

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
