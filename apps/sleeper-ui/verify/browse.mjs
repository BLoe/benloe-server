import { chromium } from 'playwright';
const B = process.env.BASE || 'https://sleeper.benloe.com';
const LG = '1180168833027727360';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1512, height: 950 }, colorScheme: 'dark', deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(B, { waitUntil: 'networkidle' });
if (await p.$('#username')) {
  await p.fill('#username', 'BenLoe');
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Standings', { timeout: 30000 });
}
const shots = [
  ['b-overview', `${B}/l/${LG}`, 'text=Standings'],
  ['b-matchups', `${B}/l/${LG}/matchups/12`, 'text=Full breakdown'],
  ['b-teams', `${B}/l/${LG}/teams/8`, 'text=FAAB left'],
  ['b-activity', `${B}/l/${LG}/activity`, 'text=League activity'],
];
for (const [name, url, wait] of shots) {
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForSelector(wait, { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `.verify/${name}.png`, fullPage: false });
  console.log(name, 'ok');
}
// Crop of the standings row area to judge type sizes at true scale.
await p.goto(`${B}/l/${LG}`, { waitUntil: 'networkidle' });
await p.waitForSelector('text=Standings');
await p.waitForTimeout(400);
await p.screenshot({ path: '.verify/b-crop-standings.png', clip: { x: 240, y: 400, width: 1270, height: 300 } });
await p.screenshot({ path: '.verify/b-crop-header.png', clip: { x: 240, y: 60, width: 1270, height: 300 } });
console.log('crops ok');
await b.close();
