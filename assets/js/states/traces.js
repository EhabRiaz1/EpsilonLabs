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
   board revs you edit the millimetres and nothing else.
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
 * TRACES — the board, as n points.
 * Budget: outline and holes read as the object's silhouette, so they get a
 * disproportionate share; the ground pour is deliberately sparse because a
 * dense fill would swallow the routing.
 */
export function tracesState(n, opts = {}) {
  const { tilt = -0.16 } = opts;
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

  // The board is laid back a little so it reads as an object on a bench
  // rather than a flat plan view.
  const c = Math.cos(tilt), s = Math.sin(tilt);
  for (let k = 0; k < n; k++) {
    const y = out[k * 3 + 1], z = out[k * 3 + 2];
    out[k * 3 + 1] = y * c - z * s;
    out[k * 3 + 2] = y * s + z * c;
  }

  return out;
}
