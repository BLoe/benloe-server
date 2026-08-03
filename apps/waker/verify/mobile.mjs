/**
 * The phone pass.
 *
 * Viewport-sized screenshots rather than fullPage, so anything sticky lands
 * where a person actually sees it, plus the checks a desktop pass cannot make:
 * tap-target size, sideways scroll, and whether the dense figures survive at
 * 390px.
 */
import { join } from 'node:path';
import { devices } from 'playwright';
import { OUT, ensureOut, launchBrowser, overflows, settle, signIn, startServer, watch } from './harness.mjs';

const server = await startServer();
const browser = await launchBrowser();
// A real phone profile: touch events, mobile user agent, correct DPR handling.
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
const seen = watch(page);
await ensureOut();

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

  for (const [name, path, proof] of [
    ['m-now', '', 'text=What needs you'],
    ['m-season', 'season', 'text=seasons simulated'],
    ['m-horizon', 'horizon', 'text=The board'],
    ['m-tape', 'tape', 'text=ranked'],
  ]) {
    await check(name, async () => {
      await page.goto(`${server.base}/l/${league}/${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(proof, { timeout: 45_000 });
      await settle(page);
      if (await overflows(page)) throw new Error('scrolls sideways at 390px');
      await page.screenshot({ path: join(OUT, `${name}.png`) });
    });
  }

  await check('the thumb index fits without wrapping', async () => {
    await page.goto(`${server.base}/l/${league}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav[aria-label="Horizons"]');
    const box = await page.locator('nav[aria-label="Horizons"]').boundingBox();
    if (box.height > 60) throw new Error(`nav is ${Math.round(box.height)}px tall — it has wrapped`);
  });

  await check('tap targets are at least 40px', async () => {
    const small = await page.$$eval('nav[aria-label="Horizons"] a', (els) =>
      els
        .map((e) => ({ text: e.textContent.trim(), h: e.getBoundingClientRect().height }))
        .filter((x) => x.h < 40)
    );
    if (small.length) {
      throw new Error(`${small.map((s) => `${s.text} ${Math.round(s.h)}px`).join(', ')}`);
    }
  });

  await check('the tide strip is legible rather than a hairline', async () => {
    const box = await page.locator('svg').first().boundingBox();
    if (!box || box.height < 40) throw new Error(`tide strip is ${Math.round(box?.height ?? 0)}px tall`);
  });

  await check('no figure is rendered below 10px', async () => {
    // Dense numeric UI degrades by shrinking type until it cannot be read.
    const tiny = await page.$$eval('.fig', (els) =>
      els
        .filter((e) => e.textContent.trim())
        .map((e) => ({ t: e.textContent.trim().slice(0, 16), s: parseFloat(getComputedStyle(e).fontSize) }))
        .filter((x) => x.s < 10)
    );
    if (tiny.length) throw new Error(`${tiny.length} too small, e.g. "${tiny[0].t}" at ${tiny[0].s}px`);
  });

  await check('the board plot still fits the screen', async () => {
    await page.goto(`${server.base}/l/${league}/horizon`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=The board', { timeout: 45_000 });
    await settle(page);
    const box = await page.locator('svg').first().boundingBox();
    if (box.width > 400) throw new Error(`plot is ${Math.round(box.width)}px wide on a 390px screen`);
  });

  await check('no console errors on a phone', async () => {
    if (seen.errors.length) throw new Error(seen.errors[0]);
  });
} finally {
  await browser.close();
  server.stop();
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} mobile problem(s)`);
  process.exit(1);
}
console.log('mobile layout and navigation OK');
