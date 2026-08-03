import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3012';
const LG = process.env.LG || '1312065694577209344';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await p.goto(B, { waitUntil: 'domcontentloaded' });
if (await p.$('#username')) {
  await p.fill('#username', 'BenLoe');
  await p.click('button[type=submit]');
}
await p.waitForSelector('text=Waker', { timeout: 20000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: '.verify/identity.png', fullPage: true });
console.log('ok');
await b.close();
