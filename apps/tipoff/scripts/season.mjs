// After the draft: every real roster (results file transcribed from Ben's
// Yahoo screenshots), each team's category strength, and Ben's projected
// weekly H2H odds against each one. Weeks are played out under a randomly
// chosen single source (ESPN/CBS/FantasyPros) so projection error shows up.
import { readFileSync } from 'node:fs';
import { valuePlayers, CATS, CAT_LABEL } from '../public/model.js';
import { norm } from './snapshot.mjs';

const R = JSON.parse(readFileSync(process.env.TIPOFF_RESULTS || '/srv/benloe/data/tipoff/results-2026.json', 'utf8'));
const { players } = JSON.parse(readFileSync(new URL('../public/players.json', import.meta.url)));
const all = valuePlayers(players).players; // no punt: how rivals see value
const byKey = new Map(all.map((p) => [norm(p.name), p]));
const teams = Object.fromEntries(Object.entries(R.teams).map(([t, ns]) => [t, ns.map((n) => byKey.get(norm(n)))]));

let seed = 23;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Weekly line: the 13 best by value play, ~3.4 games each, scaled to 10 slots.
const GAMES = 3.4;
function week(roster, src) {
  const top = [...roster].sort((a, b) => b.value - a.value).slice(0, 13);
  const t = { fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
  for (const p of top) {
    const L = (src && p.src?.[src]) || p.proj;
    const g = GAMES * Math.min(1, (L.gp ?? p.proj.gp) / 82) * (10 / 13);
    for (const k of Object.keys(t)) t[k] += (L[k] ?? p.proj[k]) * g;
  }
  return t;
}
function sample(t) {
  const n = (m, d = 1.6) => Math.max(0, m + gauss() * Math.sqrt(m * d));
  const fga = n(t.fga, 1), fgm = Math.min(fga, n(t.fgm * (fga / t.fga), 0.9));
  const fta = n(t.fta, 1.4), ftm = Math.min(fta, n(t.ftm * (fta / t.fta), 0.4));
  return { fgm, fgp: fgm / fga, ftp: ftm / fta, tpm: n(t.tpm), pts: n(t.pts, 2.5), reb: n(t.reb), ast: n(t.ast), stl: n(t.stl, 1.2), blk: n(t.blk, 1.4) };
}
const point = (t) => ({ fgm: t.fgm, fgp: t.fgm / t.fga, ftp: t.ftm / t.fta, tpm: t.tpm, pts: t.pts, reb: t.reb, ast: t.ast, stl: t.stl, blk: t.blk });

// Category ranks across the league (1 = best), from the blended projection.
const lines = Object.fromEntries(Object.entries(teams).map(([t, r]) => [t, point(week(r))]));
const rank = {};
for (const c of CATS) {
  const order = Object.keys(lines).sort((a, b) => lines[b][c] - lines[a][c]);
  order.forEach((t, i) => ((rank[t] ??= {})[c] = i + 1));
}
console.log('CATEGORY RANKS (1 = best of 12), from blended projections');
console.log('team'.padEnd(31) + CATS.map((c) => CAT_LABEL[c].padStart(5)).join('') + '   avg');
for (const t of Object.keys(lines).sort((a, b) => CATS.reduce((s, c) => s + rank[a][c], 0) - CATS.reduce((s, c) => s + rank[b][c], 0))) {
  const avg = CATS.reduce((s, c) => s + rank[t][c], 0) / CATS.length;
  console.log((t === R.me ? '* ' : '  ') + t.padEnd(29) + CATS.map((c) => String(rank[t][c]).padStart(5)).join('') + avg.toFixed(1).padStart(6));
}

// Every team against every other: weekly matchup win% and per-category win%.
const WEEKS = 300;
function h2h(a, b) {
  let wins = 0, ties = 0;
  const cat = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (let w = 0; w < WEEKS; w++) {
    const src = ['espn', 'cbs', 'fp'][Math.floor(rand() * 3)];
    const x = sample(week(teams[a], src)), y = sample(week(teams[b], src));
    let cw = 0, cl = 0;
    for (const c of CATS) {
      if (x[c] > y[c]) (cw++, cat[c]++);
      else if (x[c] < y[c]) cl++;
    }
    if (cw > cl) wins++;
    else if (cw === cl) ties++;
  }
  return { win: wins / WEEKS, tie: ties / WEEKS, cat: Object.fromEntries(CATS.map((c) => [c, cat[c] / WEEKS])) };
}

console.log(`\n${R.me}: WEEKLY MATCHUP ODDS vs each team (${WEEKS} simulated weeks each)`);
const rows = Object.keys(teams).filter((t) => t !== R.me).map((t) => ({ t, ...h2h(R.me, t) })).sort((a, b) => a.win - b.win);
for (const r of rows) {
  const lose = CATS.filter((c) => r.cat[c] < 0.4).map((c) => CAT_LABEL[c]);
  console.log(`  ${r.t.padEnd(30)} win ${(100 * r.win).toFixed(0).padStart(3)}%   usually lose: ${lose.join(', ') || '-'}`);
}

// League table: each team's average weekly win% against the other eleven.
console.log('\nPOWER TABLE: average weekly win% vs the rest of the league');
const power = Object.keys(teams).map((a) => {
  const ws = Object.keys(teams).filter((b) => b !== a).map((b) => h2h(a, b).win);
  return { t: a, w: ws.reduce((s, x) => s + x) / ws.length };
}).sort((a, b) => b.w - a.w);
power.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${(p.t === R.me ? '* ' : '  ') + p.t.padEnd(30)} ${(100 * p.w).toFixed(0)}%`));
