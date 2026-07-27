import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { PositionDef, Settings, StatDef } from '../lib/api';
import { RosterPanel } from '../components/RosterPanel';
import { RatingsPanel } from '../components/RatingsPanel';
import { GamesPanel } from '../components/GamesPanel';
import { SettingsPanel } from '../components/SettingsPanel';

const AUTH_URL = 'https://auth.benloe.com';

type Tab = 'games' | 'roster' | 'ratings' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'roster', label: 'Roster' },
  { key: 'ratings', label: 'Ratings' },
  { key: 'settings', label: 'Settings' },
];

export interface Meta {
  stats: StatDef[];
  positions: PositionDef[];
  settings: Settings;
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('games');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [email, setEmail] = useState<string>('');
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, metaResponse] = await Promise.all([api.me(), api.meta()]);
        setEmail(me.user.email);
        setMeta(metaResponse);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(window.location.href)}`;
          return;
        }
        setDenied(error instanceof Error ? error.message : 'Could not load the dashboard.');
      }
    })();
  }, []);

  if (denied) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-md">
          <p className="eyebrow mb-3">Dugout only</p>
          <h1 className="display mb-4 text-4xl">{denied}</h1>
          <a className="btn btn-ghost" href="/rate">
            Play the rating game instead
          </a>
        </div>
      </main>
    );
  }

  if (!meta) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="eyebrow animate-pulse">Loading the clipboard…</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rail-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <p className="eyebrow mb-1.5">Manager</p>
            <h1 className="display text-2xl">{meta.settings.team_name}</h1>
          </div>
          <p className="code text-xs text-chalk/35">{email}</p>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 sm:px-8">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              onClick={() => setTab(entry.key)}
              aria-current={tab === entry.key ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
                tab === entry.key
                  ? 'border-rubber text-chalk'
                  : 'border-transparent text-chalk/45 hover:text-chalk/80'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        {tab === 'games' && <GamesPanel meta={meta} />}
        {tab === 'roster' && <RosterPanel meta={meta} />}
        {tab === 'ratings' && <RatingsPanel meta={meta} />}
        {tab === 'settings' && <SettingsPanel meta={meta} onChange={(settings) => setMeta({ ...meta, settings })} />}
      </main>
    </div>
  );
}
