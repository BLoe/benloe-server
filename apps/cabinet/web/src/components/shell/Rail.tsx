import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { ChatSummary } from '../../lib/contracts.js';
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
}

function matches(c: ChatSummary, needle: string): boolean {
  return `${c.title ?? ''} ${c.preview ?? ''}`.toLowerCase().includes(needle);
}

/** The conversation list, folded into the rail under the Chat item — an
 *  accordion: expanded exactly while the Chat surface is active. */
function ChatAccordion({ nav }: { nav: ChatNav }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    if (!nav.chats) return null;
    const needle = query.trim().toLowerCase();
    return needle ? nav.chats.filter((c) => matches(c, needle)) : nav.chats;
  }, [nav.chats, query]);

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
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === nav.selectedId}
                className={`rail-convo${c.id === nav.selectedId ? ' active' : ''}`}
                onClick={() => nav.onSelect(c.id)}
                title={c.title ?? 'Untitled chat'}
              >
                <span className="rail-convo-title">{c.title ?? 'Untitled chat'}</span>
                {nav.resumingIds.has(c.id) && <span className="resume-dot" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Rail({
  active,
  onNavigate,
  chatNav,
}: {
  active: SurfaceId;
  onNavigate: (id: SurfaceId) => void;
  chatNav?: ChatNav;
}) {
  return (
    <aside className="rail">
      <div className="brandmark">
        <span className="glyph" aria-hidden="true" />
        <div>
          <div className="word">CABINET</div>
          <div className="sub">Ben&rsquo;s office</div>
        </div>
      </div>

      <nav className="rail-nav" aria-label="Surfaces">
        {SURFACES.map((s) => (
          <Fragment key={s.id}>
            <button
              className={`rail-item${s.id === active ? ' active' : ''}`}
              aria-current={s.id === active ? 'page' : undefined}
              aria-expanded={s.id === 'chat' ? s.id === active : undefined}
              onClick={() => onNavigate(s.id)}
            >
              <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                {ICONS[s.id]}
              </svg>
              <span className="txt">{s.label}</span>
              <span className="k">{s.key}</span>
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
