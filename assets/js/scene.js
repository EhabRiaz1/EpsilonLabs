/* ═══════════════════════════════════════════════════════════════════════
   EPSILON LABS — the field

   One scene. One object. It is the epsilon, held as a few tens of thousands
   of points, and it changes shape to match whatever the reader has scrolled
   to. It is never decoration: if a section does not name a state, the field
   does not move.

   States live in ./states/. Sections opt in with data-scene="<state>";
   an IntersectionObserver hands the most-visible one to setState().

   Morphing happens on the GPU. Two position attributes and one uniform —
   there is no per-frame CPU work over the point set, which is the only way
   this holds 60fps while the page is also scrolling.
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from '../vendor/three.module.min.js';
import { loadGlyph, epsilonState, markState } from './states/epsilon.js';
import { tracesState } from './states/traces.js';
import { latticeState } from './states/lattice.js';

const canvas = document.getElementById('scene');
if (!canvas) throw new Error('scene: no #scene canvas on this page');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

/* Point budget scales with the device. A phone that drops to 20fps looks
   broken; the same scene at 12k points looks deliberate. */
const COUNT = (() => {
  const w = innerWidth;
  const cores = navigator.hardwareConcurrency || 4;
  if (w < 700 || coarse) return 12000;
  if (w < 1200 || cores <= 4) return 26000;
  return 40000;
})();

/* ── palette — kept in step with assets/css/site.css ────────────────── */
const PALETTE = {
  ink:    new THREE.Color('#EDF0F1'),
  copper: new THREE.Color('#D2793C'),
  signal: new THREE.Color('#5FC6D6'),
  muted:  new THREE.Color('#8A949B'),
};

/* Tells the boot curtain the field has arrived. Fires once, and fires on the
   failure path too — a page that cannot draw the mark must not stay behind a
   black curtain. */
let readySent = false;
function ready() {
  if (readySent) return;
  readySent = true;
  document.dispatchEvent(new CustomEvent('epsilon:ready'));
}

/* ── renderer ───────────────────────────────────────────────────────── */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: true, powerPreference: 'high-performance',
  });
} catch (err) {
  /* No WebGL. Drop the canvas and mark the document so the CSS can stop
     reserving room for a thing that will never arrive. The site reads in
     full without it — that is the deal. */
  canvas.remove();
  document.documentElement.classList.add('no-webgl');
  ready();
  throw err;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearAlpha(0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
camera.position.set(0, 0, 46);

/* ── material ───────────────────────────────────────────────────────── */

const uniforms = {
  uMix:    { value: 0 },
  uTime:   { value: 0 },
  uSize:   { value: coarse ? 3.0 : 2.75 },
  uDpr:    { value: Math.min(devicePixelRatio, 2) },
  uColorA: { value: PALETTE.ink.clone() },
  uColorB: { value: PALETTE.ink.clone() },
  uArc:    { value: 1.0 },
  uDrift:  { value: reduced ? 0 : 1 },
  uAlpha:  { value: 1.0 },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    uniform float uMix, uTime, uSize, uDpr, uArc, uDrift;
    attribute vec3 aPosB;
    attribute vec3 aDir;
    attribute float aSeed;
    varying float vT;
    varying float vFleck;

    void main() {
      /* Stagger: every point runs the same 0->1 ramp, but starts at a
         different moment. The cloud reorganises as a wave instead of
         sliding as a block. */
      float lead = aSeed * 0.42;
      float t = clamp((uMix * 1.42 - lead) / 1.0, 0.0, 1.0);
      t = t * t * (3.0 - 2.0 * t);
      vT = t;

      vec3 pos = mix(position, aPosB, t);

      /* In transit each point bows out along its own axis, so the morph
         reads as matter being moved rather than values being lerped. */
      pos += aDir * sin(t * 3.14159265) * uArc * (0.7 + aSeed * 1.6);

      /* At rest, a slow suspension drift. Amplitude is deliberately below
         the threshold where it reads as "animated" — it reads as floating. */
      float d = uDrift * (1.0 - abs(t - 0.5) * 2.0 * 0.6);
      pos.x += sin(uTime * 0.21 + aSeed * 22.0) * 0.055 * d;
      pos.y += cos(uTime * 0.17 + aSeed * 31.0) * 0.055 * d;
      pos.z += sin(uTime * 0.13 + aSeed * 17.0) * 0.085 * d;


      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;

      /* Size attenuation, with a little per-point variance so the cloud has
         grain instead of reading as a uniform stipple. */
      float size = uSize * (0.55 + aSeed * 0.9);
      gl_PointSize = size * uDpr * (26.0 / max(-mv.z, 0.6));
      vFleck = aSeed;
    }
  `,
  fragmentShader: /* glsl */`
    precision mediump float;
    uniform vec3 uColorA, uColorB;
    uniform float uAlpha;
    varying float vT;
    varying float vFleck;

    void main() {
      /* Round, soft-edged point. Cheaper and sharper than a texture. */
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c);
      if (d > 0.25) discard;
      float a = smoothstep(0.25, 0.02, d);

      vec3 col = mix(uColorA, uColorB, vT);

      /* Points brighten as they travel, so a morph has a visible crest. */
      col += vec3(0.24) * sin(vT * 3.14159265);

      /* Additive blending stacks fast where the cloud is dense; hold the
         per-point alpha low so dense areas glow instead of clipping white.
         uAlpha trims the states that sit behind dense copy. */
      gl_FragColor = vec4(col, a * (0.30 + vFleck * 0.22) * uAlpha);
    }
  `,
});

/* ── geometry ───────────────────────────────────────────────────────── */

const geometry = new THREE.BufferGeometry();
const posA = new Float32Array(COUNT * 3);
const posB = new Float32Array(COUNT * 3);
const dirs = new Float32Array(COUNT * 3);
const seeds = new Float32Array(COUNT);

{
  // aDir: a unit vector per point, used as its arc axis during a morph.
  let s = 0x9E3779B9;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < COUNT; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    dirs[i * 3] = r * Math.cos(th);
    dirs[i * 3 + 1] = r * Math.sin(th);
    dirs[i * 3 + 2] = u;
    seeds[i] = rnd();
  }
}

geometry.setAttribute('position', new THREE.BufferAttribute(posA, 3));
geometry.setAttribute('aPosB', new THREE.BufferAttribute(posB, 3));
geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

const points = new THREE.Points(geometry, material);
scene.add(points);

/* ── states ─────────────────────────────────────────────────────────── */

/* Each entry: the point positions, the colour, where the camera sits, how
   far points bow out on the way in, and how bright the state is allowed to
   be. `alpha` is the legibility dial — states that sit behind a dense block
   of copy are held back so the type keeps winning. */
const STATES = {};
let current = null;

function scatterState(n) {
  /* A loose shell the mark assembles out of. Points start far enough back
     that the arrival reads as depth, not a fade. */
  const out = new Float32Array(n * 3);
  let seed = 0xA5511E;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = 26 + rnd() * 26;
    const s2 = Math.sqrt(Math.max(0, 1 - u * u));
    out[i * 3]     = r * s2 * Math.cos(th);
    out[i * 3 + 1] = r * s2 * Math.sin(th) * 0.7;
    out[i * 3 + 2] = u * r * 0.8 - 14;
  }
  return out;
}

function defineStates(glyph) {
  STATES.scatter = {
    pos: scatterState(COUNT),
    color: PALETTE.signal, cam: [0, 0, 46], arc: 0, alpha: 0.55,
  };
  STATES.epsilon = {
    pos: epsilonState(glyph, COUNT, { scale: 15 }),
    color: PALETTE.ink, cam: [0, 0, 31], arc: 2.6, alpha: 1.0,
  };
  STATES.traces = {
    pos: tracesState(COUNT),
    color: PALETTE.copper, cam: [0, -0.8, 38], arc: 2.0, alpha: 0.95,
  };
  STATES.lattice = {
    pos: latticeState(COUNT),
    color: PALETTE.signal, cam: [3.5, 1.8, 34], arc: 2.2, alpha: 1.0,
  };
  STATES.mark = {
    pos: markState(glyph, COUNT),
    color: PALETTE.muted, cam: [0, 0, 33], arc: 1.4, alpha: 0.9,
  };
}

/* ── camera ─────────────────────────────────────────────────────────── */

const camTarget = new THREE.Vector3(0, 0, 46);

/* Where the camera aims. Copy on this site is left-aligned, so on a wide
   viewport we aim left of the object, which throws the object into the
   right-hand half where there is nothing to read. Narrow viewports go
   single-column and full-width, so there is no empty half to aim for and
   the shift drops to zero — the scrim carries legibility instead. */
const lookTarget = new THREE.Vector3(0, 0, 0);
const lookEased = new THREE.Vector3(0, 0, 0);


/* Scroll gives the object a slow turn, so it reads as something sitting in
   space rather than a picture pinned behind the page.

   Bounded on purpose: a term linear in scrollY accumulates without limit and
   by the foot of a long page the mark had rotated far enough to stop reading
   as an epsilon. A sine keeps it turning continuously in both directions and
   can never exceed SPIN_MAX. */
const SPIN_MAX = 0.38;          // radians — about 22 degrees
let spin = 0, spinTarget = 0;
addEventListener('scroll', () => {
  spinTarget = Math.sin((scrollY || pageYOffset) * 0.00075) * SPIN_MAX;
}, { passive: true });

/* The home page frames the field like footage with the title centred over
   it, so there is no empty half to push the object into. */
const FRAMED = document.body.dataset.layout === 'panel';

function lookShift() {
  if (FRAMED || innerWidth < 900) return 0;
  return -9.5 * Math.min(1, (innerWidth - 900) / 460 + 0.4);
}

/* Narrow viewports go single-column and the copy runs full width, so there
   is no empty half to push the object into sideways. Aim below it instead,
   which lifts it clear of the text block rather than dimming the field. */
function lookRise() {
  if (FRAMED) return 0;
  return innerWidth < 900 ? -3.4 : 0;
}


/* ── transitions ────────────────────────────────────────────────────── */

const DURATION = 1350;
const ENTRANCE = 2300;
let anim = null;

function freezeCurrentInto(target, t) {
  /* Interrupting a morph: bake the positions the reader is actually looking
     at into A, so the new transition starts from what is on screen rather
     than snapping back to the last settled state. */
  const a = geometry.attributes.position.array;
  const b = geometry.attributes.aPosB.array;
  const e = t * t * (3 - 2 * t);
  for (let i = 0; i < a.length; i++) target[i] = a[i] + (b[i] - a[i]) * e;
}

function setState(name, opts = {}) {
  const next = STATES[name];
  if (!next || name === current) return;

  const instant = opts.instant || reduced;

  if (anim) {
    freezeCurrentInto(posA, anim.t);
    anim = null;
  } else if (current) {
    posA.set(STATES[current].pos);
  }

  posB.set(next.pos);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aPosB.needsUpdate = true;

  uniforms.uColorA.value.copy(current ? STATES[current].color : next.color);
  uniforms.uColorB.value.copy(next.color);
  uniforms.uArc.value = instant ? 0 : next.arc;

  camTarget.set(next.cam[0], next.cam[1], next.cam[2]);

  if (instant || !current) {
    posA.set(next.pos);
    uniforms.uMix.value = 0;
    uniforms.uColorA.value.copy(next.color);
    uniforms.uAlpha.value = next.alpha;
    geometry.attributes.position.needsUpdate = true;
    if (!current) {
      camera.position.copy(camTarget);
      lookEased.copy(lookTarget);
    }
  } else {
    uniforms.uMix.value = 0;
    anim = { t: 0, start: performance.now(), dur: opts.duration || DURATION };
  }

  current = name;

  /* No loop is running under reduced motion, so a state change has to paint
     itself or the field would freeze on whichever state booted first. */
  if (reduced && renderer) renderOnce();
}

/* ── resize ─────────────────────────────────────────────────────────── */

function resize() {
  const w = canvas.clientWidth || innerWidth;
  const h = canvas.clientHeight || innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  /* Pull back on narrow viewports so the object still fits the frame —
     otherwise the epsilon is cropped on a phone. */
  const fit = Math.min(1, w / 1100);
  camera.fov = 42 + (1 - fit) * 16;
  camera.updateProjectionMatrix();

  lookTarget.x = lookShift();
  lookTarget.y = lookRise();
  if (reduced && current) renderOnce();
}

addEventListener('resize', resize, { passive: true });

/* ── loop ───────────────────────────────────────────────────────────── */

let running = false;
let raf = 0;
const clock = new THREE.Clock();

function frame() {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  uniforms.uTime.value += dt;

  if (anim) {
    const p = Math.min(1, (performance.now() - anim.start) / anim.dur);
    anim.t = p;
    uniforms.uMix.value = p;
    if (p >= 1) {
      // Settle: the target becomes the new resting state.
      posA.set(STATES[current].pos);
      geometry.attributes.position.needsUpdate = true;
      uniforms.uMix.value = 0;
      uniforms.uColorA.value.copy(STATES[current].color);
      anim = null;
    }
  }

  /* Brightness eases rather than snapping, so a state change does not read
     as the lights being switched. */
  const wantAlpha = current ? STATES[current].alpha : 1;
  uniforms.uAlpha.value += (wantAlpha - uniforms.uAlpha.value) * (1 - Math.pow(0.02, dt));

  camera.position.lerp(camTarget, 1 - Math.pow(0.004, dt));

  lookEased.lerp(lookTarget, 1 - Math.pow(0.004, dt));
  camera.lookAt(lookEased);

  spin += (spinTarget - spin) * (1 - Math.pow(0.02, dt));
  points.rotation.y = spin;
  points.rotation.x = spin * 0.22;


  renderer.render(scene, camera);
}

/* Reduced motion means no animation loop — not no picture. Without this the
   renderer is never called at all and the field is simply absent, which is
   not what "static epsilon" was supposed to mean. */
function renderOnce() {
  camera.position.copy(camTarget);
  lookEased.copy(lookTarget);
  camera.lookAt(lookEased);
  uniforms.uAlpha.value = current ? STATES[current].alpha : 1;
  renderer.render(scene, camera);
}

function start() {
  if (reduced) { renderOnce(); return; }
  if (running) return;
  running = true;
  clock.getDelta();
  raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
}

/* Do not burn a GPU on a tab nobody is looking at. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else start();
});

/* ── choreography ───────────────────────────────────────────────────── */

function observeSections() {
  const marked = Array.from(document.querySelectorAll('[data-scene]'));
  if (!marked.length) return;

  if (!('IntersectionObserver' in window)) {
    setState(marked[0].dataset.scene, { instant: true });
    return;
  }

  /* Track how much of each marked section is showing and follow whichever
     is winning. Keying off elements rather than scroll offsets means copy
     edits never knock the choreography out of step. */
  const ratios = new Map();

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => ratios.set(en.target, en.isIntersecting ? en.intersectionRatio : 0));

    let best = null, bestRatio = 0;
    ratios.forEach((r, el) => {
      if (r > bestRatio) { bestRatio = r; best = el; }
    });
    if (best && bestRatio > 0.06) setState(best.dataset.scene);
  }, { threshold: [0, 0.06, 0.2, 0.4, 0.6, 0.85] });

  marked.forEach((el) => io.observe(el));
}

/* ── boot ───────────────────────────────────────────────────────────── */

const boot = document.body.dataset.scene || 'epsilon';


loadGlyph(undefined, Math.min(COUNT, 30000))
  .then((glyph) => {
    defineStates(glyph);
    resize();

    /* Arrive, rather than appear. The mark assembles out of a scattered
       shell while the camera pushes in — the one moment on the site that is
       pure spectacle, and it plays once. Reduced motion skips straight to
       the settled state. */
    if (reduced) {
      setState(boot, { instant: true });
      canvas.classList.add('is-live');
      start();
      ready();
    } else {
      setState('scatter', { instant: true });
      canvas.classList.add('is-live');
      start();
      requestAnimationFrame(() => setState(boot, { duration: ENTRANCE }));
      /* The curtain lifts while the mark is still settling: by here it is
         legible, and the last of the entrance plays behind the page as the
         field it becomes. chrome.html holds a 4s failsafe for the case where
         this line is never reached. */
      setTimeout(ready, ENTRANCE * 0.62);
    }

    observeSections();
  })
  .catch((err) => {
    /* The glyph is the one asset the field cannot be built without. If it
       fails, say so in the console and leave the page exactly as it reads
       without JavaScript — never a half-drawn scene. */
    console.error(err);
    canvas.remove();
    document.documentElement.classList.add('no-webgl');
    ready();
  });

export { setState };
