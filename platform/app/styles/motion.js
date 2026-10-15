/* Epsilon platform · motion.js
   Copied from the approved design system (platform-v2-20261011). Only change: the prototype launcher
   commands ("Prototypes" group, links to *.html mockups) are removed from the command palette.
   Tiny, framework-free. Exposes window.Eps. Load in <head>; theme applies before first paint. */
(function () {
  "use strict";
  var Eps = {};
  var rm = matchMedia("(prefers-reduced-motion: reduce)");
  Eps.reduced = function () { return rm.matches; };
  var ms = function (n) { return rm.matches ? 0 : n; };

  /* ---- theme + accent (query > localStorage > page default) ---- */
  var html = document.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: theme still applies for this page */ } }
  };
  var q = new URLSearchParams(location.search);
  var THEMES = ["dark", "light"], ACCENTS = ["coral", "graphite", "copper"];
  function pick(key, allowed, fallback) {
    var v = q.get(key);
    if (allowed.indexOf(v) >= 0) { store.set("eps." + key, v); return v; }
    v = store.get("eps." + key);
    if (allowed.indexOf(v) >= 0) return v;
    return fallback;
  }
  Eps.theme = {
    get: function () { return html.getAttribute("data-theme"); },
    set: function (t) {
      html.setAttribute("data-theme", t); store.set("eps.theme", t);
      document.querySelectorAll("[data-theme-toggle]").forEach(function (b) { b.setAttribute("aria-label", t === "dark" ? "Switch to light" : "Switch to dark"); b.setAttribute("data-mode", t); });
      document.querySelectorAll("[data-theme-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === t)); });
      document.dispatchEvent(new CustomEvent("eps:theme", { detail: t }));
    },
    toggle: function () { Eps.theme.set(Eps.theme.get() === "dark" ? "light" : "dark"); }
  };
  Eps.accent = {
    get: function () { return html.getAttribute("data-accent"); },
    set: function (a) {
      html.setAttribute("data-accent", a); store.set("eps.accent", a);
      document.querySelectorAll("[data-accent-pick]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-accent-pick") === a)); });
      document.dispatchEvent(new CustomEvent("eps:accent", { detail: a }));
    }
  };
  html.setAttribute("data-theme", pick("theme", THEMES, html.getAttribute("data-theme") || "light"));
  html.setAttribute("data-accent", pick("accent", ACCENTS, html.getAttribute("data-accent") || "coral"));

  /* ---- icons (own 24-grid strokes) ---- */
  var P = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M12 6v2m0 3v2m0 3v2" stroke-dasharray="1 3"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3.5 3.5 0 0 1 0 6.5M21 20a6 6 0 0 0-4-5.6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>',
    chevL: '<path d="m15 6-6 6 6 6"/>',
    arrowR: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    arrowL: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5-2 .4-3 1-3 2.5"/>',
    merge: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9M6 7.5c0 4 4 4.5 9.5 4.5"/>',
    upload: '<path d="M12 16V5m-5 5 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    terminal: '<path d="m5 7 5 5-5 5M12 17h7"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h5l1.5 2.5h3L15 14h5"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    send: '<path d="m4 11 16-7-5 16-3.5-6.5z"/><path d="M11.5 13.5 20 4"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4m0 3v.5"/>',
    pencil: '<path d="m4 20 4-1L19 8l-3-3L5 16z"/><path d="m14 7 3 3"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.3 7.6 7.5 9 4.2-1.4 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
    clip: '<path d="m16 7-7.5 7.5a2.5 2.5 0 0 0 3.5 3.5L20 10a5 5 0 0 0-7-7L5 11a7 7 0 0 0 10 10"/>',
    more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 17.5l9 5 9-5"/>',
    chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    undo: '<path d="M8 7H4V3"/><path d="M4 7a8 8 0 1 1 1.5 9.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    download: '<path d="M12 4v11m-5-5 5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
    corner: '<path d="M4 4v7a4 4 0 0 0 4 4h12m-5-5 5 5-5 5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1"/>'
  };
  Eps.icon = function (name, cls) {
    return '<span class="i ' + (cls || "") + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg></span>";
  };
  function mountIcons(root) {
    (root || document).querySelectorAll("i[data-icon]").forEach(function (el) {
      var name = el.getAttribute("data-icon");
      var span = document.createElement("span");
      span.className = "i " + (el.className || "");
      span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
      el.replaceWith(span);
    });
  }
  Eps.mountIcons = mountIcons;

  /* ---- stagger ---- */
  Eps.stagger = function (root) {
    (root || document).querySelectorAll("[data-stagger]").forEach(function (list) {
      Array.prototype.forEach.call(list.children, function (c, i) { c.style.setProperty("--i", i); });
    });
  };

  /* ---- number ticker ---- */
  function fmt(n, el) {
    var dec = +(el.getAttribute("data-decimals") || 0);
    var s = n.toFixed(dec);
    if (el.getAttribute("data-comma") !== "false") s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (el.getAttribute("data-prefix") || "") + s + (el.getAttribute("data-suffix") || "");
  }
  Eps.ticker = function (el, to, dur) {
    to = to == null ? parseFloat(el.getAttribute("data-ticker")) : to;
    dur = ms(dur == null ? 900 : dur);
    var from = parseFloat(el.getAttribute("data-from") || 0);
    if (!dur) { el.textContent = fmt(to, el); return; }
    var t0 = performance.now();
    function step(t) {
      var p = Math.min(1, (t - t0) / dur); p = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * p, el);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  /* ---- tabs with animated ink ---- */
  Eps.tabs = function (root) {
    var tabs = root.querySelectorAll(".tab");
    var ink = root.querySelector(".tabs-ink");
    if (!ink) { ink = document.createElement("span"); ink.className = "tabs-ink"; root.appendChild(ink); }
    function move(tab, animate) {
      if (!animate) ink.style.transition = "none";
      ink.style.left = tab.offsetLeft + "px"; ink.style.width = tab.offsetWidth + "px";
      if (!animate) requestAnimationFrame(function () { ink.style.transition = ""; });
    }
    function select(tab) {
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
      move(tab, true);
      var panelsRoot = root.getAttribute("data-panels") ? document.getElementById(root.getAttribute("data-panels")) : null;
      if (panelsRoot) Array.prototype.forEach.call(panelsRoot.children, function (p) { p.hidden = p.getAttribute("data-panel") !== tab.getAttribute("data-tab"); });
      root.dispatchEvent(new CustomEvent("eps:tab", { detail: tab.getAttribute("data-tab") }));
    }
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        var i = Array.prototype.indexOf.call(tabs, t);
        if (e.key === "ArrowRight") { tabs[(i + 1) % tabs.length].focus(); select(tabs[(i + 1) % tabs.length]); }
        if (e.key === "ArrowLeft") { tabs[(i - 1 + tabs.length) % tabs.length].focus(); select(tabs[(i - 1 + tabs.length) % tabs.length]); }
      });
    });
    var active = root.querySelector('.tab[aria-selected="true"]') || tabs[0];
    if (active) { select(active); move(active, false); }
    addEventListener("resize", function () { var a = root.querySelector('.tab[aria-selected="true"]'); if (a) move(a, false); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { var a = root.querySelector('.tab[aria-selected="true"]'); if (a) move(a, false); });
  };

  /* ---- progress rings ---- */
  Eps.ring = function (el, pct) {
    pct = pct == null ? parseFloat(el.getAttribute("data-pct")) : pct;
    var bar = el.querySelector(".bar");
    if (!bar) return;
    var C = 2 * Math.PI * 16;
    bar.style.strokeDasharray = C;
    bar.style.strokeDashoffset = C;
    requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(100, pct)) / 100); }); });
    var v = el.querySelector(".val[data-auto]"); if (v) v.textContent = Math.round(pct) + "%";
  };
  Eps.ringHTML = function (pct, cls, label) {
    return '<div class="ring ' + (cls || "") + '" data-pct="' + pct + '"><svg viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="16"/><circle class="bar" cx="20" cy="20" r="16"/></svg><div class="val"' + (label == null ? " data-auto" : "") + ">" + (label == null ? "" : label) + "</div></div>";
  };

  /* ---- collapsibles ---- */
  function bindCollapsibles(root) {
    (root || document).querySelectorAll("[data-collapse-toggle]").forEach(function (btn) {
      var target = document.getElementById(btn.getAttribute("data-collapse-toggle"));
      if (!target) return;
      var open = target.hasAttribute("data-open");
      btn.setAttribute("aria-expanded", String(open));
      btn.addEventListener("click", function () {
        var now = !target.hasAttribute("data-open");
        if (now) target.setAttribute("data-open", ""); else target.removeAttribute("data-open");
        btn.setAttribute("aria-expanded", String(now));
      });
    });
  }

  /* ---- overlays: sidebar drawer, sheets, modals ---- */
  var scrim;
  function getScrim() {
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "scrim"; document.body.appendChild(scrim); scrim.addEventListener("click", Eps.closeAll); }
    return scrim;
  }
  var openEls = [];
  function openOverlay(el) {
    getScrim().setAttribute("data-open", ""); el.setAttribute("data-open", ""); if (openEls.indexOf(el) < 0) openEls.push(el);
    var f = el.querySelector("[autofocus]") || el.querySelector("input, textarea") || el.querySelector(".sheet-body button, .modal-card button, button");
    if (f) setTimeout(function () { f.focus(); }, ms(120));
    document.body.style.overflow = "hidden";
  }
  function closeOverlay(el) {
    el.removeAttribute("data-open"); openEls = openEls.filter(function (x) { return x !== el; });
    if (!openEls.length) { getScrim().removeAttribute("data-open"); document.body.style.overflow = ""; }
  }
  Eps.open = function (id) { var el = document.getElementById(id); if (el) openOverlay(el); };
  Eps.close = function (id) { var el = document.getElementById(id); if (el) closeOverlay(el); };
  Eps.closeAll = function () { openEls.slice().forEach(closeOverlay); if (Eps.cmdk.isOpen()) Eps.cmdk.close(); };
  function bindOpeners(root) {
    (root || document).querySelectorAll("[data-open-id]").forEach(function (b) { b.addEventListener("click", function () { Eps.open(b.getAttribute("data-open-id")); }); });
    (root || document).querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { var el = b.closest(".sheet, .modal, .sidebar"); if (el) closeOverlay(el); }); });
  }

  /* ---- toast with undo countdown ---- */
  var toastsEl;
  Eps.toast = function (msg, opts) {
    opts = opts || {};
    if (!toastsEl) { toastsEl = document.createElement("div"); toastsEl.className = "toasts"; document.body.appendChild(toastsEl); }
    var seconds = opts.seconds || 0;
    var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status");
    t.innerHTML = '<span class="msg">' + Eps.icon(opts.icon || "check") + "<span>" + msg + "</span></span>" +
      (seconds ? '<span class="count"><svg viewBox="0 0 22 22"><circle class="tr" cx="11" cy="11" r="9"/><circle class="br" cx="11" cy="11" r="9"/></svg><span class="n">' + seconds + "</span></span>" : "") +
      (opts.action ? '<button class="btn btn-ghost btn-sm" type="button">' + opts.action + "</button>" : "") +
      '<button class="btn btn-ghost btn-icon" type="button" aria-label="Dismiss">' + Eps.icon("x", "i-sm") + "</button>";
    while (toastsEl.children.length >= 3) { var old = toastsEl.firstChild; if (old._finish) old._finish(true); old.remove(); }
    toastsEl.appendChild(t);
    var done = false, timer, tick;
    function finish(committed) {
      if (done) return; done = true; clearTimeout(timer); clearInterval(tick);
      t.classList.add("out"); setTimeout(function () { t.remove(); }, ms(220));
      if (committed && opts.onCommit) opts.onCommit();
      if (!committed && opts.onUndo) opts.onUndo();
    }
    t._finish = finish;
    var btns = t.querySelectorAll("button");
    if (opts.action) btns[0].addEventListener("click", function () { finish(false); });
    btns[btns.length - 1].addEventListener("click", function () { finish(true); });
    if (seconds) {
      var br = t.querySelector(".br"), n = t.querySelector(".n"), C = 2 * Math.PI * 9, t0 = performance.now(), total = seconds * 1000;
      br.style.strokeDasharray = C;
      tick = setInterval(function () {
        var el = performance.now() - t0, p = Math.min(1, el / total);
        br.style.strokeDashoffset = C * p; n.textContent = Math.max(0, Math.ceil((total - el) / 1000));
      }, 50);
      timer = setTimeout(function () { finish(true); }, total);
    } else if (!opts.sticky) timer = setTimeout(function () { finish(true); }, 3600);
    return { close: function () { finish(true); } };
  };

  /* ---- command palette ---- */
  var cmd = { items: [], el: null, input: null, list: null, sel: 0, filtered: [] };
  Eps.cmdk = {
    /* returns off(): removes exactly these items again (page commands registered per page) */
    register: function (items) { cmd.items = cmd.items.concat(items); return function () { cmd.items = cmd.items.filter(function (it) { return items.indexOf(it) < 0; }); }; },
    isOpen: function () { return !!(cmd.el && cmd.el.hasAttribute("data-open")); },
    open: function () { build(); cmd.el.setAttribute("data-open", ""); getScrim().setAttribute("data-open", ""); cmd.input.value = ""; render(""); setTimeout(function () { cmd.input.focus(); }, ms(40)); },
    close: function () { if (!cmd.el) return; cmd.el.removeAttribute("data-open"); if (!openEls.length) { getScrim().removeAttribute("data-open"); } },
    toggle: function () { Eps.cmdk.isOpen() ? Eps.cmdk.close() : Eps.cmdk.open(); }
  };
  function build() {
    if (cmd.el) return;
    cmd.el = document.createElement("div"); cmd.el.className = "cmdk"; cmd.el.setAttribute("role", "dialog"); cmd.el.setAttribute("aria-label", "Command palette");
    cmd.el.innerHTML = '<div class="cmdk-card"><div class="cmdk-input">' + Eps.icon("search") + '<input type="text" placeholder="Type a command or search…" aria-label="Command" spellcheck="false"><span class="kbd">esc</span></div><div class="cmdk-list" role="listbox"></div><div class="cmdk-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span><span><span class="kbd">↵</span> run</span><span><span class="kbd">esc</span> close</span></div></div>';
    document.body.appendChild(cmd.el);
    cmd.input = cmd.el.querySelector("input"); cmd.list = cmd.el.querySelector(".cmdk-list");
    cmd.input.addEventListener("input", function () { render(cmd.input.value); });
    cmd.input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); cmd.sel = Math.min(cmd.filtered.length - 1, cmd.sel + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); cmd.sel = Math.max(0, cmd.sel - 1); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); run(cmd.filtered[cmd.sel]); }
    });
    cmd.el.addEventListener("click", function (e) { if (e.target === cmd.el) Eps.cmdk.close(); });
  }
  function render(qs) {
    qs = qs.trim().toLowerCase();
    cmd.filtered = cmd.items.filter(function (it) { return !qs || (it.label + " " + (it.group || "") + " " + (it.keywords || "")).toLowerCase().indexOf(qs) >= 0; });
    cmd.sel = 0; paint();
  }
  function paint() {
    if (!cmd.filtered.length) { cmd.list.innerHTML = '<div class="cmdk-empty">No results</div>'; return; }
    var h = "", lastGroup = null;
    cmd.filtered.forEach(function (it, i) {
      if (it.group !== lastGroup) { h += '<div class="cmdk-group">' + it.group + "</div>"; lastGroup = it.group; }
      h += '<div class="cmdk-item" role="option" data-i="' + i + '" aria-selected="' + (i === cmd.sel) + '">' + Eps.icon(it.icon || "corner") + "<span>" + it.label + "</span>" +
        (it.keys ? '<span class="kbd-group">' + it.keys.split(" ").map(function (k) { return '<span class="kbd">' + k + "</span>"; }).join("") + "</span>" : "") + "</div>";
    });
    cmd.list.innerHTML = h;
    cmd.list.querySelectorAll(".cmdk-item").forEach(function (el) {
      el.addEventListener("mouseenter", function () { cmd.sel = +el.getAttribute("data-i"); paint(); });
      el.addEventListener("click", function () { run(cmd.filtered[+el.getAttribute("data-i")]); });
    });
    var s = cmd.list.querySelector('[aria-selected="true"]'); if (s) s.scrollIntoView({ block: "nearest" });
  }
  function run(it) { if (!it) return; Eps.cmdk.close(); setTimeout(function () { it.run(); }, ms(60)); }

  /* ---- keys: single keys and two-key sequences ("g h") ---- */
  var keymap = {}, pending = null, pendingTimer;
  /* returns off(): restores what each key did before (a page's keys shadow the global ones while it is mounted) */
  Eps.keys = function (map) {
    var prev = {};
    Object.keys(map).forEach(function (k) { prev[k] = keymap[k]; keymap[k] = map[k]; });
    return function () { Object.keys(map).forEach(function (k) { if (keymap[k] !== map[k]) return; if (prev[k]) keymap[k] = prev[k]; else delete keymap[k]; }); };
  };
  function typing(e) { var t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
  addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); Eps.cmdk.toggle(); return; }
    if (e.key === "Escape") { if (Eps.cmdk.isOpen()) { Eps.cmdk.close(); return; } if (openEls.length) { closeOverlay(openEls[openEls.length - 1]); return; } }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || Eps.cmdk.isOpen()) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (pending) { var seq = pending + " " + k; clearTimeout(pendingTimer); pending = null; if (keymap[seq]) { e.preventDefault(); keymap[seq](e); return; } }
    if (keymap[k]) { e.preventDefault(); keymap[k](e); return; }
    var hasSeq = Object.keys(keymap).some(function (s) { return s.indexOf(k + " ") === 0; });
    if (hasSeq) { pending = k; pendingTimer = setTimeout(function () { pending = null; }, 900); }
  });

  /* ---- OTP input ---- */
  Eps.otp = function (root, onChange) {
    var inputs = root.querySelectorAll("input");
    function value() { return Array.prototype.map.call(inputs, function (i) { return i.value; }).join(""); }
    function sync() { inputs.forEach(function (i) { i.classList.toggle("filled", !!i.value); }); if (onChange) onChange(value(), value().length === inputs.length); }
    inputs.forEach(function (inp, i) {
      inp.addEventListener("input", function () {
        var v = inp.value.replace(/\D/g, "");
        if (v.length > 1) { for (var j = 0; j < v.length && i + j < inputs.length; j++) inputs[i + j].value = v[j]; inputs[Math.min(inputs.length - 1, i + v.length)].focus(); }
        else { inp.value = v; if (v && i < inputs.length - 1) inputs[i + 1].focus(); }
        if (v) { inp.classList.remove("bump"); void inp.offsetWidth; inp.classList.add("bump"); }
        sync();
      });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !inp.value && i > 0) { inputs[i - 1].value = ""; inputs[i - 1].focus(); sync(); }
        if (e.key === "ArrowLeft" && i > 0) inputs[i - 1].focus();
        if (e.key === "ArrowRight" && i < inputs.length - 1) inputs[i + 1].focus();
      });
      inp.addEventListener("focus", function () { inp.select(); });
    });
    return { value: value, clear: function () { inputs.forEach(function (i) { i.value = ""; }); sync(); inputs[0].focus(); }, focus: function () { inputs[0].focus(); } };
  };

  /* ---- animate an element out (approve/reject) ---- */
  Eps.leave = function (el, dir, cb) {
    var d = ms(360);
    if (!d) { el.remove(); if (cb) cb(); return; }
    var h = el.offsetHeight;
    el.style.height = h + "px"; el.style.overflow = "hidden";
    el.style.transition = "transform " + d + "ms var(--ease), opacity " + (d * .6) + "ms var(--ease), height " + d + "ms var(--ease) " + (d * .4) + "ms, margin " + d + "ms var(--ease) " + (d * .4) + "ms, padding " + d + "ms var(--ease) " + (d * .4) + "ms";
    requestAnimationFrame(function () {
      el.style.transform = "translateX(" + (dir === "left" ? -40 : 40) + "px) scale(.98)"; el.style.opacity = "0";
      setTimeout(function () { el.style.height = "0px"; el.style.marginTop = "0"; el.style.marginBottom = "0"; el.style.paddingTop = "0"; el.style.paddingBottom = "0"; }, d * .4);
    });
    setTimeout(function () { el.remove(); if (cb) cb(); }, d * 1.5);
  };

  /* ---- charts: sparkline, gauge, lines with tooltip, mirrored histogram ---- */
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function path(points) { return points.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" "); }
  function smooth(points) {
    if (points.length < 3) return path(points);
    var d = "M" + points[0][0].toFixed(1) + " " + points[0][1].toFixed(1);
    for (var i = 1; i < points.length; i++) {
      var p0 = points[i - 1], p1 = points[i], cx = (p0[0] + p1[0]) / 2;
      d += " C" + cx.toFixed(1) + " " + p0[1].toFixed(1) + " " + cx.toFixed(1) + " " + p1[1].toFixed(1) + " " + p1[0].toFixed(1) + " " + p1[1].toFixed(1);
    }
    return d;
  }
  function scale(data, w, h, pad) {
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data); if (max === min) max = min + 1;
    return data.map(function (v, i) { return [pad + (i / (data.length - 1)) * (w - pad * 2), pad + (1 - (v - min) / (max - min)) * (h - pad * 2)]; });
  }
  Eps.sparkline = function (el, data) {
    data = data || JSON.parse(el.getAttribute("data-spark"));
    var w = 100, h = 36, pts = scale(data, w, h, 3);
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "none", "aria-hidden": "true" }); svg.setAttribute("class", "spark");
    var id = "sf" + Math.random().toString(36).slice(2, 7);
    var defs = svgEl("defs"); var g = svgEl("linearGradient", { id: id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(svgEl("stop", { offset: "0", "stop-color": "currentColor", "stop-opacity": ".14" })); g.appendChild(svgEl("stop", { offset: "1", "stop-color": "currentColor", "stop-opacity": "0" }));
    defs.appendChild(g); svg.appendChild(defs);
    var area = svgEl("path", { d: smooth(pts) + " L" + pts[pts.length - 1][0].toFixed(1) + " " + h + " L" + pts[0][0].toFixed(1) + " " + h + " Z", fill: "url(#" + id + ")" }); svg.appendChild(area);
    var line = svgEl("path", { d: smooth(pts), "vector-effect": "non-scaling-stroke" }); line.setAttribute("class", "line"); svg.appendChild(line);
    var last = pts[pts.length - 1]; var dot = svgEl("circle", { cx: last[0], cy: last[1], r: 2.6 }); dot.setAttribute("class", "end"); svg.appendChild(dot);
    el.innerHTML = ""; el.appendChild(svg);
  };
  Eps.gauge = function (el, pct, opts) {
    opts = opts || {}; pct = pct == null ? parseFloat(el.getAttribute("data-gauge")) : pct;
    var r = 80, cx = 100, cy = 95, C = Math.PI * r; /* half circle */
    var d = "M" + (cx - r) + " " + cy + " A" + r + " " + r + " 0 0 1 " + (cx + r) + " " + cy;
    var svg = svgEl("svg", { viewBox: "0 0 200 110", "aria-hidden": "true" });
    var t = svgEl("path", { d: d }); t.setAttribute("class", "track"); svg.appendChild(t);
    var b = svgEl("path", { d: d, "stroke-dasharray": C, "stroke-dashoffset": C }); b.setAttribute("class", "bar" + (opts.accent ? " accent" : "")); svg.appendChild(b);
    el.innerHTML = ""; el.appendChild(svg);
    var v = document.createElement("div"); v.className = "val";
    v.innerHTML = '<div class="big">' + Math.round(pct) + '<span class="dec">' + (opts.unit || "%") + "</span></div>" + (opts.label ? '<div class="lbl">' + opts.label + "</div>" : "");
    el.appendChild(v);
    requestAnimationFrame(function () { requestAnimationFrame(function () { b.style.strokeDashoffset = C * (1 - pct / 100); }); });
  };
  Eps.lines = function (el, cfg) {
    /* cfg: { labels:[], series:[{name,color,data}], marker: index, height } */
    var w = 600, h = cfg.height || 180, padL = 8, padR = 8, padT = 14, padB = 24;
    var all = [].concat.apply([], cfg.series.map(function (s) { return s.data; }));
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all); if (max === min) max = min + 1;
    var n = cfg.labels.length;
    var X = function (i) { return padL + (i / (n - 1)) * (w - padL - padR); }, Y = function (v) { return padT + (1 - (v - min) / (max - min)) * (h - padT - padB); };
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "none", role: "img", "aria-label": cfg.aria || "Trend chart" });
    var grid = svgEl("g"); grid.setAttribute("class", "grid");
    for (var k = 0; k < 4; k++) { var y = padT + k * (h - padT - padB) / 3; grid.appendChild(svgEl("line", { x1: padL, x2: w - padR, y1: y, y2: y })); }
    svg.appendChild(grid);
    var axis = svgEl("g"); axis.setAttribute("class", "axis");
    cfg.labels.forEach(function (l, i) { if (!l) return; var t = svgEl("text", { x: X(i), y: h - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }); t.textContent = l; axis.appendChild(t); });
    svg.appendChild(axis);
    cfg.series.forEach(function (s) { var p = svgEl("path", { d: path(s.data.map(function (v, i) { return [X(i), Y(v)]; })), stroke: s.color, "vector-effect": "non-scaling-stroke" }); p.setAttribute("class", "series"); svg.appendChild(p); });
    var mi = cfg.marker == null ? n - 1 : cfg.marker;
    var ml = svgEl("line", { x1: X(mi), x2: X(mi), y1: padT, y2: h - padB }); ml.setAttribute("class", "marker-line"); svg.appendChild(ml);
    cfg.series.forEach(function (s) { var c = svgEl("circle", { cx: X(mi), cy: Y(s.data[mi]), r: 4.5, fill: s.color }); c.setAttribute("class", "marker"); svg.appendChild(c); });
    el.innerHTML = ""; el.appendChild(svg);
    var tip = document.createElement("div"); tip.className = "tip"; el.appendChild(tip);
    var badge = document.createElement("div"); badge.className = "badge"; el.appendChild(badge);
    function place(i) {
      var r = el.getBoundingClientRect(); var x = X(i) / w * r.width; var top = Math.min.apply(null, cfg.series.map(function (s) { return Y(s.data[i]); })) / h * r.height;
      tip.innerHTML = cfg.series.map(function (s) { return '<i style="background:' + s.color + '"></i><span class="l">' + s.name + "</span><b>" + (cfg.format ? cfg.format(s.data[i]) : s.data[i]) + "</b>"; }).join("");
      var tw = tip.offsetWidth || 120, th = tip.offsetHeight || 40, tx = Math.max(tw / 2 + 4, Math.min(r.width - tw / 2 - 4, x));
      var below = top - 12 - th < 6;
      tip.classList.toggle("below", below);
      tip.style.left = tx + "px"; tip.style.top = (below ? top + 14 : top - 12) + "px";
      tip.style.setProperty("--arrow", (x - tx) + "px");
      badge.style.left = x + "px"; badge.style.top = (h - padB + 4) / h * r.height + "px"; badge.textContent = cfg.labels[i] || cfg.badge || "";
      ml.setAttribute("x1", X(i)); ml.setAttribute("x2", X(i));
      svg.querySelectorAll(".marker").forEach(function (c, k) { c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(cfg.series[k].data[i])); });
    }
    el.addEventListener("mousemove", function (e) { var r = el.getBoundingClientRect(); var i = Math.round((e.clientX - r.left) / r.width * (n - 1)); place(Math.max(0, Math.min(n - 1, i))); });
    el.addEventListener("mouseleave", function () { place(mi); });
    requestAnimationFrame(function () { place(mi); });
    addEventListener("resize", function () { place(mi); });
  };
  Eps.mirror = function (el, cfg) {
    /* cfg: { labels:[], up:[], down:[], hi: index } */
    var max = Math.max.apply(null, cfg.up.concat(cfg.down));
    el.style.setProperty("--n", cfg.labels.length);
    el.innerHTML = cfg.labels.map(function (l, i) {
      return '<div class="col"' + (i === cfg.hi ? " data-hi" : "") + ' title="' + l + ": " + cfg.up[i] + " / " + cfg.down[i] + '"><div class="up" style="height:' + (cfg.up[i] / max * 100) + '%"></div><div class="lbl">' + l + '</div><div class="down" style="height:' + (cfg.down[i] / max * 100) + '%"></div></div>';
    }).join("");
  };

  /* ---- shared chrome ---- */
  Eps.themeToggleHTML = function () {
    return '<div class="theme-pill" role="group" aria-label="Theme"><button type="button" data-theme-set="light" aria-label="Light" aria-pressed="false"><i data-icon="sun" class="i-sm"></i></button><button type="button" data-theme-set="dark" aria-label="Dark" aria-pressed="false"><i data-icon="moon" class="i-sm"></i></button></div>';
  };
  Eps.accentPickerHTML = function () {
    var names = { coral: "Coral", graphite: "Graphite", copper: "Copper" };
    return '<div class="accent-pick" role="group" aria-label="Accent">' + ACCENTS.map(function (a) { return '<button type="button" data-accent-pick="' + a + '" aria-pressed="false"><span></span>' + names[a] + "</button>"; }).join("") + "</div>";
  };

  /* ---- boot ---- */
  function boot() {
    mountIcons();
    Eps.stagger();
    document.querySelectorAll("[data-ticker]").forEach(function (el) { Eps.ticker(el); });
    document.querySelectorAll("[data-tabs]").forEach(Eps.tabs);
    document.querySelectorAll(".ring[data-pct]").forEach(function (r) { Eps.ring(r); });
    bindCollapsibles(); bindOpeners();
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) { b.addEventListener("click", Eps.theme.toggle); });
    document.querySelectorAll("[data-theme-set]").forEach(function (b) { b.addEventListener("click", function () { Eps.theme.set(b.getAttribute("data-theme-set")); }); });
    document.querySelectorAll("[data-spark]").forEach(function (el) { Eps.sparkline(el); });
    document.querySelectorAll("[data-gauge]").forEach(function (el) { Eps.gauge(el, null, { label: el.getAttribute("data-label"), accent: el.hasAttribute("data-accent-bar") }); });
    document.querySelectorAll("[data-accent-pick]").forEach(function (b) { b.addEventListener("click", function () { Eps.accent.set(b.getAttribute("data-accent-pick")); }); });
    document.querySelectorAll(".menu-btn").forEach(function (b) { b.addEventListener("click", function () { var sb = document.querySelector(".sidebar"); if (sb) openOverlay(sb); }); });
    document.querySelectorAll(".cmdk-trigger").forEach(function (b) { b.addEventListener("click", Eps.cmdk.open); });
    document.querySelectorAll(".seg:not([data-manual])").forEach(function (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b || !seg.contains(b)) return;
        seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        seg.dispatchEvent(new CustomEvent("eps:seg", { detail: b.getAttribute("data-value") || b.textContent.trim() }));
      });
    });
    document.querySelectorAll("[data-loading]").forEach(function (el) { setTimeout(function () { el.removeAttribute("data-loading"); Eps.stagger(el); mountIcons(el); el.querySelectorAll(".ring[data-pct]").forEach(function (r) { Eps.ring(r); }); el.querySelectorAll("[data-ticker]").forEach(function (t) { Eps.ticker(t); }); }, +(el.getAttribute("data-loading") || 600)); });
    Eps.theme.set(Eps.theme.get()); Eps.accent.set(Eps.accent.get());
    Eps.cmdk.register([
      { group: "Appearance", label: "Toggle light / dark", icon: "sun", keys: "t", run: Eps.theme.toggle },
      { group: "Appearance", label: "Accent: Coral", icon: "sparkle", run: function () { Eps.accent.set("coral"); } },
      { group: "Appearance", label: "Accent: Graphite", icon: "sparkle", run: function () { Eps.accent.set("graphite"); } },
      { group: "Appearance", label: "Accent: Copper", icon: "sparkle", run: function () { Eps.accent.set("copper"); } }
    ]);
    Eps.keys({ "t": Eps.theme.toggle });
    document.dispatchEvent(new CustomEvent("eps:ready"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.Eps = Eps;
})();
