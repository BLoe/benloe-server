// Reads the league's own sheet (keepers, last year's draft) into
// public/league.json, with every name resolved to a player id. The sheet is
// hand-typed, so names are matched loosely and anything unresolved is printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { norm } from './snapshot.mjs';

const SHEET = '10L3pzV4nD1DqCcTwURkncnzdXNSJFPnixTEWYgtr2T4';
const KEEPERS_TAB = '2026 Keepers';
const DRAFT_TAB = '2025 Draft Results';
const ME = 'Ben Loe';
// Spellings in the sheet that no rule would reconcile.
const ALIAS = { alexandersarr: 'alexsarr', dejountemurrary: 'dejountemurray' };

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

writeFileSync(new URL('../public/league.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), me: ME, teams, keepers, draft2025 }, null, 1));
console.log(`${teams.length} teams, ${keepers.length} keepers, ${draft2025.length} picks from 2025`);
const missingKeepers = keepers.filter((k) => k.playerId == null).map((k) => k.name);
if (missingKeepers.length) console.log('UNRESOLVED KEEPERS:', missingKeepers.join(', '));
console.log(`unresolved 2025 picks (retired/abroad, fine): ${unresolved.length - missingKeepers.length}`);
