import type { ReactNode } from 'react';
import { SURFACES, type SurfaceId } from './surfaces.js';

const ICONS: Record<SurfaceId, ReactNode> = {
  today: <path d="M2 6l6-4 6 4v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z M6 14V9h4v5" />,
  domains: <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>,
  ops: <path d="M2 8h3l2 5 3-10 2 5h2" />,
  brain: <path d="M8 2.5C5.5 2.5 4 4 4 6c-1 .4-1.5 1.3-1.5 2.3 0 1 .6 1.9 1.5 2.2 0 1.6 1.3 2.7 3 2.7 M8 2.5c2.5 0 4 1.5 4 3.5 1 .4 1.5 1.3 1.5 2.3 0 1-.6 1.9-1.5 2.2 0 1.6-1.3 2.7-3 2.7 M8 2.5v11" />,
  chat: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />,
};

export function Rail({ active, onNavigate }: { active: SurfaceId; onNavigate: (id: SurfaceId) => void }) {
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
          <button
            key={s.id}
            className={`rail-item${s.id === active ? ' active' : ''}`}
            aria-current={s.id === active ? 'page' : undefined}
            onClick={() => onNavigate(s.id)}
          >
            <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              {ICONS[s.id]}
            </svg>
            <span className="txt">{s.label}</span>
            <span className="k">{s.key}</span>
          </button>
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
