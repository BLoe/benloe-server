/**
 * Freeze every upstream into fixtures/ so tests and screenshots never touch the
 * network.
 *
 * Run with `npm run capture`. Third-party payloads are trimmed to the players
 * this league actually rosters plus a healthy margin, because a full snap-count
 * CSV is megabytes and none of it is needed to prove a parser works.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/lib/sleeper.js';
import { fetchText, fetchJson } from '../src/lib/sources/http.js';
import { normaliseName } from '../src/lib/sources/nflverse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures');

const LEAGUE = process.env.CAPTURE_LEAGUE || '1312065694577209344';
const USER = process.env.CAPTURE_USER || 'BenLoe';
// The last season with published nflverse data. In the preseason this is the
// season before the league's, which is exactly what resolveUsageSeason picks.
const SEASON = process.env.CAPTURE_SEASON || '2025';

const save = async (name: string, value: unknown) => {
  await mkdir(FIXTURES, { recursive: true });
  const path = join(FIXTURES, `${name}.json`);
  const body = JSON.stringify(value);
  await writeFile(path, body);
  console.log(`  ${name.padEnd(28)} ${(body.length / 1024).toFixed(0)}kb`);
};

async function main() {
  console.log('Sleeper:');
  const [state, user, league, rosters, users, players] = await Promise.all([
    S.getState(),
    S.getUser(USER),
    S.getLeague(LEAGUE),
    S.getRosters(LEAGUE),
    S.getLeagueUsers(LEAGUE),
    S.getAllPlayers(),
  ]);
  await save('state', state);
  await save('user', user);
  await save('league', league);
  await save('rosters', rosters);
  await save('users', users);
  await save('leagues', await S.getUserLeagues(user.user_id, league.season));

  // Everyone rostered anywhere in this league, plus who the fixtures need.
  const rostered = new Set<string>(
    rosters.flatMap((r: any) => [...(r.players ?? []), ...(r.taxi ?? []), ...(r.reserve ?? [])])
  );

  // Slim the 14MB player dump down to the rostered set plus the top free agents
  // by search rank, so waiver-wire views have something real to show.
  const ranked = Object.entries(players as Record<string, any>)
    .filter(([, p]) => p.active && p.team && ['QB', 'RB', 'WR', 'TE'].includes(p.position))
    .sort((a, b) => (a[1].search_rank ?? 9e9) - (b[1].search_rank ?? 9e9))
    .slice(0, 400)
    .map(([id]) => id);
  for (const id of ranked) rostered.add(id);

  const slim: Record<string, any> = {};
  for (const id of rostered) if ((players as any)[id]) slim[id] = (players as any)[id];
  await save('players', slim);

  const schedule: Record<number, any> = {};
  for (let w = 1; w <= 14; w++) {
    const wk = await S.getMatchups(LEAGUE, w).catch(() => []);
    if (!wk?.length) break;
    schedule[w] = wk;
  }
  await save('schedule', schedule);

  const projections = await S.getProjections(league.season, null).catch(() => []);
  await save(
    'projections',
    projections.filter((p: any) => rostered.has(String(p.player_id)))
  );

  console.log('FantasyCalc:');
  const fc = await fetchJson<any[]>(
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=0',
    30_000
  );
  await save('fantasycalc', fc);

  console.log('KeepTradeCut:');
  // Stored as raw HTML: the parser's whole job is surviving this page's shape,
  // so a pre-parsed fixture would test nothing.
  const ktcHtml = await fetchText('https://keeptradecut.com/dynasty-rankings', 30_000);
  const inline = ktcHtml.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
  await save('ktc-inline', inline ? inline[0] : '');

  console.log('nflverse:');
  const names = new Set([...rostered].map((id) => normaliseName((players as any)[id]?.full_name ?? '')));
  const RELEASE = 'https://github.com/nflverse/nflverse-data/releases/download';

  for (const [name, url, nameCol] of [
    ['snap-counts', `${RELEASE}/snap_counts/snap_counts_${SEASON}.csv`, 'player'],
    ['usage', `${RELEASE}/stats_player/stats_player_week_${SEASON}.csv`, 'player_display_name'],
    ['injuries', `${RELEASE}/injuries/injuries_${SEASON}.csv`, 'full_name'],
  ] as const) {
    const csv = await fetchText(url, 90_000);
    const lines = csv.split('\n');
    const header = lines[0];
    const col = header.split(',').indexOf(nameCol);
    // Keep the header plus only rows naming a player this league cares about.
    const kept = [header];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      if (col >= 0 && names.has(normaliseName(cells[col] ?? ''))) kept.push(lines[i]);
    }
    await save(name, kept.join('\n'));
  }

  console.log('\ndone');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
