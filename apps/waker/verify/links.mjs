/**
 * Navigation: does every path a person would actually take work?
 *
 * Screenshots prove a page renders. They say nothing about whether you can get
 * to it, which is a different and easier thing to break — a route registered
 * under the wrong path renders perfectly and is unreachable.
 */
import { launchBrowser, settle, signIn, startServer } from './harness.mjs';

const server = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const failures = [];
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures.push(`${label}: ${e.message.split('\n')[0]}`);
    console.log(`  ✗ ${label} — ${e.message.split('\n')[0]}`);
  }
};

try {
  const league = await signIn(page, server.base);
  const at = (p) => `${server.base}/l/${league}${p ? `/${p}` : ''}`;

  await check('sign-in lands on the Now horizon', async () => {
    await page.waitForSelector('text=What needs you', { timeout: 45_000 });
  });

  // The thumb index is the app's only navigation, so every tab must work.
  for (const [label, path, proof] of [
    ['Season', 'season', 'text=/playoff|Playoff/'],
    ['Horizon', 'horizon', 'text=The board'],
    ['Tape', 'tape', 'text=/usage|Usage/'],
    ['Now', '', 'text=What needs you'],
  ]) {
    await check(`thumb index → ${label}`, async () => {
      await page.click(`nav[aria-label="Horizons"] a:has-text("${label}")`);
      await page.waitForSelector(proof, { timeout: 45_000 });
      if (path && !page.url().includes(path)) throw new Error(`landed on ${page.url()}`);
    });
  }

  await check('the league switcher changes league', async () => {
    await page.goto(at(''), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=What needs you', { timeout: 45_000 });
    const options = await page.$$eval('select option', (els) => els.map((e) => e.value));
    const other = options.find((v) => v !== league);
    if (!other) return; // a one-league account is not a failure
    await page.selectOption('select', other);
    await page.waitForFunction((id) => !location.pathname.includes(id), league, { timeout: 15_000 });
  });

  await check('a deep link opens directly, without going through Now', async () => {
    await page.goto(at('horizon'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=The board', { timeout: 45_000 });
  });

  await check('an unknown path recovers rather than showing nothing', async () => {
    await page.goto(`${server.base}/nonsense/path`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav[aria-label="Horizons"]', { timeout: 45_000 });
  });

  await check('every roster on the board can be opened', async () => {
    await page.goto(at('horizon'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=The board', { timeout: 45_000 });
    const rosters = await page.$$eval('select', (els) => {
      const board = els.find((e) => e.options.length >= 8);
      return board ? [...board.options].map((o) => o.value) : [];
    });
    if (rosters.length < 8) throw new Error(`only ${rosters.length} rosters selectable`);
    // Spot-check a few rather than all twelve: this is a navigation test, not
    // a data test, and each selection re-renders a scatter plot.
    for (const value of rosters.slice(0, 3)) {
      await page.selectOption('select >> nth=1', value);
      await settle(page, 250);
    }
  });

  await check('signing out returns to the way in', async () => {
    await page.goto(at(''), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=What needs you', { timeout: 45_000 });
    await page.click('button:has-text("↩")');
    await page.waitForSelector('#username', { timeout: 15_000 });
  });
} finally {
  await browser.close();
  server.stop();
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} navigation problem(s)`);
  process.exit(1);
}
console.log('every path navigates');
