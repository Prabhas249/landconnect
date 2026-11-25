// Renders the LandConnect mark (same geometry as src/features/auth/logo-mark.tsx) to the
// app icon, Android adaptive icon layers and splash image. No dependencies: a tiny
// supersampled rasteriser and a zlib PNG encoder. Run: node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const FOREST = [0x10, 0x20, 0x1c];
const GREEN = [0x0f, 0x6e, 0x56];
const MINT = [0x5d, 0xca, 0xa5];
const AMBER = [0xef, 0x9f, 0x27];
const WHITE = [255, 255, 255];

// Shapes copied from https://www.landconnect.si/icon.svg (48-unit grid), not redrawn.
const LEFT = [[6, 32], [19, 24], [19, 39], [6, 39]];
const RIGHT = [[42, 32], [29, 24], [29, 39], [42, 39]];
const DOT = { cx: 24, cy: 24, r: 5.5 };
const CORE = { cx: 24, cy: 24, r: 2 };
// Full icon keeps the site's exact placement (grid centre). Glyph-only layers centre the artwork's own bounds.
const GRID_CENTRE = { x: 24, y: 24 };
const ART_CENTRE = { x: 24, y: 28.75 };

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** @param scale fraction of the canvas the 48-unit grid spans */
function render({ size, scale, background, mono, plain, centre = ART_CENTRE }) {
  const SS = 4;
  const unit = (size * scale) / 48;
  const ox = size / 2 - centre.x * unit;
  const oy = size / 2 - centre.y * unit;
  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - ox) / unit;
          const y = (py + (sy + 0.5) / SS - oy) / unit;
          let c = null;
          if (plain) c = background;
          else
          if ((x - CORE.cx) ** 2 + (y - CORE.cy) ** 2 <= CORE.r ** 2) c = mono ? null : FOREST;
          else if ((x - DOT.cx) ** 2 + (y - DOT.cy) ** 2 <= DOT.r ** 2) c = mono ? WHITE : AMBER;
          else if (inPolygon(x, y, LEFT)) c = mono ? WHITE : GREEN;
          else if (inPolygon(x, y, RIGHT)) c = mono ? WHITE : MINT;
          else if (background) c = background;
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; a += 255;
          }
        }
      }
      const n = SS * SS;
      const covered = a / 255;
      const i = (py * size + px) * 4;
      if (covered > 0) {
        rgba[i] = Math.round(r / covered);
        rgba[i + 1] = Math.round(g / covered);
        rgba[i + 2] = Math.round(b / covered);
      }
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(rgba, size, size);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../assets/images/', import.meta.url);
const files = {
  'icon.png': { size: 1024, scale: 1, background: FOREST, centre: GRID_CENTRE },
  // Adaptive icons are masked to the centre ~61%; keep the artwork inside it.
  'android-icon-foreground.png': { size: 1024, scale: 0.6 },
  'android-icon-monochrome.png': { size: 1024, scale: 0.6, mono: true },
  'android-icon-background.png': { size: 512, scale: 1, background: FOREST, plain: true },
  'splash-icon.png': { size: 512, scale: 1.25 },
  'favicon.png': { size: 96, scale: 1, background: FOREST, centre: GRID_CENTRE },
};
for (const [name, opts] of Object.entries(files)) {
  writeFileSync(new URL(name, out), render(opts));
  console.log('wrote', name);
}
