import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useApi, type Me } from './api';
import SignIn from './pages/SignIn';
import { ErrorNote, Loading } from './components';
import Now from './pages/Now';
import Horizon from './pages/Horizon';
import Season from './pages/Season';
import TapePage from './pages/TapePage';

/**
 * Three horizons, not five entity pages.
 *
 * A manager's questions sort cleanly by how far out they reach: what needs me
 * today, what does this season come to, and what is this roster becoming. Every
 * piece of data in Waker belongs to exactly one of those, which is the whole
 * reorganisation — there is no "players" page because a player is never the
 * question, only ever the evidence.
 */
const HORIZONS = [
  { to: '', label: 'Now', end: true, gloss: 'days' },
  { to: 'tape', label: 'Tape', gloss: 'usage' },
  { to: 'season', label: 'Season', gloss: 'weeks' },
  { to: 'horizon', label: 'Horizon', gloss: 'years' },
];

interface SessionInfo {
  session: { userId: string; username: string } | null;
}

export default function App() {
  const [nonce, setNonce] = useState(0);
  const sess = useApi<SessionInfo>(`/api/session?n=${nonce}`);

  if (sess.loading) return <Loading label="Opening" />;
  if (!sess.data?.session) return <SignIn onDone={() => setNonce((n) => n + 1)} />;

  return <Signed onSignOut={() => setNonce((n) => n + 1)} />;
}

function Signed({ onSignOut }: { onSignOut: () => void }) {
  const me = useApi<Me>('/api/me');

  if (me.loading) return <Loading label="Reading the league" />;
  if (me.error)
    return (
      <div className="p-6">
        <ErrorNote message={me.error} />
      </div>
    );
  if (!me.data?.leagues.length) {
    return (
      <div className="p-6">
        <ErrorNote message="That account is not in any Sleeper leagues this season." />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/l/${defaultLeague(me.data).leagueId}`} replace />} />
      <Route path="/l/:leagueId/*" element={<Shell me={me.data} onSignOut={onSignOut} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Which league to open on.
 *
 * A dynasty league has a standing roster, so it is the one with decisions
 * waiting in it — especially out of season, when a redraft league is an empty
 * shell. Opening on whichever league the API listed first put a redraft auction
 * league in front of a dynasty manager in August.
 */
const KIND_RANK = { dynasty: 2, keeper: 1, redraft: 0 } as const;

function defaultLeague(me: Me) {
  return [...me.leagues].sort(
    (a, b) =>
      KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
      Number(b.season) - Number(a.season) ||
      b.totalRosters - a.totalRosters
  )[0];
}

function Shell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const league = me.leagues.find((l) => l.leagueId === leagueId) ?? defaultLeague(me);

  return (
    <div className="min-h-screen">
      {/* Masthead. An almanac names itself once, small, at the top of the page —
          the title is not the point, the tables are. */}
      <header className="border-b border-[var(--rule-strong)] bg-[var(--vellum)]">
        <div className="mx-auto max-w-[1180px] px-4 h-12 flex items-center gap-3">
          <span
            className="slab shrink-0"
            style={{ fontSize: 'var(--t-lede)', letterSpacing: '-.02em' }}
          >
            Waker
          </span>
          <span className="hidden sm:block" style={{ color: 'var(--rule-strong)' }}>
            ·
          </span>
          {/* A plain select: twelve managers, at most a handful of leagues, and
              a bespoke dropdown would be three hundred lines for no gain. */}
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Choose a league</span>
            <select
              value={league.leagueId}
              onChange={(e) => navigate(`/l/${e.target.value}`)}
              className="w-full max-w-[26rem] appearance-none bg-transparent truncate pr-5 outline-none cursor-pointer"
              style={{ fontSize: 'var(--t-meta)', color: 'var(--graphite)' }}
            >
              {[...me.leagues]
                .sort((a, b) => Number(b.season) - Number(a.season))
                .map((l) => (
                  <option key={l.leagueId} value={l.leagueId}>
                    {l.name} · {l.season}
                  </option>
                ))}
            </select>
          </label>

          <button
            onClick={async () => {
              await fetch('/api/session', { method: 'DELETE' });
              onSignOut();
            }}
            className="label ml-auto shrink-0 hover:text-[var(--alarm)]"
          >
            {me.user.username} ↩
          </button>
        </div>

        {/* Thumb index. A reference book cuts its sections into the page edge so
            you can find one without reading the contents; these are the same
            device, and they are the only navigation in the app. */}
        <nav className="mx-auto max-w-[1180px] px-4 flex gap-0" aria-label="Horizons">
          {HORIZONS.map((h) => (
            <NavLink
              key={h.label}
              to={`/l/${league.leagueId}/${h.to}`}
              end={h.end}
              className={({ isActive }) =>
                `relative flex items-center px-4 py-2 -mb-px border-l border-r border-t transition-colors ${
                  isActive
                    ? 'border-[var(--rule-strong)] bg-[var(--paper)]'
                    : 'border-transparent hover:bg-[var(--band)]'
                }`
              }
              style={({ isActive }) => ({
                borderBottomColor: isActive ? 'var(--paper)' : 'transparent',
                // A thumb cut you cannot hit is not navigation. 44px is the
                // long-standing touch guideline and these were coming out at 38.
                minHeight: 44,
              })}
            >
              {({ isActive }) => (
                <span className="flex items-baseline gap-2">
                  <span
                    className="slab"
                    style={{
                      fontSize: 'var(--t-body)',
                      color: isActive ? 'var(--ink)' : 'var(--graphite)',
                    }}
                  >
                    {h.label}
                  </span>
                  <span
                    className="fig hidden sm:inline"
                    style={{ fontSize: 'var(--t-tick)', color: 'var(--faint)', letterSpacing: '.1em' }}
                  >
                    {h.gloss}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-5 space-y-5">
        <Routes>
          <Route index element={<Now league={league} />} />
          <Route path="season" element={<Season league={league} />} />
          <Route path="tape" element={<TapePage league={league} />} />
          <Route path="horizon" element={<Horizon league={league} />} />
        </Routes>
      </main>
    </div>
  );
}


