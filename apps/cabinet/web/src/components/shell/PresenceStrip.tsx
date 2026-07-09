export type PresenceState = 'idle' | 'working' | 'thinking' | 'offline';

const STATE_LABEL: Record<PresenceState, string> = {
  idle: 'Idle',
  working: 'Working',
  thinking: 'Thinking',
  offline: 'Offline',
};

/** The bottom annunciator: what Cabinet is doing right now, always present. */
export function PresenceStrip({ state = 'idle', meta }: { state?: PresenceState; meta?: string }) {
  return (
    <footer className="presence">
      <span className={`live ${state}`} aria-hidden="true" />
      <span className="state">{STATE_LABEL[state]}</span>
      {meta && <span className="meta">· {meta}</span>}
      <span className="talk">
        <span>Direct the cabinet</span>
        <span className="kbd">&#8984;K</span>
      </span>
    </footer>
  );
}
