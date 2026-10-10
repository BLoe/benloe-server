// Drives a real draft against the live site in a fresh browser profile and
// asserts the numbers a person drafts by actually move. Screenshots land in
// .verify/ — LOOK at them; a clean exit only means nothing threw.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/srv/benloe/apps/gavel/package.json');
const { chromium } = require('playwright');

const URL_ = process.env.TIPOFF_URL ?? 'https://tipoff.benloe.com/';
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

if (!(await clockText()).includes('#10')) fail('slot 10: next pick should be #10, clock says ' + (await clockText()));

// Nine rival picks by keyboard: search, Enter opens the top row, Enter = taken.
const board = page.getByTestId('board');
for (let i = 0; i < 9; i++) {
  const first = await board.locator('tbody tr.p').first().locator('td.name').innerText();
  await page.click('#board tbody tr.p >> nth=0');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => !document.querySelector('dialog[open]'), null);
  if (i === 0 && (await board.locator('tbody tr.p').first().locator('td.name').innerText()) === first) fail('taken player still at top of board');
}
const c = await clockText();
if (!c.includes("ON THE CLOCK")) fail('after nine picks we should be on the clock: ' + c);
if (!c.includes('Pick 10')) fail('counter should read pick 10: ' + c);
await page.screenshot({ path: OUT + '3-on-the-clock.png' });

// Take the shortlist's top suggestion as ours with 'm'.
const sug = await page.locator('#suggest .row.top b').innerText();
await page.click('#suggest .row.top');
await page.keyboard.press('m');
if (!(await page.locator('#team').innerText()).includes(sug)) fail(`${sug} not on our team after m`);
const c2 = await clockText();
if (!c2.includes('Pick 11')) fail('counter should move to 11: ' + c2);
if (!c2.includes('#15')) fail('our next pick from slot 10 is #15: ' + c2);

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
if (!(await clockText()).includes('Pick 11')) fail('reload lost the pick counter: ' + (await clockText()));
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

if (errors.length) fail('console errors: ' + errors.join(' | '));
await browser.close();
console.log(process.exitCode ? 'verify: FAILED' : 'verify: ok', '— screenshots in', OUT);
