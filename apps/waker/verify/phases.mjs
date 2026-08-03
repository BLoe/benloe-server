import { chromium } from 'playwright';
// Fixture mode lets the clock be pinned, which is the only way to see a
// Sunday-lock page on a Tuesday.
const B = 'http://localhost:3013';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 700 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(B, { waitUntil: 'domcontentloaded' });
if (await p.$('#username')) { await p.fill('#username','BenLoe'); await p.click('button[type=submit]'); }
await p.waitForSelector('text=Waker', { timeout: 20000 });
const LG = await p.evaluate(() => location.pathname.split('/')[2]);
const shots = [
  ['open',    '2025-09-10T14:00:00Z'],
  ['closing', '2025-09-14T15:00:00Z'],
  ['live',    '2025-09-14T20:00:00Z'],
  ['claims',  '2025-09-16T14:00:00Z'],
];
for (const [name, now] of shots) {
  await p.goto(`${B}/l/${LG}?now=${encodeURIComponent(now)}&inSeason=1&week=2`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('text=Week 2', { timeout: 20000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `.verify/phase-${name}.png`, clip: { x: 0, y: 100, width: 1280, height: 300 } });
  console.log('  ', name);
}
await b.close();
