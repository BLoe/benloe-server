// No image tooling on this box, so render the SVG in Chrome and screenshot it.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg', 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [file, size] of [['public/favicon-32.png', 32], ['public/favicon-180.png', 180], ['public/icon-512.png', 512]]) {
  const ctx = await b.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await p.screenshot({ path: file, omitBackground: false });
  console.log(file, size);
  await ctx.close();
}
await b.close();
