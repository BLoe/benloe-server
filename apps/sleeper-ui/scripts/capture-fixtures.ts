/**
 * Freeze real Sleeper responses to disk so the UI renders deterministically in dev,
 * screenshots are stable across runs, and tests have golden data.
 *
 *   npm run capture
 *
 * Writes fixtures/<name>.json. Safe to re-run; it overwrites.
 * Deliberately serial with a small delay — we are nowhere near the 1000/min limit
 * and there is no reason to hammer someone else's API.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../src/lib/sleeper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fixtures');

const USERNAME = 'BenLoe';

/** Leagues we snapshot. The 2025 dynasty season is the rich one — a full 17 weeks
 *  of real matchups — so it is what we develop and screenshot against. */
const LEAGUES = [
  { id: '1180168833027727360', season: '2025', label: 'dynasty-2025', weeks: 17 },
  { id: '1254603551611559936', season: '2025', label: 'auction-2025', weeks: 17 },
  { id: '1312065694577209344', season: '2026', label: 'dynasty-2026', weeks: 0 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function save(name: string, data: unknown) {
  const path = join(OUT, `${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
  const size = JSON.stringify(data).length;
  console.log(`  ✓ ${name}.json (${(size / 1024).toFixed(1)} KB)`);
  return data;
}

/** Try a capture, but never let one dead endpoint abort the whole run. */
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.log(`  ✗ ${label}: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log('state + user');
  await save('state', await S.getState());
  const user = await save('user', await S.getUser(USERNAME));
  const userId = (user as any).user_id;
  await sleep(120);

  for (const season of ['2026', '2025']) {
    await attempt(`leagues-${season}`, async () =>
      save(`leagues-${season}`, await S.getUserLeagues(userId, season))
    );
    await sleep(120);
  }

  for (const lg of LEAGUES) {
    console.log(`\nleague ${lg.label} (${lg.id})`);
    await attempt('league', async () => save(`${lg.label}.league`, await S.getLeague(lg.id)));
    await sleep(120);
    await attempt('rosters', async () => save(`${lg.label}.rosters`, await S.getRosters(lg.id)));
    await sleep(120);
    await attempt('users', async () => save(`${lg.label}.users`, await S.getLeagueUsers(lg.id)));
    await sleep(120);
    await attempt('traded_picks', async () =>
      save(`${lg.label}.traded_picks`, await S.getTradedPicks(lg.id))
    );
    await sleep(120);
    await attempt('winners_bracket', async () =>
      save(`${lg.label}.winners_bracket`, await S.getWinnersBracket(lg.id))
    );
    await sleep(120);
    await attempt('drafts', async () => save(`${lg.label}.drafts`, await S.getDrafts(lg.id)));
    await sleep(120);

    // Matchups and transactions are per-week; roll them into one file each so the
    // dev server does a single read instead of 17.
    if (lg.weeks > 0) {
      const matchups: Record<number, unknown> = {};
      const transactions: Record<number, unknown> = {};
      for (let w = 1; w <= lg.weeks; w++) {
        const m = await attempt(`matchups w${w}`, () => S.getMatchups(lg.id, w));
        if (m) matchups[w] = m;
        await sleep(90);
        const t = await attempt(`transactions w${w}`, () => S.getTransactions(lg.id, w));
        if (t) transactions[w] = t;
        await sleep(90);
      }
      await save(`${lg.label}.matchups`, matchups);
      await save(`${lg.label}.transactions`, transactions);
    }
  }

  console.log('\nplayers (large — this one takes a moment)');
  const players = (await S.getAllPlayers()) as Record<string, any>;
  await save('players.full', players);

  // The full dump is 14.6MB, most of it fields no UI ever reads. Ship a trimmed
  // index to the browser instead and keep the full one for server-side lookups.
  const slim: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    if (!p.active && !p.team) continue; // drop the long tail of retired/never-played
    slim[id] = {
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position,
      team: p.team,
      no: p.number,
      age: p.age,
      exp: p.years_exp,
      status: p.injury_status,
      inj: p.injury_body_part,
      rank: p.search_rank,
      bye: p.bye_week,
    };
  }
  await save('players.slim', slim);
  console.log(`  (trimmed ${Object.keys(players).length} → ${Object.keys(slim).length} players)`);

  await attempt('trending', async () => save('trending.add', await S.getTrending('add')));

  console.log('\ndone');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
