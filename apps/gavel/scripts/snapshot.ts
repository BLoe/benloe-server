/**
 * Freeze a league's board to disk.
 *
 * Run this BEFORE a draft. Afterwards the app needs no network for anything on
 * the critical path; the server never calls this on a request, and re-running it
 * mid-draft is pointless.
 *
 * Two ways to name a league, because only one of the two platforms is readable:
 *
 *   npm run snapshot -- 1389704095224315904 columbus   # Sleeper league id
 *   npm run snapshot -- leagues/yahoo.json             # a definition file
 *
 * Projections come from Sleeper either way. They are projections of NFL
 * players, not of a fantasy platform, so a league Gavel cannot read is still
 * priced from the same source under its own scoring rules.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getLeague, getUsers, getDrafts, getProjections, getByeWeeks } from '../src/sources/sleeper.js';
import { leagueFromSleeper } from '../src/lib/seed.js';
import { buildBoard } from '../src/lib/board.js';
import type { LeagueConfig } from '../src/lib/league.js';

const DATA_DIR = process.env.GAVEL_DATA_DIR || '/srv/benloe/data/gavel';

interface Seeded {
  cfg: LeagueConfig;
  teams: Array<{ teamId: string; name: string }>;
  draftStartTime: number | null;
}

/** A league we can read: settings, managers and auction budget all come back. */
async function fromSleeper(leagueId: string, slug: string): Promise<Seeded> {
  const [league, users, drafts] = await Promise.all([
    getLeague(leagueId),
    getUsers(leagueId),
    getDrafts(leagueId),
  ]);
  const auction = drafts.find((d) => d.type === 'auction') ?? drafts[0] ?? null;
  return {
    cfg: leagueFromSleeper(league, auction?.settings ?? null, slug),
    teams: users.map((u) => ({
      teamId: u.user_id,
      name: u.metadata?.team_name || u.display_name,
    })),
    draftStartTime: auction?.start_time ?? null,
  };
}

/**
 * A league we cannot read, described by hand.
 *
 * Team names are placeholders on purpose — they are renamed in the app, which
 * is also where keeper salaries are entered. Nothing here needs to be right on
 * the first pass except the scoring map and the roster shape, because those two
 * are the only inputs to the money.
 */
async function fromFile(path: string): Promise<Seeded> {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const names: string[] = Array.isArray(raw.teamNames) ? raw.teamNames : [];
  const cfg: LeagueConfig = {
    id: raw.id,
    name: raw.name,
    platform: raw.platform ?? 'yahoo',
    platformLeagueId: raw.platformLeagueId ?? null,
    season: String(raw.season),
    teams: Number(raw.teams),
    budget: Number(raw.budget),
    minBid: Number(raw.minBid ?? 1),
    slots: raw.slots,
    scoring: raw.scoring,
  };
  return {
    cfg,
    teams: Array.from({ length: cfg.teams }, (_, i) => ({
      teamId: `t${i + 1}`,
      name: names[i] ?? `Team ${i + 1}`,
    })),
    draftStartTime: raw.draftStartTime ?? null,
  };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: npm run snapshot -- <sleeperLeagueId> <slug>');
    console.error('       npm run snapshot -- <path/to/league.json>');
    process.exit(1);
  }

  const seeded = target.endsWith('.json')
    ? await fromFile(target)
    : await fromSleeper(target, process.argv[3] || 'sleeper');
  const { cfg, teams, draftStartTime } = seeded;

  const [projections, byes] = await Promise.all([
    getProjections(cfg.season),
    getByeWeeks(cfg.season),
  ]);
  const { players, values } = buildBoard(projections, cfg, byes);

  await mkdir(DATA_DIR, { recursive: true });
  const out = join(DATA_DIR, `snapshot-${cfg.id}.json`);
  await writeFile(
    out,
    JSON.stringify({ capturedAt: Date.now(), league: cfg, draftStartTime, teams, values }, null, 2)
  );

  const priced = values.filter((v) => v.baseValue > 0);
  const total = priced.reduce((sum, v) => sum + v.baseValue, 0);
  console.log(`league     ${cfg.name} (${cfg.platform})`);
  console.log(`teams      ${cfg.teams} x $${cfg.budget}`);
  console.log(`slots      ${JSON.stringify(cfg.slots)}`);
  console.log(`players    ${players.length} projected, ${priced.length} priced`);
  console.log(`allocated  $${total.toFixed(0)} of $${cfg.teams * cfg.budget}`);
  console.log(`wrote      ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
