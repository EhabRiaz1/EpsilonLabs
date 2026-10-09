/* ═══════════════════════════════════════════════════════════════════════
   STATE: LATTICE

   The software half. Where TRACES is a plane — copper is two-dimensional,
   that is the whole constraint of the discipline — this is volumetric: a
   connected structure with depth, which is what a system looks like when
   you can put things anywhere.

   Nodes sit on a cubic lattice; most of the points ride the edges between
   them, so it reads as a graph rather than a dot cloud. Density falls off
   with distance from the centre so the thing has a silhouette.
   ═══════════════════════════════════════════════════════════════════════ */

import { rng } from '../lib/rng.js';

export function latticeState(n, opts = {}) {
  const {
    cols = 8, rows = 6, layers = 4,
    spacing = 3.2,
    jitter = 0.34,
    nodeShare = 0.26,
  } = opts;

  const out = new Float32Array(n * 3);
  const rand = rng(0x1A771CE);

  /* ── nodes ───────────────────────────────────────────────────────── */

  const nodes = [];
  const ox = ((cols - 1) * spacing) / 2;
  const oy = ((rows - 1) * spacing) / 2;
  const oz = ((layers - 1) * spacing) / 2;

  for (let z = 0; z < layers; z++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * spacing - ox;
        const py = y * spacing - oy;
        const pz = z * spacing - oz;

        // Radial falloff — corners of the box thin out and drop away, which
        // gives the structure an edge instead of a bounding cube.
        const r = Math.hypot(px / (ox + spacing), py / (oy + spacing), pz / (oz + spacing));
        if (rand() > 1.16 - r * 0.62) continue;

        nodes.push({
          x: px + (rand() - 0.5) * jitter,
          y: py + (rand() - 0.5) * jitter,
          z: pz + (rand() - 0.5) * jitter,
          gx: x, gy: y, gz: z,
        });
      }
    }
  }

  /* ── edges: orthogonal neighbours only ───────────────────────────── */

  const index = new Map();
  nodes.forEach((nd) => index.set(`${nd.gx},${nd.gy},${nd.gz}`, nd));

  const edges = [];
  for (const nd of nodes) {
    for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const other = index.get(`${nd.gx + dx},${nd.gy + dy},${nd.gz + dz}`);
      if (!other) continue;
      if (rand() > 0.88) continue;            // a lattice, not a solid block
      edges.push([nd, other, Math.hypot(other.x - nd.x, other.y - nd.y, other.z - nd.z)]);
    }
  }

  if (!nodes.length || !edges.length) {
    // Degenerate parameters would otherwise hand back a buffer of zeroes,
    // which renders as every point stacked at the origin.
    throw new Error('lattice: generated no structure — check cols/rows/layers');
  }

  /* ── distribute points ───────────────────────────────────────────── */

  const nNodes = Math.round(n * nodeShare);
  const nEdges = n - nNodes;

  // Nodes get a tight gaussian-ish cluster so they read as bright junctions.
  for (let i = 0; i < nNodes; i++) {
    const nd = nodes[(rand() * nodes.length) | 0];
    const s = 0.16;
    out[i * 3]     = nd.x + (rand() + rand() - 1) * s;
    out[i * 3 + 1] = nd.y + (rand() + rand() - 1) * s;
    out[i * 3 + 2] = nd.z + (rand() + rand() - 1) * s;
  }

  // Edges get points in proportion to their length.
  const total = edges.reduce((s, e) => s + e[2], 0);
  let i = nNodes;
  let carry = 0;
  const per = total / nEdges;

  for (const [a, b, len] of edges) {
    const share = (len + carry) / per;
    const take = Math.floor(share);
    carry = (share - take) * per;
    for (let k = 0; k < take && i < n; k++) {
      const t = (k + rand() * 0.85) / Math.max(take, 1);
      out[i * 3]     = a.x + (b.x - a.x) * t + (rand() - 0.5) * 0.06;
      out[i * 3 + 1] = a.y + (b.y - a.y) * t + (rand() - 0.5) * 0.06;
      out[i * 3 + 2] = a.z + (b.z - a.z) * t + (rand() - 0.5) * 0.06;
      i++;
    }
  }
  while (i < n) {
    const [a, b] = edges[(rand() * edges.length) | 0];
    const t = rand();
    out[i * 3]     = a.x + (b.x - a.x) * t;
    out[i * 3 + 1] = a.y + (b.y - a.y) * t;
    out[i * 3 + 2] = a.z + (b.z - a.z) * t;
    i++;
  }

  return out;
}
