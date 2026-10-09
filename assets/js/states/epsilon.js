/* ═══════════════════════════════════════════════════════════════════════
   STATE: EPSILON  ·  MARK

   The mark, as a point cloud. The glyph is not drawn by hand here — it is
   rasterised from assets/brand/epsilon.svg, which was itself traced out of
   the 120px epsilon that boots on the Epsilon1's TFT. The hero of this
   site is the same shape that lights up on the hardware.

   Both states share one sampling pass; MARK is the same cloud, small and
   parked, so the morph between them costs nothing extra.
   ═══════════════════════════════════════════════════════════════════════ */

import { rng } from '../lib/rng.js';

/* Resolved against this module, not against the document — otherwise the
   glyph 404s on every page that is not at the site root. */
const SVG = new URL('../../brand/epsilon.svg', import.meta.url).href;

/* Rasterise once, reuse for every state that needs the glyph. */
let sampledPromise = null;

/**
 * Rejection-sample the glyph's alpha channel into unit-space points.
 * Returns {pts: Float32Array(n*2), n} with x,y in [-0.5, 0.5], y up.
 */
function sampleGlyph(url, target) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';

    img.onerror = () => reject(new Error(`scene: could not load ${url}`));
    img.onload = () => {
      // Raster tall enough that the sample grid is finer than the point
      // spacing — otherwise the cloud inherits a visible pixel lattice.
      const H = 720;
      const W = Math.max(1, Math.round(H * (img.width / img.height || 0.73)));

      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (!g) { reject(new Error('scene: no 2d context')); return; }
      g.drawImage(img, 0, 0, W, H);

      let data;
      try {
        data = g.getImageData(0, 0, W, H).data;
      } catch (err) {
        // Tainted canvas — only possible if the SVG is served cross-origin.
        reject(new Error('scene: glyph canvas is tainted (serve the site over http)'));
        return;
      }

      // Build a list of filled pixels once, then draw from it with jitter.
      // Cheaper and far more even than blind rejection sampling.
      const filled = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (data[(y * W + x) * 4 + 3] > 127) filled.push(y * W + x);
        }
      }
      if (!filled.length) { reject(new Error('scene: glyph rasterised empty')); return; }

      const rand = rng(0x5C0FFEE);
      const pts = new Float32Array(target * 2);
      const aspect = W / H;

      for (let i = 0; i < target; i++) {
        const p = filled[(rand() * filled.length) | 0];
        const px = (p % W) + rand();
        const py = ((p / W) | 0) + rand();
        pts[i * 2]     = (px / W - 0.5) * aspect;
        pts[i * 2 + 1] = (0.5 - py / H);          // flip: canvas y is down
      }

      resolve({ pts, n: target, aspect });
    };

    img.src = url;
  });
}

export function loadGlyph(url, target) {
  if (!sampledPromise) sampledPromise = sampleGlyph(url || SVG, target);
  return sampledPromise;
}

/**
 * EPSILON — the mark at hero scale, standing up in the middle of the frame.
 * Given a little depth so it reads as a slab of points rather than a decal.
 */
export function epsilonState(glyph, n, opts = {}) {
  const { scale = 15, depth = 0.55, z = 0 } = opts;
  const out = new Float32Array(n * 3);
  const rand = rng(0xE9511011);

  for (let i = 0; i < n; i++) {
    const gx = glyph.pts[(i % glyph.n) * 2];
    const gy = glyph.pts[(i % glyph.n) * 2 + 1];

    // Depth is correlated with position, not pure noise, so the slab has a
    // gentle bow to it and catches the light unevenly as the camera drifts.
    const bow = Math.cos(gx * 2.2) * 0.35 + Math.sin(gy * 1.7) * 0.25;

    out[i * 3]     = gx * scale;
    out[i * 3 + 1] = gy * scale;
    out[i * 3 + 2] = z + bow * depth + (rand() - 0.5) * depth;
  }
  return out;
}

/**
 * MARK — the same glyph, collapsed small and parked out on the right, clear
 * of the column the copy runs in, so a long reading page keeps the object on
 * screen without it competing for the same space as the text.
 */
export function markState(glyph, n, opts = {}) {
  const { scale = 4.6, x = 9, y = -5.2, depth = 0.3 } = opts;
  const out = new Float32Array(n * 3);
  const rand = rng(0x4A4B4C);

  for (let i = 0; i < n; i++) {
    const gx = glyph.pts[(i % glyph.n) * 2];
    const gy = glyph.pts[(i % glyph.n) * 2 + 1];
    out[i * 3]     = x + gx * scale;
    out[i * 3 + 1] = y + gy * scale;
    out[i * 3 + 2] = (rand() - 0.5) * depth;
  }
  return out;
}
