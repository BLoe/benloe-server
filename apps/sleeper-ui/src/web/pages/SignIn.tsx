import { useEffect, useRef, useState } from 'react';

/**
 * Entry point for a visitor with no session.
 *
 * There is no password here on purpose: a Sleeper username and everything this
 * dashboard reads are already public. All we are asking is whose leagues to show.
 */
export default function SignIn({
  suggested,
  onSignedIn,
}: {
  suggested: string | null;
  onSignedIn: () => void;
}) {
  const [username, setUsername] = useState(suggested ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      input.current?.select();
    }
  };

  return (
    <main className="relative z-10 min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-[420px]">
        <div className="mb-8">
          <h1 className="headline text-[34px] leading-none">League Desk</h1>
          <p className="text-muted text-[14px] mt-2 leading-snug">
            Your Sleeper leagues, laid out for a full screen.
          </p>
        </div>

        <form onSubmit={submit} className="panel p-5">
          <label htmlFor="username" className="stat-label block mb-2">
            Sleeper username
          </label>
          <div className="flex gap-2">
            <input
              id="username"
              ref={input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              aria-describedby={error ? 'signin-error' : 'signin-hint'}
              aria-invalid={!!error}
              className="flex-1 min-w-0 bg-raised border border-line rounded-[3px] px-3 py-2 text-[14px] placeholder:text-dim focus:border-line2 outline-none"
            />
            <button
              type="submit"
              disabled={!username.trim() || busy}
              className="tab border border-line2 px-4 disabled:opacity-40 disabled:cursor-not-allowed hover:border-dim"
            >
              {busy ? 'Checking' : 'Continue'}
            </button>
          </div>

          {error ? (
            <p id="signin-error" className="text-[12.5px] mt-3" style={{ color: '#E5484D' }}>
              {error}
            </p>
          ) : (
            <p id="signin-hint" className="text-dim text-[12px] mt-3 leading-snug">
              Not your password — just the username on your Sleeper profile. Everything
              shown here is public league data.
            </p>
          )}
        </form>

        <p className="text-dim text-[11px] mt-4 leading-snug">
          Read only. This never changes your lineup, waivers or trades.
        </p>
      </div>
    </main>
  );
}
