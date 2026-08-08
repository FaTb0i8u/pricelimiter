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

const BACKGROUND = [30, 142, 62]; // Google green 700
const MARGIN = 0.06;
const RADIUS = 0.2;

function insideRoundedRect(x, y) {
  const half = 0.5 - MARGIN;
  const dxAbs = Math.abs(x - 0.5);
  const dyAbs = Math.abs(y - 0.5);
  if (dxAbs > half || dyAbs > half) return false;
  const dx = Math.max(dxAbs - (half - RADIUS), 0);
  const dy = Math.max(dyAbs - (half - RADIUS), 0);
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

/** A downward chevron over a baseline: "lower price, per unit". */
function insideGlyph(x, y) {
  const chevron =
    Math.min(
      distanceToSegment(x, y, 0.28, 0.36, 0.5, 0.58),
      distanceToSegment(x, y, 0.5, 0.58, 0.72, 0.36)
    ) <= 0.068;
  const baseline = distanceToSegment(x, y, 0.31, 0.735, 0.69, 0.735) <= 0.05;
  return chevron || baseline;
}

function renderIcon(size) {
  const samples = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let background = 0;
      let foreground = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (!insideRoundedRect(x, y)) continue;
          background++;
          if (insideGlyph(x, y)) foreground++;
        }
      }
      const total = samples * samples;
      const offset = (py * size + px) * 4;
      if (background === 0) continue;
      const mix = foreground / background;
      rgba[offset] = Math.round(BACKGROUND[0] * (1 - mix) + 255 * mix);
      rgba[offset + 1] = Math.round(BACKGROUND[1] * (1 - mix) + 255 * mix);
      rgba[offset + 2] = Math.round(BACKGROUND[2] * (1 - mix) + 255 * mix);
      rgba[offset + 3] = Math.round((background / total) * 255);
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
