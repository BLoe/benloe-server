import { chromium } from 'playwright';
const B = 'http://localhost:3010';
const LG25 = '1180168833027727360';   // played season — real weekly projections
const LG26 = '1312065694577209344';   // preseason
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1512, height: 950 }, colorScheme: 'dark' });
const p = await ctx.newPage();
p.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await p.goto(B, { waitUntil: 'networkidle' });
if (await p.$('#username')) {
  await p.fill('#username', 'BenLoe');
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Standings', { timeout: 30000 });
}
const shots = [
  ['l-matchup-detail', `${B}/l/${LG25}/matchups/12/1`, 'text=Edge by slot'],
  ['l-matchups-pre', `${B}/l/${LG26}/matchups/1`, 'text=Projected'],
  ['l-player', `${B}/l/${LG25}/players/4984`, 'text=News desk'],
  ['l-brief', `${B}/l/${LG25}/players/4984`, 'text=What Claude makes of it'],
];
for (const [name, url, wait] of shots) {
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForSelector(wait, { timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  if (name === 'l-brief') {
    const box = await p.locator('section', { hasText: 'What Claude makes of it' }).last().boundingBox();
    await p.screenshot({ path: `.verify/${name}.png`, clip: box });
  } else {
    await p.screenshot({ path: `.verify/${name}.png`, fullPage: name === 'l-player' });
  }
  console.log(name, 'ok');
}
await b.close();
