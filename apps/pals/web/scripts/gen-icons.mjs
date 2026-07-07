// Dependency-free PNG icon generator: renders the PALS mark (dark ground,
// amber bars, cursor block) into icon-180.png and icon-512.png.
// PNG = IHDR + IDAT(zlib of filtered scanlines) + IEND, CRC32 per chunk.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  draw((x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  });
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const INK = [0x0e, 0x14, 0x20];
const AMBER = [0xf0, 0xb2, 0x49];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function drawMark(size) {
  return png(size, (set) => {
    const u = size / 128; // design units from the SVG
    const rect = (x, y, w, h, color) => {
      for (let yy = Math.round(y * u); yy < Math.round((y + h) * u); yy++)
        for (let xx = Math.round(x * u); xx < Math.round((x + w) * u); xx++) set(xx, yy, ...color);
    };
    rect(0, 0, 128, 128, INK);
    rect(20, 30, 88, 10, AMBER);
    rect(20, 52, 62, 10, mix(INK, AMBER, 0.75));
    rect(20, 74, 76, 10, mix(INK, AMBER, 0.5));
    rect(20, 92, 12, 14, AMBER);
  });
}

writeFileSync(new URL('../public/icon-180.png', import.meta.url), drawMark(180));
writeFileSync(new URL('../public/icon-512.png', import.meta.url), drawMark(512));
console.log('icons written');
