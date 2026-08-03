import { useState } from 'react';

/**
 * The way in. Deliberately plain: this is a private league dashboard and the
 * only thing it needs is which manager you are.
 */
export default function SignIn({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not sign in.');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="slab" style={{ fontSize: 'var(--t-title)', letterSpacing: '-.02em' }}>
          Waker
        </div>
        <p className="mt-1" style={{ fontSize: 'var(--t-body)', color: 'var(--graphite)' }}>
          What your team needs from you, and when.
        </p>

        <form onSubmit={submit} className="sheet mt-5 p-4">
          <label className="label block" htmlFor="username">
            Sleeper username
          </label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="fig w-full mt-2 px-2.5 py-2 bg-[var(--paper)] border border-[var(--rule-strong)] outline-none"
            style={{ fontSize: 'var(--t-body)' }}
          />
          <button
            type="submit"
            disabled={busy || !username.trim()}
            className="fig w-full mt-3 py-2.5 disabled:opacity-40"
            style={{
              background: 'var(--ink)',
              color: 'var(--vellum)',
              fontSize: 'var(--t-meta)',
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            {busy ? 'Checking' : 'Open the almanac'}
          </button>
          {error && (
            <p className="mt-3" style={{ fontSize: 'var(--t-meta)', color: 'var(--alarm)' }}>
              {error}
            </p>
          )}
        </form>

        <p className="mt-3" style={{ fontSize: 'var(--t-meta)', color: 'var(--faint)', lineHeight: 1.5 }}>
          Private to the twelve managers in the dynasty league. No password —
          Waker only reads what Sleeper already publishes.
        </p>
      </div>
    </main>
  );
}
