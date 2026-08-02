import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type { CredentialMeta, CredentialSlot, CredentialsView, EnvVarReport } from '../lib/cabinet.js';
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

/* ---- environment: read-only by nature, and it has to look it ---- */

function EnvRow({ v }: { v: EnvVarReport }) {
  // Belt and braces: the server only sends `value` for entries it has marked
  // as configuration rather than secret, and never for a scrubbed one. This
  // repeats that rule client-side so a server-side mistake still can't put a
  // secret on screen.
  const showValue = v.value !== null && !v.scrubbed;
  return (
    <li className="cred-env-row">
      <div className="cred-env-head">
        <code className="cred-env-name data">{v.name}</code>
        <span className="cred-env-label">{v.label}</span>
        {/* The same per-row marker the managed list carries, in the same
            words: every read-only row on this page says so on the row, not
            just once in a section lede a scroll away. */}
        <span className="cred-ro">read-only</span>
        {/* An unset var is only a warning when something actually needs it.
            PLAID_ENV has a default and the GitHub pair belongs to an
            integration that may never be turned on — those go quiet, so the
            one that IS missing and IS needed still reads as an exception. */}
        <Pill set={v.set} required={v.required} />
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
      <p className="cred-env-reason">
        <span className="cred-env-k">why not here</span> {v.reason}
      </p>
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
  const nManaged = '02';
  const nUnknown = hasManaged ? '03' : '02';
  const nEnv = String(2 + (hasManaged ? 1 : 0) + (hasUnknown ? 1 : 0)).padStart(2, '0');

  return (
    <section className="creds" aria-label="Credentials">
      <header className="creds-head">
        <div>
          <SectionLabel n="00">Keys and secrets</SectionLabel>
          <p className="creds-lede voice">
            Every key Cabinet knows how to use, and whether it has one. Values go in encrypted and never come
            back out — not to an API, not to this page, not to me. What you can see here is that a key exists
            and when it was last touched.
          </p>
        </div>
        <div className="creds-head-side">
          <span
            className={`cred-tally ${missingRequired > 0 ? 'warn' : 'ok'}`}
            title={missingRequired > 0 ? 'A required key is missing — its integration is dark' : 'Every required key is stored'}
          >
            {view.slots.filter((s) => s.stored).length}/{view.slots.length} slots filled
          </span>
        </div>
      </header>

      {/* The one state where nothing on this page can work. Loud, and before
          anything that would otherwise look actionable. */}
      {!view.configured && (
        <p className="cred-banner" role="alert">
          <span className="cred-banner-mark" aria-hidden="true">
            △
          </span>
          <span>
            <strong>No encryption key on the server.</strong> This process booted without CABINET_CRED_KEY, so
            nothing can be saved and nothing already stored can be decrypted. Names and dates below are still
            accurate; the values behind them are unreadable until the key is restored and Cabinet restarted.
            Deleting still works — dropping ciphertext no one can read is a complete delete.
          </span>
        </p>
      )}

      {note && <p className="cred-note data">{note}</p>}
      {loadError && <p className="cred-error data">{loadError}</p>}

      <section className="cred-slots" aria-label="Integrations">
        <SectionLabel n="01">Integrations</SectionLabel>
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

      <section className="cred-env" aria-label="Environment">
        <SectionLabel n={nEnv}>Environment</SectionLabel>
        <p className="cred-section-lede">
          <span className="cred-ro">read-only</span> These are process environment variables, set outside the
          app — in root-owned config Cabinet can neither read nor write — and read once at boot. Nothing on this
          page can change one, and changing one takes a restart, not a save.
        </p>
        <ul className="cred-env-list">
          {view.env.map((v) => (
            <EnvRow key={v.name} v={v} />
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
