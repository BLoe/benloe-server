import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useApi, type LeagueBundle, type Me } from './api';
import SignIn from './pages/SignIn';
import { Avatar, ErrorState, Loading } from './components';
import Dashboard from './pages/Dashboard';
import Matchups from './pages/Matchups';
import TeamPage from './pages/Team';
import Activity from './pages/Activity';
import Chat from './pages/Chat';
import PlayerPage from './pages/Player';

const NAV = [
  { to: '', label: 'Overview', end: true },
  { to: 'matchups', label: 'Matchups' },
  { to: 'teams', label: 'Teams' },
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

        <main className="flex-1 min-w-0 px-4 lg:px-6 pb-10">
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
              <Route path="activity" element={<Activity bundle={bundle.data} />} />
              <Route path="chat" element={<Chat bundle={bundle.data} />} />
            </Routes>
          )}
        </main>
      </div>
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
  // Follow the week in the URL when there is one, so the header never disagrees
  // with the matchups the reader is actually looking at.
  const routeWeek = Number(useLocation().pathname.match(/\/matchups\/(\d+)/)?.[1]);
  const week = routeWeek || bundle?.currentWeek || me.state.display_week;
  const isLive = bundle?.league.status === 'in_season' && me.state.season_type === 'regular';

  return (
    <header className="sticky top-0 z-20 h-[52px] shrink-0 border-b border-line bg-ground/95 backdrop-blur flex items-center gap-4 px-4 lg:px-6">
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="headline text-[15px] sm:text-[19px] truncate">{bundle?.league.name ?? 'Loading'}</h1>
        <span className="eyebrow shrink-0">
          {bundle?.league.season} · Week {week}
        </span>
      </div>

      {isLive && (
        <span className="chip shrink-0" style={{ color: '#F5C518', background: 'rgba(245,197,24,.12)' }}>
          Live
        </span>
      )}

      {/* Section tabs double as the mobile navigation, since the rail is hidden there. */}
      <nav className="md:hidden ml-auto flex overflow-x-auto" aria-label="Sections">
        {NAV.map((n) => (
          <NavLink
            key={n.label}
            to={`/l/${leagueId}/${n.to}`}
            end={n.end}
            className="tab shrink-0"
            style={({ isActive }) =>
              isActive ? { color: '#E8EDF2', boxShadow: 'inset 0 -2px 0 #3FBF7F' } : undefined
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
