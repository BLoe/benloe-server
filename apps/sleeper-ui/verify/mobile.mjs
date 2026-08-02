/**
 * Mobile review: viewport-sized screenshots (not fullPage), so fixed elements
 * like the bottom tab bar land where a person actually sees them.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () => new Promise((r) => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const LG = '1180168833027727360';

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
// A real phone profile: touch, mobile UA, correct DPR behaviour.
const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark', deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#username', 'BenLoe');
await page.click('button[type=submit]');
await page.waitForSelector('text=Standings');

const shots = [
  ['m-overview', `${BASE}/l/${LG}`, 'text=Standings', 0],
  ['m-overview-scrolled', `${BASE}/l/${LG}`, 'text=Standings', 900],
  ['m-matchups', `${BASE}/l/${LG}/matchups/12`, 'text=Full breakdown', 0],
  ['m-matchup-detail', `${BASE}/l/${LG}/matchups/12/1`, 'text=Edge by slot', 300],
  ['m-teams', `${BASE}/l/${LG}/teams/8`, 'text=Starting lineup', 0],
  ['m-teams-roster', `${BASE}/l/${LG}/teams/8`, 'text=Starting lineup', 700],
  ['m-activity', `${BASE}/l/${LG}/activity`, 'text=One row per manager', 0],
  ['m-player', `${BASE}/l/${LG}/players/4984`, 'text=Points by week', 0],
  ['m-chat', `${BASE}/l/${LG}/chat`, 'text=Read only', 0],
];

for (const [name, url, wait, scroll] of shots) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(wait, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `.verify/${name}.png` });
  console.log('  ✓', name);
}

const fails = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (e) { fails.push(`${label}: ${e.message}`); console.log(`  ✗ ${label} — ${e.message}`); }
};

// The bottom bar is the only navigation on a phone, so every tab must work.
for (const [label, path, wait] of [
  ['Overview', '', 'text=Standings'],
  ['Matchups', 'matchups', 'text=Week'],
  ['Teams', 'teams', 'text=Starting lineup'],
  ['Activity', 'activity', 'text=One row per manager'],
  ['Chat', 'chat', 'text=Read only'],
]) {
  await check(`bottom nav → ${label}`, async () => {
    await page.goto(`${BASE}/l/${LG}`, { waitUntil: 'networkidle' });
    await page.click(`nav[aria-label="Sections"] a:has-text("${label}")`);
    await page.waitForSelector(wait, { timeout: 15000 });
    if (path && !page.url().includes(path)) throw new Error(`landed on ${page.url()}`);
  });
}

await check('league switcher changes league', async () => {
  await page.goto(`${BASE}/l/${LG}`, { waitUntil: 'networkidle' });
  const other = '1254603551611559936';
  await page.selectOption('select[aria-label="Choose a league"]', other);
  await page.waitForURL(new RegExp(other), { timeout: 15000 });
});

await check('team switcher changes roster', async () => {
  await page.goto(`${BASE}/l/${LG}/teams/8`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Starting lineup');
  await page.selectOption('select[aria-label="Choose a team"]', '3');
  await page.waitForURL(/\/teams\/3/, { timeout: 15000 });
});

// The fixed bar must not sit on top of the last row of content.
await check('bottom bar does not cover page content', async () => {
  await page.goto(`${BASE}/l/${LG}/activity`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=One row per manager');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const covered = await page.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="Sections"]');
    if (!bar) return 'no bottom bar';
    const barTop = bar.getBoundingClientRect().top;
    const last = [...document.querySelectorAll('main li, main tr, main p')].pop();
    if (!last) return null;
    const r = last.getBoundingClientRect();
    return r.bottom > barTop + 1 ? `last element overlaps by ${Math.round(r.bottom - barTop)}px` : null;
  });
  if (covered) throw new Error(covered);
});

// Tap targets should clear the 44px guideline on a touch device.
await page.goto(`${BASE}/l/${LG}`, { waitUntil: 'networkidle' });
const small = await page.$$eval('nav a, nav button', (els) =>
  els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 14), h: Math.round(r.height), w: Math.round(r.width) }; })
     .filter((x) => x.h > 0 && x.h < 40)
);
console.log(small.length ? `  ! nav targets under 40px: ${JSON.stringify(small)}` : '  ✓ nav tap targets >= 40px');

await browser.close();
try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }

if (fails.length) { console.log(`\n${fails.length} mobile problem(s)`); process.exit(1); }
console.log('\nmobile navigation and layout OK');
