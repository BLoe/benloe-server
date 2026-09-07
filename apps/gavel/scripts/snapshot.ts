/**
 * Freeze a league's board to disk.
 *
 * Run this before a draft. After it has run, the app needs no network for
 * anything on the critical path. Re-running it before the draft picks up
 * roster/scoring changes and fresher projections; running it DURING a draft is
 * pointless at best, so the server never calls it on a request.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getLeague, getUsers, getDrafts, getProjections, getByeWeeks } from '../src/sources/sleeper.js';
import { leagueFromSleeper } from '../src/lib/seed.js';
import { scoreStatsRounded } from '../src/lib/scoring.js';
import { valueBoard, type PlayerProjection } from '../src/lib/valuation.js';
import { POSITIONS, type Position } from '../src/lib/league.js';

const DATA_DIR = process.env.GAVEL_DATA_DIR || '/srv/benloe/data/gavel';

function isPosition(value: string | null | undefined): value is Position {
  return !!value && (POSITIONS as readonly string[]).includes(value);
}

async function main() {
  const leagueId = process.argv[2];
  const slug = process.argv[3] || 'sleeper';
  if (!leagueId) {
    console.error('usage: npm run snapshot -- <sleeperLeagueId> [slug]');
    process.exit(1);
  }

  const [league, users, drafts] = await Promise.all([
    getLeague(leagueId),
    getUsers(leagueId),
    getDrafts(leagueId),
  ]);
  const auction = drafts.find((d) => d.type === 'auction') ?? drafts[0] ?? null;
  const cfg = leagueFromSleeper(league, auction?.settings ?? null, slug);

  const [projections, byes] = await Promise.all([
    getProjections(league.season),
    getByeWeeks(league.season),
  ]);

  const players: PlayerProjection[] = [];
  for (const row of projections) {
    const p = row.player;
    const pos = p?.fantasy_positions?.[0];
    if (!isPosition(pos)) continue;
    const points = scoreStatsRounded(row.stats, cfg.scoring);
    if (!Number.isFinite(points)) continue;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
    if (!name) continue;
    players.push({
      id: row.player_id,
      name,
      position: pos,
      team: p?.team ?? null,
      points,
      byeWeek: p?.team ? (byes[p.team] ?? null) : null,
      adp: row.stats?.adp_std ?? null,
      injury: p?.injury_status ?? null,
    });
  }

  const values = valueBoard(players, cfg);
  const teams = users.map((u) => ({
    teamId: u.user_id,
    name: u.metadata?.team_name || u.display_name,
  }));

  await mkdir(DATA_DIR, { recursive: true });
  const out = join(DATA_DIR, `snapshot-${slug}.json`);
  await writeFile(
    out,
    JSON.stringify(
      {
        capturedAt: Date.now(),
        league: cfg,
        draftStartTime: auction?.start_time ?? null,
        teams,
        values,
      },
      null,
      2
    )
  );

  console.log(`league     ${cfg.name} (${cfg.platform})`);
  console.log(`teams      ${cfg.teams} x $${cfg.budget}`);
  console.log(`slots      ${JSON.stringify(cfg.slots)}`);
  console.log(`players    ${players.length} projected, ${values.filter((v) => v.baseValue > 0).length} priced`);
  console.log(`wrote      ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
