import { useEffect, useState, type ReactNode } from 'react';
import { Rail, type ChatNav } from './Rail.js';
import { CommandBar } from './CommandBar.js';
import { PresenceStrip, type PresenceState } from './PresenceStrip.js';
import type { SurfaceId } from './surfaces.js';

interface AppShellProps {
  active: SurfaceId;
  onNavigate: (id: SurfaceId) => void;
  onCommand?: (intent: string) => void;
  /** Conversation list state for the rail's Chat accordion (owned by App). */
  chatNav?: ChatNav;
  datestamp?: ReactNode;
  /** The active chat's title, shown in the topbar next to the datestamp
   *  (2026-07-17) — App passes this only while the Chat surface has a
   *  conversation selected. Lives here instead of inside the Chat surface
   *  itself because the topbar was otherwise mostly empty dead space while
   *  the reading column's own title banner ate into its already-limited
   *  vertical budget. */
  headerTitle?: ReactNode;
  presence?: PresenceState;
  presenceMeta?: string;
  children: ReactNode;
}

const COLLAPSE_KEY = 'cabinet:rail-collapsed';

/** The frame every surface lives in: rail · command bar · surface · presence.
 *  Owns the rail's collapsed/expanded state (2026-07-17) — it's the one
 *  component that persists across surface switches, and it's the thing that
 *  actually has to resize .shell's grid columns around the rail, so the
 *  state lives here rather than inside Rail itself. */
export function AppShell({ active, onNavigate, onCommand, chatNav, datestamp, headerTitle, presence = 'idle', presenceMeta, children }: AppShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, railCollapsed ? '1' : '0');
    } catch {
      /* private-browsing/quota — the preference just won't survive a reload */
    }
  }, [railCollapsed]);

  return (
    <div className={`shell${railCollapsed ? ' rail-collapsed' : ''}`}>
      <Rail active={active} onNavigate={onNavigate} chatNav={chatNav} collapsed={railCollapsed} onToggleCollapsed={() => setRailCollapsed((c) => !c)} />
      <div className="main">
        <header className="topbar">
          {datestamp && <div className="datestamp">{datestamp}</div>}
          {headerTitle && <div className="topbar-title">{headerTitle}</div>}
          <CommandBar onSubmit={onCommand} />
        </header>
        <main className="surface" aria-label={active}>{children}</main>
        <PresenceStrip state={presence} meta={presenceMeta} />
      </div>
    </div>
  );
}
