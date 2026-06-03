/*
 * generate-icons.mjs — zero-dependency PWA icon generator.
 *
 * PLACEHOLDER ART. This draws a simple, on-brand Yaniv icon procedurally — a
 * felt-green rounded tile with a brass rim and an ivory playing card carrying a
 * red diamond and a dark club — using the actual Felt & Chips theme palette. It
 * is deliberately a sensible placeholder; Roger can replace it with final art
 * by dropping new PNGs (and an SVG) of the same names into /public.
 *
 * Why hand-rolled: the environment has no image toolchain (sharp / resvg /
 * imagemagick / inkscape), and the brief asks to keep the dependency tree
 * minimal. Node ships `zlib`, which is all a PNG encoder needs. We rasterise a
 * handful of flat vector shapes to an RGBA buffer and deflate it into a valid
 * PNG. No new dependencies.
 *
 * Outputs (into /public):
 *   pwa-192x192.png            standard icon (any)
 *   pwa-512x512.png            standard icon (any)
 *   pwa-maskable-512x512.png   maskable icon — full-bleed felt, art kept inside
 *                              the ~80% safe zone so Android/iOS masking can't
 *                              clip it (a missing/!maskable icon is the usual
 *                              reason an install looks broken)
 *   apple-touch-icon.png       180x180, iOS home-screen (opaque, no transparency)
 *   favicon.png                32x32 browser tab icon
 *   icon.svg                   editable vector source for the final-art handoff
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

// --- Felt & Chips palette (default theme), from src/theme/tokens.css ---------
const FELT = [0x1f, 0x4a, 0x3d]; // --surface  deep felt green
const FELT_RAISED = [0x27, 0x60, 0x4e]; // --surface-raised
const BRASS = [0xc9, 0xa2, 0x27]; // --accent   brass/gold rim
const IVORY = [0xf4, 0xec, 0xd8]; // --chip     ivory card
const INK = [0x24, 0x1e, 0x1a]; // --chip-text near-black (club)
const RED = [0xb3, 0x38, 0x2f]; // --danger   warm red (diamond)

// ---------------------------------------------------------------------------
// Tiny software rasteriser → RGBA buffer. All shapes are anti-aliased by
// 3x3 supersampling at the coverage test, which is plenty for flat icons.
// ---------------------------------------------------------------------------
function makeCanvas(size) {
  const buf = new Uint8ClampedArray(size * size * 4); // transparent
  return { size, buf };
}

function blend(c, x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size || a <= 0) return;
  const i = (y * c.size + x) * 4;
  const da = c.buf[i + 3] / 255;
  const sa = a;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) {
    c.buf[i + k] = (([r, g, b][k]) * sa + c.buf[i + k] * da * (1 - sa)) / oa;
  }
  c.buf[i + 3] = oa * 255;
}

// Fill a region defined by an inside(px,py)->bool test, with 3x3 AA.
function fill(c, color, inside, alpha = 1) {
  const S = 3;
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (inside(px, py)) hit++;
        }
      }
      if (hit) blend(c, x, y, color, alpha * (hit / (S * S)));
    }
  }
}

// --- shape predicates -------------------------------------------------------
const roundedRect = (x0, y0, x1, y1, r) => (px, py) => {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

// rotate a point around a centre by angle (radians)
const rot = (px, py, cx, cy, a) => {
  const dx = px - cx, dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

// A 4-point diamond (suit) centred at (cx,cy), half-width w, half-height h
const diamond = (cx, cy, w, h) => (px, py) =>
  Math.abs(px - cx) / w + Math.abs(py - cy) / h <= 1;

// A simple club: three circles + a stem trapezoid.
const club = (cx, cy, R) => (px, py) => {
  const top = (px - cx) ** 2 + (py - (cy - R * 0.55)) ** 2 <= (R * 0.6) ** 2;
  const left = (px - (cx - R * 0.62)) ** 2 + (py - (cy + R * 0.1)) ** 2 <= (R * 0.6) ** 2;
  const right = (px - (cx + R * 0.62)) ** 2 + (py - (cy + R * 0.1)) ** 2 <= (R * 0.6) ** 2;
  // stem
  const sy = py - cy;
  const stem = sy > 0 && sy < R * 1.15 && Math.abs(px - cx) < R * 0.14 + sy * 0.16;
  return top || left || right || stem;
};

// ---------------------------------------------------------------------------
// Draw the icon at a given size. `safe` in [0..1] shrinks the artwork toward
// the centre for the maskable variant (keeps art inside the safe zone) and
// makes the felt full-bleed (no rounded corners) so the platform mask owns the
// shape. For non-maskable, the felt is a rounded tile on transparency.
// ---------------------------------------------------------------------------
function drawIcon(size, { maskable = false } = {}) {
  const c = makeCanvas(size);
  const u = size; // work in pixel units

  if (maskable) {
    // full-bleed felt background, no transparency, no rounded corners
    fill(c, FELT, () => true);
  } else {
    // rounded felt tile on transparency
    fill(c, FELT, roundedRect(u * 0.04, u * 0.04, u * 0.96, u * 0.96, u * 0.22));
    // brass rim
    const outer = roundedRect(u * 0.04, u * 0.04, u * 0.96, u * 0.96, u * 0.22);
    const inner = roundedRect(u * 0.085, u * 0.085, u * 0.915, u * 0.915, u * 0.185);
    fill(c, BRASS, (px, py) => outer(px, py) && !inner(px, py));
  }

  // central artwork scaled into the safe zone for maskable
  const k = maskable ? 0.74 : 1; // shrink art for maskable safe zone
  const cx = u / 2, cy = u / 2;
  const sc = (v) => cx + (v - cx) * k;
  const scy = (v) => cy + (v - cy) * k;

  // subtle raised-felt inner disc for depth
  fill(c, FELT_RAISED, (px, py) => {
    const dx = (px - cx) / k, dy = (py - cy) / k;
    return dx * dx + dy * dy <= (u * 0.40) ** 2;
  });

  // Two overlapping ivory cards, slightly fanned (back card tilted left).
  const cardW = u * 0.30, cardH = u * 0.42;
  const drawCard = (angle, ox, oy, color) => {
    const x0 = cx + ox - cardW / 2, y0 = cy + oy - cardH / 2;
    const x1 = x0 + cardW, y1 = y0 + cardH;
    const rrect = roundedRect(x0, y0, x1, y1, u * 0.035);
    fill(c, color, (px, py) => {
      // inverse-rotate the sample point about the card centre, scale for mask
      let qx = cx + (px - cx) / k, qy = cy + (py - cy) / k;
      const [rx, ry] = rot(qx, qy, cx + ox, cy + oy, -angle);
      return rrect(rx, ry);
    });
  };
  // back card (tilted), then front card (slightly tilted other way)
  drawCard(-0.20, -u * 0.045, u * 0.01, IVORY);
  drawCard(0.12, u * 0.05, -u * 0.01, IVORY);

  // suits on the front card: a red diamond above a dark club
  const fcx = cx + u * 0.05, fcy = cy - u * 0.01;
  const place = (fn, color) => {
    fill(c, color, (px, py) => {
      const qx = cx + (px - cx) / k, qy = cy + (py - cy) / k;
      const [rx, ry] = rot(qx, qy, fcx, fcy, -0.12);
      return fn(rx, ry);
    });
  };
  place(diamond(fcx, fcy - u * 0.085, u * 0.058, u * 0.085), RED);
  place(club(fcx, fcy + u * 0.085, u * 0.058), INK);

  return c;
}

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, 8-bit) using zlib deflate. Minimal, spec-correct.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(canvas) {
  const { size, buf } = canvas;
  // add a filter byte (0 = none) at the start of each scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(buf.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression, filter, interlace = 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function flatten(canvas, bg) {
  // composite onto an opaque background (for apple-touch-icon, which must be opaque)
  const out = makeCanvas(canvas.size);
  fill(out, bg, () => true);
  for (let i = 0; i < canvas.buf.length; i += 4) {
    const a = canvas.buf[i + 3] / 255;
    for (let k = 0; k < 3; k++) {
      out.buf[i + k] = canvas.buf[i + k] * a + out.buf[i + k] * (1 - a);
    }
    out.buf[i + 3] = 255;
  }
  return out;
}

// --- write the set ----------------------------------------------------------
const write = (name, canvas) => {
  writeFileSync(join(OUT, name), encodePng(canvas));
  console.log('wrote', name, `${canvas.size}x${canvas.size}`);
};

write('pwa-192x192.png', drawIcon(192));
write('pwa-512x512.png', drawIcon(512));
write('pwa-maskable-512x512.png', drawIcon(512, { maskable: true }));
write('apple-touch-icon.png', flatten(drawIcon(180), FELT)); // opaque for iOS
write('favicon.png', drawIcon(32));

// --- an editable SVG source for the final-art handoff -----------------------
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- PLACEHOLDER Yaniv Scorekeeper icon. Felt & Chips palette. Replace with
     final art; keep the safe zone (~80% centre) clear for the maskable PNG. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect x="20" y="20" width="472" height="472" rx="112" fill="#1f4a3d"/>
  <rect x="20" y="20" width="472" height="472" rx="112" fill="none" stroke="#c9a227" stroke-width="22"/>
  <circle cx="256" cy="256" r="205" fill="#27604e"/>
  <g transform="translate(232 261) rotate(-11.5)">
    <rect x="-77" y="-108" width="154" height="215" rx="18" fill="#f4ecd8"/>
  </g>
  <g transform="translate(282 256) rotate(6.9)">
    <rect x="-77" y="-108" width="154" height="215" rx="18" fill="#f4ecd8"/>
    <path d="M0 -90 L30 -44 L0 0 L-30 -44 Z" fill="#b3382f"/>
    <g fill="#241e1a" transform="translate(0 44)">
      <circle cx="0" cy="-28" r="18"/>
      <circle cx="-32" cy="5" r="18"/>
      <circle cx="32" cy="5" r="18"/>
      <path d="M-7 0 L7 0 L16 59 L-16 59 Z"/>
    </g>
  </g>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');
