import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { CredentialMeta, CredentialSlot, CredentialsView, EnvVarReport, SettingView } from '../lib/cabinet.js';
import { SectionLabel } from '../components/instruments/index.js';
import { ConfirmDialog } from '../components/shell/index.js';
import { ApiError } from '../lib/client.js';
import './credentials.css';

/**
 * CREDENTIALS surface — the one place Ben hands Cabinet a key.
 *
 * Three rules shape everything below:
 *
 *  1. Secrets travel in ONE direction. The server has no route that returns a
 *     stored value, so this page has no reveal, no copy, no "show" toggle, and
 *     no placeholder standing in for a hidden value. Where that limit is
 *     load-bearing the page says so out loud, because a UI that merely omits
 *     the value reads as "hidden", and "hidden" implies "retrievable".
 *  2. The typed secret lives in React state for as long as it takes to POST it
 *     and not one render longer — cleared on success before anything else
 *     runs, and never written to any other state, log, URL or title.
 *  3. Missing is a first-class state. The whole point of the surface is
 *     answering "which integrations are configured?" at a glance, so a slot
 *     with no value renders as loudly as one with, and a required empty slot
 *     carries the warning tone.
 *
 * The Settings section is the deliberate inverse of rule 1 and shares the page
 * anyway, because "configure this integration" is one job in Ben's head and
 * splitting it across two pages would mean holding half a Plaid setup in each.
 * Everything there is plaintext, readable, and echoed back. What it adds is a
 * fourth rule, which governs that section alone:
 *
 *  4. PRECEDENCE IS THE PRODUCT. A stored setting outranks its environment
 *     variable, so every control states which of DB / env / default supplied
 *     the value in force and what it is beating. The failure this prevents is
 *     the worst one a settings page has: an edit that reports success and
 *     changes nothing because an invisible env var wins — or its mirror, an
 *     operator reading a .env line that has silently done nothing for months.
 *     Both directions are named, here and in the environment list below.
 */

/* ---------------------------------------------------------------- time --- */

/* SQLite's datetime('now') hands back naive UTC — "2026-08-02 04:41:09", no
   zone marker — and `new Date()` reads exactly that string as LOCAL time. In
   New York that is a silent four- or five-hour shift: a credential rotated a
   minute ago reads as five hours old, which is precisely the kind of wrong
   that looks plausible. Normalising to an explicit `Z` first is the whole
   fix, and it lives here (exported, unit-tested) rather than inline. */
const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
const ZONED = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * `"2026-08-02 04:41:09"` → `"2026-08-02T04:41:09Z"`.
 *
 * A string that already carries a zone (trailing `Z` or `±HH:MM`) is returned
 * untouched — the server's own ISO timestamps go through here too. Anything
 * that matches neither shape is returned unchanged rather than guessed at or
 * thrown over: a malformed stamp should degrade to showing the raw string,
 * not take the surface down.
 */
export function normalizeStamp(s: string): string {
  const t = s.trim();
  if (ZONED.test(t)) return t;
  const m = NAIVE.exec(t);
  return m ? `${m[1]}T${m[2]}Z` : s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A relative reading of a store timestamp — "12 min ago", "3 h ago", "6 d
 * ago" — falling back to an absolute UTC date past a month, where "47 d ago"
 * stops being information. `null` is "never", which is a real answer here
 * (a credential that has never been used or never rotated).
 */
export function fmtAgo(s: string | null, now: number = Date.now()): string {
  if (!s) return 'never';
  const at = Date.parse(normalizeStamp(s));
  if (Number.isNaN(at)) return s;

  const secs = Math.round((now - at) / 1000);
  if (secs < 0) return 'just now'; // clock skew between server and browser
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 30) return `${days} d ago`;

  const d = new Date(at);
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

/**
 * A store stamp as a readable LOCAL datetime — "2 Aug 2026, 19:22".
 *
 * Deliberately absolute where `fmtAgo` is relative. A credential's stamps
 * answer "is this fresh?", which relative time answers better; a setting's
 * stamp answers "was that me, in the change I'm remembering?", and "3 d ago"
 * is no help in placing an edit against the afternoon it happened. Local, not
 * UTC, for the same reason: the memory being matched is in wall-clock time.
 */
export function fmtWhen(s: string | null): string {
  if (!s) return 'never';
  const at = Date.parse(normalizeStamp(s));
  if (Number.isNaN(at)) return s;
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** The exact instant, for a `title=` — relative is for reading, this is for checking. */
function exact(s: string | null): string | undefined {
  if (!s) return undefined;
  return normalizeStamp(s).replace('T', ' ').replace(/Z$/, ' UTC');
}

/* --------------------------------------------------------------- errors --- */

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The two statuses that are states rather than faults get their own reading.
 * 503 is "this deployment has no encryption key" — the server is healthy and
 * the credential is fine, there is simply nothing to encrypt with. 409 is the
 * store refusing to let a machine-managed name be hand-edited; the server's
 * own message names the credential and says what to do instead, so it is
 * passed through rather than paraphrased.
 */
function saveErrText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) {
      return `No encryption key on the server, so nothing can be saved: ${e.message}`;
    }
    if (e.status === 409) {
      return e.message || 'That name is managed automatically by an integration and cannot be set by hand.';
    }
    if (e.message) return e.message;
  }
  return errText(e, "The value wasn't stored.");
}

/* --------------------------------------------------------------- pieces --- */

/**
 * Presence, in one mark. The tone already carries "and that matters" — brass
 * for a required slot standing empty, quiet grey for an optional one — so
 * "required" rides inside this label rather than beside it. A second brass
 * capsule next to the first one only ever said the same thing twice.
 */
function Pill({ set, required }: { set: boolean; required: boolean }) {
  const tone = set ? 'ok' : required ? 'warn' : 'dim';
  const label = set ? 'Set' : required ? 'Not set · required' : 'Not set';
  return <span className={`cred-pill ${tone}`}>{label}</span>;
}

/** updated / rotated / last used, relative — with the exact UTC instant on hover. */
function Stamps({ meta }: { meta: CredentialMeta }) {
  const parts: [string, string | null][] = [
    ['updated', meta.updated_at],
    ['rotated', meta.rotated_at],
    ['last used', meta.last_used_at],
  ];
  return (
    <p className="cred-stamps data">
      {parts.map(([k, v], i) => (
        <span key={k} className="cred-stamp" title={exact(v)}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span className="cred-stamp-k">{k}</span> {fmtAgo(v)}
        </span>
      ))}
    </p>
  );
}

interface EditorProps {
  slot: CredentialSlot;
  busy: boolean;
  error: string | null;
  note: string | null;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * The only input on the surface that touches a secret.
 *
 * type=password so it never renders as text and never lands in a screenshot;
 * autoComplete off and spellCheck off so no password manager offers to store
 * it and no spellchecker ships it off for a suggestion. There is deliberately
 * no reveal toggle — not because reveal is hard, but because after the POST
 * there is nothing to reveal, and an affordance that implies otherwise is a
 * lie about how the store works.
 */
function Editor({ slot, busy, error, note, value, onChange, onSave, onCancel }: EditorProps) {
  const inputId = `cred-input-${slot.name}`;
  return (
    <form
      className="cred-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label className="cred-editor-label" htmlFor={inputId}>
        {slot.stored ? `New value for ${slot.label}` : `Value for ${slot.label}`}
      </label>
      <div className="cred-editor-row">
        <input
          id={inputId}
          className="cred-input data"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={value}
          disabled={busy}
          placeholder="paste the value"
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Always "Save", never "Rotate": the row's own button already says
            which of the two this is, and two buttons reading "Rotate" in one
            row is a coin flip nobody should have to call. */}
        <button type="submit" className="cred-btn" disabled={busy || value.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="cred-btn subtle" disabled={busy} onClick={onCancel}>
          Close
        </button>
      </div>
      <p className="cred-editor-help">
        Pasted here it goes straight to the encrypted store and comes back as metadata only — no route on this
        server can return it, including to this page. Nothing to retrieve later means keep your own copy.
      </p>
      {note && <p className="cred-note data">{note}</p>}
      {error && <p className="cred-error data">{error}</p>}
    </form>
  );
}

/* ---- settings: plaintext, editable, and loud about precedence ---- */

/** True when a stored row is actively beating a live environment variable. */
function isOverriding(s: SettingView): boolean {
  return s.source === 'db' && s.env_value !== null && s.env_value !== s.value;
}

/**
 * Where the value in force came from, in one mark — the settings equivalent of
 * `Pill`, and the same reading at the same glance distance. Brass only for the
 * one case that can surprise you: a stored value quietly beating a variable
 * that is still set to something else.
 */
function SourcePill({ s }: { s: SettingView }) {
  if (s.source === 'db') {
    const over = isOverriding(s);
    return (
      <span className={`cred-pill ${over ? 'warn' : 'ok'}`}>{over ? 'Set here · overriding' : 'Set here'}</span>
    );
  }
  if (s.source === 'env') return <span className="cred-pill dim">From {s.envVar}</span>;
  return <span className="cred-pill dim">Default</span>;
}

/**
 * The sentence this section exists to say. Every branch names the source that
 * won AND the source that lost, because either one alone leaves a reader who
 * knows about the other convinced the page is lying to them.
 */
function Precedence({ s }: { s: SettingView }) {
  if (s.source === 'db') {
    if (isOverriding(s)) {
      return (
        <p className="cred-set-note override">
          <span className="cred-set-mark" aria-hidden="true">
            △
          </span>
          <span>
            Overriding <code className="cred-name data">{s.envVar}</code> (
            <code className="cred-env-val">{s.env_value}</code>) from the environment. The value stored here is
            the one in force — that variable is still in the environment and is being ignored, and will stay
            ignored until you stop overriding.
          </span>
        </p>
      );
    }
    if (s.env_value !== null) {
      return (
        <p className="cred-set-note">
          Stored here. <code className="cred-name data">{s.envVar}</code> is also set, to the same value, so
          nothing would change if you stopped overriding.
        </p>
      );
    }
    return (
      <p className="cred-set-note">
        Stored here.{' '}
        {s.value === s.default ? (
          <>Same value as the built-in default.</>
        ) : (
          <>
            The built-in default is <code className="cred-env-val">{s.default}</code>.
          </>
        )}
      </p>
    );
  }

  if (s.source === 'env') {
    return (
      <p className="cred-set-note">
        This value comes from <code className="cred-name data">{s.envVar}</code> in the environment. Saving here
        stores an override that outranks it from then on — the variable stays where it is, doing nothing.
      </p>
    );
  }

  return (
    <p className="cred-set-note">
      The built-in default — nothing is stored here
      {s.envVar ? (
        <>
          , and <code className="cred-name data">{s.envVar}</code> is not set in the environment.
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
  const id = `cred-setting-${s.key}`;
  const dirty = draft.trim() !== s.value;
  return (
    <li className={`cred-set${isOverriding(s) ? ' is-overriding' : ''}`}>
      <div className="cred-set-head">
        <label className="cred-slot-label" htmlFor={id}>
          {s.label}
        </label>
        <code className="cred-name data">{s.key}</code>
        <SourcePill s={s} />
      </div>

      <div className="cred-set-control">
        {s.type === 'enum' ? (
          <>
            {/* Saving on change is safe here because the choices are closed and
                every one of them is a complete, valid value — there is no
                half-typed state to protect, so a Save button would only be a
                second click between deciding and it being true. */}
            <select
              id={id}
              className="cred-select data"
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
            {busy && <span className="cred-set-busy data">Saving…</span>}
          </>
        ) : (
          <form
            className="cred-set-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) onSave(draft);
            }}
          >
            <input
              id={id}
              className="cred-input data"
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
            <button type="submit" className="cred-btn" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>

      {/* Inline, at the control that produced it, never a banner at the top of
          the page: the 409 about linked banks is the most important thing this
          surface can say, and it is only legible next to the selector that
          caused it. */}
      {error && <p className="cred-error data">{error}</p>}

      <Precedence s={s} />
      {s.restartRequired && (
        <p className="cred-set-note">Read once at boot — this takes effect after Cabinet restarts, not on save.</p>
      )}
      <p className="cred-slot-desc">{s.description}</p>

      {s.source === 'db' && (
        <p className="cred-set-when data">
          <span className="cred-env-k">stored</span> {fmtWhen(s.updated_at)}
          {/* Offered ONLY for a stored value, because it is the only state
              where there is an override to stop. Putting the old value back by
              hand is not the same operation — it leaves a row that keeps
              winning over whatever .env says next year. */}
          <button type="button" className="cred-btn tiny subtle" disabled={busy} onClick={onRevert}>
            {s.env_value !== null ? 'Stop overriding' : 'Revert to default'}
          </button>
        </p>
      )}
    </li>
  );
}

/* ---- environment: read-only by nature, and it has to look it ---- */

/**
 * `setting` is the entry that supersedes this variable, when one exists — the
 * row needs its label and its current value to say what actually won.
 */
function EnvRow({ v, setting }: { v: EnvVarReport; setting?: SettingView | null }) {
  // Belt and braces: the server only sends `value` for entries it has marked
  // as configuration rather than secret, and never for a scrubbed one. This
  // repeats that rule client-side so a server-side mistake still can't put a
  // secret on screen.
  const showValue = v.value !== null && !v.scrubbed;
  // A superseded variable has been demoted to a legacy fallback: a stored
  // setting beats it, so whatever is next to it on screen may not be in force.
  // It stays listed — deleting it from the catalog would be tidier and worse,
  // because the .env line does not disappear when the setting is created — but
  // it is dimmed and labelled rather than left sitting there looking like the
  // answer to "what is this configured to?".
  const superseded = v.supersededBy !== null;
  return (
    <li className={`cred-env-row${superseded ? ' is-superseded' : ''}`}>
      <div className="cred-env-head">
        <code className="cred-env-name data">{v.name}</code>
        <span className="cred-env-label">{v.label}</span>
        {/* The same per-row marker the managed list carries, in the same
            words: every read-only row on this page says so on the row, not
            just once in a section lede a scroll away. */}
        <span className="cred-ro">read-only</span>
        {superseded ? (
          // "Set / not set" is the wrong question for a variable that has been
          // outranked — the answer would be true and useless — so the pill
          // answers the one that matters instead.
          <span className="cred-pill dim">Superseded</span>
        ) : (
          /* An unset var is only a warning when something actually needs it.
             The GitHub pair belongs to an integration that may never be turned
             on — that goes quiet, so the one that IS missing and IS needed
             still reads as an exception. */
          <Pill set={v.set} required={v.required} />
        )}
      </div>
      {showValue ? (
        <p className="cred-env-value data">
          <span className="cred-env-k">value</span>{' '}
          {v.value === '' ? (
            // The server keeps '' distinct from unset on purpose — "set to
            // nothing" is a different and more confusing state than absent,
            // and an empty box would render it as neither.
            <span className="cred-env-noval">set to an empty string</span>
          ) : (
            <code className="cred-env-val">{v.value}</code>
          )}
        </p>
      ) : (
        <p className="cred-env-value data">
          <span className="cred-env-k">value</span> <span className="cred-env-noval">not shown — presence only</span>
        </p>
      )}
      <p className="cred-env-desc">{v.description}</p>
      {superseded ? (
        // Replaces the "why not here" line rather than joining it: for these
        // entries the server's `reason` IS the supersession note, and saying it
        // twice — once generically, once with the value that actually won —
        // would bury the half that carries the information.
        <p className="cred-env-reason cred-env-superseded">
          <span className="cred-env-k">superseded</span> The{' '}
          {setting ? `${setting.group} · ${setting.label}` : v.supersededBy} setting on this page takes
          precedence over this variable
          {setting ? (
            <>
              {' '}
              and is currently <code className="cred-env-val">{setting.value}</code>
              {setting.source === 'db' ? '' : ' — read from this variable, since nothing is stored yet'}.
            </>
          ) : (
            '.'
          )}
        </p>
      ) : (
        <p className="cred-env-reason">
          <span className="cred-env-k">why not here</span> {v.reason}
        </p>
      )}
    </li>
  );
}

/** A stored credential with no editable slot: managed by an integration, or unclaimed. */
function MetaRow({ meta, onDelete }: { meta: CredentialMeta; onDelete?: () => void }) {
  return (
    <li className="cred-meta-row">
      <div className="cred-meta-head">
        <code className="cred-name data">{meta.name}</code>
        {meta.provider && <span className="cred-meta-provider">{meta.provider}</span>}
        {onDelete ? (
          <button type="button" className="cred-btn tiny danger" onClick={onDelete}>
            Delete
          </button>
        ) : (
          <span className="cred-ro">read-only</span>
        )}
      </div>
      {meta.description && <p className="cred-meta-desc">{meta.description}</p>}
      <Stamps meta={meta} />
    </li>
  );
}

/* -------------------------------------------------------------- surface --- */

interface Pending {
  name: string;
  label: string;
  /** Extra copy for a slot Cabinet actively uses — deleting it turns an integration off. */
  breaks: string | null;
}

export function Credentials() {
  const [view, setView] = useState<CredentialsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // One editor open at a time: two open password fields is two chances to
  // paste into the wrong one.
  const [openName, setOpenName] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const [pending, setPending] = useState<Pending | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* ---- settings: a second, independent payload on the same page ----
     Deliberately not folded into the credentials fetch. They are different
     endpoints with opposite rules, and a settings outage should cost this page
     the settings section, not the key cabinet. */
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
      .credentials()
      .then((v) => {
        if (!live) return;
        setView(v);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setLoadError(errText(e, "Couldn't read the credential store."));
      });
    return () => {
      live = false;
    };
  }, [tick]);

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
  }, [tick]);

  // Catalog order, grouped — the server sends slots in catalog order, so the
  // first appearance of a group fixes that group's position.
  const groups = useMemo(() => {
    const out: { name: string; slots: CredentialSlot[] }[] = [];
    for (const slot of view?.slots ?? []) {
      const found = out.find((g) => g.name === slot.group);
      if (found) found.slots.push(slot);
      else out.push({ name: slot.group, slots: [slot] });
    }
    return out;
  }, [view]);

  // Same grouping, same catalog order, so a setting sits under the same
  // heading as the keys for the integration it configures.
  const settingGroups = useMemo(() => {
    const out: { name: string; items: SettingView[] }[] = [];
    for (const s of settings ?? []) {
      const found = out.find((g) => g.name === s.group);
      if (found) found.items.push(s);
      else out.push({ name: s.group, items: [s] });
    }
    return out;
  }, [settings]);

  /** Lets an environment row name the setting that outranks it, and its value. */
  const settingByKey = useMemo(() => new Map((settings ?? []).map((s) => [s.key, s])), [settings]);

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
        // wanted, a 409 explains what the change would break — so it goes
        // through as-is rather than being paraphrased into "save failed".
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

  const openEditor = (slot: CredentialSlot) => {
    setOpenName(slot.name);
    setSecret('');
    setSaveError(null);
    setSaveNote(null);
    setNote(null);
  };

  const closeEditor = () => {
    setOpenName(null);
    setSecret('');
    setSaveError(null);
    setSaveNote(null);
  };

  const save = (slot: CredentialSlot) => {
    if (secret.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveNote(null);
    api
      .saveCredential({ name: slot.name, secret, provider: slot.group, description: slot.description })
      .then((res) => {
        // FIRST, before anything that could throw or re-enter: the plaintext
        // leaves state the moment it is no longer needed. The editor stays
        // open, emptied, so the clearing is something Ben can see happen.
        setSecret('');
        setSaveNote(
          `${slot.label} ${res.created ? 'stored' : 'rotated'}. The field is cleared, and there is no way to read the value back — keep your own copy.`,
        );
        reload();
      })
      .catch((e: unknown) => setSaveError(saveErrText(e)))
      .finally(() => setSaving(false));
  };

  const confirmDelete = () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    api
      .deleteCredential(pending.name)
      .then(() => {
        setNote(`${pending.label} deleted. Nothing on this server can decrypt it now.`);
        if (openName === pending.name) closeEditor();
        setPending(null);
        reload();
      })
      .catch((e: unknown) => setDeleteError(errText(e, "That credential wasn't deleted.")))
      .finally(() => setDeleting(false));
  };

  if (!view) {
    return (
      <section className="creds" aria-label="Credentials">
        <p className={loadError ? 'cred-empty voice' : 'cred-loading data'}>
          {loadError ?? 'Reading the credential store…'}
        </p>
      </section>
    );
  }

  const missingRequired = view.slots.filter((s) => s.required && !s.stored).length;
  const hasManaged = view.managed.length > 0;
  const hasUnknown = view.unrecognised.length > 0;
  const nManaged = '03';
  const nUnknown = hasManaged ? '04' : '03';
  const nEnv = String(3 + (hasManaged ? 1 : 0) + (hasUnknown ? 1 : 0)).padStart(2, '0');

  return (
    <section className="creds" aria-label="Credentials">
      <header className="creds-head">
        <div>
          <SectionLabel n="00">Keys and secrets</SectionLabel>
          <p className="creds-lede voice">
            What this server holds, what it reads from its environment, and what it deliberately cannot see.
            Live secrets moved out on 2 August — they live in cabinet-secrets now, which holds its own key
            outside this process. What is left here is the retired local store and the environment report.
          </p>
        </div>
        {view.slots.length > 0 && (
          <div className="creds-head-side">
            <span
              className={`cred-tally ${missingRequired > 0 ? 'warn' : 'ok'}`}
              title={missingRequired > 0 ? 'A required key is missing — its integration is dark' : 'Every required key is stored'}
            >
              {view.slots.filter((s) => s.stored).length}/{view.slots.length} slots filled
            </span>
          </div>
        )}
      </header>

      {/* Retired, not broken — and the difference is the whole message.
          This banner used to say "restore CABINET_CRED_KEY and restart", which
          is now precisely the wrong instruction: that key is gone on purpose and
          must not come back. A page that reports a deliberate end-state as an
          outage sends Ben to fix something that isn't broken, and teaches him to
          distrust the alerts that do matter. */}
      {!view.configured && (
        <p className="cred-banner is-retired" role="status">
          <span className="cred-banner-mark" aria-hidden="true">
            △
          </span>
          <span>
            <strong>This store is retired and has no key.</strong> Nothing can be saved here and nothing already
            stored can be read — intended, not a misconfiguration. Secrets now live in{' '}
            <a className="data" href="https://secrets.benloe.com" target="_blank" rel="noreferrer">
              secrets.benloe.com
            </a>
            , where the encryption key never enters this process and no endpoint hands a value back. Names and
            dates below are still accurate, and deleting still works — dropping ciphertext no one can read is a
            complete delete.
          </span>
        </p>
      )}

      {note && <p className="cred-note data">{note}</p>}
      {loadError && <p className="cred-error data">{loadError}</p>}

      <section className="cred-slots" aria-label="Integrations">
        <SectionLabel n="01">Integrations</SectionLabel>
        {/* An empty catalog is the finished state, so it gets a sentence rather
            than a blank heading. A section that renders nothing reads as a page
            that failed to load. */}
        {groups.length === 0 && (
          <p className="cred-empty voice">
            No integration keys live in this process any more. Plaid&rsquo;s moved to the secrets service above;
            add a slot here only for something this server must decrypt itself, which so far is nothing.
          </p>
        )}
        {groups.map((group) => (
          <article className="cred-group" key={group.name} aria-label={group.name}>
            <h3 className="cred-group-name">{group.name}</h3>
            <ul className="cred-slot-list">
              {group.slots.map((slot) => (
                // is-missing (the brass edge) marks a REQUIRED slot with
                // nothing in it — an integration that is dark. An empty
                // optional slot isn't a problem to be found, so it stays plain.
                <li className={`cred-slot${slot.required && !slot.stored ? ' is-missing' : ''}`} key={slot.name}>
                  <div className="cred-slot-head">
                    <span className="cred-slot-label">{slot.label}</span>
                    <code className="cred-name data">{slot.name}</code>
                    <Pill set={slot.stored} required={slot.required} />
                    <span className="cred-slot-actions">
                      <button
                        type="button"
                        className="cred-btn tiny"
                        disabled={!view.configured}
                        title={view.configured ? undefined : 'No encryption key on the server — nothing can be saved'}
                        onClick={() => (openName === slot.name ? closeEditor() : openEditor(slot))}
                      >
                        {slot.stored ? 'Rotate' : 'Set'}
                      </button>
                      {slot.stored && (
                        <button
                          type="button"
                          className="cred-btn tiny danger"
                          onClick={() =>
                            setPending({
                              name: slot.name,
                              label: slot.label,
                              breaks: `${group.name} stops working until a new value is stored.`,
                            })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </div>

                  <p className="cred-slot-desc">{slot.description}</p>
                  <p className="cred-slot-where data">
                    <span className="cred-env-k">where</span> {slot.where}
                  </p>
                  {slot.meta && <Stamps meta={slot.meta} />}

                  {openName === slot.name && (
                    <Editor
                      slot={slot}
                      busy={saving}
                      error={saveError}
                      note={saveNote}
                      value={secret}
                      onChange={setSecret}
                      onSave={() => save(slot)}
                      onCancel={closeEditor}
                    />
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {/* Directly under the keys, and above the read-only lists: a Plaid setup
          is one job, and the environment selector belongs beside the pair of
          keys it decides the meaning of. */}
      <section className="cred-settings" aria-label="Settings">
        <SectionLabel n="02">Settings</SectionLabel>
        <p className="cred-section-lede">
          Configuration rather than secrets: plaintext, readable, and editable right here. Anything saved in this
          section outranks the matching environment variable listed further down — the variable stays where it is
          and stops being used, and each control says which of the two is currently winning.
        </p>
        {settingsError && <p className="cred-error data">{settingsError}</p>}
        {!settings && !settingsError && <p className="cred-loading data">Reading settings…</p>}
        {settingGroups.map((group) => (
          <article className="cred-group" key={group.name} aria-label={`${group.name} settings`}>
            <h3 className="cred-group-name">{group.name}</h3>
            <ul className="cred-set-list">
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
      </section>

      {hasManaged && (
        <section className="cred-managed" aria-label="Managed automatically">
          <SectionLabel n={nManaged}>Managed automatically</SectionLabel>
          <p className="cred-section-lede">
            Issued by an integration and bound to something it owns — a bank connection, an app install. Cabinet
            writes and rotates these itself; there is no version of editing one by hand that ends well, so
            there&rsquo;s no button for it. To replace one, re-link the account it belongs to.
          </p>
          <ul className="cred-meta-list">
            {view.managed.map((m) => (
              <MetaRow key={m.name} meta={m} />
            ))}
          </ul>
        </section>
      )}

      {hasUnknown && (
        <section className="cred-unknown" aria-label="Unrecognised">
          <SectionLabel n={nUnknown}>Unrecognised</SectionLabel>
          <p className="cred-section-lede">
            Stored, but nothing in the catalog claims them — left over from an integration that was removed, or
            put there by hand. Listed rather than hidden, because a secret you&rsquo;ve forgotten about is worse
            than one you can see.
          </p>
          <ul className="cred-meta-list">
            {view.unrecognised.map((m) => (
              <MetaRow
                key={m.name}
                meta={m}
                onDelete={() => setPending({ name: m.name, label: m.name, breaks: null })}
              />
            ))}
          </ul>
        </section>
      )}

      {/* aria-label is "Environment variables", not "Environment": one of the
          settings above is literally called Environment, and two things on one
          page answering to the same name is how you end up editing the wrong
          one — or, for a screen reader, being told you are somewhere you are
          not. The heading stays short because its column gives it context. */}
      <section className="cred-env" aria-label="Environment variables">
        <SectionLabel n={nEnv}>Environment</SectionLabel>
        <p className="cred-section-lede">
          <span className="cred-ro">read-only</span> These are process environment variables, set outside the
          app — in root-owned config Cabinet can neither read nor write — and read once at boot. Nothing on this
          page can change one, and changing one takes a restart, not a save. A variable marked{' '}
          <em>superseded</em> has been replaced by a setting above, which wins: the line is still in the
          environment, and it is no longer what Cabinet uses.
        </p>
        <ul className="cred-env-list">
          {view.env.map((v) => (
            <EnvRow key={v.name} v={v} setting={v.supersededBy ? settingByKey.get(v.supersededBy) ?? null : null} />
          ))}
        </ul>
      </section>

      {pending && (
        <ConfirmDialog
          title={`Delete ${pending.label}?`}
          body={
            <>
              The stored value is destroyed and cannot be recovered from here — there is no copy on this server
              you can read, and no export.{pending.breaks ? ` ${pending.breaks}` : ''} You&rsquo;ll need the
              original from wherever it was issued.
            </>
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          error={deleteError}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (deleting) return;
            setPending(null);
            setDeleteError(null);
          }}
        />
      )}
    </section>
  );
}
