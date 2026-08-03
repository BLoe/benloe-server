import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })).newPage();
p.on('console', (m) => m.type()==='error' && console.log('CONSOLE', m.text()));
await p.goto('http://localhost:3012', { waitUntil: 'domcontentloaded' });
if (await p.$('#username')) { await p.fill('#username','BenLoe'); await p.click('button[type=submit]'); }
await p.waitForSelector('text=Waker');
const LG = await p.evaluate(() => location.pathname.split('/')[2]);
await p.goto(`http://localhost:3012/l/${LG}/horizon`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('text=The board', { timeout: 90000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: '.verify/horizon.png', fullPage: true });
console.log('ok');
await b.close();
