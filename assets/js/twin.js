/* ═══════════════════════════════════════════════════════════════════════
   EPSILON LABS — the station twin

   A port of the digital twin built for eFuelPro (IsometricStation.js, React
   Three Fiber) to plain Three.js, so it runs on this site with no build
   step. The layout is the original's, dimension for dimension: a 40 x 30 m
   forecourt with lane markings, a 36 x 26 m canopy at 12 m on six pillars,
   and six double-sided dispensers at x = ±4 m, z = -10 / 0 / 10 m, each a
   1.8 x 3.5 x 2.4 m body with a tilted screen on both faces.

   What changed: materials restyled to this site's palette, the client's
   signage removed, and the data is simulated — the original read the live
   ledger. Every dispenser label says DEMO so nobody mistakes it for a real
   station's numbers.

   Mounts into any element with data-demo="twin". Renders only while it is
   on screen and its tab is open; one static frame under reduced motion.
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from '../vendor/three.module.min.js';

const hosts = document.querySelectorAll('[data-demo="twin"]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Status colours from the original component. */
const STATUS = {
  active:  { color: 0x10b981, label: 'Active' },
  idle:    { color: 0xf59e0b, label: 'Idle' },
  offline: { color: 0xef4444, label: 'Offline' },
};

const PPL = 272.5;          // PKR per litre, illustrative

hosts.forEach((host) => {
  try { mount(host); }
  catch (err) {
    /* No WebGL, or anything else: leave the static fallback in place. */
    console.error('twin failed:', err);
  }
});

function mount(host) {
  const fallback = host.innerHTML;

  /* ── window chrome, matching the other demos ── */
  host.textContent = '';
  host.classList.add('is-live');
  const app = document.createElement('div');
  app.className = 'app app--twin';
  app.innerHTML =
    '<div class="app__bar"><span class="app__dots"></span>' +
    '<span class="app__title">Digital twin — Station 01</span>' +
    '<span class="app__badge">Demo data</span></div>';
  const stage = document.createElement('div');
  stage.className = 't__stage';
  const canvas = document.createElement('canvas');
  canvas.className = 't__canvas';
  canvas.setAttribute('aria-label', 'Interactive 3D model of a fuel station. Drag to orbit, click a dispenser for its live state.');
  canvas.setAttribute('role', 'img');
  stage.appendChild(canvas);

  const hud = document.createElement('div');
  hud.className = 't__hud';
  stage.appendChild(hud);

  const panel = document.createElement('div');
  panel.className = 't__panel';
  panel.hidden = true;
  stage.appendChild(panel);

  const hint = document.createElement('p');
  hint.className = 't__hint';
  hint.textContent = 'Drag to orbit · scroll to zoom · click a dispenser';
  stage.appendChild(hint);

  app.appendChild(stage);
  host.appendChild(app);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    host.innerHTML = fallback;
    host.classList.remove('is-live');
    throw err;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x08090a, 55, 120);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 300);

  /* ── light ── */
  scene.add(new THREE.HemisphereLight(0xcfe7ff, 0x0b0d10, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(18, 30, 22);
  scene.add(sun);
  /* The canopy lights the forecourt from above, as a real one does at night. */
  [-10, 0, 10].forEach((z) => {
    const l = new THREE.PointLight(0xfff1dc, 22, 34, 1.2);
    l.position.set(0, 10.8, z);
    scene.add(l);
  });

  const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, extra));

  /* ── ground: 40 x 30, lanes at z = ±5, centre line ── */
  /* Low metalness on purpose: with no environment map, a metallic floor has
     nothing to reflect and renders as a black hole. */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), mat(0x1f262a, { roughness: 0.85, metalness: 0.05 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const lane = mat(0xd2793c, { emissive: 0xd2793c, emissiveIntensity: 0.25 });
  [-5, 5].forEach((z) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(40, 0.05, 0.3), lane);
    l.position.set(0, 0.03, z);
    scene.add(l);
  });
  const centre = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 30), lane);
  centre.position.y = 0.03;
  scene.add(centre);
  /* A faint 2 m grid, so the eye can read scale on an otherwise flat slab. */
  const grid = new THREE.GridHelper(40, 20, 0x2e373c, 0x252c30);
  grid.scale.z = 30 / 40;
  grid.position.y = 0.012;
  scene.add(grid);
  /* The apron around the forecourt, so it does not float in space. */
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), mat(0x0e1113, { roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);

  /* ── canopy: 36 x 26 at y = 12, pillars at x = ±8 ── */
  /* Translucent, as operational twins usually render a roof: from the default
     three-quarter view an opaque canopy hides every pump underneath it. */
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(36, 1, 26),
    mat(0x2a3136, { metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false }));
  canopy.position.y = 12;
  scene.add(canopy);
  /* The lit fascia is a rim of four bars, not a slab: a solid 36 x 26 box
     glowed straight through the translucent roof and turned it orange. */
  const fasciaMat = mat(0xd2793c, { emissive: 0xd2793c, emissiveIntensity: 0.9 });
  [[36.2, 0.22, 0.22, 0, 13], [36.2, 0.22, 0.22, 0, -13],
   [0.22, 0.22, 26.2, 18, 0], [0.22, 0.22, 26.2, -18, 0]].forEach(([w, h, d, x, z]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fasciaMat);
    bar.position.set(x, 11.45, z);
    scene.add(bar);
  });
  const pillarMat = mat(0x2a3136, { metalness: 0.5, roughness: 0.35 });
  [-10, 0, 10].forEach((z) => [-8, 8].forEach((x) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 12, 20), pillarMat);
    p.position.set(x, 6, z);
    scene.add(p);
  }));

  /* ── dispensers ── */
  const POS = [[-4, -10], [4, -10], [-4, 0], [4, 0], [-4, 10], [4, 10]];
  const bodyMat = mat(0xe9edf0, { roughness: 0.35, metalness: 0.2 });
  /* One shared hover material — cloning per mouse-over leaked a material
     (and a GPU program handle) every time the cursor crossed a dispenser. */
  const hoverMat = mat(0xe9edf0, { roughness: 0.35, metalness: 0.2, emissive: 0xd2793c, emissiveIntensity: 0.35 });
  const units = [];
  const pickables = [];

  POS.forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 28), mat(0x2a3136));
    base.position.y = 0.1;
    g.add(base);

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.5, 2.4), bodyMat);
    body.position.y = 1.75;
    g.add(body);

    /* Two faces, two dispensers: front is 1-6, back is 7-12 — the original's
       numbering, where each back face is its own metered pump. */
    const faces = [];
    [1, -1].forEach((dir, side) => {
      const face = new THREE.Group();
      face.rotation.y = side ? Math.PI : 0;

      const screenCanvas = document.createElement('canvas');
      screenCanvas.width = 256; screenCanvas.height = 160;
      const tex = new THREE.CanvasTexture(screenCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.0, 0.08),
        [mat(0x0b0d10), mat(0x0b0d10), mat(0x0b0d10), mat(0x0b0d10),
         new THREE.MeshBasicMaterial({ map: tex }), mat(0x0b0d10)]
      );
      screen.position.set(0, 2.75, 1.24);
      screen.rotation.x = -Math.PI / 12;
      face.add(screen);

      const light = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.2 }));
      light.position.set(0, 3.55, 1.22);
      face.add(light);

      /* Nozzle holsters */
      [-0.45, 0.45].forEach((nx) => {
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 12), mat(0x1c2124));
        n.position.set(nx, 1.7, 1.26);
        face.add(n);
      });

      g.add(face);
      const id = 'P' + String(side ? i + 7 : i + 1).padStart(2, '0');
      faces.push({
        id, light, tex, ctx: screenCanvas.getContext('2d'),
        status: 'idle', litres: 0, pkr: 0, today: 0, sales: 0, target: 0,
      });
    });

    body.userData.unit = i;
    pickables.push(body);
    scene.add(g);
    units.push({ group: g, faces, body, home: new THREE.Vector3(x, 0, z) });
  });

  /* ── simulated feed ── */
  let seed = 0x7A11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  units.forEach((u) => u.faces.forEach((f) => {
    f.today = 200 + rnd() * 900;
    f.sales = Math.round(f.today / 22);
    f.status = rnd() < 0.08 ? 'offline' : 'idle';
  }));

  function drawScreen(f) {
    const c = f.ctx;
    c.fillStyle = '#050b10'; c.fillRect(0, 0, 256, 160);
    c.fillStyle = STATUS[f.status].color === 0xef4444 ? '#ef4444' : '#39ff9a';
    c.font = '600 22px ui-monospace, Menlo, monospace';
    c.fillText(f.id + '  ' + STATUS[f.status].label.toUpperCase(), 14, 34);
    c.font = '600 40px ui-monospace, Menlo, monospace';
    c.fillText(f.litres.toFixed(2) + ' L', 14, 88);
    c.font = '500 24px ui-monospace, Menlo, monospace';
    c.fillStyle = '#a7f3d0';
    c.fillText('PKR ' + Math.round(f.pkr).toLocaleString('en-US'), 14, 128);
    c.fillStyle = '#5b6770';
    c.font = '500 14px ui-monospace, Menlo, monospace';
    c.fillText('DEMO', 206, 150);
    f.tex.needsUpdate = true;
  }

  function setLight(f) {
    const col = STATUS[f.status].color;
    f.light.material.color.setHex(col);
    f.light.material.emissive.setHex(col);
  }

  units.forEach((u) => u.faces.forEach((f) => { setLight(f); drawScreen(f); }));

  /* A nozzle lifts, fuel flows, the sale closes. Only on idle faces. */
  let nextSale = 0;
  function tickSales(t, dt) {
    units.forEach((u) => u.faces.forEach((f) => {
      if (f.status !== 'active') return;
      f.litres = Math.min(f.target, f.litres + dt * 1.4);
      f.pkr = f.litres * PPL;
      if (f.litres >= f.target) {
        f.status = 'idle';
        f.today += f.litres; f.sales += 1;
        setLight(f);
        if (focused && focused.faces.includes(f)) showPanel(focused);
      }
      drawScreen(f);
    }));
    if (t > nextSale) {
      const idle = [];
      units.forEach((u) => u.faces.forEach((f) => { if (f.status === 'idle') idle.push(f); }));
      if (idle.length) {
        const f = idle[Math.floor(rnd() * idle.length)];
        f.status = 'active';
        f.litres = 0; f.pkr = 0;
        f.target = 6 + rnd() * 34;
        setLight(f);
      }
      nextSale = t + 1.2 + rnd() * 1.8;
    }
    updateHud();
  }

  function updateHud() {
    let active = 0, litres = 0, sales = 0, offline = 0;
    units.forEach((u) => u.faces.forEach((f) => {
      if (f.status === 'active') active++;
      if (f.status === 'offline') offline++;
      litres += f.today; sales += f.sales;
    }));
    hud.innerHTML =
      '<div><span>Pumps active</span><b>' + active + ' / 12</b></div>' +
      '<div><span>Litres today</span><b>' + Math.round(litres).toLocaleString('en-US') + '</b></div>' +
      '<div><span>Sales today</span><b>' + sales + '</b></div>' +
      '<div><span>Offline</span><b class="' + (offline ? 'is-bad' : '') + '">' + offline + '</b></div>';
  }

  /* ── camera: a small orbit controller, no extra dependency ── */
  const orbit = { theta: 0.55, phi: 1.2, radius: 50, target: new THREE.Vector3(0, 2.5, 0) };
  const goal = { theta: orbit.theta, phi: orbit.phi, radius: orbit.radius, target: orbit.target.clone() };
  let focused = null;

  function place() {
    const s = Math.sin(orbit.phi);
    camera.position.set(
      orbit.target.x + orbit.radius * s * Math.sin(orbit.theta),
      orbit.target.y + orbit.radius * Math.cos(orbit.phi),
      orbit.target.z + orbit.radius * s * Math.cos(orbit.theta)
    );
    camera.lookAt(orbit.target);
  }

  let dragging = false, moved = 0, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      goal.theta -= dx * 0.006;
      goal.phi = Math.min(1.45, Math.max(0.35, goal.phi - dy * 0.005));
      lx = e.clientX; ly = e.clientY;
      wake();
    } else {
      hover(e);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    if (moved < 6) click(e);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal.radius = Math.min(90, Math.max(14, goal.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    wake();
  }, { passive: false });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? units[hit.object.userData.unit] : null;
  }

  let hovered = null;
  function hover(e) {
    const u = pick(e);
    if (u === hovered) return;
    if (hovered && hovered !== focused) hovered.body.material = bodyMat;
    hovered = u;
    canvas.style.cursor = u ? 'pointer' : 'grab';
    if (u && u !== focused) u.body.material = hoverMat;
    wake();
  }

  function click(e) {
    const u = pick(e);
    if (!u) { if (focused) unfocus(); return; }
    focus(u);
  }

  /* Fly to a dispenser, like the original's per-dispenser camera. */
  function focus(u) {
    focused = u;
    goal.target.set(u.home.x, 2.4, u.home.z);
    goal.radius = 13;
    goal.phi = 1.18;
    showPanel(u);
    wake();
  }

  function unfocus() {
    focused = null;
    goal.target.set(0, 2.5, 0);
    goal.radius = 50;
    goal.phi = 1.2;
    panel.hidden = true;
    wake();
  }

  function showPanel(u) {
    const [a, b] = u.faces;
    const row = (f) =>
      '<div class="t__face"><span class="t__dot" style="background:#' +
      STATUS[f.status].color.toString(16).padStart(6, '0') + '"></span>' +
      '<b>' + f.id + '</b><span>' + STATUS[f.status].label + '</span>' +
      '<span>' + Math.round(f.today).toLocaleString('en-US') + ' L today</span>' +
      '<span>' + f.sales + ' sales</span></div>';
    panel.innerHTML =
      '<p class="t__k">Island ' + (units.indexOf(u) + 1) + '</p>' + row(a) + row(b) +
      '<button type="button" class="t__back">← Whole station</button>';
    panel.querySelector('.t__back').addEventListener('click', unfocus);
    panel.hidden = false;
  }

  /* ── resize + loop ── */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return false;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }
  new ResizeObserver(() => { if (resize()) wake(); }).observe(stage);

  let running = false, raf = 0, visible = false, last = 0, clock = 0;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    clock += dt;

    const k = 1 - Math.pow(0.002, dt);
    orbit.theta += (goal.theta - orbit.theta) * k;
    orbit.phi += (goal.phi - orbit.phi) * k;
    orbit.radius += (goal.radius - orbit.radius) * k;
    orbit.target.lerp(goal.target, k);

    /* A slow idle turn when nobody is interacting and nothing is focused. */
    if (!dragging && !focused && !reduced) goal.theta += dt * 0.05;

    if (!reduced) tickSales(clock, dt);
    place();
    renderer.render(scene, camera);

    if (running) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (reduced) { place(); renderer.render(scene, camera); return; }
    if (!running && visible) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function sleep() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  /* Render only while on screen and inside an open tab. */
  const io = new IntersectionObserver((es) => {
    visible = es[0].isIntersecting && !host.closest('[hidden]');
    if (visible) { resize(); wake(); } else sleep();
  }, { threshold: 0.05 });
  io.observe(host);
  host.addEventListener('demo:show', () => { visible = !host.closest('[hidden]'); resize(); wake(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sleep(); else if (visible) wake(); });

  resize();
  updateHud();
  place();
  renderer.render(scene, camera);
}
