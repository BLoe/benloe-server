// Live draft state. Pure: everything here is a function of the marks, the
// settings and the league file, so the board can be rebuilt from localStorage.
import { TEAMS, ROUNDS, CATS, overall, survival, openSlots } from './model.js';

export const TOTAL_PICKS = TEAMS * ROUNDS;
const OWN_ROUNDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16]; // 10-12 were sold
export const EXTRA_ROUNDS = [3, 6, 8];

/**
 * Pick numbers as Yahoo prints them: "34" (overall) or "3.10" (round 3, the
 * tenth pick of that round — Yahoo numbers within a round in draft order, so
 * the snake is already applied). Commas, spaces or newlines between.
 */
export function parsePicks(text) {
  const out = [];
  for (const t of String(text ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const m = t.match(/^(\d+)[.\-/](\d+)$/);
    const n = m ? (Number(m[1]) - 1) * TEAMS + Number(m[2]) : Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= TOTAL_PICKS && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Where every pick that matters to us falls.
 *  - our picks, own and extra, with the two keeper picks flagged
 *  - every keeper pick in the league whose position is known (needs the
 *    draft order); those picks are filled before the draft and are skipped
 *    by the room, so the pick counter must skip them too.
 * Picks are traded all over this league, so either half can instead be typed
 * straight from Yahoo (settings.myPicksText / keeperPicksText). Typed numbers
 * win: trades between other teams never change WHEN a pick happens, only who
 * makes it, which the board does not track.
 */
export function schedule(league, settings) {
  const order = settings.order ?? [];
  const slotOf = (team) => {
    const i = order.indexOf(team);
    return i === -1 ? null : i + 1;
  };
  const mySlot = slotOf(league.me);
  const mine = [];
  if (mySlot) {
    for (const r of OWN_ROUNDS) mine.push({ round: r, at: overall(r, mySlot), from: null });
    for (const r of EXTRA_ROUNDS) {
      const s = slotOf(settings.extraFrom?.[r]);
      mine.push({ round: r, at: s ? overall(r, s) : null, from: settings.extraFrom?.[r] || null });
    }
  }
  // Our keepers: George takes our 13th; Flagg one of our two 3rds.
  const keeperPicks = new Map(); // overall pick -> keeper entry
  for (const k of league.keepers) {
    if (!k.round) continue;
    if (k.mine) {
      const cands = mine.filter((m) => m.round === k.round);
      const own = cands.find((m) => !m.from);
      const extra = cands.find((m) => m.from);
      const m = k.round === 3 && settings.flaggPick === 'extra' && extra ? extra : own;
      if (m) {
        m.keeper = k;
        if (m.at) keeperPicks.set(m.at, k);
      }
    } else {
      const s = slotOf(k.team);
      if (s) keeperPicks.set(overall(k.round, s), k);
    }
  }
  // Typed from Yahoo: our live picks, and every keeper-filled pick.
  // What Ben typed wins; otherwise the grid read off his Yahoo screenshots.
  const typedMine = parsePicks(settings.myPicksText || league.yahooPicks?.mine);
  if (typedMine.length) {
    const keepers = mine.filter((m) => m.keeper);
    mine.length = 0;
    for (const at of typedMine) mine.push({ round: Math.ceil(at / TEAMS), at, from: null, typed: true });
    // Our keepers still show in the list; where they sit only matters to the
    // counter, which the typed keeper list (or the order) covers.
    for (const k of league.keepers.filter((x) => x.mine)) {
      const placed = keepers.find((m) => m.keeper === k);
      const fromGrid = parsePicks(league.yahooPicks?.keeperAt?.[k.name])[0];
      mine.push({ round: k.round, at: fromGrid ?? (placed?.at && !typedMine.includes(placed.at) ? placed.at : null), keeper: k, from: null });
    }
  }
  const typedKeepers = parsePicks(settings.keeperPicksText || league.yahooPicks?.keepers);
  if (typedKeepers.length) {
    keeperPicks.clear();
    for (const at of typedKeepers) keeperPicks.set(at, { name: 'keeper', round: Math.ceil(at / TEAMS) });
    for (const m of mine) if (m.keeper && m.at && !keeperPicks.has(m.at)) m.at = null;
  }
  mine.sort((a, b) => (a.at ?? 999) - (b.at ?? 999) || a.round - b.round);
  // The room's sequence: every pick not already filled by a keeper.
  const seq = [];
  for (let i = 1; i <= TOTAL_PICKS; i++) if (!keeperPicks.has(i)) seq.push(i);
  return {
    mySlot,
    mine,
    keeperPicks,
    seq,
    known: !!mySlot || typedMine.length > 0, // do we know our own picks at all
    typedMine: typedMine.length > 0,
    typedKeepers: typedKeepers.length,
    orderComplete: order.filter(Boolean).length === TEAMS,
  };
}

/** The pick on the clock, and our next two live picks. */
export function clock(sched, marks, offset) {
  const made = marks.filter((m) => !m.keeper).length + (offset || 0);
  const now = sched.seq[Math.max(0, made)] ?? null; // overall number on the clock
  const live = sched.mine.filter((m) => !m.keeper && m.at && now && m.at >= now);
  const onClock = !!(live[0] && live[0].at === now);
  // The horizon is the next time we choose AFTER the current decision.
  const horizon = onClock ? live[1] : live[0];
  const idx = (at) => (at == null ? null : sched.seq.indexOf(at));
  return { made: Math.max(0, made), now, onClock, next: live[0] ?? null, horizon: horizon ?? null, idx, live };
}

/**
 * ADP sources rank a league with no keepers. Here every keeper is gone before
 * pick one, so everyone behind them goes that much sooner.
 */
export function keeperAdjustedAdp(players, keeperIds) {
  const keptAdps = players.filter((p) => keeperIds.has(p.id) && p.adp).map((p) => p.adp).sort((a, b) => a - b);
  const out = new Map();
  for (const p of players) {
    if (p.adp == null) continue;
    let ahead = 0;
    while (ahead < keptAdps.length && keptAdps[ahead] < p.adp) ahead++;
    out.set(p.id, Math.max(1, p.adp - ahead));
  }
  return out;
}

/** Chance the player is still there at our horizon, in room-sequence terms. */
export function survives(adjAdp, made, horizonIdx) {
  if (adjAdp == null || horizonIdx == null) return null;
  return survival(adjAdp, made + 1, horizonIdx + 1);
}

/**
 * Category needs: our roster against the room's average drafted player,
 * scaled to our roster size. The weakest live categories get leaned into and
 * the strongest eased off. Punted categories are not needs.
 */
export function needs(mineValued, roomValued, punts) {
  const w = Object.fromEntries(CATS.map((c) => [c, 1]));
  if (mineValued.length < 2 || roomValued.length < 6) return { w, rel: null };
  const rel = {};
  for (const c of CATS) {
    const avg = roomValued.reduce((s, p) => s + p.z[c], 0) / roomValued.length;
    rel[c] = mineValued.reduce((s, p) => s + p.z[c], 0) - avg * mineValued.length;
  }
  const live = CATS.filter((c) => !punts.includes(c)).sort((a, b) => rel[a] - rel[b]);
  live.slice(0, 3).forEach((c) => (w[c] = 1.35));
  live.slice(-2).forEach((c) => (w[c] = 0.75));
  for (const c of punts) w[c] = 0;
  return { w, rel };
}

export function fit(p, w) {
  const scale = p.perGame > 0 ? p.value / p.perGame : 1;
  return CATS.reduce((s, c) => s + w[c] * p.z[c], 0) * scale;
}

/** Does adding this player fill a starting slot we cannot fill today? */
export function fillsSlot(roster, p) {
  return openSlots([...roster, p]).length < openSlots(roster).length;
}
