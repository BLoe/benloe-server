/**
 * Navigation check: every entity name should be a link that goes somewhere real.
 * Runs against fixtures so it is deterministic.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () => new Promise((res) => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const LG = '1180168833027727360';
const PRESEASON = '1312065694577209344'; // the league with projections published

const server = spawn('npx', ['tsx', 'src/server/index.ts'], {
  cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), SLEEPER_SOURCE: 'fixtures', NODE_ENV: 'production' },
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server timeout')), 30000);
  server.stdout.on('data', d => { if (d.toString().includes('listening')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({
  executablePath: existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const fails = [];

const check = async (label, fn) => {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (e) { fails.push(`${label}: ${e.message}`); console.log(`  ✗ ${label} — ${e.message}`); }
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.fill('#username', 'BenLoe');
await page.click('button[type=submit]');
await page.waitForSelector('text=Standings');

await check('standings team name → team page', async () => {
  await page.goto(`${BASE}/l/${LG}`, { waitUntil: 'domcontentloaded' });
  await page.click('table a:has-text("Scooty Puff Sr")');
  await page.waitForURL(/\/teams\/\d+/, { timeout: 10000 });
  await page.waitForSelector('text=FAAB left');
});

await check('roster player name → player page', async () => {
  // Name-agnostic: whichever player is first on whichever roster we landed on.
  await page.click('a[href*="/players/"]:visible >> nth=0');
  await page.waitForURL(/\/players\/\w+/, { timeout: 10000 });
  await page.waitForSelector('text=Points by week');
});

await check('player page breadcrumb → owning team', async () => {
  await page.click('a[href*="/teams/"]:visible >> nth=0');
  await page.waitForURL(/\/teams\/\d+/, { timeout: 10000 });
  await page.waitForSelector('text=FAAB left');
});

await check('scoreboard game → matchup detail', async () => {
  await page.goto(`${BASE}/l/${LG}`, { waitUntil: 'domcontentloaded' });
  await page.click('a[href*="/matchups/"][href*="/"]>> nth=1');
  await page.waitForURL(/\/matchups\/\d+\/\d+/, { timeout: 10000 });
  await page.waitForSelector('text=Edge by slot');
});

await check('matchup lineup player → player page', async () => {
  await page.click('a[href*="/players/"]:visible >> nth=0');
  await page.waitForURL(/\/players\/\w+/, { timeout: 10000 });
  await page.waitForSelector('text=Points by week');
});

await check('activity player → player page', async () => {
  await page.goto(`${BASE}/l/${LG}/activity`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=League activity');
  await page.click('table a[href*="/players/"]:visible >> nth=0');
  await page.waitForURL(/\/players\/\w+/, { timeout: 10000 });
});

await check('activity team → team page', async () => {
  await page.goto(`${BASE}/l/${LG}/activity`, { waitUntil: 'domcontentloaded' });
  await page.click('table a[href*="/teams/"]:visible >> nth=0');
  await page.waitForURL(/\/teams\/\d+/, { timeout: 10000 });
});

await check('chat author → team page', async () => {
  await page.goto(`${BASE}/l/${LG}/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Read only');
  await page.click('a[href*="/teams/"]:visible >> nth=0');
  await page.waitForURL(/\/teams\/\d+/, { timeout: 10000 });
});

// No link should dead-end on a 404 or an error state.
await check('no broken player links on a roster', async () => {
  await page.goto(`${BASE}/l/${LG}/teams/8`, { waitUntil: 'domcontentloaded' });
  // The roster renders client-side, so wait for it before harvesting links.
  await page.waitForSelector('a[href*="/players/"]');
  const hrefs = await page.$$eval('a[href*="/players/"]', els => [...new Set(els.map(e => e.getAttribute('href')))]);
  if (hrefs.length < 10) throw new Error(`only ${hrefs.length} player links found`);
  for (const href of hrefs.slice(0, 6)) {
    const res = await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
    if (!res.ok()) throw new Error(`${href} returned ${res.status()}`);
    await page.waitForSelector('text=Points by week', { timeout: 20000 });
    if (await page.$('text=Could not load')) throw new Error(`${href} rendered an error state`);
  }
});

// The projected season is reachable and every team on it links onward.
await check('projected standings → team page', async () => {
  await page.goto(`${BASE}/l/${PRESEASON}/projected`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Projected standings');
  await page.click('a[href*="/teams/"]:visible >> nth=0');
  await page.waitForURL(/\/teams\/\d+/, { timeout: 10000 });
  await page.waitForSelector('text=FAAB left');
});

// Expanding a projected team reveals its lineup, and those players link too.
await check('projected lineup player → player page', async () => {
  await page.goto(`${BASE}/l/${PRESEASON}/projected`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Projected standings');
  await page.click('button[aria-expanded="false"] >> nth=0');
  await page.waitForSelector('text=Best available lineup');
  await page.click('a[href*="/players/"]:visible >> nth=0');
  await page.waitForURL(/\/players\/\w+/, { timeout: 10000 });
  await page.waitForSelector('text=Points by week');
});

await browser.close();
try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }

if (fails.length) { console.log(`\n${fails.length} navigation problem(s)`); process.exit(1); }
console.log('\nall entity links navigate correctly');
