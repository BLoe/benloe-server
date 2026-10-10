// Reads the league's own sheet (keepers, last year's draft) into
// public/league.json, with every name resolved to a player id. The sheet is
// hand-typed, so names are matched loosely and anything unresolved is printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { norm } from './snapshot.mjs';

const SHEET = '10L3pzV4nD1DqCcTwURkncnzdXNSJFPnixTEWYgtr2T4';
const KEEPERS_TAB = '2026 Keepers';
const DRAFT_TAB = '2025 Draft Results';
const KEEPERS_2025_TAB = '2025 Keepers';
// Read off Ben's screenshots of the Yahoo draft grid (2026-10-10), as
// round.pick. Picks are traded widely, so these beat anything derived from
// a draft order. Ours: the 14 live picks. Keepers: all 21 pre-filled picks.
const YAHOO_PICKS = {
  mine: '1.5 2.8 3.5 4.8 5.5 6.2 6.8 7.5 8.6 8.8 9.5 14.8 15.5 16.8',
  keepers: {
    '3.7': 'Cooper Flagg', '4.2': 'Julius Randle', '4.11': 'Deni Avdija', '5.4': 'Jayson Tatum',
    '6.3': 'Tyrese Haliburton', '6.4': 'Donovan Clingan', '6.5': 'Darius Garland', '6.11': 'Austin Reaves',
    '7.11': 'Dyson Daniels', '8.7': 'Stephon Castle', '8.9': 'Alexander Sarr', '8.12': 'Ryan Rollins',
    '9.9': 'Amen Thompson', '9.12': 'Keyonte George', '10.7': 'Jaden McDaniels', '12.3': 'N. Alexander-Walker',
    '12.10': 'Dejounte Murrary', '13.1': 'VJ Edgecombe', '13.3': 'Damian Lillard', '13.5': 'Kyshawn George',
    '15.12': 'Kon Knueppel',
  },
};

// Yahoo team names that changed since the 2025 draft grid: manager -> name.
const TEAM_NAME_OVERRIDES = { 'Joe M': 'Austin 316', 'Florio/Avi': 'Knicks in 5' };
const ME = 'Ben Loe';
// Spellings in the sheet that no rule would reconcile.
const ALIAS = { alexandersarr: 'alexsarr', dejountemurrary: 'dejountemurray', austinreeves: 'austinreaves', shadensharpe: 'shaedonsharpe', jarenjackson: 'jarenjackson' };

async function csv(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${sheet}`);
  return (await res.text())
    .trim()
    .split('\n')
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"').trim()));
}

const { players } = JSON.parse(readFileSync(new URL('../public/players.json', import.meta.url)));
const byKey = new Map(players.map((p) => [norm(p.name), p]));
const unresolved = [];
function resolve(raw) {
  let k = norm(raw);
  k = ALIAS[k] ?? k;
  if (byKey.has(k)) return byKey.get(k).id;
  // "N. Alexander-Walker": an initial and a surname.
  const m = raw.match(/^([A-Z])\.\s*(.+)$/);
  if (m) {
    const hit = players.find((p) => p.name.startsWith(m[1]) && norm(p.name).endsWith(norm(m[2])));
    if (hit) return hit.id;
  }
  unresolved.push(raw);
  return null;
}

const keepers = [];
const teams = [];
let team = null;
for (const [t, name, round] of (await csv(KEEPERS_TAB)).slice(1)) {
  if (t) teams.push((team = t));
  if (!name) continue;
  keepers.push({ team, name, round: Number(round) || null, playerId: resolve(name), mine: team === ME });
}

const draft = await csv(DRAFT_TAB);
const managers2025 = draft[0].slice(1);
const draft2025 = draft.slice(1).flatMap(([round, ...names]) =>
  names.map((name, i) => {
    const r = Number(round);
    const slot = i + 1;
    return { round: r, slot, overall: (r - 1) * 12 + (r % 2 ? slot : 13 - slot), team: managers2025[i], name, playerId: name ? resolve(name) : null };
  }),
);

// The sheet keys teams by manager; Yahoo shows team names. The 2025 grid is
// headed by team name, and each manager's 2025 keepers sit in their column at
// exactly their keeper round — so the keepers identify the column.
const teamNames = {};
let mgr = null;
const votes = {};
for (const [t, name, round] of (await csv(KEEPERS_2025_TAB)).slice(1)) {
  if (t) mgr = t.replace(/\s+/g, ' ').replace(/^Florio$/, 'Florio/Avi');
  if (!name) continue;
  const hit = draft2025.find((d) => d.round === Number(round) && norm(d.name) === (ALIAS[norm(name)] ?? norm(name)));
  if (hit) (votes[mgr] ??= []).push(hit.team);
}
for (const m of teams) {
  const v = votes[m] ?? [];
  if (v.length && v.every((x) => x === v[0])) teamNames[m] = v[0];
}
// The grid's own names, by manager, before any rename — to label 2025 picks.
const teamNames2025 = { ...teamNames };
Object.assign(teamNames, TEAM_NAME_OVERRIDES);

// Every keeper in the sheet must have exactly one pre-filled pick, and vice versa.
const gridNames = Object.values(YAHOO_PICKS.keepers);
const off = keepers.filter((k) => !gridNames.includes(k.name)).map((k) => k.name).concat(gridNames.filter((n) => !keepers.some((k) => k.name === n)));
if (off.length) throw new Error('sheet keepers and Yahoo grid disagree: ' + off.join(', '));
const yahooPicks = { mine: YAHOO_PICKS.mine, keepers: Object.keys(YAHOO_PICKS.keepers).join(' '), keeperAt: Object.fromEntries(Object.entries(YAHOO_PICKS.keepers).map(([rp, n]) => [n, rp])) };

writeFileSync(new URL('../public/league.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), me: ME, teams, teamNames, teamNames2025, keepers, draft2025, yahooPicks }, null, 1));
for (const m of teams) console.log(`  ${m.padEnd(11)} -> ${teamNames[m] ?? 'UNRESOLVED'}`);
console.log(`${teams.length} teams, ${keepers.length} keepers, ${draft2025.length} picks from 2025`);
const missingKeepers = keepers.filter((k) => k.playerId == null).map((k) => k.name);
if (missingKeepers.length) console.log('UNRESOLVED KEEPERS:', missingKeepers.join(', '));
console.log(`unresolved 2025 picks (retired/abroad, fine): ${unresolved.length - missingKeepers.length}`);
