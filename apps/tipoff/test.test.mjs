import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overall, openSlots, valuePlayers, tiers, survival } from './public/model.js';
import { schedule, clock, keeperAdjustedAdp, parsePicks } from './public/draft.js';

const real = JSON.parse(readFileSync(new URL('./public/league.json', import.meta.url)));
// The order-derived path, as if no Yahoo grid had been read.
const league = { ...real, yahooPicks: undefined };
const { players } = JSON.parse(readFileSync(new URL('./public/players.json', import.meta.url)));
const order = ['Florio/Avi', 'Tim Doyle', 'Garrett', 'John M', 'Mike S', 'Ben M', 'Aaron M', 'Thomas H', 'Joe M', 'Ben Loe', 'John L', 'Joe C'];
const settings = { order, extraFrom: { 3: 'Garrett', 6: 'Mike S', 8: 'Joe C' }, flaggPick: 'own' };

test('snake: slot 1 picks 1, 24, 25; slot 12 picks 12, 13', () => {
  assert.deepEqual([1, 2, 3].map((r) => overall(r, 1)), [1, 24, 25]);
  assert.deepEqual([1, 2].map((r) => overall(r, 12)), [12, 13]);
});

test('our picks: 16 rounds worth, none in 10-12, two keepers flagged', () => {
  const s = schedule(league, settings);
  assert.equal(s.mySlot, 10);
  assert.equal(s.mine.length, 16);
  assert.ok(!s.mine.some((m) => m.round >= 10 && m.round <= 12));
  const kept = s.mine.filter((m) => m.keeper).map((m) => [m.round, m.at]);
  assert.deepEqual(kept, [[3, overall(3, 10)], [13, overall(13, 10)]]);
  assert.equal(s.mine.find((m) => m.round === 3 && m.from).at, overall(3, 3)); // Garrett's 3rd
});

test('keeper picks are skipped by the counter, so it matches the room', () => {
  const s = schedule(league, settings);
  assert.equal(s.keeperPicks.size, league.keepers.length);
  assert.equal(s.seq.length, 192 - league.keepers.length);
  // Garrett keeps Tatum in round 5: that pick never comes up on the clock.
  const tatum = overall(5, 3);
  assert.ok(!s.seq.includes(tatum));
});

test('clock: pick 1 with no marks; on the clock at our first pick', () => {
  const s = schedule(league, settings);
  const keepers = league.keepers.map((k) => ({ id: k.playerId, keeper: true }));
  assert.equal(clock(s, keepers, 0).now, 1);
  const c = clock(s, keepers, 9);
  assert.equal(c.now, 10);
  assert.ok(c.onClock);
  assert.equal(c.horizon.at, 15);
});

test('flagg on the extra 3rd frees our own 3rd', () => {
  const s = schedule(league, { ...settings, flaggPick: 'extra' });
  const r3 = s.mine.filter((m) => m.round === 3);
  assert.equal(r3.find((m) => m.keeper).from, 'Garrett');
  assert.ok(!r3.find((m) => !m.keeper).from);
});

test('two C-only slots: a roster of guards leaves both C open', () => {
  const g = (id) => ({ id, pos: ['PG', 'SG'] });
  assert.deepEqual(openSlots([g(1), g(2), g(3), g(4), g(5)]).filter((s) => s === 'C').length, 2);
  // A C/PF fills C before PF when only he can.
  const open = openSlots([{ id: 1, pos: ['PF', 'C'] }]);
  assert.equal(open.filter((s) => s === 'C').length, 1);
});

test('values: the blend ranks the obvious top tier near the top', () => {
  const top = valuePlayers(players).players.slice(0, 6).map((p) => p.name);
  assert.ok(top.includes('Nikola Jokic'));
  assert.ok(top.includes('Shai Gilgeous-Alexander'));
});

test('punting a category zeroes it out of value', () => {
  const a = valuePlayers(players, { punts: ['fgp'] }).players.find((p) => p.name === 'Kyshawn George');
  const b = valuePlayers(players).players.find((p) => p.name === 'Kyshawn George');
  assert.ok(a.rank < b.rank, 'a poor-FG% player rises when FG% is punted');
});

test('tiers: the top of the board is not all singletons', () => {
  const v = valuePlayers(players).players;
  const t = tiers(v, 192);
  const firstTwenty = new Set(v.slice(0, 20).map((p) => t.get(p.id)));
  assert.ok(firstTwenty.size < 15);
});

test('keepers pull everyone behind them earlier', () => {
  const ids = new Set(league.keepers.map((k) => k.playerId));
  const adj = keeperAdjustedAdp(players, ids);
  const p = players.find((x) => x.adp > 150);
  assert.ok(adj.get(p.id) < p.adp - 15);
});

test('survival: falls as the horizon moves past ADP', () => {
  assert.ok(survival(40, 10, 20) > 0.9);
  assert.ok(survival(40, 10, 60) < 0.2);
});

test('parsePicks: overall numbers and Yahoo round.pick, deduped and sorted', () => {
  assert.deepEqual(parsePicks('34, 3.10\n10 2.3; 999 x'), [10, 15, 34]);
});

test('typed picks beat the computed schedule, with no draft order at all', () => {
  const typed = '7 18 31 35 43 55 66 70 79 90 102 159 162 183';
  const s = schedule(league, { order: Array(12).fill(''), myPicksText: typed, keeperPicksText: '30 41 52' });
  assert.ok(s.known);
  assert.deepEqual(s.mine.filter((m) => !m.keeper).map((m) => m.at), parsePicks(typed));
  assert.equal(s.mine.filter((m) => m.keeper).length, 2);
  assert.equal(s.seq.length, 192 - 3);
  const c = clock(s, [], 6);
  assert.equal(c.now, 7);
  assert.ok(c.onClock);
  assert.equal(c.horizon.at, 18);
  // Counter steps over a typed keeper pick: 29 made -> pick 31, not 30.
  assert.equal(clock(s, [], 29).now, 31);
});

test('the Yahoo grid: our real picks, keepers placed, a 55-pick wait after #101', () => {
  const s = schedule(real, { order: Array(12).fill('') });
  assert.deepEqual(s.mine.filter((m) => !m.keeper).map((m) => m.at), [5, 20, 29, 44, 53, 62, 68, 77, 90, 92, 101, 164, 173, 188]);
  assert.deepEqual(s.mine.filter((m) => m.keeper).map((m) => [m.keeper.name, m.at]), [['Cooper Flagg', 31], ['Kyshawn George', 149]]);
  assert.equal(s.keeperPicks.size, 21);
  assert.equal(clock(s, [], 0).next.at, 5);
  const at101 = clock(s, [], s.seq.indexOf(101));
  assert.ok(at101.onClock);
  assert.equal(at101.horizon.at, 164);
  // What Ben types still wins over the grid.
  assert.equal(schedule(real, { order: [], myPicksText: '7 8' }).mine.filter((m) => !m.keeper)[0].at, 7);
});
