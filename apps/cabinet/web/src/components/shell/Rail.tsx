import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChatSummary } from '../../lib/contracts.js';
import { hasDraft } from '../../lib/draft.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { SURFACES, type SurfaceId } from './surfaces.js';

const ICONS: Record<SurfaceId, ReactNode> = {
  today: <path d="M2 6l6-4 6 4v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z M6 14V9h4v5" />,
  domains: <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>,
  ops: <path d="M2 8h3l2 5 3-10 2 5h2" />,
  brain: <path d="M8 2.5C5.5 2.5 4 4 4 6c-1 .4-1.5 1.3-1.5 2.3 0 1 .6 1.9 1.5 2.2 0 1.6 1.3 2.7 3 2.7 M8 2.5c2.5 0 4 1.5 4 3.5 1 .4 1.5 1.3 1.5 2.3 0 1-.6 1.9-1.5 2.2 0 1.6-1.3 2.7-3 2.7 M8 2.5v11" />,
  chat: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />,
};

/** Everything the rail's Chat accordion needs — owned by App, so the list
 *  survives surface switches and the reading pane stays a dumb projection. */
export interface ChatNav {
  chats: ChatSummary[] | null;
  loadError: string | null;
  selectedId: string | null;
  /** Chats mid-resume after a restart — badged with a pulsing dot. */
  resumingIds: ReadonlySet<string>;
  creating: boolean;
  createError: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Rejects with an Error whose message is shown in the confirm dialog. */
  onDelete: (id: string) => Promise<void>;
}

function matches(c: ChatSummary, needle: string): boolean {
  return `${c.title ?? ''} ${c.preview ?? ''}`.toLowerCase().includes(needle);
}

/** Sidebar titles are truncated with ellipsis by default (see .rail-convo-title
 *  in shell.css); on hover, if the title actually overflows its box, it
 *  marquees to reveal the rest and resets. Measured lazily on first hover
 *  (not on every list render) via scrollWidth vs clientWidth — titles that
 *  fit are left completely alone (distance stays 0, animation is a no-op). */
function ConvoTitle({ title }: { title: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  const measure = () => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    setDistance(Math.max(0, inner.scrollWidth - wrap.clientWidth));
  };

  const style =
    distance > 0
      ? ({ '--marquee-dist': `-${distance}px`, '--marquee-dur': `${Math.max(2, distance / 30)}s` } as CSSProperties)
      : undefined;

  return (
    <span className="rail-convo-title" ref={wrapRef} onMouseEnter={measure}>
      <span className="rail-convo-title-inner" ref={innerRef} style={style}>
        {title}
      </span>
    </span>
  );
}

/** The conversation list, folded into the rail under the Chat item — an
 *  accordion: expanded exactly while the Chat surface is active. */
function ChatAccordion({ nav }: { nav: ChatNav }) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // hasDraft() reads localStorage directly — cheap, but nothing here re-runs
  // when a draft is saved/cleared from inside the (separately-mounted) Chat
  // surface. lib/draft.ts fires a 'cabinet:draft' window event on every
  // change; this just forces a re-render so the pencil badges stay current
  // without threading draft state through props.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener('cabinet:draft', forceRerender);
    return () => window.removeEventListener('cabinet:draft', forceRerender);
  }, []);

  const filtered = useMemo(() => {
    if (!nav.chats) return null;
    const needle = query.trim().toLowerCase();
    return needle ? nav.chats.filter((c) => matches(c, needle)) : nav.chats;
  }, [nav.chats, query]);

  const askDelete = (e: MouseEvent, c: ChatSummary) => {
    e.stopPropagation();
    setDeleteError(null);
    setPendingDelete(c);
  };
  const cancelDelete = () => {
    if (deleting) return; // let the in-flight call land before the dialog can be dismissed
    setPendingDelete(null);
    setDeleteError(null);
  };
  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDeleting(true);
    nav
      .onDelete(pendingDelete.id)
      .then(() => setPendingDelete(null))
      .catch((e: unknown) => setDeleteError(e instanceof Error ? e.message : "Couldn't delete that conversation."))
      .finally(() => setDeleting(false));
  };

  return (
    <div className="rail-convos">
      <div className="rail-convos-head">
        <input
          type="search"
          className="rail-convos-search data"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search conversations"
        />
        <button
          type="button"
          className="rail-convos-new"
          onClick={nav.onNew}
          disabled={nav.creating}
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      {nav.createError && <p className="rail-convos-note voice">{nav.createError}</p>}
      {nav.loadError ? (
        <p className="rail-convos-note voice">{nav.loadError}</p>
      ) : !filtered ? (
        <p className="rail-convos-note data">Opening the archive…</p>
      ) : filtered.length === 0 ? (
        <p className="rail-convos-note voice">
          {nav.chats && nav.chats.length > 0 ? `Nothing matches “${query.trim()}.”` : 'Nothing filed yet.'}
        </p>
      ) : (
        <ul className="rail-convos-list" role="listbox" aria-label="Conversations">
          {filtered.map((c) => (
            <li key={c.id} className="rail-convo-row">
              <button
                type="button"
                role="option"
                aria-selected={c.id === nav.selectedId}
                className={`rail-convo${c.id === nav.selectedId ? ' active' : ''}`}
                onClick={() => nav.onSelect(c.id)}
                title={c.title ?? 'Untitled chat'}
              >
                <ConvoTitle title={c.title ?? 'Untitled chat'} />
                {hasDraft(c.id) && <Pencil className="rail-convo-draft" size={11} aria-label="Draft saved" />}
                {nav.resumingIds.has(c.id) && <span className="resume-dot" aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="rail-convo-delete"
                onClick={(e) => askDelete(e, c)}
                aria-label={`Delete “${c.title ?? 'Untitled chat'}”`}
                title="Delete conversation"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this conversation?"
          body={
            <>
              &ldquo;{pendingDelete.title ?? 'Untitled chat'}&rdquo;
              {pendingDelete.messages > 0 && <> and its {pendingDelete.messages} message{pendingDelete.messages === 1 ? '' : 's'}</>} will be
              gone for good — this can&rsquo;t be undone.
            </>
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          error={deleteError}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}

export function Rail({
  active,
  onNavigate,
  chatNav,
  collapsed = false,
  onToggleCollapsed,
}: {
  active: SurfaceId;
  onNavigate: (id: SurfaceId) => void;
  chatNav?: ChatNav;
  /** Icon-only rail (2026-07-17) — state lives in AppShell, which also owns
   *  .shell's grid columns that have to resize around it. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  // The collapse toggle lives inside the brandmark box itself (2026-07-17,
  // Ben's request — it used to be its own button centered in a row below
  // the logo, which read as an orphaned, awkwardly-placed control). Two
  // shapes, not one: expanded shows the full wordmark with a small chevron
  // pinned to the row's trailing edge; collapsed has no room for a second
  // target next to the icon-only glyph, so the whole brandmark becomes the
  // (re)expand button instead — click the logo to bring the sidebar back.
  return (
    <aside className="rail">
      {collapsed && onToggleCollapsed ? (
        <button
          type="button"
          className="brandmark brandmark--collapsed"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <span className="glyph" aria-hidden="true" />
        </button>
      ) : (
        <div className="brandmark">
          <span className="glyph" aria-hidden="true" />
          <div>
            <div className="word">CABINET</div>
            <div className="sub">Ben&rsquo;s office</div>
          </div>
          {onToggleCollapsed && (
            <button
              type="button"
              className="rail-collapse-toggle"
              onClick={onToggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <nav className="rail-nav" aria-label="Surfaces">
        {SURFACES.map((s) => (
          <Fragment key={s.id}>
            <button
              className={`rail-item${s.id === active ? ' active' : ''}`}
              aria-current={s.id === active ? 'page' : undefined}
              aria-expanded={s.id === 'chat' ? s.id === active : undefined}
              aria-label={s.label}
              title={collapsed ? s.label : undefined}
              onClick={() => onNavigate(s.id)}
            >
              <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                {ICONS[s.id]}
              </svg>
              <span className="txt">{s.label}</span>
            </button>
            {s.id === 'chat' && s.id === active && chatNav && <ChatAccordion nav={chatNav} />}
          </Fragment>
        ))}
      </nav>

      <div className="spacer" />
      <div className="principal">
        <div className="seal">B</div>
        <div>
          <div className="who">Ben Loe</div>
          <div className="role">Principal</div>
        </div>
      </div>
    </aside>
  );
}
