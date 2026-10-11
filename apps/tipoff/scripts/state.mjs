// The live draft as Ben's board last pushed it, for a Claude session giving
// advice mid-draft. Reads /srv/benloe/data/tipoff/state.json.
import { readFileSync, statSync } from 'node:fs';
import { valuePlayers, CATS, CAT_LABEL, POOL } from '../public/model.js';
import { schedule, clock, keeperAdjustedAdp, survives, needs } from '../public/draft.js';
import { openSlots, matchSlots } from '../public/model.js';

const FILE = process.env.TIPOFF_STATE_FILE || '/srv/benloe/data/tipoff/state.json';
const S = JSON.parse(readFileSync(FILE, 'utf8'));
const { players } = JSON.parse(readFileSync(new URL('../public/players.json', import.meta.url)));
const league = JSON.parse(readFileSync(new URL('../public/league.json', import.meta.url)));
const age = Math.round((Date.now() - statSync(FILE).mtimeMs) / 1000);

const all = valuePlayers(players, { punts: S.punts }).players;
const byId = new Map(all.map((p) => [p.id, p]));
const marked = new Set(S.marks.map((m) => m.id));
const mine = S.marks.filter((m) => m.mine).map((m) => byId.get(m.id)).filter(Boolean);
const room = S.marks.filter((m) => !m.mine).map((m) => byId.get(m.id)).filter(Boolean);
const sched = schedule(league, S.settings);
const clk = clock(sched, S.marks, S.offset);
const hIdx = clk.horizon ? clk.idx(clk.horizon.at) : null;
const adj = keeperAdjustedAdp(players, new Set(league.keepers.map((k) => k.playerId)));
const need = needs(mine, room, S.punts);
const line = all[POOL - 1].value;

console.log(`pushed ${age}s ago · punts: ${S.punts.map((c) => CAT_LABEL[c]).join('+') || 'none'} · offset ${S.offset}`);
console.log(`ON THE CLOCK: #${clk.now} (R${Math.ceil(clk.now / 12)})${clk.onClock ? '  <-- BEN' : ''} · Ben next #${clk.next?.at} · then #${clk.horizon?.at}`);
console.log(`\nLast 12 taken: ${S.marks.filter((m) => !m.keeper).slice(-12).map((m) => (m.mine ? '*' : '') + (byId.get(m.id)?.name ?? m.id)).join(', ')}`);
console.log(`\nBen's roster (${mine.length}):`);
for (const { slot, player } of matchSlots(mine)) console.log(`  ${slot.padEnd(5)} ${player ? player.name : '-- open --'}`);
const used = new Set(matchSlots(mine).filter((x) => x.player).map((x) => x.player.id));
console.log(`  bench ${mine.filter((p) => !used.has(p.id)).map((p) => p.name).join(', ') || '-'}`);
console.log('\nCategory need weights:', Object.fromEntries(CATS.map((c) => [CAT_LABEL[c], need.w[c]])));
console.log('\nBest available (value · fit · survive-to-next · market):');
const fitOf = (p) => CATS.reduce((s, c) => s + need.w[c] * p.z[c], 0) * (p.perGame > 0 ? p.value / p.perGame : 1);
for (const p of all.filter((p) => !marked.has(p.id)).slice(0, 25)) {
  const sv = survives(adj.get(p.id), clk.made, hIdx);
  console.log(`  ${String(p.rank).padStart(3)} ${p.name.padEnd(26)} ${p.pos.join('/').padEnd(11)} v${p.value.toFixed(1).padStart(5)} f${fitOf(p).toFixed(1).padStart(5)}  ${sv == null ? '  -' : String(Math.round(sv * 100)).padStart(3) + '%'}  mkt ${Math.round(adj.get(p.id) ?? 0)}${p.injury ? '  ' + p.injury : ''}  [${CATS.filter((c) => !S.punts.includes(c)).map((c) => CAT_LABEL[c] + ' ' + p.z[c].toFixed(1)).join(', ')}]`);
}
console.log('\nStarter-grade left by position (now -> at Ben\'s horizon):');
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  const pool = all.filter((p) => !marked.has(p.id) && p.pos.includes(pos) && p.value >= line);
  console.log(`  ${pos}: ${pool.length} -> ${Math.round(pool.reduce((s, p) => s + (survives(adj.get(p.id), clk.made, hIdx) ?? 1), 0))}`);
}
console.log(`\nOpen starting slots: ${openSlots(mine).join(', ') || 'none'}`);
