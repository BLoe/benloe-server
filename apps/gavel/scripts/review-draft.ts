/**
 * Post-draft review, read from the platform rather than from Gavel's board.
 *
 * Deliberately NOT sourced from the app's own pick log: that log is typed by a
 * human during a live auction and is known to drift — mis-entered prices, and
 * whole runs of $1 players skipped once they start going faster than anyone can
 * type. The platform's record is authoritative. Gavel's board is for making
 * decisions in the moment; this is for finding out what actually happened.
 *
 * Every valuation below is Gavel's own frozen pre-draft board, so "surplus"
 * means "against what we said beforehand" — not against hindsight.
 *
 *   npm run review -- <draftId> <snapshot-slug>
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDraftPicks } from '../src/sources/sleeper.js';
import type { PlayerValue } from '../src/lib/valuation.js';
import type { LeagueConfig, Position } from '../src/lib/league.js';

const DATA_DIR = process.env.GAVEL_DATA_DIR || '/srv/benloe/data/gavel';

interface Roster {
  owner: string;
  picks: Array<{ value: PlayerValue | null; name: string; position: string; price: number }>;
}

/**
 * The best legal starting lineup from a roster.
 *
 * Fill each fixed slot with the best available at that position, then hand the
 * flex to the best eligible player still on the bench. Greedy is exact here
 * because the flex is the only slot with a choice.
 */
function bestLineup(
  picks: Roster['picks'],
  cfg: LeagueConfig
): { starters: number; bench: number; used: Set<string> } {
  const byPos = new Map<string, typeof picks>();
  for (const p of picks) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position)!.push(p);
  }
  for (const list of byPos.values()) list.sort((a, b) => (b.value?.points ?? 0) - (a.value?.points ?? 0));

  const used = new Set<string>();
  let starters = 0;
  const fixed: Array<[Position, number]> = [
    ['QB', cfg.slots.QB],
    ['RB', cfg.slots.RB],
    ['WR', cfg.slots.WR],
    ['TE', cfg.slots.TE],
    ['DEF', cfg.slots.DEF],
  ];
  for (const [pos, n] of fixed) {
    for (const p of (byPos.get(pos) ?? []).slice(0, n)) {
      used.add(p.name);
      starters += p.value?.points ?? 0;
    }
  }
  for (let i = 0; i < cfg.slots.FLEX; i++) {
    const candidates = ['RB', 'WR', 'TE']
      .flatMap((pos) => byPos.get(pos) ?? [])
      .filter((p) => !used.has(p.name))
      .sort((a, b) => (b.value?.points ?? 0) - (a.value?.points ?? 0));
    if (candidates[0]) {
      used.add(candidates[0].name);
      starters += candidates[0].value?.points ?? 0;
    }
  }
  const bench = picks.filter((p) => !used.has(p.name)).reduce((s, p) => s + (p.value?.points ?? 0), 0);
  return { starters: Math.round(starters), bench: Math.round(bench), used };
}

async function main() {
  const draftId = process.argv[2];
  const slug = process.argv[3] || 'columbus';
  if (!draftId) {
    console.error('usage: npm run review -- <draftId> <snapshot-slug>');
    process.exit(1);
  }

  const snap = JSON.parse(await readFile(join(DATA_DIR, `snapshot-${slug}.json`), 'utf8'));
  const cfg: LeagueConfig = snap.league;
  const values: PlayerValue[] = snap.values;
  const byId = new Map(values.map((v) => [v.id, v]));
  const teamName = new Map<string, string>(
    (snap.teams ?? []).map((t: any) => [t.teamId, t.name])
  );

  const picks = await getDraftPicks(draftId);
  const rosters = new Map<string, Roster>();
  for (const p of picks) {
    const md = p.metadata ?? {};
    const price = Number(md.amount);
    if (!Number.isFinite(price)) continue;
    const owner = p.picked_by ?? 'unknown';
    if (!rosters.has(owner)) rosters.set(owner, { owner, picks: [] });
    rosters.get(owner)!.picks.push({
      value: byId.get(p.player_id) ?? null,
      name: `${md.first_name ?? ''} ${md.last_name ?? ''}`.trim() || p.player_id,
      position: md.position ?? '??',
      price,
    });
  }

  const rows = [...rosters.values()].map((r) => {
    const spent = r.picks.reduce((s, p) => s + p.price, 0);
    const projected = r.picks.reduce((s, p) => s + (p.value?.baseValue ?? 0), 0);
    const { starters, bench, used } = bestLineup(r.picks, cfg);
    const posSpend: Record<string, number> = {};
    for (const p of r.picks) posSpend[p.position] = (posSpend[p.position] ?? 0) + p.price;
    const graded = r.picks.filter((p) => p.value && p.value.baseValue > 0);
    const sorted = [...graded].sort(
      (a, b) => (b.value!.baseValue - b.price) - (a.value!.baseValue - a.price)
    );
    return {
      name: teamName.get(r.owner) ?? r.owner,
      spent,
      surplus: Math.round(projected - spent),
      starters,
      bench,
      posSpend,
      best: sorted[0],
      worst: sorted[sorted.length - 1],
      unpriced: r.picks.filter((p) => !p.value).length,
    };
  });

  rows.sort((a, b) => b.starters - a.starters);

  console.log(`\n${cfg.name} — ${picks.length} picks, $${rows.reduce((s, r) => s + r.spent, 0)} spent`);
  console.log(`Valued against Gavel's pre-draft board (calibrated on ${snap.calibration?.seasons?.join(', ') ?? 'nothing'}).\n`);

  console.log('  # TEAM                       SPENT  STARTERS  BENCH  SURPLUS   QB  RB  WR  TE DEF');
  rows.forEach((r, i) => {
    const p = (k: string) => String(r.posSpend[k] ?? 0).padStart(3);
    console.log(
      `  ${String(i + 1).padStart(2)} ${r.name.slice(0, 26).padEnd(26)} ` +
        `$${String(r.spent).padStart(4)} ${String(r.starters).padStart(9)} ` +
        `${String(r.bench).padStart(6)} ${(r.surplus >= 0 ? '+' : '') + r.surplus}`.padEnd(9) +
        ` ${p('QB')} ${p('RB')} ${p('WR')} ${p('TE')} ${p('DEF')}`
    );
  });

  console.log('\n  best and worst buy on each roster, against the board:');
  for (const r of rows) {
    const b = r.best;
    const w = r.worst;
    if (!b || !w) continue;
    console.log(
      `    ${r.name.slice(0, 26).padEnd(26)} ` +
        `+${Math.round(b.value!.baseValue - b.price)} ${b.name} ($${b.price} vs $${Math.round(b.value!.baseValue)})` +
        `   /   ${Math.round(w.value!.baseValue - w.price)} ${w.name} ($${w.price} vs $${Math.round(w.value!.baseValue)})`
    );
  }

  const all = [...rosters.values()].flatMap((r) => r.picks).filter((p) => p.value && p.value.baseValue > 0);
  const bargains = [...all].sort((a, b) => (b.value!.baseValue - b.price) - (a.value!.baseValue - a.price));
  console.log('\n  biggest bargains in the room:');
  for (const p of bargains.slice(0, 8)) {
    console.log(`    +${String(Math.round(p.value!.baseValue - p.price)).padStart(3)}  ${p.name} (${p.position}) $${p.price} vs $${Math.round(p.value!.baseValue)}`);
  }
  console.log('\n  biggest overpays in the room:');
  for (const p of bargains.slice(-8).reverse()) {
    console.log(`    ${String(Math.round(p.value!.baseValue - p.price)).padStart(4)}  ${p.name} (${p.position}) $${p.price} vs $${Math.round(p.value!.baseValue)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
