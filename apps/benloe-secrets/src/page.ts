/**
 * The dashboard page, served as one self-contained document.
 *
 * No build step, no framework, no external requests — this page is the last
 * thing that should break, and every dependency is one more way for it to. A
 * strict CSP upstream (default-src 'none'; inline style and script only;
 * connect-src 'self') would refuse a CDN anyway, so the constraint and the
 * preference agree.
 *
 * The documents ARE rendered into the page, which is the deliberate difference
 * from the credential UI this replaced. That one was write-only because it held
 * third-party API keys you rotate at the provider — those stay sealed, and the
 * broker's credential table is not reachable from here at all. This holds env
 * documents an operator has to read in order to edit, served only over TLS and
 * only to an authenticated owner session.
 *
 * WHY THE CLIENT DOES THE RENDERING. The one question this page exists to
 * answer is "what can this app actually read" — which is the union of `shared`
 * and the app's own set, with the app winning collisions. That answer has to
 * stay true WHILE the operator is typing, not only after a save, so the merge
 * is computed in the browser from the current text. `envPairs` below therefore
 * mirrors store.ts's `parseEnv` and must keep mirroring it; the save response
 * reports the server's own key count as a check on the two agreeing.
 *
 * All set data reaches the client as one JSON blob and is placed into the DOM
 * with textContent, never innerHTML — set names, values and version metadata
 * are operator-supplied text and are never treated as markup.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Embed data in an inline script without letting it close the script element
 *  or open an HTML comment. Escaping `<` alone is sufficient for both. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface PageVersion {
  version: number;
  updated_at: string;
  updated_by: string | null;
  key_count: number;
  byte_length: number;
}

export interface PageSet {
  name: string;
  /** null when the set exists only in the UI sense (never saved). */
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
  byte_length: number;
  /** Current plaintext, or null if this set could not be decrypted. */
  document: string | null;
  /** Why it could not be decrypted. Never carries key material. */
  error?: string;
  /** Newest first. */
  versions: PageVersion[];
}

export interface PageProps {
  /** Server decides the order: `shared` first, then apps alphabetically. */
  sets: PageSet[];
  keyLoaded: boolean;
  ownerEmail: string;
  /** Paths the last materialise wrote, with key counts. */
  rendered: Record<string, number>;
  sharedName: string;
  /** Source of SET_NAME_RE, so the client validates against the same rule the
   *  server will enforce rather than a hand-copied approximation. */
  namePattern: string;
}

export function renderPage(p: PageProps): string {
  const data = jsonForScript({
    sets: p.sets,
    rendered: p.rendered,
    shared: p.sharedName,
    namePattern: p.namePattern,
    keyLoaded: p.keyLoaded,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>benloe-secrets</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #262b36; --text: #e6e8ec;
    --muted: #8b93a3; --accent: #6ea8fe; --ok: #4ade80; --warn: #fbbf24; --err: #f87171;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 22px; }
  .cols { display: flex; gap: 20px; align-items: flex-start; }
  .side { width: 240px; flex: none; }
  .main { flex: 1; min-width: 0; }
  @media (max-width: 760px) { .cols { flex-direction: column; } .side { width: 100%; } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .panel.tight { padding: 8px; }
  h2 { font-size: 12px; margin: 0 0 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .setlist { list-style: none; margin: 0; padding: 0; }
  .setlist li { margin: 0; }
  .setbtn {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    background: none; color: var(--text); border: 0; border-radius: 7px;
    padding: 8px 10px; font-size: 14px; font-weight: 500; cursor: pointer;
  }
  .setbtn:hover { background: #1d222c; }
  .setbtn.sel { background: #1b2230; color: var(--accent); }
  .setbtn .nm { font-family: var(--mono); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .setbtn .ct { margin-left: auto; color: var(--muted); font-size: 12px; font-family: var(--mono); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); flex: none; }
  .dot.hide { visibility: hidden; }
  .newset { display: flex; gap: 6px; margin-top: 10px; padding: 0 2px; }
  input[type=text] {
    flex: 1; min-width: 0; background: #0b0d11; color: var(--text); border: 1px solid var(--line);
    border-radius: 7px; padding: 7px 9px; font: 13px var(--mono);
  }
  input[type=text]:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  textarea {
    width: 100%; min-height: 46vh; resize: vertical; background: #0b0d11; color: var(--text);
    border: 1px solid var(--line); border-radius: 8px; padding: 14px;
    font: 13px/1.65 var(--mono); tab-size: 2; white-space: pre; overflow-wrap: normal; overflow-x: auto;
  }
  .bar { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  button {
    background: var(--accent); color: #0b0d11; border: 0; border-radius: 7px;
    padding: 9px 16px; font-weight: 600; font-size: 14px; cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.small { padding: 7px 11px; font-size: 13px; }
  button.ghost { background: none; color: var(--muted); border: 1px solid var(--line); }
  button.ghost:hover { color: var(--text); }
  button.danger { background: none; color: var(--err); border: 1px solid #5b2326; }
  button.link { background: none; color: var(--accent); padding: 0; font-weight: 500; text-decoration: underline; font-size: 13px; }
  .muted { color: var(--muted); font-size: 13px; }
  .status { font-size: 13px; min-height: 20px; }
  .status.ok { color: var(--ok); } .status.err { color: var(--err); }
  .spacer { margin-left: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; }
  tr.cur td { background: #1b2230; }
  .num { font-family: var(--mono); }
  .tag { color: var(--ok); font-size: 12px; }
  ul.plain { list-style: none; margin: 0; padding: 0; }
  ul.plain li { margin: 3px 0; font-size: 13px; display: flex; gap: 8px; align-items: baseline; break-inside: avoid; }
  code { font-family: var(--mono); font-size: 12px; }
  .badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .badge.shared { color: var(--warn); border-color: #4a3a13; }
  .badge.override { color: var(--accent); border-color: #23384f; }
  .badge.own { color: var(--ok); border-color: #1e3d2a; }
  .keys { columns: 2; column-gap: 24px; }
  @media (max-width: 620px) { .keys { columns: 1; } }
  .banner { border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
  .banner.err { background: #2a1416; border: 1px solid #5b2326; color: #fca5a5; }
  .banner.warn { background: #2a2313; border: 1px solid #5b4a23; color: #fcd9a5; }
</style>
</head>
<body>
<div class="wrap">
  <header><h1>benloe-secrets</h1><span class="muted">${escapeHtml(p.ownerEmail)}</span></header>
  <div class="sub">
    One set per app, plus <code>shared</code>. Each app reads its own set merged over
    <code>shared</code> — saving re-renders those files immediately.
  </div>

  ${p.keyLoaded ? '' : '<div class="banner err">No encryption key is loaded — nothing can be read or saved. Check the key file.</div>'}

  <div class="cols">
    <div class="side">
      <div class="panel tight">
        <ul class="setlist" id="setlist"></ul>
        <div class="newset">
          <input type="text" id="newname" placeholder="new-set" autocomplete="off" spellcheck="false" ${p.keyLoaded ? '' : 'disabled'}>
          <button class="small ghost" id="newbtn" ${p.keyLoaded ? '' : 'disabled'}>Add</button>
        </div>
        <div class="status" id="newstatus"></div>
      </div>
      <div class="panel">
        <h2>Rendered files</h2>
        <ul class="plain" id="rendered"></ul>
      </div>
    </div>

    <div class="main" id="main"></div>
  </div>
</div>
<script>
const DATA = ${data};

const state = {
  sel: null,
  drafts: Object.create(null), // set name -> text currently in the editor
};
for (const s of DATA.sets) state.drafts[s.name] = s.document === null ? '' : s.document;

const NAME_RE = new RegExp(DATA.namePattern);
const byName = (n) => DATA.sets.find((s) => s.name === n) || null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/**
 * Mirrors store.ts parseEnv: value taken verbatim after the FIRST '=', later
 * duplicates win, optional surrounding quotes stripped. Kept in step with the
 * server on purpose — see the header comment.
 */
function envPairs(text) {
  const out = new Map();
  for (const line of String(text || '').split('\\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    let v = t.slice(eq + 1).trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    out.set(k, v);
  }
  return out;
}

const keyCount = (name) => envPairs(state.drafts[name] || '').size;
const isDirty = (name) => {
  const s = byName(name);
  return !!s && (s.document === null ? '' : s.document) !== (state.drafts[name] || '');
};

/** What the app can actually read: shared underneath, its own set on top. */
function effectiveKeys(name) {
  const shared = envPairs(state.drafts[DATA.shared] || '');
  const own = envPairs(state.drafts[name] || '');
  const rows = [];
  for (const k of new Set([...shared.keys(), ...own.keys()])) {
    const inS = shared.has(k), inO = own.has(k);
    rows.push({ key: k, from: inS && inO ? 'override' : inO ? 'own' : 'shared' });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

async function api(method, url, body) {
  const init = { method: method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || ('HTTP ' + r.status));
  return out;
}

const setUrl = (name) => '/api/sets/' + encodeURIComponent(name);

function select(name) {
  state.sel = name;
  location.hash = name ? '#' + encodeURIComponent(name) : '';
  render();
}

function renderSidebar() {
  const list = document.getElementById('setlist');
  list.textContent = '';
  for (const s of DATA.sets) {
    const li = el('li');
    const b = el('button', 'setbtn' + (s.name === state.sel ? ' sel' : ''));
    b.appendChild(el('span', 'dot' + (isDirty(s.name) ? '' : ' hide')));
    b.appendChild(el('span', 'nm', s.name));
    b.appendChild(el('span', 'ct', s.error ? 'sealed' : keyCount(s.name)));
    b.addEventListener('click', () => select(s.name));
    li.appendChild(b);
    list.appendChild(li);
  }

  const rendered = document.getElementById('rendered');
  rendered.textContent = '';
  const paths = Object.keys(DATA.rendered).sort();
  if (!paths.length) rendered.appendChild(el('li', 'muted', 'nothing rendered yet'));
  for (const path of paths) {
    const li = el('li');
    li.appendChild(el('code', null, path));
    li.appendChild(el('span', 'muted', DATA.rendered[path] + ' keys'));
    rendered.appendChild(li);
  }
}

function status(node, msg, cls) {
  node.textContent = msg;
  node.className = 'status ' + (cls || '');
}

function renderMain() {
  const main = document.getElementById('main');
  main.textContent = '';
  const s = byName(state.sel);
  if (!s) {
    const p = el('div', 'panel');
    p.appendChild(el('div', 'muted', 'No sets yet. Create one on the left — start with "shared".'));
    main.appendChild(p);
    return;
  }

  // ---- editor -------------------------------------------------------------
  const ed = el('div', 'panel');
  const head = el('div', 'bar');
  head.style.marginTop = '0';
  const title = el('h2', null, s.name);
  title.style.margin = '0';
  head.appendChild(title);
  head.appendChild(el('span', 'muted', s.version === null ? 'never saved' : 'v' + s.version + ' · ' + s.updated_at + (s.updated_by ? ' · ' + s.updated_by : '')));
  ed.appendChild(head);

  if (s.error) {
    ed.appendChild(el('div', 'banner err', s.error));
  }

  const area = el('textarea');
  area.spellcheck = false;
  area.id = 'editor';
  area.value = state.drafts[s.name] || '';
  if (!DATA.keyLoaded) area.disabled = true;
  area.addEventListener('input', () => {
    state.drafts[s.name] = area.value;
    renderSidebar();
    renderEffective();
  });
  ed.appendChild(area);

  const bar = el('div', 'bar');
  const saveBtn = el('button', null, 'Save');
  saveBtn.id = 'save';
  saveBtn.disabled = !DATA.keyLoaded;
  const st = el('span', 'status');
  bar.appendChild(saveBtn);
  bar.appendChild(el('span', 'muted', 'Ctrl/Cmd-S'));
  bar.appendChild(st);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    status(st, 'saving…');
    try {
      const res = await api('POST', setUrl(s.name), { document: state.drafts[s.name] || '' });
      status(st, 'saved v' + res.version + ' — ' + res.key_count + ' keys, ' + Object.keys(res.rendered || {}).length + ' file(s) rendered', 'ok');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      status(st, e.message, 'err');
      saveBtn.disabled = false;
    }
  });

  if (s.name !== DATA.shared) {
    const del = el('button', 'small danger spacer', 'Delete set');
    del.addEventListener('click', async () => {
      // Naming the set in the prompt: the whole risk here is deleting the set
      // you were not looking at.
      if (!confirm('Delete the set "' + s.name + '" and all of its history? Its rendered file is removed too. This cannot be undone.')) return;
      status(st, 'deleting…');
      try {
        await api('DELETE', setUrl(s.name));
        location.hash = '';
        location.reload();
      } catch (e) { status(st, e.message, 'err'); }
    });
    bar.appendChild(del);
  }
  ed.appendChild(bar);
  main.appendChild(ed);

  // ---- effective keys -----------------------------------------------------
  const eff = el('div', 'panel');
  eff.id = 'eff';
  main.appendChild(eff);
  renderEffective();

  // ---- history ------------------------------------------------------------
  const hist = el('div', 'panel');
  hist.appendChild(el('h2', null, 'History'));
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Version', 'Saved', 'By', 'Keys', 'Size', '']) hr.appendChild(el('th', null, h));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  if (!s.versions.length) {
    const tr = el('tr');
    const td = el('td', 'muted', 'no versions yet');
    td.colSpan = 6;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const v of s.versions.slice(0, 25)) {
    const cur = v.version === s.version;
    const tr = el('tr', cur ? 'cur' : null);
    tr.appendChild(el('td', 'num', 'v' + v.version));
    tr.appendChild(el('td', null, v.updated_at));
    tr.appendChild(el('td', null, v.updated_by || '—'));
    tr.appendChild(el('td', 'num', v.key_count + ' keys'));
    tr.appendChild(el('td', 'num', v.byte_length + ' B'));
    const last = el('td');
    if (cur) {
      last.appendChild(el('span', 'tag', 'current'));
    } else {
      const b = el('button', 'link', 'restore');
      b.addEventListener('click', async () => {
        if (!confirm('Restore ' + s.name + ' v' + v.version + '? It is saved as a NEW version, so nothing is lost.')) return;
        try {
          const res = await api('POST', setUrl(s.name) + '/restore', { version: v.version });
          alert('Restored as v' + res.version + '.');
          location.reload();
        } catch (e) { alert(e.message); }
      });
      last.appendChild(b);
    }
    tr.appendChild(last);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  hist.appendChild(table);
  main.appendChild(hist);
}

/** The point of the page: exactly what this app can read, and where it came
 *  from. Recomputed on every keystroke so it never describes a stale document. */
function renderEffective() {
  const box = document.getElementById('eff');
  if (!box) return;
  box.textContent = '';
  const name = state.sel;

  if (name === DATA.shared) {
    const own = envPairs(state.drafts[name] || '');
    const consumers = DATA.sets.filter((s) => s.name !== DATA.shared);
    box.appendChild(el('h2', null, 'Inherited by every set'));
    box.appendChild(el('div', 'muted', own.size + ' keys reach all ' + consumers.length + ' app set(s) below unless that set overrides them. Anything here is broadly exposed — keep it to what several apps must agree on.'));
    const ul = el('ul', 'plain keys');
    for (const k of [...own.keys()].sort()) {
      const li = el('li');
      li.appendChild(el('code', null, k));
      const over = consumers.filter((s) => envPairs(state.drafts[s.name] || '').has(k)).map((s) => s.name);
      if (over.length) li.appendChild(el('span', 'badge override', 'overridden by ' + over.join(', ')));
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return;
  }

  const rows = effectiveKeys(name);
  const fromShared = rows.filter((r) => r.from === 'shared').length;
  const overridden = rows.filter((r) => r.from === 'override').length;
  box.appendChild(el('h2', null, 'Effective — what ' + name + ' can read'));
  box.appendChild(el('div', 'muted', rows.length + ' keys in ' + name + '.env: ' + (rows.length - fromShared) + ' its own (' + overridden + ' overriding shared), ' + fromShared + ' inherited from shared.'));
  const ul = el('ul', 'plain keys');
  for (const r of rows) {
    const li = el('li');
    li.appendChild(el('code', null, r.key));
    li.appendChild(el('span', 'badge ' + r.from, r.from === 'shared' ? 'shared' : r.from === 'override' ? 'overrides shared' : 'own'));
    ul.appendChild(li);
  }
  if (!rows.length) ul.appendChild(el('li', 'muted', 'no keys — this app gets an empty file'));
  box.appendChild(ul);
}

function render() {
  renderSidebar();
  renderMain();
}

// ---- new set ---------------------------------------------------------------
const newName = document.getElementById('newname');
const newBtn = document.getElementById('newbtn');
const newStatus = document.getElementById('newstatus');

async function createSet() {
  const name = newName.value.trim();
  if (!NAME_RE.test(name)) {
    status(newStatus, 'lowercase letters, digits and dashes; must start with a letter', 'err');
    return;
  }
  if (byName(name)) { status(newStatus, 'that set already exists', 'err'); return; }
  status(newStatus, 'creating…');
  try {
    await api('POST', setUrl(name), { document: '' });
    location.hash = '#' + encodeURIComponent(name);
    location.reload();
  } catch (e) { status(newStatus, e.message, 'err'); }
}
newBtn.addEventListener('click', createSet);
newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createSet(); });

// Ctrl/Cmd-S saves, because this is a text editor and muscle memory wins.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    const b = document.getElementById('save');
    if (b && !b.disabled) b.click();
  }
});

// An unsaved buffer is the one thing here that cannot be recovered from the
// store, since every save is kept but nothing keeps a draft.
window.addEventListener('beforeunload', (e) => {
  if (DATA.sets.some((s) => isDirty(s.name))) { e.preventDefault(); e.returnValue = ''; }
});

const wanted = decodeURIComponent(location.hash.replace(/^#/, ''));
state.sel = byName(wanted) ? wanted : (DATA.sets.length ? DATA.sets[0].name : null);
render();
</script>
</body>
</html>`;
}
