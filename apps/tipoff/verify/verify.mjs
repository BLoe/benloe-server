// Drives a real draft against the live site in a fresh browser profile and
// asserts the numbers a person drafts by actually move. Screenshots land in
// .verify/ — LOOK at them; a clean exit only means nothing threw.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire('/srv/benloe/apps/gavel/package.json');
const { chromium } = require('playwright');

// The live site is owner-gated, so by default run our own server.mjs on an
// ephemeral port: test user, static files from public/, a throwaway upload dir.
const uploadDir = mkdtempSync(join(tmpdir(), 'tipoff-verify-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], {
  env: { ...process.env, TIPOFF_STATE_FILE: join(uploadDir, 'state.json'), NODE_ENV: 'test', PORT: String(port), TIPOFF_TEST_USER: '1', TIPOFF_SERVE_STATIC: '1', TIPOFF_UPLOAD_DIR: uploadDir },
  stdio: 'inherit',
});
await new Promise((r) => setTimeout(r, 600));
const URL_ = process.env.TIPOFF_URL ?? `http://127.0.0.1:${port}/`;
const OUT = new URL('../.verify/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ORDER = ['Florio/Avi', 'Tim Doyle', 'Garrett', 'John M', 'Mike S', 'Ben M', 'Aaron M', 'Thomas H', 'Joe M', 'Ben Loe', 'John L', 'Joe C']; // option values stay manager keys
const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL_);
await page.waitForSelector('table.b tbody tr');
await page.screenshot({ path: OUT + '1-fresh.png' });

const clockText = () => page.locator('#clock').innerText();
if (!(await clockText()).includes('Pick 1')) fail('fresh board is not at pick 1: ' + (await clockText()));
// Keepers are pre-marked: Flagg is on our team.
if (!(await page.locator('#team').innerText()).includes('Cooper Flagg')) fail('Flagg not on our team at start');

// Draft setup.
await page.click('#settingsBtn');
for (let i = 0; i < 12; i++) await page.selectOption(`select[data-order="${i}"]`, ORDER[i]);
await page.selectOption('select[data-extra="3"]', 'Garrett');
await page.selectOption('select[data-extra="6"]', 'Mike S');
await page.selectOption('select[data-extra="8"]', 'Joe C');
await page.screenshot({ path: OUT + '2-setup.png' });
await page.click('#settingsForm button[value=close]');

if (!(await clockText()).includes('#5')) fail('from the Yahoo grid our first pick is #5, clock says ' + (await clockText()));

// Four rival picks by keyboard: search, Enter opens the top row, Enter = taken.
const board = page.getByTestId('board');
for (let i = 0; i < 4; i++) {
  const first = await board.locator('tbody tr.p').first().locator('td.name').innerText();
  await page.click('#board tbody tr.p >> nth=0');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => !document.querySelector('dialog[open]'), null);
  if (i === 0 && (await board.locator('tbody tr.p').first().locator('td.name').innerText()) === first) fail('taken player still at top of board');
}
const c = await clockText();
if (!c.includes("ON THE CLOCK")) fail('after four picks we should be on the clock: ' + c);
if (!c.includes('Pick 5')) fail('counter should read pick 5: ' + c);
await page.screenshot({ path: OUT + '3-on-the-clock.png' });

// Take the shortlist's top suggestion as ours with 'm'.
const sug = await page.locator('#suggest .row.top b').innerText();
await page.click('#suggest .row.top');
await page.keyboard.press('m');
if (!(await page.locator('#team').innerText()).includes(sug)) fail(`${sug} not on our team after m`);
const c2 = await clockText();
if (!c2.includes('Pick 6')) fail('counter should move to 6: ' + c2);
if (!c2.includes('#20')) fail('our next pick is #20: ' + c2);

// Undo puts him back.
await page.click('#undo');
if ((await page.locator('#team').innerText()).includes(sug)) fail('undo did not remove our pick');
await page.click('#suggest .row.top');
await page.keyboard.press('m');

// Punt toggle changes the ranking.
const before = await board.locator('tbody tr.p td.name').nth(5).innerText();
await page.click('button[data-punt="fgp"]'); // un-punt FG%
const after = await board.locator('tbody tr.p td.name').nth(5).innerText();
if (before === after) console.warn('note: 6th row unchanged by un-punting FG% (possible but unlikely)');
await page.click('button[data-punt="fgp"]'); // restore

// Reload: everything survives.
await page.reload();
await page.waitForSelector('table.b tbody tr');
if (!(await clockText()).includes('Pick 6')) fail('reload lost the pick counter: ' + (await clockText()));
if (!(await page.locator('#team').innerText()).includes(sug)) fail('reload lost our pick');

await page.click('button[data-tab="pos"]');
await page.screenshot({ path: OUT + '4-tiers-by-position.png', fullPage: false });
await page.click('button[data-tab="board"]');
await page.click('button[data-pos="C"]');
await page.screenshot({ path: OUT + '5-centers.png' });

// Phone width: no horizontal page scroll.
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: OUT + '6-phone.png' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 1) fail(`phone: page scrolls horizontally by ${overflow}px`);

// Typed picks from Yahoo override the order-derived schedule.
await page.setViewportSize({ width: 1440, height: 900 });
await page.click('#settingsBtn');
await page.fill('textarea[data-text="myPicksText"]', '11 14 3.2 35 59 62 6.4 6.9 83 96 8.5 107 159 182');
await page.screenshot({ path: OUT + '7-typed-picks.png' });
const parsed = await page.locator('#parsedPicks').innerText();
if (!parsed.includes('#26 (R3)') || !parsed.includes('#89 (R8)')) fail('typed picks not parsed: ' + parsed);
await page.click('#settingsForm button[value=close]');
if (!(await page.locator('#mypicks').innerText()).includes('typed')) fail('picks panel does not show typed picks');
if (!(await clockText()).includes('#11')) fail('next pick should be #11 from typed list: ' + (await clockText()));

// The live draft is mirrored to the server for Claude to read.
await page.waitForTimeout(800);
const mirrored = JSON.parse(readFileSync(join(uploadDir, 'state.json'), 'utf8'));
if (!mirrored.marks?.some((m) => m.mine && !m.keeper)) fail('server state mirror is missing our pick');

// Upload page, reached the way Ben would: the header link.
await page.goto(URL_);
if (!(await page.getByTestId('upload-link').isVisible())) fail('upload link not visible in header');
if ((await page.getByTestId('upload-link').getAttribute('href')) !== 'upload.html') fail('upload link points elsewhere');
await page.goto(URL_ + 'upload.html');
await page.setInputFiles('#pick', OUT + '1-fresh.png');
await page.waitForSelector('.shot img');
if (readdirSync(uploadDir).filter((f) => f.endsWith('.png')).length !== 1) fail('upload did not land on disk');
if (!(await page.locator('#status').innerText()).includes('Saved 1')) fail('upload status: ' + (await page.locator('#status').innerText()));
await page.screenshot({ path: OUT + '8-upload.png' });
page.once('dialog', (d) => d.accept());
await page.click('.shot .meta button');
await page.waitForFunction(() => !document.querySelector('.shot'));
if (readdirSync(uploadDir).filter((f) => f.endsWith('.png')).length !== 0) fail('delete did not remove the file');
if (errors.length) fail('console errors: ' + errors.join(' | '));
errors.length = 0;
// The server refuses non-images by their bytes (the browser logs the 415).
const bad = await page.evaluate(async () => (await fetch('api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'not an image' })).status);
if (bad !== 415) fail('non-image upload got ' + bad);

await browser.close();
server.kill();
console.log(process.exitCode ? 'verify: FAILED' : 'verify: ok', '— screenshots in', OUT);
