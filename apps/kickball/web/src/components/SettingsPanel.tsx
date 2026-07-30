import { useState } from 'react';
import { api } from '../lib/api';
import type { Settings } from '../lib/api';
import type { Meta } from '../pages/Dashboard';

export function SettingsPanel({ meta, onChange }: { meta: Meta; onChange: (settings: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(meta.settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateSettings(draft);
      onChange(result.settings);
      setDraft(result.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save those settings.');
    } finally {
      setBusy(false);
    }
  };

  const rateUrl = `${window.location.origin}/rate`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={save} className="card h-fit p-6">
        <h2 className="display mb-1 text-xl">League settings</h2>
        <p className="eyebrow eyebrow-ink mb-5">These become hard constraints on every lineup</p>

        <div className="space-y-4">
          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="team-name">
              Team name
            </label>
            <input
              id="team-name"
              className="field-input"
              value={draft.team_name}
              onChange={(e) => setDraft({ ...draft, team_name: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="innings">
                Innings
              </label>
              <input
                id="innings"
                type="number"
                min={1}
                max={12}
                className="field-input"
                value={draft.innings}
                onChange={(e) => setDraft({ ...draft, innings: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="min-women">
                Women in the field
              </label>
              <input
                id="min-women"
                type="number"
                min={0}
                max={10}
                className="field-input"
                value={draft.min_women_in_field}
                onChange={(e) => setDraft({ ...draft, min_women_in_field: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-sm text-ink-soft">
            The minimum counts women and non-binary players, matching how the league writes the rule. It is
            enforced in every inning, not on average.
          </p>

          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="max-run">
              Most of the same gender in a row
            </label>
            <input
              id="max-run"
              type="number"
              min={0}
              max={20}
              className="field-input"
              value={draft.max_same_gender_run}
              onChange={(e) => setDraft({ ...draft, max_same_gender_run: Number(e.target.value) })}
            />
            <p className="mt-1.5 text-sm text-ink-soft">
              Spreads the batting order out. Without it the order sorts itself by ability, and if that happens
              to track gender you get every man and then every woman. Costs about 0.05 runs a game, against
              roughly a run that the ordering is worth in the first place. Set to 0 to turn it off; if the
              turnout makes your number impossible, the closest achievable spread is used instead.
            </p>
          </div>

          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="passcode">
              Rating game code
            </label>
            <input
              id="passcode"
              className="field-input"
              value={draft.rating_game_passcode}
              onChange={(e) => setDraft({ ...draft, rating_game_passcode: e.target.value })}
              placeholder="Leave empty for no code"
            />
            <p className="mt-1.5 text-sm text-ink-soft">
              Optional. Anyone with the link and this code can rate.
            </p>
          </div>

          <div>
            <label className="eyebrow eyebrow-ink mb-1.5 block" htmlFor="admins">
              Manager emails
            </label>
            <input
              id="admins"
              className="field-input"
              value={draft.admin_emails}
              onChange={(e) => setDraft({ ...draft, admin_emails: e.target.value })}
              placeholder="you@example.com, captain@example.com"
            />
            <p className="mt-1.5 text-sm text-ink-soft">
              Comma separated. Only these accounts can open this dashboard. Clearing it lets in anyone with a
              benloe.com login, so keep at least your own address here.
            </p>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-rubber">{error}</p>}
        <button className="btn btn-primary mt-6" disabled={busy}>
          {saved ? 'Saved' : 'Save settings'}
        </button>
      </form>

      <div className="space-y-6">
        <section className="card p-6">
          <h2 className="display mb-1 text-xl">Share the rating game</h2>
          <p className="eyebrow eyebrow-ink mb-4">Send this to the whole team</p>
          <div className="flex min-w-0 items-center gap-3 rounded-lg bg-chalk-dim/50 px-4 py-3">
            <a className="code min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline" href={rateUrl}>
              {rateUrl}
            </a>
            <button
              type="button"
              className="btn btn-chalk shrink-0 px-3 py-1 text-sm"
              onClick={() => navigator.clipboard?.writeText(rateUrl)}
            >
              Copy
            </button>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            Everyone picks their own name, then answers one matchup at a time. The game decides what to ask —
            it favours close calls between people it knows least about, so a few hundred answers spread across
            the team goes a long way.
          </p>
        </section>

        <section className="card p-6">
          <h2 className="display mb-1 text-xl">How the lineup is built</h2>
          <p className="eyebrow eyebrow-ink mb-4">In order of what wins</p>
          <ol className="space-y-3 text-sm">
            {[
              [
                'Playing time',
                'Nearly non-negotiable, and measured across the season. Sit a lot one week and you play more the next.',
              ],
              [
                'Skill at the position',
                'Decides where the people on the field get placed, using the ratings from the game. Positions are not weighted equally — the pitcher, first base and the striker matter most, because they touch the ball on nearly every play, while a corner outfielder may not see one all game.',
              ],
              [
                'Staying put',
                'Resists moving anyone between positions unless a substitution forces it, and prefers a shift within the same zone when it does.',
              ],
              ['Rest', 'Breaks ties away from making the same person sit two innings in a row.'],
            ].map(([title, body], index) => (
              <li key={title} className="flex gap-3">
                <span className="code text-xs text-ink-soft/60">{index + 1}</span>
                <span>
                  <strong className="font-semibold">{title}.</strong>{' '}
                  <span className="text-ink-soft">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
