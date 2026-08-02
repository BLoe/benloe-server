/**
 * The dashboard page, served as one self-contained document.
 *
 * No build step, no bundler, no framework — this is a handful of forms over a
 * JSON API, and a toolchain for it would be more code than the thing itself.
 * It is also the surface that must keep working when Cabinet is broken, which
 * is an argument for having as few moving parts as possible.
 *
 * Visual language is lifted from Cabinet's own tokens (apps/cabinet/web/src/
 * styles/tokens.css) — the warm dark "campaign desk", brass as the single
 * accent — so this reads as another instrument on the same desk rather than a
 * bolted-on admin panel. Values are inlined rather than imported because this
 * service must not depend on Cabinet's build output.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cabinet · Secrets</title>
<style>
  :root {
    --ground:#171009; --panel:#20160d; --panel-2:#241810; --inset:#0e0a05;
    --rule:#3a2c1c; --rule-soft:#2a2013;
    --brass:#c99b53; --brass-hi:#eccb88; --brass-dim:#8a6b39;
    --patina:#7fa093; --vermilion:#d5573b;
    --linen:#e6dbc5; --linen-dim:#9d8d71; --linen-faint:#6a5c46;
    --fs-cap:10.5px; --fs-body:15px;
    --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-7:32px;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--linen);
    font:var(--fs-body)/1.5 ui-serif, Georgia, serif;
    padding:var(--sp-7) var(--sp-5);
  }
  .wrap { max-width:860px; margin:0 auto; }
  h1 { font-size:26px; font-weight:600; margin:0 0 var(--sp-1); letter-spacing:.01em; }
  .eyebrow {
    font:500 var(--fs-cap)/1 var(--mono); letter-spacing:.14em; text-transform:uppercase;
    color:var(--brass); margin-bottom:var(--sp-3);
  }
  .lede { color:var(--linen-dim); margin:0 0 var(--sp-6); font-size:14px; }
  .panel {
    background:var(--panel); border:1px solid var(--rule); border-radius:6px;
    padding:var(--sp-5); margin-bottom:var(--sp-5);
  }
  .panel h2 {
    font:500 var(--fs-cap)/1 var(--mono); letter-spacing:.14em; text-transform:uppercase;
    color:var(--linen-dim); margin:0 0 var(--sp-4);
  }
  table { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:12.5px; }
  th {
    text-align:left; color:var(--linen-faint); font-weight:500; font-size:var(--fs-cap);
    letter-spacing:.1em; text-transform:uppercase; padding:0 var(--sp-3) var(--sp-2) 0;
    border-bottom:1px solid var(--rule-soft);
  }
  td { padding:var(--sp-3) var(--sp-3) var(--sp-3) 0; border-bottom:1px solid var(--rule-soft); vertical-align:top; }
  tr:last-child td { border-bottom:0; }
  .name { color:var(--brass-hi); }
  .muted { color:var(--linen-faint); }
  .sealed { color:var(--patina); font-size:var(--fs-cap); letter-spacing:.08em; text-transform:uppercase; }
  label { display:block; font:500 var(--fs-cap)/1 var(--mono); letter-spacing:.1em;
          text-transform:uppercase; color:var(--linen-dim); margin-bottom:var(--sp-2); }
  input, textarea {
    width:100%; background:var(--inset); border:1px solid var(--rule); border-radius:4px;
    color:var(--linen); padding:var(--sp-3); font-family:var(--mono); font-size:13px;
  }
  input:focus, textarea:focus { outline:none; border-color:var(--brass-dim); }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-4); margin-bottom:var(--sp-4); }
  .field { margin-bottom:var(--sp-4); }
  button {
    background:var(--brass); color:#211505; border:0; border-radius:4px;
    padding:var(--sp-3) var(--sp-5); font:600 13px var(--mono); letter-spacing:.06em;
    text-transform:uppercase; cursor:pointer;
  }
  button:hover { background:var(--brass-hi); }
  button.ghost { background:transparent; color:var(--linen-faint); border:1px solid var(--rule);
                 padding:var(--sp-1) var(--sp-3); font-size:11px; }
  button.ghost:hover { color:var(--vermilion); border-color:var(--vermilion); background:transparent; }
  .status { display:flex; gap:var(--sp-5); flex-wrap:wrap; font-family:var(--mono); font-size:12px; }
  .status div { color:var(--linen-dim); }
  .status b { color:var(--linen); font-weight:500; }
  .ok { color:var(--patina); } .bad { color:var(--vermilion); }
  #msg { margin-bottom:var(--sp-4); font-family:var(--mono); font-size:12.5px; min-height:1em; }
  .log { font-family:var(--mono); font-size:11.5px; color:var(--linen-dim);
         max-height:260px; overflow:auto; }
  .log div { padding:3px 0; border-bottom:1px solid var(--rule-soft); white-space:pre-wrap; }
  .note { color:var(--linen-faint); font-size:12px; margin-top:var(--sp-4); line-height:1.6; }
  @media (max-width:640px) { .row { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">Cabinet · Credential Broker</div>
  <h1>Secrets</h1>
  <p class="lede">
    Stored encrypted under a key this service holds and Cabinet cannot read.
    Values are write-only by design — to change one, paste a new value.
    There is no way to read a secret back, here or anywhere else.
  </p>

  <div class="panel">
    <h2>Status</h2>
    <div class="status" id="status">loading…</div>
  </div>

  <div class="panel">
    <h2>Stored credentials</h2>
    <div id="msg"></div>
    <table>
      <thead><tr><th>Name</th><th>Provider</th><th>Value</th><th>Rotated</th><th>Last used</th><th></th></tr></thead>
      <tbody id="creds"><tr><td colspan="6" class="muted">loading…</td></tr></tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Add or rotate</h2>
    <div class="row">
      <div><label for="name">Name</label><input id="name" placeholder="plaid-secret" autocomplete="off"></div>
      <div><label for="provider">Provider</label><input id="provider" placeholder="plaid" autocomplete="off"></div>
    </div>
    <div class="field"><label for="description">Description</label><input id="description" placeholder="Plaid API secret (sandbox)" autocomplete="off"></div>
    <div class="field"><label for="secret">Secret</label><textarea id="secret" rows="3" autocomplete="off" spellcheck="false"></textarea></div>
    <button id="save">Store</button>
    <p class="note">
      Plaid needs exactly two to be configured: <span class="name">plaid-client-id</span> and
      <span class="name">plaid-secret</span>. Access tokens are created by the broker during Link
      and filed automatically — you never paste one.
    </p>
  </div>

  <div class="panel">
    <h2>Recent credential use</h2>
    <div class="log" id="audit">loading…</div>
    <p class="note">Every use, by Cabinet or from this page. Written to a file Cabinet cannot read or rewrite.</p>
  </div>
</div>
<script>
// Everything server-supplied reaches the page as textContent, never as markup.
// This page renders credential names, provider strings and audit lines, some of
// which are free text; escaping-then-innerHTML would work but would make the
// safety of a secrets console depend on one regex being right. Building nodes
// removes the question entirely.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

function msg(text, bad) {
  const box = $('msg'); clear(box);
  box.appendChild(el('span', bad ? 'bad' : 'ok', text));
}

function statusItem(label, value, cls) {
  const d = el('div', null, label + ' ');
  d.appendChild(el('b', cls, value));
  return d;
}

async function load() {
  const r = await fetch('/api/state');
  if (!r.ok) {
    const wrap = document.querySelector('.wrap'); clear(wrap);
    wrap.appendChild(el('h1', null, 'Not authorised'));
    wrap.appendChild(el('p', 'lede', 'This dashboard is owner-only.'));
    return;
  }
  const s = await r.json();
  const st = $('status'); clear(st);
  st.appendChild(statusItem('signed in', s.actor));
  st.appendChild(statusItem('encryption key', s.keyLoaded ? 'loaded' : 'MISSING', s.keyLoaded ? 'ok' : 'bad'));
  st.appendChild(statusItem('plaid', s.plaidConfigured ? 'configured' : 'not configured', s.plaidConfigured ? 'ok' : null));
  st.appendChild(statusItem('environment', s.environment));

  const body = $('creds'); clear(body);
  if (!s.credentials.length) {
    const tr = el('tr'); const td = el('td', 'muted', 'nothing stored yet');
    td.colSpan = 6; tr.appendChild(td); body.appendChild(tr);
  }
  for (const c of s.credentials) {
    const tr = el('tr');
    tr.appendChild(el('td', 'name', c.name));
    tr.appendChild(el('td', 'muted', c.provider || '—'));
    const sealed = el('td'); sealed.appendChild(el('span', 'sealed', 'sealed')); tr.appendChild(sealed);
    tr.appendChild(el('td', 'muted', (c.rotated_at || c.created_at || '').slice(0, 16)));
    tr.appendChild(el('td', 'muted', c.last_used_at ? c.last_used_at.slice(0, 16) : 'never'));
    const act = el('td');
    const btn = el('button', 'ghost', 'delete');
    btn.onclick = async () => {
      if (!confirm('Delete ' + c.name + '? This cannot be undone.')) return;
      const res = await fetch('/api/credentials/' + encodeURIComponent(c.name), { method: 'DELETE' });
      msg(res.ok ? 'Deleted ' + c.name : 'Delete failed', !res.ok);
      load(); audit();
    };
    act.appendChild(btn); tr.appendChild(act);
    body.appendChild(tr);
  }
}

async function audit() {
  const r = await fetch('/api/audit');
  if (!r.ok) return;
  const { events } = await r.json();
  const box = $('audit'); clear(box);
  if (!events.length) { box.appendChild(el('div', 'muted', 'no credential use recorded yet')); return; }
  for (const e of events) {
    const line = el('div', null,
      (e.at || '').slice(0, 19) + '  ' + (e.via || '') + '  ' + (e.action || '') + '  ' +
      ((e.credentials || []).join(',')) + '  ');
    line.appendChild(el('span', e.ok ? 'ok' : 'bad', e.ok ? 'ok' : (e.error || 'failed')));
    box.appendChild(line);
  }
}

$('save').onclick = async () => {
  const name = $('name').value.trim();
  const secret = $('secret').value;
  if (!name || !secret) { msg('Name and secret are both required.', true); return; }
  const res = await fetch('/api/credentials/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, provider: $('provider').value.trim() || null, description: $('description').value.trim() || null }),
  });
  const out = await res.json().catch(() => ({}));
  if (res.ok) {
    msg(out.created ? 'Stored ' + name : 'Rotated ' + name);
    // Clear the secret field immediately — no reason for plaintext to sit in
    // a DOM node after it has been sent.
    $('secret').value = ''; $('name').value = ''; $('provider').value = ''; $('description').value = '';
  } else {
    msg(out.error || 'Failed to store', true);
  }
  load(); audit();
};

load(); audit();
</script>
</body>
</html>`;
}
