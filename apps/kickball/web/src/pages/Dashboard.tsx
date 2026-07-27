import { useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { PositionDef, Settings, StatDef } from '../lib/api';
import { RosterPanel } from '../components/RosterPanel';
import { RatingsPanel } from '../components/RatingsPanel';
import { GamesPanel } from '../components/GamesPanel';
import { SettingsPanel } from '../components/SettingsPanel';

const AUTH_URL = 'https://auth.benloe.com';

const TABS = [
  { to: '/games', label: 'Games' },
  { to: '/roster', label: 'Roster' },
  { to: '/ratings', label: 'Ratings' },
  { to: '/settings', label: 'Settings' },
];

export interface Meta {
  stats: StatDef[];
  positions: PositionDef[];
  settings: Settings;
}

interface DashboardContext {
  meta: Meta;
  applySettings: (settings: Settings) => void;
}

/** Handed down from the layout so a tab switch does not refetch the session. */
export function useDashboard(): DashboardContext {
  return useOutletContext<DashboardContext>();
}

/**
 * The dashboard shell: session check, league metadata, and the tab bar.
 *
 * This is a layout route, so it stays mounted while the tabs change underneath
 * it. Rendering it per-tab instead would re-run the auth check and flash a
 * loading state on every click.
 */
export function Dashboard() {
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

  const applySettings = (settings: Settings) => setMeta({ ...meta, settings });

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
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  isActive
                    ? 'border-rubber text-chalk'
                    : 'border-transparent text-chalk/45 hover:text-chalk/80'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <Outlet context={{ meta, applySettings } satisfies DashboardContext} />
      </main>
    </div>
  );
}

// Thin route wrappers so each panel keeps taking plain props.

export function GamesRoute() {
  const { meta } = useDashboard();
  return <GamesPanel meta={meta} />;
}

export function RosterRoute() {
  const { meta } = useDashboard();
  return <RosterPanel meta={meta} />;
}

export function RatingsRoute() {
  const { meta } = useDashboard();
  return <RatingsPanel meta={meta} />;
}

export function SettingsRoute() {
  const { meta, applySettings } = useDashboard();
  return <SettingsPanel meta={meta} onChange={applySettings} />;
}
