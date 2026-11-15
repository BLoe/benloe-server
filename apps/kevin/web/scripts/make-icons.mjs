// Renders the app icons from one SVG with the Chromium that Playwright
// already installed on this box (the repo root has playwright; the web app
// does not depend on it). Run from web/: `npm run icons`. The PNGs are committed.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../public');
const { chromium } = createRequire('/srv/benloe/tests/')('playwright');

// A "K" built from three strokes. `pad` is the share of the canvas left empty
// around the tile: maskable icons are full-bleed with the glyph in the safe zone.
const svg = ({ bleed, mono = false }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${mono ? '' : `<rect width="512" height="512" rx="${bleed ? 0 : 112}" fill="#1d6b58"/>`}
  <g transform="translate(256 256) scale(${bleed ? 0.74 : 0.92}) translate(-256 -256)" fill="none" stroke="#ffffff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round">
    <path d="M178 132 V380"/>
    <path d="M346 132 L178 282"/>
    <path d="M246 224 L350 380"/>
  </g>
</svg>`;

const targets = [
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/maskable-192.png', 192, { bleed: true }],
  ['icons/maskable-512.png', 512, { bleed: true }],
  ['icons/apple-touch-icon.png', 180, { bleed: true }],
  ['icons/badge-96.png', 96, { mono: true }],
  ['icons/favicon-48.png', 48, {}],
];

const browser = await chromium.launch();
const page = await browser.newPage();
let favicon;
for (const [file, size, opts] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(opts)}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(join(out, file), png);
  if (size === 48) favicon = png;
}
await browser.close();

// An .ico may simply wrap one PNG: 6-byte header, one 16-byte directory entry, the PNG.
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(1, 4);
head[6] = 48;
head[7] = 48;
head.writeUInt16LE(1, 10);
head.writeUInt16LE(32, 12);
head.writeUInt32LE(favicon.length, 14);
head.writeUInt32LE(22, 18);
writeFileSync(join(out, 'favicon.ico'), Buffer.concat([head, favicon]));
console.log(`wrote ${targets.length} icons and favicon.ico to ${out}`);
