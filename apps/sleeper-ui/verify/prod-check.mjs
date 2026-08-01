import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1728, height: 1080 }, colorScheme: 'dark' });
const errs = [];
for (const [name, url] of [
  ['prod-overview', 'https://sleeper.benloe.com/'],
  ['prod-teams', 'https://sleeper.benloe.com/l/1312065694577209344/teams'],
]) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
  p.on('console', m => m.type() === 'error' && errs.push(`${name}: ${m.text()}`));
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `.verify/${name}.png`, fullPage: true });
  console.log(name, '->', await p.title(), '|', p.url());
  await p.close();
}
await b.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
