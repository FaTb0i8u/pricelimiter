/**
 * Generates the extension icons as PNGs.
 *
 * Written by hand against the PNG spec so the repo needs no image tooling and
 * no npm packages: `node tools/make-icons.js`. Re-run it only if the artwork
 * below changes.
 */
'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ artwork */

/*
 * The mark is a single PRICE TAG, drawn as signed-distance fields rather than
 * boolean masks so edges carry real coverage instead of a supersampled hard
 * test. At 16px the string hole is barely over one pixel across and only
 * survives as partial coverage.
 *
 * Three rejected alternatives are worth not repeating. A bare chevron over a
 * bar, and then a full arrow over a bar, both read in the toolbar as
 * "download" or "collapse" -- the two affordances browser chrome already
 * spends most of its icon vocabulary on. Two overlapping tags, meaning
 * "compare prices", merged into an unreadable blob below 48px.
 */

const SURFACE_TOP = [46, 168, 83]; // matches the panel's #1e8e3e family, lifted
const SURFACE_BOTTOM = [11, 92, 41];
const MARGIN = 0.055;
const RADIUS = 0.225;

/** Negative inside the shape, positive outside, in unit-square distance. */
function roundedBoxSdf(px, py, halfWidth, halfHeight, radius) {
  const dx = Math.abs(px) - (halfWidth - radius);
  const dy = Math.abs(py) - (halfHeight - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

function surfaceSdf(x, y) {
  return roundedBoxSdf(x - 0.5, y - 0.5, 0.5 - MARGIN, 0.5 - MARGIN, RADIUS);
}

const SIN45 = Math.sin(Math.PI / 4);
const COS45 = Math.cos(Math.PI / 4);

/**
 * One tag: a square rotated 45 degrees with a punched-out string hole, which
 * is the shape every storefront in the world already uses for "price".
 * @param {number} cx centre in screen space
 * @param {number} scale half-edge of the square before rotation
 */
function tagSdf(x, y, cx, cy, scale) {
  const dx = x - cx;
  const dy = y - cy;
  const u = dx * COS45 + dy * SIN45;
  const v = -dx * SIN45 + dy * COS45;

  const body = roundedBoxSdf(u, v, scale, scale, scale * 0.2);
  const hole = Math.hypot(u + scale * 0.44, v + scale * 0.44) - scale * 0.27;
  return Math.max(body, -hole); // subtract the hole from the body
}

const TAG = { cx: 0.5, cy: 0.5, scale: 0.2 };

function glyphSdf(x, y) {
  return tagSdf(x, y, TAG.cx, TAG.cy, TAG.scale);
}

/**
 * Coverage of an SDF at one pixel. The distance is compared against half a
 * pixel, which is exactly the width of the band an antialiased edge occupies.
 */
function coverage(distance, pixel) {
  return Math.max(0, Math.min(1, 0.5 - distance / pixel));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function renderIcon(size) {
  const pixel = 1 / size;
  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;

      const surface = coverage(surfaceSdf(x, y), pixel);
      if (surface <= 0) continue;

      // Clipping the glyph to the surface keeps it from bleeding past the
      // rounded corners at small sizes.
      const ink = Math.min(coverage(glyphSdf(x, y), pixel), surface);

      const shade = (y - MARGIN) / (1 - 2 * MARGIN);
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const base = lerp(SURFACE_TOP[channel], SURFACE_BOTTOM[channel], Math.min(Math.max(shade, 0), 1));
        rgba[offset + channel] = Math.round(lerp(base, 255, ink / surface));
      }
      rgba[offset + 3] = Math.round(surface * 255);
    }
  }
  return encodePng(size, rgba);
}

const outputDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outputDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outputDir, `icon-${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  process.stdout.write(`wrote ${path.relative(path.join(__dirname, '..'), file)}\n`);
}
