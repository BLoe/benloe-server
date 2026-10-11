// The value engine. Pure: no DOM, no network. Shared by the board and by
// scripts/analyze.mjs and the tests, so there is one definition of "value".

export const TEAMS = 12;
export const ROUNDS = 16; // 16 non-IL roster spots
export const CATS = ['fgm', 'fgp', 'ftp', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk'];
export const CAT_LABEL = { fgm: 'FGM', fgp: 'FG%', ftp: 'FT%', tpm: '3PM', pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'ST', blk: 'BLK' };
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
// Yahoo roster: PG, SG, G, SF, PF, F, C, C, Util, Util + 6 BN + 2 IL.
export const SLOTS = [
  { id: 'PG', fits: ['PG'] },
  { id: 'SG', fits: ['SG'] },
  { id: 'G', fits: ['PG', 'SG'] },
  { id: 'SF', fits: ['SF'] },
  { id: 'PF', fits: ['PF'] },
  { id: 'F', fits: ['SF', 'PF'] },
  { id: 'C', fits: ['C'] },
  { id: 'C', fits: ['C'] },
  { id: 'Util', fits: POSITIONS },
  { id: 'Util', fits: POSITIONS },
];

// The baseline the z-scores are measured against: roughly every active
// starter in the league. Measuring against all 345 projected players would
// make every rotation player look like a star.
export const POOL = TEAMS * 13;
const FULL_SEASON = 72; // what ESPN projects for a healthy starter

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) || 1;
};

// One category's raw per-game number for a player, given pool shooting
// averages for the percentage categories. A percentage is worth its distance
// from the pool average times the volume behind it: 60% on 4 shots moves a
// week less than 52% on 18.
function raw(s, cat, lg) {
  if (cat === 'fgp') return s.fga ? (s.fgm / s.fga - lg.fgp) * s.fga : 0;
  if (cat === 'ftp') return s.fta ? (s.ftm / s.fta - lg.ftp) * s.fta : 0;
  return s[cat];
}

function zTable(players, pool, L) {
  const lg = {
    fgp: pool.reduce((a, p) => a + L(p).fgm, 0) / pool.reduce((a, p) => a + L(p).fga, 0),
    ftp: pool.reduce((a, p) => a + L(p).ftm, 0) / pool.reduce((a, p) => a + L(p).fta, 0),
  };
  const stats = {};
  for (const c of CATS) {
    const xs = pool.map((p) => raw(L(p), c, lg));
    stats[c] = { m: mean(xs), s: sd(xs) };
  }
  const z = new Map();
  for (const p of players) {
    const row = {};
    for (const c of CATS) row[c] = (raw(L(p), c, lg) - stats[c].m) / stats[c].s;
    z.set(p.id, row);
  }
  return { z, lg };
}

/**
 * Value every player.
 *   punts      — categories to ignore (weight 0)
 *   gpWeight   — 0 ranks purely per game; 1 scales value fully by projected
 *                games. Weekly H2H punishes missed games, but not as hard as
 *                a season-total roto league does, so the default is between.
 *   weights    — per-category multipliers for partial emphasis (punts win)
 *   line       — which stat line to value; the blend by default, or one
 *                source's (players without that source are dropped).
 */
export function valuePlayers(all, { punts = [], weights = null, gpWeight = 0.5, line = (p) => p.proj } = {}) {
  const L = line;
  const players = all.filter((p) => L(p));
  // weights: optional partial emphasis, e.g. { fgp: 0.5 }; a punt is weight 0.
  const w = Object.fromEntries(CATS.map((c) => [c, punts.includes(c) ? 0 : (weights?.[c] ?? 1)]));
  const score = (row) => CATS.reduce((s, c) => s + w[c] * row[c], 0);
  const avail = (p) => 1 - gpWeight + gpWeight * Math.min(1, L(p).gp / FULL_SEASON);

  // Two passes: the pool is "the best POOL players", which depends on value.
  const box = (p) => L(p).pts + L(p).reb + L(p).ast;
  let pool = [...players].sort((a, b) => box(b) - box(a)).slice(0, POOL);
  let table;
  for (let i = 0; i < 2; i++) {
    table = zTable(players, pool, L);
    pool = [...players].sort((a, b) => score(table.z.get(b.id)) - score(table.z.get(a.id))).slice(0, POOL);
  }
  table = zTable(players, pool, L);

  const out = players.map((p) => {
    const z = table.z.get(p.id);
    const perGame = score(z);
    // Scale only the part above zero: a negative player missing games is not
    // made "less bad" by it.
    const value = perGame > 0 ? perGame * avail(p) : perGame;
    return { ...p, z, perGame, value };
  });
  out.sort((a, b) => b.value - a.value);
  out.forEach((p, i) => (p.rank = i + 1));
  return { players: out, league: table.lg };
}

/**
 * Tier breaks over a value-sorted list. A gap opens a new tier when it is
 * large relative to the gaps AROUND it: the top of a board is steep and the
 * tail is flat, so any single threshold either makes every star a tier of one
 * or never fires in the tail. The window median sets the local scale.
 */
export function tiers(sorted, depth = sorted.length, k = 1.9, win = 6) {
  const n = Math.min(depth, sorted.length);
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(sorted[i - 1].value - sorted[i].value);
  const out = new Map();
  let t = 1;
  let size = 0;
  sorted.forEach((p, i) => {
    if (i >= n) return out.set(p.id, 0);
    if (i > 0 && size >= 2) {
      const g = gaps[i - 1];
      const around = gaps.slice(Math.max(0, i - 1 - win), i - 1 + win + 1).sort((x, y) => x - y);
      const med = around[around.length >> 1];
      if (g > k * med && g > 0.08) (t++, (size = 0));
    }
    size++;
    out.set(p.id, t);
  });
  return out;
}

/** Overall pick number for a round and an original draft slot (1-12), snake. */
export const overall = (round, slot) => (round - 1) * TEAMS + (round % 2 ? slot : TEAMS + 1 - slot);

/**
 * The chance a player is still there at pick `at`, given the board is at pick
 * `now`. ADP is a rough mean; the spread widens with it. Normal approximation,
 * and only ever displayed as a coarse label.
 */
export function survival(adp, now, at) {
  if (adp == null) return 1;
  if (at <= now) return 1;
  const s = 2 + 0.22 * adp;
  const x = (at - 0.5 - adp) / s; // P(picked before `at`)
  const before = 0.5 * (1 + erf(x / Math.SQRT2));
  // Condition on having survived until now.
  const xNow = (now - 0.5 - adp) / s;
  const beforeNow = 0.5 * (1 + erf(xNow / Math.SQRT2));
  if (beforeNow >= 0.999) return 0.5; // past ADP already: a coin flip, not a certainty
  return Math.max(0, Math.min(1, (1 - before) / (1 - beforeNow)));
}

function erf(x) {
  // Abramowitz-Stegun 7.1.26; plenty for a three-bucket label.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/**
 * The starting slots a roster cannot fill, by maximum bipartite matching of
 * players to slots (Kuhn's augmenting paths). Ten slots, sixteen men: instant.
 */
// Placement preference: the two C-only slots first (the scarce ones), then
// single-position slots, then G/F, then Util last.
const PREFER = [6, 7, 0, 1, 3, 4, 2, 5, 8, 9];

export function matchSlots(roster) {
  const owner = new Array(SLOTS.length).fill(-1);
  const tryPlace = (pi, seen) => {
    for (const si of PREFER) {
      if (seen[si] || !roster[pi].pos.some((x) => SLOTS[si].fits.includes(x))) continue;
      seen[si] = true;
      if (owner[si] === -1 || tryPlace(owner[si], seen)) {
        owner[si] = pi;
        return true;
      }
    }
    return false;
  };
  for (let pi = 0; pi < roster.length; pi++) tryPlace(pi, []);
  return SLOTS.map((s, si) => ({ slot: s.id, player: owner[si] === -1 ? null : roster[owner[si]] }));
}

export const openSlots = (roster) => matchSlots(roster).filter((x) => !x.player).map((x) => x.slot);

/** Category totals of a roster's z-scores. */
export function profile(roster) {
  const out = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (const p of roster) for (const c of CATS) out[c] += p.z[c];
  return out;
}
