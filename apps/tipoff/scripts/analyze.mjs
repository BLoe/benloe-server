// Answers "should I punt?" for THIS league by simulation rather than folklore.
//
// Eleven rivals draft by Yahoo ADP with noise (they draft off Yahoo's default
// ranks, which assume standard 9-cat with TO). We draft with our real pick
// structure and keepers, maximising value under a given punt set. Every
// resulting team is scored by expected weekly H2H category wins against each
// rival, with weekly noise. Repeated across all twelve draft slots.
import { readFileSync } from 'node:fs';
import { valuePlayers, CATS, CAT_LABEL, TEAMS, ROUNDS, overall, openSlots, profile } from '../public/model.js';

const data = JSON.parse(readFileSync(new URL('../public/players.json', import.meta.url)));
const KEEPERS = { 'Cooper Flagg': 3, 'Kyshawn George': 13 };
// Our rounds: 1-9 own, extra 3/6/8, none in 10-12, 13-16 own. 16 picks.
const MY_ROUNDS = [1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 8, 9, 13, 14, 15, 16];

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const base = valuePlayers(data.players).players;
const byName = new Map(base.map((p) => [p.name, p]));
const byId = new Map(base.map((p) => [p.id, p]));
const league = JSON.parse(readFileSync(new URL('../public/league.json', import.meta.url)));
const rivalKeepers = new Set(league.keepers.filter((k) => !k.mine && k.playerId != null).map((k) => k.playerId));

function draft(slot, punts) {
  const V = new Map(valuePlayers(data.players, { punts }).players.map((p) => [p.id, p.value]));
  const keepers = Object.keys(KEEPERS).map((n) => byName.get(n));
  const taken = new Set([...keepers.map((p) => p.id), ...rivalKeepers]);
  // Who sold us the extra picks is not modelled: random, never ourselves.
  let extraSlot = slot;
  while (extraSlot === slot) extraSlot = 1 + Math.floor(rand() * TEAMS);
  const mine = [];
  for (const r of MY_ROUNDS) mine.push({ r, at: overall(r, mine.some((m) => m.r === r) ? extraSlot : slot) });
  // Flagg occupies one 3rd, George the 13th; drop those picks.
  mine.splice(mine.findIndex((m) => m.r === 3), 1);
  mine.splice(mine.findIndex((m) => m.r === 13), 1);
  const myPicks = new Set(mine.map((m) => m.at));

  // Rival draft order: noisy ADP. Undrafted-by-Yahoo players sort last.
  const rivalOrder = base
    .filter((p) => !taken.has(p.id))
    // RIVALS=value: rivals draft off this league's own blended value instead
    // of Yahoo's ranks — the stress test for any edge the punt claims.
    .map((p) => ({ p, k: (process.env.RIVALS === 'value' ? p.rank : (p.adp ?? 230 + p.rank)) + gauss() * (2 + 0.15 * (p.adp ?? 200)) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);

  const teams = Array.from({ length: TEAMS }, () => []);
  const me = slot - 1;
  teams[me].push(...keepers);
  // Rival keepers go onto rival rosters, one sheet team per rival seat.
  const rivalTeams = [...new Set(league.keepers.filter((k) => !k.mine).map((k) => k.team))];
  const seats = [...Array(TEAMS).keys()].filter((i) => i !== me);
  for (const k of league.keepers) {
    if (k.mine || k.playerId == null) continue;
    teams[seats[rivalTeams.indexOf(k.team) % seats.length]].push(byId.get(k.playerId));
  }
  for (let pick = 1; pick <= TEAMS * ROUNDS; pick++) {
    const round = Math.ceil(pick / TEAMS);
    const pos = (pick - 1) % TEAMS;
    const owner = round % 2 ? pos : TEAMS - 1 - pos;
    if (myPicks.has(pick)) {
      const open = openSlots(teams[me]);
      const left = mine.filter((m) => m.at >= pick).length;
      let best = null, bestScore = -Infinity;
      const avail = base.filter((p) => !taken.has(p.id)).sort((a, b) => V.get(b.id) - V.get(a.id));
      for (const p of left <= open.length ? avail : avail.slice(0, 40)) {
        const fills = open.length && openSlots([...teams[me], p]).length < open.length;
        // Must-fill once the remaining picks only just cover the open slots.
        if (left <= open.length && !fills) continue;
        const s = V.get(p.id) + (fills ? 0.4 : 0);
        if (s > bestScore) (bestScore = s), (best = p);
      }
      teams[me].push(best);
      taken.add(best.id);
    } else {
      if (owner === me) continue; // a keeper's pick, or one we sold (10-12): handled outside the loop
      const p = rivalOrder.find((x) => !taken.has(x.id));
      teams[owner].push(p);
      taken.add(p.id);
    }
  }
  // Picks we sold in 10-12 go to some rival; hand them out so the league has
  // the same number of players.
  for (let i = 0; i < 3; i++) {
    const p = rivalOrder.find((x) => !taken.has(x.id));
    teams[(me + 1 + i) % TEAMS].push(p);
    taken.add(p.id);
  }
  return teams;
}

// Weekly line: each player's per-game stats x ~3.4 games x availability;
// only the best 13 by blended value play (10 active slots, daily rotation).
const GAMES = 3.4;
function week(team) {
  const top = [...team].sort((a, b) => b.value - a.value).slice(0, 13);
  const t = { fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
  for (const p of top) {
    const g = GAMES * Math.min(1, p.proj.gp / 82) * (10 / 13);
    for (const k of Object.keys(t)) t[k] += p.proj[k] * g;
  }
  return t;
}
// Sample one noisy week. Counting stats ~ overdispersed Poisson; shooting
// through makes over attempts.
function sample(t) {
  const n = (m, d = 1.6) => Math.max(0, m + gauss() * Math.sqrt(m * d));
  const fga = n(t.fga, 1), fgm = Math.min(fga, n(t.fgm * (fga / t.fga), 0.9));
  const fta = n(t.fta, 1.4), ftm = Math.min(fta, n(t.ftm * (fta / t.fta), 0.4));
  return { fgm, fgp: fgm / fga, ftp: ftm / fta, tpm: n(t.tpm), pts: n(t.pts, 2.5), reb: n(t.reb), ast: n(t.ast), stl: n(t.stl, 1.2), blk: n(t.blk, 1.4) };
}
function matchup(a, b, weeks = 120) {
  let wins = 0, cats = 0;
  const catWins = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (let i = 0; i < weeks; i++) {
    const x = sample(a), y = sample(b);
    let w = 0;
    for (const c of CATS) if (x[c] > y[c]) w++, catWins[c]++;
    else if (x[c] === y[c]) w += 0.5;
    cats += w;
    if (w > 4.5) wins++;
  }
  return { win: wins / weeks, cats: cats / weeks, catWins };
}

const STRATS = [[], ['ftp'], ['fgp'], ['ast'], ['blk'], ['tpm'], ['reb'], ['stl'], ['ftp', 'blk'], ['fgp', 'ftp'], ['ast', 'tpm'], ['fgp', 'blk']];
const results = [];
for (const punts of STRATS) {
  let win = 0, cats = 0, n = 0;
  const catWins = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (let slot = 1; slot <= TEAMS; slot++) {
    for (let rep = 0; rep < 3; rep++) {
      const teams = draft(slot, punts);
      const W = teams.map(week);
      for (let o = 0; o < TEAMS; o++) {
        if (o === slot - 1) continue;
        const m = matchup(W[slot - 1], W[o], 40);
        win += m.win, cats += m.cats, n++;
        for (const c of CATS) catWins[c] += m.catWins[c] / 40;
      }
    }
  }
  results.push({ punt: punts.map((c) => CAT_LABEL[c]).join('+') || 'none', win: win / n, cats: cats / n, by: Object.fromEntries(CATS.map((c) => [CAT_LABEL[c], Math.round((100 * catWins[c]) / n)])) });
}
results.sort((a, b) => b.win - a.win);
console.log('\nPUNT SIMULATION — matchup win% vs rivals drafting by Yahoo ADP (all 12 slots x 3 reps)');
for (const r of results) console.log(`${r.punt.padEnd(10)} win ${(100 * r.win).toFixed(1)}%  cats ${r.cats.toFixed(2)}/9  `, JSON.stringify(r.by));

// Where this league's settings disagree with Yahoo's room.
console.log('\nBIGGEST GAPS: our value rank vs Yahoo ADP (top 150 by either)');
const gap = base.filter((p) => p.adp && (p.rank <= 150 || p.adp <= 150)).map((p) => ({ n: p.name, rank: p.rank, adp: p.adp, d: p.adp - p.rank }));
console.log('undervalued by the room:', gap.sort((a, b) => b.d - a.d).slice(0, 15).map((x) => `${x.n} (${x.rank} vs ADP ${x.adp})`).join('; '));
console.log('overvalued by the room:', gap.sort((a, b) => a.d - b.d).slice(0, 15).map((x) => `${x.n} (${x.rank} vs ADP ${x.adp})`).join('; '));

console.log('\nKEEPERS (z per category, blended projection)');
for (const n of Object.keys(KEEPERS)) {
  const p = byName.get(n);
  console.log(n, `rank ${p.rank}, Yahoo ADP ${p.adp}`, Object.fromEntries(CATS.map((c) => [CAT_LABEL[c], +p.z[c].toFixed(2)])));
}
console.log('keepers combined', Object.fromEntries(Object.entries(profile(Object.keys(KEEPERS).map((n) => byName.get(n)))).map(([c, v]) => [CAT_LABEL[c], +v.toFixed(2)])));

console.log('\nCATEGORY CORRELATION over the top 156');
const top = base.slice(0, 156);
const corr = (a, b) => {
  const xa = top.map((p) => p.z[a]), xb = top.map((p) => p.z[b]);
  const ma = xa.reduce((s, x) => s + x) / xa.length, mb = xb.reduce((s, x) => s + x) / xb.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < xa.length; i++) (sab += (xa[i] - ma) * (xb[i] - mb)), (saa += (xa[i] - ma) ** 2), (sbb += (xb[i] - mb) ** 2);
  return sab / Math.sqrt(saa * sbb);
};
console.log('      ' + CATS.map((c) => CAT_LABEL[c].padStart(5)).join(''));
for (const a of CATS) console.log(CAT_LABEL[a].padEnd(6) + CATS.map((b) => corr(a, b).toFixed(2).padStart(5)).join(''));

console.log('\nTOP 30 (blended, this league)');
console.log(base.slice(0, 30).map((p) => `${p.rank}. ${p.name} ${p.pos.join('/')} ${p.value.toFixed(2)} (Y${p.adp ?? '-'})`).join('\n'));
