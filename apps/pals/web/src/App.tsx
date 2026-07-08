import { useCallback, useEffect, useState } from 'react';
import { api, type PresenceState } from './lib/cabinet.js';
import { AuthRequiredError } from './lib/client.js';
import { AppShell, type SurfaceId } from './components/shell/index.js';
import { Today } from './surfaces/Today.js';
import { Domains } from './surfaces/Domains.js';
import { Ops } from './surfaces/Ops.js';
import { Brain } from './surfaces/Brain.js';
import { Threads } from './surfaces/Threads.js';
import './App.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Datestamp({ now }: { now: Date }) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <>{DAYS[now.getDay()]} · <b>{now.getDate()} {MONTHS[now.getMonth()]}</b> · {hh}:{mm}</>;
}

function toLogin() {
  window.location.href = `https://auth.benloe.com/?redirect=${encodeURIComponent(window.location.href)}`;
}

/** The v2 console: the shell + surface routing. Chat is a surface (Threads),
    not the spine — you direct Cabinet through the command bar (⌘K). */
export default function App() {
  const [active, setActive] = useState<SurfaceId>('today');
  const [presence, setPresence] = useState<PresenceState>('idle');
  const [presenceMeta, setPresenceMeta] = useState<string>('');
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'login'>('checking');
  const [now, setNow] = useState(() => new Date());
  // A conversation opened from the command bar: a thread + a first message to send.
  const [pendingConvo, setPendingConvo] = useState<{ id: string; seed: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.health()
        .then((h) => { if (!alive) return; setPresence(h.presence); setPresenceMeta(h.presenceMeta); setAuthState('ok'); })
        .catch((e) => { if (!alive) return; setAuthState(e instanceof AuthRequiredError ? 'login' : 'ok'); });
    load();
    const health = setInterval(load, 30_000);
    const clock = setInterval(() => alive && setNow(new Date()), 30_000);
    return () => { alive = false; clearInterval(health); clearInterval(clock); };
  }, []);

  const onCommand = useCallback((intent: string) => {
    // Open a fresh conversation and send the intent as its first message.
    api.createThread()
      .then(({ id }) => {
        setPendingConvo({ id, seed: intent });
        setActive('threads');
      })
      .catch(() => {});
  }, []);

  if (authState === 'checking') return <div className="boot"><span className="wordmark">CABINET</span></div>;
  if (authState === 'login') {
    return (
      <div className="boot login">
        <span className="wordmark">CABINET</span>
        <span className="line">Sign in with your magic link to open your office.</span>
        <button onClick={toLogin}>Sign in via auth.benloe.com</button>
      </div>
    );
  }

  return (
    <AppShell
      active={active}
      onNavigate={setActive}
      onCommand={onCommand}
      datestamp={<Datestamp now={now} />}
      presence={presence}
      presenceMeta={presenceMeta}
    >
      {active === 'today' && <Today onNavigate={(s) => setActive(s)} />}
      {active === 'domains' && <Domains />}
      {active === 'ops' && <Ops />}
      {active === 'brain' && <Brain />}
      {active === 'threads' && (
        <Threads
          openThreadId={pendingConvo?.id}
          openSeed={pendingConvo?.seed}
          onConsumed={() => setPendingConvo(null)}
        />
      )}
    </AppShell>
  );
}
