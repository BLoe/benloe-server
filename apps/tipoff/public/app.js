import { valuePlayers, tiers, CATS, CAT_LABEL, POSITIONS, POOL, matchSlots, openSlots } from './model.js';
import { schedule, clock, keeperAdjustedAdp, survives, needs, fit, fillsSlot, EXTRA_ROUNDS } from './draft.js';

// ---------- state ----------
const KEY = 'tipoff:v1';
const RECOMMENDED_PUNTS = ['fgp'];
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
};
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* private window: the draft still works, it just won't survive a reload */
  }
};

const [data, league] = await Promise.all([fetch('players.json').then((r) => r.json()), fetch('league.json').then((r) => r.json())]);
// Upstream strings reach innerHTML; positions and teams are escaped once here,
// names and outlooks at render through esc().
const clean = (x) => String(x ?? '').replace(/[^A-Za-z0-9 .'-]/g, '');
const players = data.players.map((p) => ({ ...p, team: clean(p.team), pos: p.pos.map(clean) }));
const byId = new Map(players.map((p) => [p.id, p]));

const fresh = () => ({
  marks: league.keepers.filter((k) => k.playerId != null).map((k) => ({ id: k.playerId, mine: k.mine, keeper: true })),
  offset: 0,
  punts: RECOMMENDED_PUNTS,
  settings: { order: Array(12).fill(''), extraFrom: {}, flaggPick: 'own' },
  pos: 'All',
  tab: 'board',
  sort: 'value',
  showTaken: false,
});
const S = load() ?? fresh();

const keeperIds = new Set(league.keepers.map((k) => k.playerId).filter((x) => x != null));
const adjAdp = keeperAdjustedAdp(players, keeperIds);
// The sheet names managers; Yahoo shows team names. Managers stay the key.
const teamName = (m) => league.teamNames?.[m] ?? m;
// The 2025 grid is headed by 2025 team names; show today's name for the same team.
const manager2025 = new Map(Object.entries(league.teamNames2025 ?? {}).map(([m, n]) => [n, m]));
const teamNow = (name2025) => (manager2025.has(name2025) ? teamName(manager2025.get(name2025)) : name2025);
const keptBy = new Map(league.keepers.filter((k) => k.playerId != null).map((k) => [k.playerId, k]));
const room2025 = new Map(league.draft2025.filter((d) => d.playerId != null).map((d) => [d.playerId, d]));

// ---------- derived ----------
let V; // everything computed from S
function derive() {
  const valued = valuePlayers(players, { punts: S.punts });
  const all = valued.players;
  const vById = new Map(all.map((p) => [p.id, p]));
  const tierOf = tiers(all, 192);
  const posTier = {};
  for (const pos of POSITIONS) posTier[pos] = tiers(all.filter((p) => p.pos.includes(pos)), 36);
  // Each source valued on its own, under the same punts, for the split flag.
  const srcRank = {};
  for (const s of ['espn', 'cbs', 'fp']) {
    srcRank[s] = new Map(valuePlayers(players, { punts: S.punts, line: (p) => p.src[s] }).players.map((p) => [p.id, p.rank]));
  }
  const markOf = new Map(S.marks.map((m) => [m.id, m]));
  const mine = S.marks.filter((m) => m.mine).map((m) => vById.get(m.id)).filter(Boolean);
  const room = S.marks.filter((m) => !m.mine).map((m) => vById.get(m.id)).filter(Boolean);
  const sched = schedule(league, S.settings);
  const clk = clock(sched, S.marks, S.offset);
  const hIdx = clk.horizon ? clk.idx(clk.horizon.at) : null;
  const need = needs(mine, room, S.punts);
  const starterLine = all[POOL - 1]?.value ?? 0;
  const avail = all.filter((p) => !markOf.has(p.id));
  for (const p of all) {
    p.tier = tierOf.get(p.id);
    p.fit = fit(p, need.w);
    p.surv = survives(adjAdp.get(p.id), clk.made, hIdx);
    const ranks = ['espn', 'cbs', 'fp'].map((s) => srcRank[s].get(p.id)).filter(Boolean);
    p.srcRanks = { espn: srcRank.espn.get(p.id), cbs: srcRank.cbs.get(p.id), fp: srcRank.fp.get(p.id) };
    p.split = ranks.length > 1 && Math.max(...ranks) - Math.min(...ranks) > Math.max(25, 0.6 * p.rank);
  }
  V = { all, vById, posTier, markOf, mine, room, sched, clk, need, starterLine, avail };
}

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (x) => (x == null ? '–' : x.toFixed(1));
const f2 = (x) => (x == null ? '–' : x.toFixed(2));
const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '–');
const roundOf = (at) => Math.ceil(at / 12);
const zColor = (z) => {
  const a = Math.min(1, Math.abs(z) / 2.2) * 0.55;
  return z >= 0 ? `background: rgba(63,182,139,${a})` : `background: rgba(229,83,75,${a})`;
};
function survBadge(s) {
  if (s == null) return '<span class="badge" title="Set the draft order to see this">–</span>';
  if (s < 0.3) return `<span class="badge gone" title="${Math.round(s * 100)}% to last">gone</span>`;
  if (s < 0.7) return `<span class="badge flip" title="${Math.round(s * 100)}% to last">${Math.round(s * 100)}%</span>`;
  return `<span class="badge there" title="${Math.round(s * 100)}% to last">there</span>`;
}
const injTag = (p) => (p.injury === 'OUT' ? '<span class="inj">OUT</span>' : p.injury ? '<span class="inj dtd">DTD</span>' : '');
const marketRank = (p) => adjAdp.get(p.id);

// ---------- header ----------
function renderClock() {
  const { clk, sched } = V;
  let html = '';
  if (!clk.now) html = '<span class="now">Draft complete</span>';
  else {
    html += `<button class="step" data-act="back" title="Pick counter back one">−</button>
      <span class="now num">Pick ${clk.now} <span class="next">R${roundOf(clk.now)}</span></span>
      <button class="step" data-act="fwd" title="Pick counter forward one (e.g. a pick you didn't mark)">+</button>`;
    if (!sched.mySlot) html += `<span class="next">Set the draft order in <b>Draft setup</b> to track your picks</span>`;
    else if (clk.onClock) html += `<span class="onclock">YOU'RE ON THE CLOCK</span><span class="next">then #${clk.horizon?.at ?? '–'}</span>`;
    else if (clk.next) html += `<span class="next">You: <b>#${clk.next.at}</b> in ${clk.idx(clk.next.at) - clk.made} picks</span>`;
  }
  $('#clock').innerHTML = html;
}

function renderStrategy() {
  $('#strategy').innerHTML =
    '<span class="lbl">Punt:</span>' +
    CATS.map((c) => `<button data-punt="${c}" class="${S.punts.includes(c) ? 'punted' : ''}" title="${S.punts.includes(c) ? 'Punted — click to count it again' : 'Click to punt'}">${CAT_LABEL[c]}</button>`).join('');
}

// ---------- board ----------
function boardRows() {
  const q = $('#search').value.trim().toLowerCase();
  let rows = V.all.filter((p) => (S.showTaken || !V.markOf.has(p.id) || V.markOf.get(p.id).mine) && p.rank <= 300);
  if (S.pos === 'Need') {
    rows = rows.filter((p) => !V.markOf.has(p.id) && fillsSlot(V.mine, p));
  } else if (S.pos !== 'All') {
    const want = S.pos === 'G' ? ['PG', 'SG'] : S.pos === 'F' ? ['SF', 'PF'] : [S.pos];
    rows = rows.filter((p) => p.pos.some((x) => want.includes(x)));
  }
  if (q) rows = V.all.filter((p) => p.name.toLowerCase().includes(q));
  const key = { value: (p) => -p.value, fit: (p) => -p.fit, adp: (p) => marketRank(p) ?? 999 }[S.sort];
  return [...rows].sort((a, b) => key(a) - key(b));
}

function renderBoard() {
  const rows = boardRows();
  const h = V.clk.horizon?.at;
  const head = `<tr>
    <th>T</th><th>#</th><th class="l">Player</th>
    <th class="sortable" data-sort="value" title="Value in YOUR categories, after punts">Val${S.sort === 'value' ? ' ▾' : ''}</th>
    <th class="sortable" data-sort="fit" title="Value re-weighted toward what your roster lacks">Fit${S.sort === 'fit' ? ' ▾' : ''}</th>
    ${CATS.map((c) => `<th>${CAT_LABEL[c]}</th>`).join('')}
    <th class="sortable" data-sort="adp" title="Where the room takes him: median of Yahoo ADP, ESPN ADP, expert rank — adjusted for keepers">Mkt${S.sort === 'adp' ? ' ▾' : ''}</th>
    <th title="Market slot minus our rank. Positive: the room undervalues him for this league.">Edge</th>
    <th title="Chance he lasts to your next pick">${h ? `@#${h}` : 'Next'}</th>
  </tr>`;
  let body = '';
  let lastTier = null;
  for (const p of rows) {
    const m = V.markOf.get(p.id);
    if (S.sort === 'value' && lastTier != null && p.tier !== lastTier) body += '<tr class="tierbreak"><td colspan="17"></td></tr>';
    lastTier = p.tier;
    const mk = marketRank(p);
    const edge = mk != null ? Math.round(mk - p.rank) : null;
    const cls = ['p', m ? (m.mine ? 'mine' : 'taken') : ''].join(' ');
    body += `<tr class="${cls}" data-id="${p.id}">
      <td class="tier">${p.tier || ''}</td>
      <td class="num">${p.rank}</td>
      <td class="l name">${esc(p.name)}${m?.keeper ? '<span class="keeper-tag">K</span>' : ''}${injTag(p)}<span class="sub">${p.pos.join('/')} · ${p.team}</span>${p.split ? ' <span class="split" title="Sources disagree: ESPN ' + (p.srcRanks.espn ?? '–') + ' · CBS ' + (p.srcRanks.cbs ?? '–') + ' · FantasyPros ' + (p.srcRanks.fp ?? '–') + '">◆</span>' : ''}</td>
      <td class="num val">${f1(p.value)}</td>
      <td class="num">${f1(p.fit)}</td>
      ${CATS.map((c) => `<td class="z ${S.punts.includes(c) ? 'punt' : ''}" style="${zColor(p.z[c])}">${f1(p.z[c])}</td>`).join('')}
      <td class="num">${mk != null ? Math.round(mk) : '–'}</td>
      <td class="num edge ${edge > 8 ? 'pos' : edge < -8 ? 'neg' : ''}">${edge == null ? '' : (edge > 0 ? '+' : '') + edge}</td>
      <td>${m ? '' : survBadge(p.surv)}</td>
    </tr>`;
  }
  $('#board').innerHTML = `<table class="b"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderPosView() {
  const cols = POSITIONS.map((pos) => {
    const list = V.all.filter((p) => p.pos.includes(pos) && V.posTier[pos].get(p.id) > 0);
    const left = list.filter((p) => !V.markOf.has(p.id) && p.value >= V.starterLine).length;
    let html = `<div class="poscol"><h4>${pos}<span>${left} starter-grade left</span></h4>`;
    let t = null;
    for (const p of list) {
      const pt = V.posTier[pos].get(p.id);
      if (pt !== t) {
        if (t != null) html += '</div>';
        t = pt;
        const remaining = list.filter((x) => V.posTier[pos].get(x.id) === pt && !V.markOf.has(x.id)).length;
        html += `<div class="ptier"><div class="tl">Tier ${pt} · ${remaining} left</div>`;
      }
      const m = V.markOf.get(p.id);
      html += `<div class="pp ${m ? (m.mine ? 'mine' : 'taken') : ''}" data-id="${p.id}"><span>${esc(p.name)}${injTag(p)}</span><span class="v">${f1(p.value)}</span></div>`;
    }
    return html + '</div></div>';
  });
  $('#posview').innerHTML = `<div class="posgrid">${cols.join('')}</div>`;
}

// ---------- sidebar ----------
// Which open slot a player closes: the one missing from the open list after.
function filledBy(open, p) {
  const after = [...openSlots([...V.mine, p])];
  for (const s of open) {
    const i = after.indexOf(s);
    if (i === -1) return s;
    after.splice(i, 1);
  }
  return 'slot';
}

function renderSuggest() {
  const { clk } = V;
  const open = openSlots(V.mine);
  const liveLeft = clk.live.length;
  const mustFill = liveLeft > 0 && liveLeft <= open.length;
  const cands = V.avail
    .filter((p) => !mustFill || fillsSlot(V.mine, p))
    .map((p) => ({ p, fills: fillsSlot(V.mine, p), score: p.fit + (fillsSlot(V.mine, p) ? 0.3 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  let html = `<h3>${clk.onClock ? 'Take now' : 'Shortlist for your pick'}<span>${clk.next ? `#${clk.next.at}` : ''}</span></h3><div class="sug">`;
  cands.forEach(({ p, fills }, i) => {
    const why = [fills ? `fills ${filledBy(open, p)}` : null, p.injury === 'OUT' ? 'OUT' : null].filter(Boolean).join(' · ');
    html += `<div class="row ${i === 0 ? 'top' : ''}" data-id="${p.id}"><span><b>${esc(p.name)}</b> <span class="why">${p.pos.join('/')} ${why ? '· ' + why : ''}</span></span><span>${survBadge(p.surv)} <span class="num">${f1(p.fit)}</span></span></div>`;
  });
  html += '</div>';
  // Wait-or-take: if the best fit should survive and a near-equal one won't.
  const [a] = cands;
  const urgent = cands.slice(1).find((c) => c.p.surv != null && c.p.surv < 0.35 && c.score >= a.score - 1);
  if (a && a.p.surv != null && a.p.surv > 0.7 && urgent) {
    html += `<div class="note"><b>${esc(a.p.name)}</b> should last to #${clk.horizon?.at}. <b>${esc(urgent.p.name)}</b> won't — take him first.</div>`;
  }
  if (mustFill) html += `<div class="warnline">${liveLeft} picks left, ${open.length} open starting slots (${open.join(', ')}). Shortlist is slot-fillers only.</div>`;
  // The hole in our draft: R9 to R13 is the only long wait.
  if (clk.next && clk.horizon && roundOf(clk.horizon.at) - roundOf(clk.next.at) >= 3) {
    const gap = clk.idx(clk.horizon.at) - clk.idx(clk.next.at);
    html += `<div class="warnline">After #${clk.next.at} you wait ${gap} picks (to #${clk.horizon.at}). Anything you need from a thin position, get it now.</div>`;
  }
  $('#suggest').innerHTML = html;
}

function renderTeam() {
  const assigned = matchSlots(V.mine);
  const used = new Set(assigned.filter((x) => x.player).map((x) => x.player.id));
  const bench = V.mine.filter((p) => !used.has(p.id));
  let html = `<h3>Your team<span>${V.mine.length}/16</span></h3><div class="slots">`;
  for (const { slot, player } of assigned) {
    html += `<span class="s">${slot}</span>${player ? `<span>${esc(player.name)} <span class="why" style="color:var(--muted)">${player.pos.join('/')}</span></span>` : '<span class="empty">open</span>'}`;
  }
  html += `</div><div class="bench">Bench: ${bench.length ? bench.map((p) => esc(p.name)).join(', ') : '—'}</div>`;
  $('#team').innerHTML = html;
}

function renderProfile() {
  const { rel, w } = V.need;
  let html = `<h3>Category profile<span>vs the room's average, per roster spot</span></h3><div class="prof">`;
  for (const c of CATS) {
    const v = rel ? rel[c] : V.mine.reduce((s, p) => s + p.z[c], 0);
    const scaled = Math.max(-1, Math.min(1, v / 4));
    const left = scaled >= 0 ? 50 : 50 + scaled * 50;
    const width = Math.abs(scaled) * 50;
    const col = S.punts.includes(c) ? 'var(--faint)' : v >= 0 ? 'var(--good)' : 'var(--bad)';
    const tag = S.punts.includes(c) ? '' : w[c] > 1 ? ' ↑' : w[c] < 1 ? ' ↓' : '';
    html += `<span class="c ${S.punts.includes(c) ? 'punt' : ''}">${CAT_LABEL[c]}${tag}</span><div class="bar"><div class="mid"></div><div class="fill" style="left:${left}%;width:${width}%;background:${col}"></div></div><span class="num">${f1(v)}</span>`;
  }
  html += '</div><div class="note">↑ categories the Fit column leans toward; ↓ ones you\'re already winning.</div>';
  $('#profile').innerHTML = html;
}

function renderScarcity() {
  const { clk } = V;
  const h = clk.horizon?.at;
  const hIdx = h ? clk.idx(h) : null;
  const room = h ? league.draft2025.filter((d) => d.overall < h) : [];
  let html = `<h3>Positional scarcity<span>starter-grade = top ${POOL} value</span></h3><table class="scar"><tr><th>Pos</th><th>Left now</th><th>${h ? `Left @#${h}` : 'At next'}</th><th title="Tier 1-2 at the position still available">Top tiers</th><th title="How many at this position this room had taken by the same pick last year">'25 gone</th></tr>`;
  for (const pos of POSITIONS) {
    const pool = V.avail.filter((p) => p.pos.includes(pos) && p.value >= V.starterLine);
    const now = pool.length;
    const later = pool.reduce((s, p) => s + (p.surv ?? 1), 0);
    const top = V.avail.filter((p) => p.pos.includes(pos) && (V.posTier[pos].get(p.id) ?? 0) > 0 && V.posTier[pos].get(p.id) <= 2).length;
    const gone25 = room.filter((d) => d.playerId != null && byId.get(d.playerId)?.pos.includes(pos)).length;
    const hot = h && later < Math.max(3, now * 0.5);
    html += `<tr><td>${pos}</td><td>${now}</td><td class="${hot ? 'hot' : ''}">${h ? Math.round(later) : '–'}</td><td>${top}</td><td>${h ? gone25 : '–'}</td></tr>`;
  }
  html += '</table>';
  const cs = V.mine.filter((p) => p.pos.includes('C')).length;
  html += `<div class="note">You start <b>two C</b>; you have <b>${cs}</b> C-eligible. Positions are Yahoo-style via FantasyPros — check eligibility in the Yahoo room for anyone borderline.</div>`;
  $('#scarcity').innerHTML = html;
}

function renderPicks() {
  const { sched, clk } = V;
  let html = `<h3>Your picks<span>${sched.mySlot ? `slot ${sched.mySlot}` : 'set draft order'}</span></h3><div class="picks">`;
  let prevRound = 0;
  for (const m of sched.mine) {
    if (m.round - prevRound > 1 && prevRound) html += `<span class="pk gap">— R${prevRound + 1}–${m.round - 1} sold —</span>`;
    prevRound = m.round;
    const used = m.at && clk.now && m.at < clk.now;
    const label = m.keeper ? `R${m.round} ${m.keeper.name.split(' ').pop()}` : `R${m.round}${m.at ? ` #${m.at}` : ' ?'}`;
    html += `<span class="pk ${used ? 'used' : ''} ${m.keeper ? 'keep' : ''} ${clk.next && m.at === clk.next.at ? 'next' : ''}" title="${m.from ? 'from ' + esc(teamName(m.from)) : 'own pick'}">${label}</span>`;
  }
  html += '</div>';
  if (sched.mySlot && EXTRA_ROUNDS.some((r) => !S.settings.extraFrom?.[r])) html += '<div class="warnline">Set who your extra 3rd/6th/8th came from in Draft setup.</div>';
  $('#mypicks').innerHTML = html;
}

function renderPosFilter() {
  $('#posFilter').innerHTML = ['All', 'PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'Need']
    .map((p) => `<button data-pos="${p}" class="${S.pos === p ? 'on' : ''}" ${p === 'Need' ? 'title="Only players who fill a starting slot you cannot fill yet"' : ''}>${p}</button>`)
    .join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#showTaken').checked = S.showTaken;
  $('#board').hidden = S.tab !== 'board';
  $('#posview').hidden = S.tab !== 'pos';
}

function render() {
  derive();
  renderClock();
  renderStrategy();
  renderPosFilter();
  if (S.tab === 'board') renderBoard();
  else renderPosView();
  renderSuggest();
  renderTeam();
  renderProfile();
  renderScarcity();
  renderPicks();
}

// ---------- pick dialog ----------
let dialogId = null;
function openPick(id) {
  const p = V.vById.get(id);
  if (!p) return;
  dialogId = id;
  const m = V.markOf.get(id);
  const s = p.proj;
  const r25 = room2025.get(id);
  $('#pickName').innerHTML = `${esc(p.name)} ${injTag(p)}`;
  $('#pickMeta').textContent = [
    `${p.pos.join('/')} · ${p.team} · our rank ${p.rank} · value ${f2(p.value)} · tier ${p.tier || '–'}`,
    `${f1(s.pts)} pts · ${f1(s.reb)} reb · ${f1(s.ast)} ast · ${f1(s.stl)} stl · ${f1(s.blk)} blk · ${f1(s.tpm)} 3pm · ${f1(s.fgm)} FGM · ${pct(s.fgm, s.fga)} FG · ${pct(s.ftm, s.fta)} FT · ${Math.round(s.gp)} GP`,
    `Sources (our rank): ESPN ${p.srcRanks.espn ?? '–'} · CBS ${p.srcRanks.cbs ?? '–'} · FantasyPros ${p.srcRanks.fp ?? '–'}`,
    `Market: Yahoo ADP ${p.adpYahoo ?? '–'} · ESPN ADP ${p.adpEspn ?? '–'} · experts ${p.ecr ?? '–'}`,
    keptBy.has(id) ? `Kept by ${teamName(keptBy.get(id).team)} (round ${keptBy.get(id).round})` : null,
    r25 ? `2025 in this league: R${r25.round} by ${teamNow(r25.team)}` : null,
    p.outlook ? p.outlook.slice(0, 320) + (p.outlook.length > 320 ? '…' : '') : null,
  ]
    .filter(Boolean)
    .join('\n');
  $('#pickBtns').innerHTML = m
    ? `<button value="undo" data-act="undo-pick">Put back on the board <kbd>u</kbd></button>`
    : `<button value="mine" class="mine" data-act="mine">Mine <kbd>m</kbd></button><button value="taken" data-act="taken" autofocus>Taken <kbd>enter</kbd></button>`;
  $('#pickDialog').showModal();
}
function act(kind) {
  const id = dialogId;
  if (id == null) return;
  if (kind === 'mine' || kind === 'taken') {
    if (!V.markOf.has(id)) S.marks.push({ id, mine: kind === 'mine', keeper: false });
  } else if (kind === 'undo-pick') {
    S.marks = S.marks.filter((m) => m.id !== id);
  }
  $('#pickDialog').close();
  dialogId = null;
  save();
  render();
}
$('#pickDialog').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (b) {
    e.preventDefault();
    act(b.dataset.act);
  } else if (e.target === $('#pickDialog')) $('#pickDialog').close();
});
$('#pickDialog').addEventListener('keydown', (e) => {
  const m = V.markOf.get(dialogId);
  if (!m && (e.key === 'm' || e.key === 'M')) (e.preventDefault(), act('mine'));
  else if (!m && (e.key === 'Enter' || e.key === 't')) (e.preventDefault(), act('taken'));
  else if (m && e.key === 'u') (e.preventDefault(), act('undo-pick'));
});
$('#pickDialog').addEventListener('close', () => {
  dialogId = null;
  $('#search').focus();
});

// ---------- settings ----------
function openSettings() {
  const st = S.settings;
  const byName = [...league.teams].sort((a, b) => teamName(a).localeCompare(teamName(b)));
  const teamOpts = (sel) =>
    ['<option value="">—</option>', ...byName.map((t) => `<option value="${esc(t)}" ${t === sel ? 'selected' : ''}>${esc(teamName(t))}${teamName(t) !== t ? ` · ${esc(t)}` : ''}</option>`)].join('');
  $('#settingsForm').innerHTML = `
    <h2>Draft setup</h2>
    <p>Teams are listed by their Yahoo name, manager alongside. The draft order is in the Yahoo lobby. With it, the board knows every pick of yours and skips the keeper picks so the counter matches Yahoo's.</p>
    <div class="grid">${st.order.map((t, i) => `<span>Slot ${i + 1}</span><select data-order="${i}">${teamOpts(t)}</select>`).join('')}</div>
    <p>Your extra picks — whose pick was it originally?</p>
    <div class="grid">${EXTRA_ROUNDS.map((r) => `<span>Round ${r}</span><select data-extra="${r}">${teamOpts(st.extraFrom?.[r])}</select>`).join('')}</div>
    <div class="row"><span>Flagg is kept with</span><select data-flagg><option value="own" ${st.flaggPick !== 'extra' ? 'selected' : ''}>your own 3rd</option><option value="extra" ${st.flaggPick === 'extra' ? 'selected' : ''}>the extra 3rd</option></select></div>
    <p>Pick counter offset: <b class="num">${S.offset}</b> (the − / + buttons beside the pick number adjust it).</p>
    <div class="actions"><button type="button" class="danger" data-reset>Reset the whole draft</button><button value="close">Done</button></div>`;
  $('#settingsDialog').showModal();
}
$('#settingsForm').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.order != null) S.settings.order[Number(t.dataset.order)] = t.value;
  if (t.dataset.extra != null) S.settings.extraFrom = { ...S.settings.extraFrom, [t.dataset.extra]: t.value };
  if (t.hasAttribute('data-flagg')) S.settings.flaggPick = t.value;
  save();
  render();
});
$('#settingsForm').addEventListener('click', (e) => {
  if (e.target.hasAttribute('data-reset') && confirm('Clear every pick and start over? Keepers are re-entered automatically.')) {
    const keep = S.settings;
    Object.assign(S, fresh(), { settings: keep });
    save();
    $('#settingsDialog').close();
    render();
  }
});
$('#settingsBtn').addEventListener('click', openSettings);

// ---------- wiring ----------
document.body.addEventListener('click', (e) => {
  const row = e.target.closest('[data-id]');
  if (row && !e.target.closest('dialog')) return openPick(isNaN(row.dataset.id) ? row.dataset.id : Number(row.dataset.id));
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.punt) {
    const c = t.dataset.punt;
    S.punts = S.punts.includes(c) ? S.punts.filter((x) => x !== c) : [...S.punts, c];
  } else if (t.dataset.pos) S.pos = t.dataset.pos;
  else if (t.dataset.tab) S.tab = t.dataset.tab;
  else if (t.dataset.act === 'back') S.offset -= 1;
  else if (t.dataset.act === 'fwd') S.offset += 1;
  else return;
  save();
  render();
});
document.body.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    S.sort = th.dataset.sort;
    save();
    render();
  }
});
$('#undo').addEventListener('click', () => {
  const i = S.marks.map((m) => !m.keeper).lastIndexOf(true);
  if (i === -1) return;
  S.marks.splice(i, 1);
  save();
  render();
});
$('#showTaken').addEventListener('change', (e) => {
  S.showTaken = e.target.checked;
  save();
  render();
});
let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => (S.tab === 'board' ? renderBoard() : null), 60);
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = boardRows().find((p) => !V.markOf.has(p.id));
    if (first) openPick(first.id);
  } else if (e.key === 'Escape') {
    e.target.value = '';
    renderBoard();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('#search') && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    $('#search').focus();
  }
});

render();
