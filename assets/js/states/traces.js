/* ═══════════════════════════════════════════════════════════════════════
   STATE: TRACES

   Epsilon1, drawn in points. Not a generic circuit-board texture — the
   dimensions below are the ones in
   hardware/epsilon1-pcb/README.md: a 120 x 120 mm 2-layer FR4 board, four
   M3 mounting holes inset 5 mm, the MSP4031 TFT portrait on the left, the
   RC522 portrait top-right, three status LEDs in a column between them,
   the ESP32-S3-DevKitC-1 centred on the back with its USB-C facing the
   bottom edge, the barrel jack bottom-left, RS485 on the right edge, and
   the 3-pin dispenser terminal on the right.

   Everything is specified in millimetres and converted once, so if the
   board revs you edit the millimetres and nothing else. Since 2026-10 it
   sits at the centre of a small constellation of other boards; see below.
   ═══════════════════════════════════════════════════════════════════════ */

import { rng } from '../lib/rng.js';

const BOARD = 120;          // mm, square
const MM = 20 / BOARD;      // 20 world units across the board
const mm = (v) => v * MM;

/* ── the real placement, in mm, origin at board centre ──────────────── */

const MODULES = [
  { id: 'tft',   x: -28, y:   0, w: 56, h: 92, side: 'front' },
  { id: 'rfid',  x:  34, y:  28, w: 40, h: 60, side: 'front' },
  { id: 'term',  x:  50, y: -32, w: 16, h: 11, side: 'front' },
  { id: 'esp',   x:   0, y:   0, w: 26, h: 63, side: 'back'  },
  { id: 'jack',  x: -45, y: -47, w: 15, h: 10, side: 'back'  },
  { id: 'rs485', x:  46, y:   2, w: 16, h: 36, side: 'back'  },
  { id: 'btn',   x:  42, y: -47, w:  8, h:  8, side: 'back'  },
];

const LEDS = [
  { x: 6, y: 10 }, { x: 6, y: 2 }, { x: 6, y: -6 },
];

const HOLES = [
  { x: -55, y: -55 }, { x: 55, y: -55 }, { x: -55, y: 55 }, { x: 55, y: 55 },
];

/* ── segment building ───────────────────────────────────────────────── */

function seg(list, ax, ay, bx, by) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len > 0.001) list.push({ ax, ay, bx, by, len });
}

function rect(list, cx, cy, w, h) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  seg(list, x0, y0, x1, y0);
  seg(list, x1, y0, x1, y1);
  seg(list, x1, y1, x0, y1);
  seg(list, x0, y1, x0, y0);
}

function circle(list, cx, cy, r, steps = 28) {
  let px = cx + r, py = cy;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const nx = cx + Math.cos(t) * r;
    const ny = cy + Math.sin(t) * r;
    seg(list, px, py, nx, ny);
    px = nx; py = ny;
  }
}

/**
 * A routed trace: horizontal, then a 45 degree mitre, then vertical. This
 * is how the power nets on this board actually run — orthogonal with the
 * corners broken, never a right angle in copper.
 */
function route(list, ax, ay, bx, by, bias = 0.5) {
  const midX = ax + (bx - ax) * bias;
  const sy = Math.sign(by - ay) || 1;
  const sx = Math.sign(bx - midX) || 1;
  const mitre = Math.min(Math.abs(by - ay) / 2, Math.abs(bx - midX), 6);

  seg(list, ax, ay, midX, ay);                                   // out
  seg(list, midX, ay, midX, by - sy * mitre);                    // across
  seg(list, midX, by - sy * mitre, midX + sx * mitre, by);       // the break
  seg(list, midX + sx * mitre, by, bx, by);                      // in
}

/* ── the board ──────────────────────────────────────────────────────── */

function buildBoard() {
  const outline = [];
  const modules = [];
  const traces = [];
  const pads = [];

  // edge cuts
  rect(outline, 0, 0, BOARD, BOARD);
  HOLES.forEach((h) => circle(outline, h.x, h.y, 3.2, 24));

  // footprints
  MODULES.forEach((m) => rect(modules, m.x, m.y, m.w, m.h));
  LEDS.forEach((l) => circle(modules, l.x, l.y, 1.6, 14));

  // routing — power out of the jack, signal into the modules
  const esp = MODULES.find((m) => m.id === 'esp');
  const tft = MODULES.find((m) => m.id === 'tft');
  const rfid = MODULES.find((m) => m.id === 'rfid');
  const rs = MODULES.find((m) => m.id === 'rs485');
  const jack = MODULES.find((m) => m.id === 'jack');
  const term = MODULES.find((m) => m.id === 'term');

  // 5V bus from the barrel jack up the left flank
  route(traces, jack.x + 7, jack.y + 2, esp.x - 13, esp.y - 22, 0.35);
  route(traces, jack.x + 7, jack.y + 5, tft.x - 20, tft.y - 40, 0.2);

  // ESP32 -> TFT: the parallel bus, eight lines running together
  for (let i = 0; i < 8; i++) {
    const oy = -18 + i * 5;
    route(traces, esp.x - 13, esp.y + oy, tft.x + 28, tft.y + oy * 0.9, 0.45);
  }

  // ESP32 -> RC522: SPI, four lines
  for (let i = 0; i < 4; i++) {
    const oy = 8 + i * 4;
    route(traces, esp.x + 13, esp.y + oy, rfid.x - 20, rfid.y - 22 + i * 4, 0.5);
  }

  // ESP32 -> RS485 -> dispenser terminal
  route(traces, esp.x + 13, esp.y - 4, rs.x - 8, rs.y + 4, 0.6);
  route(traces, esp.x + 13, esp.y - 9, rs.x - 8, rs.y - 2, 0.6);
  route(traces, rs.x, rs.y - 18, term.x - 4, term.y + 4, 0.5);

  // status LEDs off the ESP
  LEDS.forEach((l, i) => route(traces, esp.x + 13, esp.y + 14 + i * 3, l.x - 2, l.y, 0.5));

  // pads: a fanout of stubs along each module edge
  const rand = rng(0xB0A2D);
  MODULES.forEach((m) => {
    const n = Math.max(4, Math.round(m.h / 6));
    for (let i = 0; i < n; i++) {
      const y = m.y - m.h / 2 + ((i + 0.5) / n) * m.h;
      const s = m.x > 0 ? -1 : 1;
      seg(pads, m.x + s * (m.w / 2), y, m.x + s * (m.w / 2 + 3.5), y);
    }
  });

  return { outline, modules, traces, pads };
}

/* ── sampling ───────────────────────────────────────────────────────── */

function sampleSegments(segments, count, rand, jitter, out, offset) {
  const total = segments.reduce((s, g) => s + g.len, 0);
  if (total <= 0 || count <= 0) return offset;

  // Walk the segment list once, handing each segment its share of points.
  let i = offset;
  let carry = 0;
  const per = total / count;

  for (const g of segments) {
    let n = (g.len + carry) / per;
    const take = Math.floor(n);
    carry = (n - take) * per;
    for (let k = 0; k < take && i < offset + count; k++) {
      const t = (k + rand() * 0.9) / Math.max(take, 1);
      const nx = -(g.by - g.ay) / g.len;
      const ny = (g.bx - g.ax) / g.len;
      const j = (rand() - 0.5) * jitter;
      out[i * 3]     = mm(g.ax + (g.bx - g.ax) * t + nx * j);
      out[i * 3 + 1] = mm(g.ay + (g.by - g.ay) * t + ny * j);
      out[i * 3 + 2] = (rand() - 0.5) * 0.12;
      i++;
    }
  }
  // Top up any shortfall from rounding by repeating random segments.
  while (i < offset + count) {
    const g = segments[(rand() * segments.length) | 0];
    const t = rand();
    out[i * 3]     = mm(g.ax + (g.bx - g.ax) * t);
    out[i * 3 + 1] = mm(g.ay + (g.by - g.ay) * t);
    out[i * 3 + 2] = (rand() - 0.5) * 0.12;
    i++;
  }
  return i;
}

/**
 * The Epsilon1 board on its own, as n points in board-local world units.
 * Budget: outline and holes read as the object's silhouette, so they get a
 * disproportionate share; the ground pour is deliberately sparse because a
 * dense fill would swallow the routing.
 */
function epsilon1Points(n) {
  const { outline, modules, traces, pads } = buildBoard();
  const out = new Float32Array(n * 3);
  const rand = rng(0xB0A2D);

  const nOutline = Math.round(n * 0.16);
  const nModules = Math.round(n * 0.20);
  const nPads    = Math.round(n * 0.09);
  const nPour    = Math.round(n * 0.10);
  const nTraces  = n - nOutline - nModules - nPads - nPour;

  let i = 0;
  i = sampleSegments(outline, nOutline, rand, 0.5, out, i);
  i = sampleSegments(modules, nModules, rand, 0.6, out, i);
  i = sampleSegments(traces,  nTraces,  rand, 0.55, out, i);
  i = sampleSegments(pads,    nPads,    rand, 0.4,  out, i);

  // ground pour: a loose grid across the board, skipping the module areas
  const half = BOARD / 2 - 2;
  for (; i < n; i++) {
    let x, y, tries = 0;
    do {
      x = (rand() * 2 - 1) * half;
      y = (rand() * 2 - 1) * half;
      tries++;
    } while (tries < 6 && MODULES.some((m) =>
      Math.abs(x - m.x) < m.w / 2 && Math.abs(y - m.y) < m.h / 2));
    out[i * 3]     = mm(x);
    out[i * 3 + 1] = mm(y);
    out[i * 3 + 2] = -0.35 + (rand() - 0.5) * 0.1;
  }

  return out;
}

/* ── the boards around it ─────────────────────────────────────────────
   Epsilon1 is the nucleus; around it, on two faint orbits, sit four
   denser boards of the kinds we lay out: a compute module, an RF front
   end, a power stage and an FPGA carrier. They are drawn from typical
   footprints rather than from any client's layout. Same millimetres,
   same sampler, so they read as one family with the board in the middle. */

function dots(list, cx, cy, cols, rows, pitch, r = 0.35) {
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      circle(list, cx + (i - (cols - 1) / 2) * pitch, cy + (j - (rows - 1) / 2) * pitch, r, 6);
    }
  }
}

/** A trace that zig-zags to add length, the way DDR lines are matched. */
function serpentine(list, ax, ay, bx, amp, turns) {
  const step = (bx - ax) / (turns * 2);
  let x = ax;
  for (let k = 0; k < turns * 2; k++) {
    const up = k % 2 ? -amp : amp;
    seg(list, x, ay, x, ay + up);
    seg(list, x, ay + up, x + step, ay + up);
    seg(list, x + step, ay + up, x + step, ay);
    x += step;
  }
}

/** Pins on all four sides of a square package, and a fan-out from each. */
function qfp(parts, pads, traces, cx, cy, size, perSide, reach) {
  rect(parts, cx, cy, size, size);
  const h = size / 2, pitch = size / (perSide + 1);
  for (let i = 1; i <= perSide; i++) {
    const o = -h + i * pitch;
    seg(pads, cx + o, cy + h, cx + o, cy + h + 1.8);
    seg(pads, cx + o, cy - h, cx + o, cy - h - 1.8);
    seg(pads, cx + h, cy + o, cx + h + 1.8, cy + o);
    seg(pads, cx - h, cy + o, cx - h - 1.8, cy + o);
    if (i % 2) {
      const spread = 1 + (o / h) * 0.45;
      seg(traces, cx + o, cy + h + 1.8, cx + o * spread, cy + h + reach);
      seg(traces, cx + o, cy - h - 1.8, cx + o * spread, cy - h - reach);
      seg(traces, cx + h + 1.8, cy + o, cx + h + reach, cy + o * spread);
      seg(traces, cx - h - 1.8, cy + o, cx - h - reach, cy + o * spread);
    }
  }
}

function computeModule() {                       // 80 x 55 mm
  const outline = [], parts = [], traces = [], pads = [];
  rect(outline, 0, 0, 80, 55);
  [[-36, -23.5], [36, -23.5], [-36, 23.5], [36, 23.5]].forEach(([x, y]) => circle(outline, x, y, 1.6, 16));
  rect(parts, -14, 2, 22, 22);                   // the SoC, a BGA
  dots(parts, -14, 2, 9, 9, 2.2, 0.4);
  rect(parts, 16, 13, 16, 10);                   // two DDR packages
  rect(parts, 16, -9, 16, 10);
  for (let i = 0; i < 6; i++) {                  // length-matched data lanes
    serpentine(traces, -3, 9 + i * 1.6, 8, 0.8, 3);
    serpentine(traces, -3, -5 - i * 1.6, 8, 0.8, 3);
  }
  rect(parts, -30, -16, 8, 8);                   // PMIC
  route(traces, -26, -16, -20, -9, 0.5);
  for (let i = 0; i < 34; i++) seg(pads, -34 + i * 2, -27.5, -34 + i * 2, -23.5);   // edge fingers
  for (let i = 0; i < 14; i++) rect(parts, 31, 18 - i * 2.6, 2, 1.1);            // decoupling
  return { outline, parts, traces, pads };
}

function rfBoard() {                             // 60 x 40 mm
  const outline = [], parts = [], traces = [], pads = [];
  rect(outline, 0, 0, 60, 40);
  rect(parts, -10, 0, 24, 20);                   // shield can, with its via fence
  for (let i = 0; i <= 12; i++) {
    circle(pads, -22 + i * 2, 12, 0.35, 6);
    circle(pads, -22 + i * 2, -12, 0.35, 6);
  }
  for (let i = 0; i <= 10; i++) {
    circle(pads, -24, -10 + i * 2, 0.35, 6);
    circle(pads, 4, -10 + i * 2, 0.35, 6);
  }
  rect(parts, -10, 0, 8, 8);                     // transceiver inside the can
  seg(traces, 2, 0, 18, 0);                      // 50-ohm feed out of the can
  for (let i = 0; i < 8; i++) {                  // stitching beside the feed
    circle(pads, 5 + i * 2, 2, 0.3, 6);
    circle(pads, 5 + i * 2, -2, 0.3, 6);
  }
  circle(parts, 20, 0, 2.2, 18);                 // u.FL
  let y = 16;                                    // meandered PCB antenna
  for (let k = 0; k < 6; k++) {
    seg(traces, 22, y, 28, y);
    seg(traces, k % 2 ? 22 : 28, y, k % 2 ? 22 : 28, y - 5);
    y -= 5;
  }
  route(traces, 20, 2.2, 22, 16, 0.5);
  rect(parts, -24, -16, 10, 5);                  // connector
  for (let i = 0; i < 6; i++) route(traces, -28 + i * 1.6, -13.5, -18 + i * 0.6, -10, 0.5);
  return { outline, parts, traces, pads };
}

function powerStage() {                          // 70 x 50 mm
  const outline = [], parts = [], traces = [], pads = [];
  rect(outline, 0, 0, 70, 50);
  [[-31, -21], [31, -21], [-31, 21], [31, 21]].forEach(([x, y]) => circle(outline, x, y, 1.8, 16));
  [[-16, 10], [0, 10], [16, 10]].forEach(([x, y]) => {        // inductors
    circle(parts, x, y, 6, 30); circle(parts, x, y, 3.2, 20);
  });
  for (let i = 0; i < 6; i++) rect(parts, -20 + i * 8, -6, 6, 5);   // MOSFETs
  [[-24, -18], [-12, -18]].forEach(([x, y]) => circle(parts, x, y, 4, 24));   // bulk caps
  rect(parts, 22, -16, 14, 10);                  // terminal block
  rect(parts, 26, 6, 8, 8);                      // controller
  for (let i = 0; i < 6; i++) route(traces, -20 + i * 8, -3.5, -16 + Math.floor(i / 2) * 16, 4, 0.5);
  for (let i = 0; i < 3; i++) {                  // wide copper: drawn as paired edges
    route(traces, -16 + i * 16, 16, 30, 20 - i, 0.7);
    route(traces, -16 + i * 16, 17.5, 30, 21.5 - i, 0.7);
  }
  for (let i = 0; i < 6; i++) route(traces, 22, 6 - 2 + i * 0.8, -20 + i * 8, -8.5, 0.6);
  route(traces, 22, -16, -12, -14, 0.5);
  return { outline, parts, traces, pads };
}

function fpgaBoard() {                           // 70 x 70 mm
  const outline = [], parts = [], traces = [], pads = [];
  rect(outline, 0, 0, 70, 70);
  [[-31, -31], [31, -31], [-31, 31], [31, 31]].forEach(([x, y]) => circle(outline, x, y, 1.8, 16));
  qfp(parts, pads, traces, 0, 0, 22, 18, 9);     // QFP-144 and its fan-out
  for (let i = 0; i < 20; i++) {                 // two rows of header holes
    circle(parts, -28 + i * 2.9, 30, 0.7, 8);
    circle(parts, -28 + i * 2.9, -30, 0.7, 8);
  }
  rect(parts, 24, 18, 6, 4);                     // oscillator
  rect(parts, -24, 18, 10, 6);                   // config flash
  for (let i = 0; i < 16; i++) {                 // decoupling ring
    const a = (i / 16) * Math.PI * 2;
    rect(parts, Math.cos(a) * 19, Math.sin(a) * 19, 1.6, 1);
  }
  return { outline, parts, traces, pads };
}

/** Sample one satellite board into out[offset .. offset+n). */
function boardPoints(board, n, rand, out, offset) {
  const { outline, parts, traces, pads } = board;
  const nOutline = Math.round(n * 0.2);
  const nParts = Math.round(n * 0.36);
  const nPads = Math.round(n * 0.12);
  const nTraces = n - nOutline - nParts - nPads;
  let i = offset;
  i = sampleSegments(outline, nOutline, rand, 0.35, out, i);
  i = sampleSegments(parts, nParts, rand, 0.3, out, i);
  i = sampleSegments(traces, nTraces, rand, 0.3, out, i);
  i = sampleSegments(pads, nPads, rand, 0.25, out, i);
  return i;
}

/** Scale, turn in plane, lean back, then move — in place, over a slice. */
function place(out, from, to, { x = 0, y = 0, z = 0, scale = 1, turn = 0, lean = 0 }) {
  const ct = Math.cos(turn), st = Math.sin(turn);
  const cl = Math.cos(lean), sl = Math.sin(lean);
  for (let k = from; k < to; k++) {
    let px = out[k * 3] * scale, py = out[k * 3 + 1] * scale, pz = out[k * 3 + 2] * scale;
    const rx = px * ct - py * st, ry = px * st + py * ct;
    out[k * 3]     = rx + x;
    out[k * 3 + 1] = ry * cl - pz * sl + y;
    out[k * 3 + 2] = ry * sl + pz * cl + z;
  }
}

const SATELLITES = [
  { build: computeModule, wide: { x: -20.5, y:  5.5, z: -3, scale: 0.85, turn:  0.10 }, tall: { x: -5.4, y:  12.5, z: -3, scale: 0.5, turn:  0.08 } },
  { build: rfBoard,       wide: { x: -19.5, y: -7.0, z: -1, scale: 0.95, turn: -0.08 }, tall: { x: -5.4, y: -12.5, z: -1, scale: 0.55, turn: -0.06 } },
  { build: powerStage,    wide: { x:  20.5, y:  6.0, z: -4, scale: 0.85, turn: -0.09 }, tall: { x:  5.6, y:  12.5, z: -4, scale: 0.5, turn: -0.07 } },
  { build: fpgaBoard,     wide: { x:  20.0, y: -6.5, z: -2, scale: 0.75, turn:  0.08 }, tall: { x:  5.4, y: -12.5, z: -2, scale: 0.45, turn:  0.06 } },
];

/**
 * TRACES — the Epsilon1 board on its own, laid back a little so it reads
 * as an object on a bench rather than a flat plan view.
 */
export function tracesState(n, opts = {}) {
  const { tilt = -0.16 } = opts;
  const out = epsilon1Points(n);
  place(out, 0, n, { lean: tilt });
  return out;
}

/**
 * CONSTELLATION — Epsilon1 in the middle, four boards in orbit around it.
 * Budget: the nucleus keeps half the points so it stays the subject; each
 * satellite gets a tenth, and the two orbit rings share what is left.
 * On a narrow screen the satellites stack above and below instead of
 * beside, so nothing falls off the side of a phone.
 */
export function constellationState(n, opts = {}) {
  const { tilt = -0.16, narrow = false } = opts;
  const out = new Float32Array(n * 3);
  const rand = rng(0x5A7E1);

  const nCore = Math.round(n * 0.5);
  const nSat = Math.round(n * 0.105);
  const nRing = n - nCore - nSat * SATELLITES.length;

  out.set(epsilon1Points(nCore));
  place(out, 0, nCore, { scale: narrow ? 0.55 : 0.8, lean: tilt });

  let i = nCore;
  SATELLITES.forEach((sat) => {
    const start = i;
    i = boardPoints(sat.build(), nSat, rand, out, i);
    place(out, start, i, { ...(narrow ? sat.tall : sat.wide), lean: tilt * 1.6 });
  });

  // two faint orbits, crossing behind the nucleus like an atom's shells
  const rx = narrow ? 8.5 : 23, ry = narrow ? 15 : 9;
  for (let k = 0; i < n; i++, k++) {
    const t = rand() * Math.PI * 2;
    const shell = k % 2 ? 1 : -1;
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    const a = shell * 0.18;
    out[i * 3]     = ex * Math.cos(a) - ey * Math.sin(a) + (rand() - 0.5) * 0.15;
    out[i * 3 + 1] = ex * Math.sin(a) + ey * Math.cos(a) + (rand() - 0.5) * 0.15;
    out[i * 3 + 2] = -5 + Math.sin(t) * 3 * shell;
  }

  return out;
}
