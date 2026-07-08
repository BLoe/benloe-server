import type { ReactNode } from 'react';
import { Rail } from './Rail.js';
import { CommandBar } from './CommandBar.js';
import { PresenceStrip, type PresenceState } from './PresenceStrip.js';
import type { SurfaceId } from './surfaces.js';

interface AppShellProps {
  active: SurfaceId;
  onNavigate: (id: SurfaceId) => void;
  onCommand?: (intent: string) => void;
  datestamp?: ReactNode;
  presence?: PresenceState;
  presenceMeta?: string;
  children: ReactNode;
}

/** The frame every surface lives in: rail · command bar · surface · presence. */
export function AppShell({ active, onNavigate, onCommand, datestamp, presence = 'idle', presenceMeta, children }: AppShellProps) {
  return (
    <div className="shell">
      <Rail active={active} onNavigate={onNavigate} />
      <div className="main">
        <header className="topbar">
          {datestamp && <div className="datestamp">{datestamp}</div>}
          <CommandBar onSubmit={onCommand} />
        </header>
        <main className="surface" aria-label={active}>{children}</main>
        <PresenceStrip state={presence} meta={presenceMeta} />
      </div>
    </div>
  );
}
