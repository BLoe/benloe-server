import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApi, type LeagueBundle, type Me } from './api';
import SignIn from './pages/SignIn';
import { Avatar, ErrorState, Loading } from './components';
import Dashboard from './pages/Dashboard';
import Matchups from './pages/Matchups';
import TeamPage from './pages/Team';
import Activity from './pages/Activity';
import Chat from './pages/Chat';
import PlayerPage from './pages/Player';
import Projections from './pages/Projections';

const NAV = [
  { to: '', label: 'Overview', end: true },
  { to: 'matchups', label: 'Matchups' },
  { to: 'teams', label: 'Teams' },
  { to: 'projected', label: 'Projected' },
  { to: 'activity', label: 'Activity' },
  { to: 'chat', label: 'Chat' },
];

interface SessionInfo {
  session: { userId: string; username: string } | null;
  suggestedUsername: string | null;
}

export default function App() {
  // Bumping this refetches everything session-dependent after sign in or out.
  const [nonce, setNonce] = useState(0);
  const sess = useApi<SessionInfo>(`/api/session?n=${nonce}`);

  if (sess.loading) return <Loading label="Starting up" />;
  if (sess.error) return <ErrorState message={sess.error} />;

  if (!sess.data?.session) {
    return (
      <SignIn
        suggested={sess.data?.suggestedUsername ?? null}
        onSignedIn={() => setNonce((n) => n + 1)}
      />
    );
  }

  return <SignedIn nonce={nonce} onSessionChange={() => setNonce((n) => n + 1)} />;
}

function SignedIn({
  nonce,
  onSessionChange,
}: {
  nonce: number;
  onSessionChange: () => void;
}) {
  const { data: me, error, loading } = useApi<Me>(`/api/me?n=${nonce}`);

  const signOut = async () => {
    await fetch('/api/session', { method: 'DELETE' });
    onSessionChange();
  };

  if (loading) return <Loading label="Loading your leagues" />;
  if (error || !me) return <ErrorState message={error ?? 'No account data returned.'} />;
  if (!me.leagues.length) {
    return (
      <ErrorState
        message={`No leagues found for ${me.user.displayName}. If that is not you, switch accounts and try another username.`}
        onRetry={signOut}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/l/${me.leagues[0].leagueId}`} replace />} />
      <Route
        path="/l/:leagueId/*"
        element={<LeagueShell me={me} onSignOut={signOut} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LeagueShell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { leagueId } = useParams();
  const bundle = useApi<LeagueBundle>(leagueId ? `/api/league/${leagueId}` : null);

  return (
    <div className="relative z-10 flex min-h-screen">
      <Rail me={me} activeLeagueId={leagueId!} onSignOut={onSignOut} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar bundle={bundle.data} me={me} />

        <main
          className="flex-1 min-w-0 px-4 lg:px-6 pb-10"
          style={{ paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        >
          {bundle.loading && <Loading label="Loading league" />}
          {bundle.error && <ErrorState message={bundle.error} />}
          {bundle.data && (
            <Routes>
              <Route index element={<Dashboard bundle={bundle.data} />} />
              <Route path="matchups" element={<Matchups bundle={bundle.data} />} />
              <Route path="matchups/:week" element={<Matchups bundle={bundle.data} />} />
              <Route path="matchups/:week/:matchupId" element={<Matchups bundle={bundle.data} />} />
              <Route path="teams" element={<TeamPage bundle={bundle.data} />} />
              <Route path="teams/:rosterId" element={<TeamPage bundle={bundle.data} />} />
              <Route path="players/:playerId" element={<PlayerPage bundle={bundle.data} />} />
              <Route path="projected" element={<Projections bundle={bundle.data} />} />
              <Route path="activity" element={<Activity bundle={bundle.data} />} />
              <Route path="chat" element={<Chat bundle={bundle.data} />} />
            </Routes>
          )}
        </main>
      </div>

      <BottomNav leagueId={leagueId!} />
    </div>
  );
}

/**
 * Persistent left rail. On a laptop this is the thing the mobile-derived Sleeper
 * site never gives you: league switching and section navigation always in view,
 * no hamburger, no back button.
 */
function Rail({
  me,
  activeLeagueId,
  onSignOut,
}: {
  me: Me;
  activeLeagueId: string;
  onSignOut: () => void;
}) {
  return (
    <nav
      className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-line bg-panel/60 sticky top-0 h-screen"
      aria-label="Leagues and sections"
    >
      <div className="px-4 h-[52px] flex items-center border-b border-line">
        <span className="headline text-[17px]">League Desk</span>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="stat-label">Leagues</div>
      </div>
      <ul className="px-2 space-y-0.5">
        {me.leagues.map((l) => {
          const active = l.leagueId === activeLeagueId;
          return (
            <li key={l.leagueId}>
              <NavLink
                to={`/l/${l.leagueId}`}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-[3px] transition-colors"
                style={{
                  background: active ? 'rgba(63,191,127,.10)' : undefined,
                  boxShadow: active ? 'inset 2px 0 0 #3FBF7F' : undefined,
                }}
              >
                <Avatar url={l.avatar} name={l.name} size={22} />
                <span className="min-w-0">
                  <span
                    className="block font-display font-semibold uppercase text-[13px] truncate leading-tight"
                    style={{ color: active ? '#E8EDF2' : '#8494A5' }}
                  >
                    {l.name}
                  </span>
                  <span className="block text-dim text-[10px] leading-tight">
                    {l.season} · {l.totalRosters} teams
                  </span>
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="px-4 pt-6 pb-2">
        <div className="stat-label">Sections</div>
      </div>
      <ul className="px-2 space-y-0.5">
        {NAV.map((n) => (
          <li key={n.label}>
            <NavLink
              to={`/l/${activeLeagueId}/${n.to}`}
              end={n.end}
              className={({ isActive }) =>
                `block px-2 py-1.5 font-display font-semibold uppercase text-[13px] tracking-wider rounded-[3px] transition-colors ${
                  isActive ? 'text-ink bg-raised' : 'text-dim hover:text-muted'
                }`
              }
            >
              {n.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto p-3 border-t border-line flex items-center gap-2.5">
        <Avatar url={me.user.avatar} name={me.user.displayName} size={26} />
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-[13px] truncate leading-tight">
            {me.user.displayName}
          </div>
          <div className="text-dim text-[10px] leading-tight truncate">@{me.user.username}</div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="stat-label hover:text-ink transition-colors shrink-0"
          title="Look at a different Sleeper account"
        >
          Switch
        </button>
      </div>
    </nav>
  );
}

function TopBar({ bundle, me }: { bundle: LeagueBundle | null; me: Me }) {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  // Follow the week in the URL when there is one, so the header never disagrees
  // with the matchups the reader is actually looking at.
  const routeWeek = Number(useLocation().pathname.match(/\/matchups\/(\d+)/)?.[1]);
  // The season label comes from the server, which knows the difference between
  // the preseason and week 1. A week in the URL still wins, since the reader is
  // explicitly looking at that week.
  const label = routeWeek ? `Week ${routeWeek}` : (bundle?.period.label ?? '');
  const isLive = bundle?.league.status === 'in_season' && bundle?.period.isGameWeek;

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ground/95 backdrop-blur px-4 lg:px-6">
      <div className="flex items-center gap-3 h-[52px]">
        {/* On a phone the rail is hidden, so the switcher lives here. A native
            select is the right control: it is the affordance people already
            know, and it needs no JavaScript. */}
        <label className="md:hidden relative flex-1 min-w-0">
          <span className="sr-only">Choose a league</span>
          <select
            aria-label="Choose a league"
            value={leagueId}
            onChange={(e) => navigate(`/l/${e.target.value}`)}
            className="w-full appearance-none bg-transparent text-ink font-display font-bold uppercase truncate pr-5 outline-none"
            style={{ fontSize: 'var(--t-h1)', letterSpacing: '.01em' }}
          >
            {me.leagues.map((l) => (
              <option key={l.leagueId} value={l.leagueId} style={{ background: '#111820' }}>
                {l.name} · {l.season}
              </option>
            ))}
          </select>
          <span
            className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-dim"
            aria-hidden="true"
          >
            ▾
          </span>
        </label>

        <h1 className="hidden md:block headline truncate" style={{ fontSize: 'var(--t-h1)' }}>
          {bundle?.league.name ?? 'Loading'}
        </h1>

        {/* The mobile switcher already names the season, so it is not repeated. */}
        <span className="eyebrow shrink-0">
          {/* A past season's label already names the year; do not say it twice. */}
          {bundle && !label.startsWith(bundle.league.season) && (
            <span className="hidden md:inline">{bundle.league.season} · </span>
          )}
          {label}
        </span>

        {isLive && (
          <span
            className="chip shrink-0"
            style={{ color: 'var(--live)', background: 'rgba(245,197,24,.14)' }}
          >
            Live
          </span>
        )}
      </div>
    </header>
  );
}

/**
 * Bottom tab bar, phones only.
 *
 * Five sections do not fit across the top of a 390px screen without either
 * shrinking below the type floor or hiding two of them behind a scroll nobody
 * discovers. A bottom bar keeps all five visible and in thumb reach.
 */
function BottomNav({ leagueId }: { leagueId: string }) {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-ground/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Sections"
    >
      <ul className="flex">
        {NAV.map((n) => (
          <li key={n.label} className="flex-1">
            <NavLink
              to={`/l/${leagueId}/${n.to}`}
              end={n.end}
              className="flex flex-col items-center justify-center gap-1 py-2.5 font-display font-semibold uppercase transition-colors"
              style={({ isActive }) => ({
                fontSize: 'var(--t-label)',
                letterSpacing: '.06em',
                color: isActive ? '#E8EDF2' : '#93A2B2',
              })}
            >
              {({ isActive }) => (
                <>
                  <span
                    className="block rounded-full"
                    style={{
                      width: 16,
                      height: 3,
                      background: isActive ? 'var(--win)' : 'transparent',
                    }}
                    aria-hidden="true"
                  />
                  {n.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
