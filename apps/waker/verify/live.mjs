/**
 * The live pass.
 *
 * Fixture mode is what makes the other three harnesses trustworthy, and it is
 * also their blind spot: a frozen file cannot tell you that KeepTradeCut
 * changed its page shape this morning, or that nflverse has not published a
 * file for the season the app is asking about. Those are exactly the failures
 * that matter, and they only appear against the real thing.
 *
 * This runs against the production server on purpose. It takes no screenshots
 * for comparison — the data moves — it asserts that every upstream still
 * answers and that what comes back is shaped the way the app expects.
 *
 *   node verify/live.mjs
 *   BASE=https://waker.benloe.com node verify/live.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3012';
const USER = process.env.WAKER_USER || 'BenLoe';

const failures = [];
const check = async (label, fn) => {
  try {
    const note = await fn();
    console.log(`  ✓ ${label}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    failures.push(`${label}: ${e.message}`);
    console.log(`  ✗ ${label} — ${e.message}`);
  }
};

/** Sign in and keep the cookie, the way a browser would. */
let cookie = '';
const api = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
};

await check('the server is up', async () => {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error('health said not ok');
  if (health.source !== 'live') throw new Error(`source is "${health.source}", not live`);
  return `source=${health.source}`;
});

await check('sign-in works', async () => {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error('no session cookie returned');
  return USER;
});

let league;
await check('the dynasty league is the one it opens on', async () => {
  const me = await api('/api/me');
  if (!me.leagues?.length) throw new Error('no leagues');
  const dynasty = me.leagues.find((l) => l.kind === 'dynasty');
  if (!dynasty) throw new Error('no dynasty league found — league kind detection has regressed');
  league = dynasty.leagueId;
  return `${dynasty.name} ${dynasty.season}`;
});

await check('every third-party source still answers', async () => {
  const { health } = await api(`/api/league/${league}/sources`);
  const dead = Object.entries(health)
    .filter(([k, v]) => k !== 'usageSeason' && typeof v === 'number' && v === 0)
    .map(([k]) => k);
  if (dead.length) throw new Error(`no data from: ${dead.join(', ')}`);
  return `fc ${health.fantasyCalc} · ktc ${health.ktc} · joined ${health.joined} · snaps ${health.snaps} · usage ${health.usage} (${health.usageSeason})`;
});

await check('the value markets still join to Sleeper ids', async () => {
  const { health } = await api(`/api/league/${league}/sources`);
  // The join is the fragile part: KTC publishes only an mflId and reaches
  // Sleeper through FantasyCalc. A collapse here means one of them changed a
  // field name, and every value in the app silently becomes null.
  if (health.joined < 200) throw new Error(`only ${health.joined} players joined — the crosswalk has broken`);
  return `${health.joined} players priced`;
});

await check('usage data is for a season that has actually been played', async () => {
  const { health } = await api(`/api/league/${league}/sources`);
  const year = Number(health.usageSeason);
  const now = new Date().getUTCFullYear();
  if (!Number.isFinite(year)) throw new Error(`usageSeason is "${health.usageSeason}"`);
  if (year < now - 1) throw new Error(`usage is from ${year}, which is more than a season stale`);
  return health.usageSeason;
});

await check('the cycle knows where in the year it is', async () => {
  const { cycle } = await api(`/api/league/${league}/cycle`);
  if (!cycle.phase) throw new Error('no phase');
  if (!cycle.title) throw new Error('no title');
  return `${cycle.phase} — ${cycle.title}`;
});

await check('the feed produces decisions with real stakes', async () => {
  const feed = await api(`/api/league/${league}/feed`);
  if (!Array.isArray(feed.decisions)) throw new Error('no decisions array');
  const bad = feed.decisions.filter((d) => !Number.isFinite(d.stake) || !d.claim);
  if (bad.length) throw new Error(`${bad.length} malformed decision(s)`);
  return `${feed.decisions.length} open`;
});

await check('the board plots priced players', async () => {
  const board = await api(`/api/league/${league}/board`);
  const mine = board.teams.find((t) => t.mine) ?? board.teams[0];
  const priced = mine.players.filter((p) => p.dynasty != null).length;
  if (priced < 5) throw new Error(`only ${priced} of ${mine.players.length} priced`);
  return `${priced}/${mine.players.length} priced on ${mine.teamName}`;
});

for (const [label, path] of [
  ['the tape returns usage histories', 'tape'],
  ['the season simulation runs', 'season'],
  ['the ledger finds surplus and need', 'ledger'],
]) {
  await check(label, async () => {
    const body = await api(`/api/league/${league}/${path}`);
    const keys = Object.keys(body);
    if (!keys.length) throw new Error('empty response');
    return keys.join(', ');
  });
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} live problem(s) — an upstream has moved or the joins have broken`);
  process.exit(1);
}
console.log('every upstream answers and every route is shaped as expected');
