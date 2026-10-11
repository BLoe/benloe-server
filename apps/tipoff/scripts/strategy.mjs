// "Should I punt, and what?" — the second, stricter version of analyze.mjs.
//
// What is fixed to reality:  our 14 real picks (Yahoo grid), both keepers,
//   all 19 rival keepers removed and placed on rival rosters.
// What is simulated:  rivals' drafting (two models, below), projection error,
//   and weekly variance.
// Projection error: we draft off the BLEND, but each simulated season is
//   played out under ONE source's projections (ESPN, CBS or FantasyPros, at
//   random). Grading a strategy by the same numbers it drafted with flatters
//   whatever concentrates on the model's own certainty.
// Rivals:  'adp'   draft by market ADP + noise, filling their lineups
//          'smart' draft by our blended value (no punts) + noise — a room
//                  that knows the categories as well as we do.
import { readFileSync } from 'node:fs';
import { valuePlayers, CATS, CAT_LABEL, TEAMS, ROUNDS, openSlots } from '../public/model.js';
import { schedule } from '../public/draft.js';

const data = JSON.parse(readFileSync(new URL('../public/players.json', import.meta.url)));
const league = JSON.parse(readFileSync(new URL('../public/league.json', import.meta.url)));
const DRAFTS = Number(process.env.DRAFTS || 120);
const WEEKS = 60;

let seed = Number(process.env.SEED || 11);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const base = valuePlayers(data.players).players;
const byId = new Map(base.map((p) => [p.id, p]));
const sched = schedule(league, { order: [] });
const myPicks = new Set(sched.mine.filter((m) => !m.keeper).map((m) => m.at));
const keeperAt = new Set(sched.keeperPicks.keys());
const myKeepers = league.keepers.filter((k) => k.mine).map((k) => byId.get(k.playerId));
const rivalTeams = [...new Set(league.keepers.filter((k) => !k.mine).map((k) => k.team))];
const allKept = new Set(league.keepers.map((k) => k.playerId));

// Rivals are 11 seats. Who owns each non-our pick is not modelled beyond
// "a rival", rotated so rosters fill evenly.
function draft(strategy, rivals) {
  const V = new Map(valuePlayers(data.players, strategy.opts).players.map((p) => [p.id, p.value]));
  const taken = new Set(allKept);
  const teams = Array.from({ length: TEAMS }, () => []);
  teams[0].push(...myKeepers);
  for (const k of league.keepers) if (!k.mine) teams[1 + (rivalTeams.indexOf(k.team) % 11)].push(byId.get(k.playerId));
  const key = (p) => (rivals === 'smart' ? p.rank : (p.adp ?? 230 + p.rank)) + gauss() * (2 + 0.15 * (p.adp ?? p.rank));
  const order = base.filter((p) => !taken.has(p.id)).map((p) => ({ p, k: key(p) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  let rival = 0;
  const mineLeft = () => [...myPicks].filter((x) => x >= pick).length;
  let pick;
  for (pick = 1; pick <= TEAMS * ROUNDS; pick++) {
    if (keeperAt.has(pick)) continue;
    if (myPicks.has(pick)) {
      const open = openSlots(teams[0]);
      const must = mineLeft() <= open.length;
      const avail = base.filter((p) => !taken.has(p.id)).sort((a, b) => V.get(b.id) - V.get(a.id));
      let best = null, bestS = -Infinity;
      for (const p of must ? avail : avail.slice(0, 40)) {
        const fills = open.length && openSlots([...teams[0], p]).length < open.length;
        if (must && !fills) continue;
        const s = V.get(p.id) + (fills ? 0.4 : 0);
        if (s > bestS) (bestS = s), (best = p);
      }
      best ??= avail[0];
      teams[0].push(best);
      taken.add(best.id);
    } else {
      // Rivals also respect their lineups: skip a player who fills nothing
      // when they still have open starting slots and few picks left.
      const seat = 1 + (rival++ % 11);
      const p = order.find((x) => !taken.has(x.id));
      teams[seat].push(p);
      taken.add(p.id);
    }
  }
  return teams;
}

// A team's weekly line under one source's projections.
const GAMES = 3.4;
function week(team, src) {
  const top = [...team].sort((a, b) => b.value - a.value).slice(0, 13);
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

const STRATEGIES = [
  { name: 'no punt', opts: {} },
  { name: 'FG% at half weight', opts: { weights: { fgp: 0.5 } } },
  { name: 'punt FG%', opts: { punts: ['fgp'] } },
  { name: 'punt FT%', opts: { punts: ['ftp'] } },
  { name: 'punt BLK', opts: { punts: ['blk'] } },
  { name: 'punt REB', opts: { punts: ['reb'] } },
  { name: 'punt AST', opts: { punts: ['ast'] } },
  { name: 'punt FG% + FT%', opts: { punts: ['fgp', 'ftp'] } },
  { name: 'punt FG% + BLK', opts: { punts: ['fgp', 'blk'] } },
  { name: 'punt FG% + REB', opts: { punts: ['fgp', 'reb'] } },
  { name: 'punt REB + BLK', opts: { punts: ['reb', 'blk'] } },
  { name: 'punt FT% + BLK', opts: { punts: ['ftp', 'blk'] } },
];

for (const rivals of ['adp', 'smart']) {
  console.log(`\nRIVALS: ${rivals}   (${DRAFTS} drafts per strategy, every rival, ${WEEKS} weeks each; ±= 95% interval)`);
  const rows = [];
  for (const st of STRATEGIES) {
    const perDraft = [];
    const catWins = Object.fromEntries(CATS.map((c) => [c, 0]));
    let n = 0;
    for (let d = 0; d < DRAFTS; d++) {
      const teams = draft(st, rivals);
      const src = ['espn', 'cbs', 'fp'][Math.floor(rand() * 3)];
      const W = teams.map((t) => week(t, src));
      let wins = 0;
      for (let o = 1; o < TEAMS; o++) {
        for (let w = 0; w < WEEKS; w++) {
          const x = sample(W[0]), y = sample(W[o]);
          let c = 0;
          for (const k of CATS) if (x[k] > y[k]) (c++, catWins[k]++);
          if (c >= 5) wins++;
          n++;
        }
      }
      perDraft.push(wins / ((TEAMS - 1) * WEEKS));
    }
    const m = perDraft.reduce((a, b) => a + b) / perDraft.length;
    const sd = Math.sqrt(perDraft.reduce((a, b) => a + (b - m) ** 2, 0) / (perDraft.length - 1));
    rows.push({ st: st.name, m, ci: (1.96 * sd) / Math.sqrt(perDraft.length), cats: Object.fromEntries(CATS.map((c) => [CAT_LABEL[c], Math.round((100 * catWins[c]) / n)])) });
  }
  rows.sort((a, b) => b.m - a.m);
  for (const r of rows) console.log(`${r.st.padEnd(20)} ${(100 * r.m).toFixed(1).padStart(5)}% ±${(100 * r.ci).toFixed(1)}   ${Object.entries(r.cats).map(([k, v]) => `${k} ${v}`).join('  ')}`);
}
