import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { SettingView } from '../lib/cabinet.js';
import { SectionLabel } from '../components/instruments/index.js';
import './settings.css';

/**
 * SETTINGS surface — the configuration Ben can change without a deploy.
 *
 * Everything here is plaintext, readable, and echoed back. One rule governs
 * the whole page:
 *
 *   PRECEDENCE IS THE PRODUCT. A stored setting outranks its environment
 *   variable, so every control states which of DB / env / default supplied the
 *   value in force and what it is beating. The failure this prevents is the
 *   worst one a settings page has: an edit that reports success and changes
 *   nothing because an invisible env var wins — or its mirror, an operator
 *   reading a .env line that has silently done nothing for months. Both
 *   directions are named.
 */

/* ---------------------------------------------------------------- time --- */

/* SQLite's datetime('now') hands back naive UTC — "2026-08-02 04:41:09", no
   zone marker — and `new Date()` reads exactly that string as LOCAL time. In
   New York that is a silent four- or five-hour shift: a setting saved a minute
   ago reads as five hours old, which is precisely the kind of wrong that looks
   plausible. Normalising to an explicit `Z` first is the whole fix. */
const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
const ZONED = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * `"2026-08-02 04:41:09"` → `"2026-08-02T04:41:09Z"`.
 *
 * A string that already carries a zone is returned untouched. Anything that
 * matches neither shape is returned unchanged rather than guessed at or thrown
 * over: a malformed stamp should degrade to showing the raw string, not take
 * the surface down.
 */
export function normalizeStamp(s: string): string {
  const t = s.trim();
  if (ZONED.test(t)) return t;
  const m = NAIVE.exec(t);
  return m ? `${m[1]}T${m[2]}Z` : s;
}

/**
 * A store stamp as a readable LOCAL datetime — "2 Aug 2026, 19:22".
 *
 * Deliberately absolute rather than relative: a setting's stamp answers "was
 * that me, in the change I'm remembering?", and "3 d ago" is no help in
 * placing an edit against the afternoon it happened. Local, not UTC, for the
 * same reason — the memory being matched is in wall-clock time.
 */
export function fmtWhen(s: string | null): string {
  if (!s) return 'never';
  const at = Date.parse(normalizeStamp(s));
  if (Number.isNaN(at)) return s;
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/* ------------------------------------------------------------ precedence --- */

/** True when a stored row is actively beating a live environment variable. */
function isOverriding(s: SettingView): boolean {
  return s.source === 'db' && s.env_value !== null && s.env_value !== s.value;
}

/**
 * Where the value in force came from, in one mark. Brass only for the one case
 * that can surprise you: a stored value quietly beating a variable that is
 * still set to something else.
 */
function SourcePill({ s }: { s: SettingView }) {
  if (s.source === 'db') {
    const over = isOverriding(s);
    return (
      <span className={`set-pill ${over ? 'warn' : 'ok'}`}>{over ? 'Set here · overriding' : 'Set here'}</span>
    );
  }
  if (s.source === 'env') return <span className="set-pill dim">From {s.envVar}</span>;
  return <span className="set-pill dim">Default</span>;
}

/**
 * The sentence this surface exists to say. Every branch names the source that
 * won AND the source that lost, because either one alone leaves a reader who
 * knows about the other convinced the page is lying to them.
 */
function Precedence({ s }: { s: SettingView }) {
  if (s.source === 'db') {
    if (isOverriding(s)) {
      return (
        <p className="set-note override">
          <span className="set-mark" aria-hidden="true">
            △
          </span>
          <span>
            Overriding <code className="set-name data">{s.envVar}</code> (
            <code className="set-env-val">{s.env_value}</code>) from the environment. The value stored here is
            the one in force — that variable is still in the environment and is being ignored, and will stay
            ignored until you stop overriding.
          </span>
        </p>
      );
    }
    if (s.env_value !== null) {
      return (
        <p className="set-note">
          Stored here. <code className="set-name data">{s.envVar}</code> is also set, to the same value, so
          nothing would change if you stopped overriding.
        </p>
      );
    }
    return (
      <p className="set-note">
        Stored here.{' '}
        {s.value === s.default ? (
          <>Same value as the built-in default.</>
        ) : (
          <>
            The built-in default is <code className="set-env-val">{s.default}</code>.
          </>
        )}
      </p>
    );
  }

  if (s.source === 'env') {
    return (
      <p className="set-note">
        This value comes from <code className="set-name data">{s.envVar}</code> in the environment. Saving here
        stores an override that outranks it from then on — the variable stays where it is, doing nothing.
      </p>
    );
  }

  return (
    <p className="set-note">
      The built-in default — nothing is stored here
      {s.envVar ? (
        <>
          , and <code className="set-name data">{s.envVar}</code> is not set in the environment.
        </>
      ) : (
        '.'
      )}
    </p>
  );
}

interface SettingRowProps {
  s: SettingView;
  /** What's in the field right now. Only ever differs from `s.value` between a keystroke and a save. */
  draft: string;
  busy: boolean;
  error: string | null;
  onDraft: (v: string) => void;
  onSave: (v: string) => void;
  onRevert: () => void;
}

/**
 * One editable setting.
 *
 * Nothing here is optimistic. A save shows a pending state and then renders
 * whatever the server echoed back, because the server normalises — a trailing
 * slash comes off an origin, a default port is dropped — and the difference
 * between "what I typed" and "what is stored" is exactly the thing that would
 * otherwise be discovered a week later by a redirect that doesn't match.
 */
function SettingRow({ s, draft, busy, error, onDraft, onSave, onRevert }: SettingRowProps) {
  const id = `setting-${s.key}`;
  const dirty = draft.trim() !== s.value;
  return (
    <li className={`set${isOverriding(s) ? ' is-overriding' : ''}`}>
      <div className="set-head">
        <label className="set-label" htmlFor={id}>
          {s.label}
        </label>
        <code className="set-name data">{s.key}</code>
        <SourcePill s={s} />
      </div>

      <div className="set-control">
        {s.type === 'enum' ? (
          <>
            {/* Saving on change is safe here because the choices are closed and
                every one of them is a complete, valid value — there is no
                half-typed state to protect, so a Save button would only be a
                second click between deciding and it being true. */}
            <select
              id={id}
              className="set-select data"
              value={draft}
              disabled={busy}
              onChange={(e) => onSave(e.target.value)}
            >
              {(s.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {busy && <span className="set-busy data">Saving…</span>}
          </>
        ) : (
          <form
            className="set-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) onSave(draft);
            }}
          >
            <input
              id={id}
              className="set-input data"
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={draft}
              disabled={busy}
              onChange={(e) => onDraft(e.target.value)}
            />
            {/* Disabled while unchanged: a Save that does nothing still reads
                as a change having been made, and this page's whole job is
                keeping "what I did" and "what is true" the same sentence. */}
            <button type="submit" className="set-btn" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>

      {/* Inline, at the control that produced it, never a banner at the top of
          the page: a rejected value is only legible next to the control that
          caused it. */}
      {error && <p className="set-error data">{error}</p>}

      <Precedence s={s} />
      {s.restartRequired && (
        <p className="set-note">Read once at boot — this takes effect after Cabinet restarts, not on save.</p>
      )}
      <p className="set-desc">{s.description}</p>

      {s.source === 'db' && (
        <p className="set-when data">
          <span className="set-when-k">stored</span> {fmtWhen(s.updated_at)}
          {/* Offered ONLY for a stored value, because it is the only state
              where there is an override to stop. Putting the old value back by
              hand is not the same operation — it leaves a row that keeps
              winning over whatever .env says next year. */}
          <button type="button" className="set-btn tiny subtle" disabled={busy} onClick={onRevert}>
            {s.env_value !== null ? 'Stop overriding' : 'Revert to default'}
          </button>
        </p>
      )}
    </li>
  );
}

/* -------------------------------------------------------------- surface --- */

export function Settings() {
  const [settings, setSettings] = useState<SettingView[] | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  /* Per-key edit state. `drafts` holds what is in the field, which differs from
     the stored value only between a keystroke and the server's echo — the echo
     writes back over it, so a normalised value replaces what was typed rather
     than sitting next to it. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingBusy, setSettingBusy] = useState<string | null>(null);
  const [settingErrors, setSettingErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    api
      .settings()
      .then((r) => {
        if (!live) return;
        setSettings(r.settings);
        setSettingsError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setSettingsError(errText(e, "Couldn't read the settings."));
      });
    return () => {
      live = false;
    };
  }, []);

  // Catalog order, grouped — the server sends settings in catalog order, so
  // the first appearance of a group fixes that group's position.
  const settingGroups = useMemo(() => {
    const out: { name: string; items: SettingView[] }[] = [];
    for (const s of settings ?? []) {
      const found = out.find((g) => g.name === s.group);
      if (found) found.items.push(s);
      else out.push({ name: s.group, items: [s] });
    }
    return out;
  }, [settings]);

  /* The server re-resolves after every write and echoes the result — which
     source now wins, what the value normalised to, when it was stored. Taking
     that verbatim is the only way the page can't drift from the store. */
  const applySetting = useCallback((next: SettingView) => {
    setSettings((prev) => (prev ? prev.map((s) => (s.key === next.key ? next : s)) : prev));
    setDrafts((prev) => ({ ...prev, [next.key]: next.value }));
  }, []);

  const clearSettingError = useCallback((key: string) => {
    setSettingErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const saveSetting = (s: SettingView, value: string) => {
    if (settingBusy) return;
    setSettingBusy(s.key);
    clearSettingError(s.key);
    // Show the pick while the request is in flight — pending, not optimistic:
    // the control still reads as un-settled, and what lands is the echo.
    setDrafts((prev) => ({ ...prev, [s.key]: value }));
    api
      .saveSetting(s.key, value)
      .then((r) => applySetting(r.setting))
      .catch((e: unknown) => {
        // The server's message is written for Ben — a 400 names the format it
        // wanted — so it goes through as-is rather than being paraphrased into
        // "save failed".
        setSettingErrors((prev) => ({ ...prev, [s.key]: errText(e, "That setting wasn't saved.") }));
        // A refused choice must not sit in a closed control looking chosen:
        // for an enum there is nothing to correct, so it snaps back to what is
        // actually stored. A typed value stays put, because the correction is
        // an edit of what's already in the field.
        if (s.type === 'enum') setDrafts((prev) => ({ ...prev, [s.key]: s.value }));
      })
      .finally(() => setSettingBusy(null));
  };

  const revertSetting = (s: SettingView) => {
    if (settingBusy) return;
    setSettingBusy(s.key);
    clearSettingError(s.key);
    api
      .revertSetting(s.key)
      .then((r) => applySetting(r.setting))
      .catch((e: unknown) =>
        // Reverting is a value change too, so it can be blocked for exactly
        // the same reason a save can — and it lands in the same place.
        setSettingErrors((prev) => ({ ...prev, [s.key]: errText(e, "That setting wasn't reverted.") })),
      )
      .finally(() => setSettingBusy(null));
  };

  return (
    <section className="settings" aria-label="Settings">
      <header className="settings-head">
        <div>
          <SectionLabel n="00">Settings</SectionLabel>
          <p className="settings-lede voice">
            Configuration rather than secrets: plaintext, readable, and editable right here. Anything saved
            outranks the matching environment variable — the variable stays where it is and stops being used,
            and each control says which of the two is currently winning.
          </p>
        </div>
      </header>

      {settingsError && <p className="set-error data">{settingsError}</p>}
      {!settings && !settingsError && <p className="set-loading data">Reading settings…</p>}

      <div className="set-groups">
        {settingGroups.map((group) => (
          <article className="set-group" key={group.name} aria-label={`${group.name} settings`}>
            <h3 className="set-group-name">{group.name}</h3>
            <ul className="set-list">
              {group.items.map((s) => (
                <SettingRow
                  key={s.key}
                  s={s}
                  draft={drafts[s.key] ?? s.value}
                  busy={settingBusy === s.key}
                  error={settingErrors[s.key] ?? null}
                  onDraft={(v) => setDrafts((prev) => ({ ...prev, [s.key]: v }))}
                  onSave={(v) => saveSetting(s, v)}
                  onRevert={() => revertSetting(s)}
                />
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
