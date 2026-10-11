(function () {
  'use strict';
  var csrfMeta = document.querySelector('meta[name=csrf]');
  var CSRF = csrfMeta ? csrfMeta.content : '';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var UNDO_MS = 10000;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function typing(t) { return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable); }

  function post(name, body) {
    return fetch('/api/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'network', message: 'Network error. Nothing was changed.' }; });
  }

  var sheet = $('#sheet');
  function openSheet() { if (sheet && !sheet.open && sheet.showModal) sheet.showModal(); }

  function toast(text, opts) {
    opts = opts || {};
    var box = $('#toasts'); if (!box) return null;
    var el = document.createElement('div'); el.className = 'toast' + (opts.bad ? ' bad' : '');
    var msg = document.createElement('span'); msg.className = 'msg'; msg.textContent = text; el.appendChild(msg);
    var cd = null;
    if (opts.undo) {
      cd = document.createElement('span'); cd.className = 'cd'; el.appendChild(cd);
      var b = document.createElement('button'); b.className = 'btn'; b.type = 'button';
      b.innerHTML = 'Undo <span class="kbd" aria-hidden="true">U</span>'; b.addEventListener('click', opts.undo); el.appendChild(b);
    }
    box.appendChild(el);
    var ttl = opts.ttl || 4000;
    var t0 = Date.now();
    var iv = setInterval(function () {
      var left = ttl - (Date.now() - t0);
      if (cd) cd.textContent = Math.max(Math.ceil(left / 1000), 0) + 's';
      if (left <= 0) { clearInterval(iv); el.remove(); if (opts.expire) opts.expire(); }
    }, 250);
    if (cd) cd.textContent = Math.ceil(ttl / 1000) + 's';
    return { el: el, close: function () { clearInterval(iv); el.remove(); } };
  }

  // ---------------------------------------------------------------- deck
  var deck = $('#deck');
  if (deck) initDeck();

  function initDeck() {
    var cards = $$('article.card', deck);
    var pips = $$('.pip', deck);
    var clear = $('#clear'), count = $('#count'), actbar = $('#actbar'), editbar = $('#editbar');
    var live = cards.slice();
    var total = cards.length;
    var sent = +deck.dataset.sent || 0, rejected = +deck.dataset.rejected || 0;
    var idx = 0, busy = false, editing = null, undos = [];
    var pipOf = new Map(); cards.forEach(function (c, i) { pipOf.set(c, pips[i]); });
    var wanted = new URLSearchParams(location.search).get('id');
    if (wanted) { var w = cards.filter(function (c) { return c.dataset.id === wanted; })[0]; if (w) idx = live.indexOf(w); }

    function cur() { return live[idx] || null; }
    function paint() {
      cards.forEach(function (c) {
        var p = pipOf.get(c), isLive = live.indexOf(c) >= 0;
        p.className = 'pip' + (c === cur() ? ' cur' : (!isLive ? ' done' : (c.dataset.lint !== '0' ? ' warn' : '')));
      });
      var done = total - live.length;
      count.textContent = live.length ? (Math.min(done + 1, total) + ' of ' + total + ' · ' + sent + ' sent') : (total + ' of ' + total);
    }
    function show(focus, animate) {
      cards.forEach(function (c) { c.hidden = true; c.classList.remove('exit', 'enter'); });
      var c = cur();
      if (!c) {
        clear.hidden = false;
        $('#clear-counts').textContent = sent + ' sent, ' + rejected + ' rejected, ' + live.length + ' left.';
        actbar.hidden = true; editbar.hidden = true;
        if (focus) $('#clear-t').focus();
        paint(); return;
      }
      clear.hidden = true; actbar.hidden = !!editing; editbar.hidden = !editing;
      c.hidden = false;
      if (animate && !reduced) c.classList.add('enter');
      var missing = c.dataset.missing === '1';
      if (missing && !editing) { startEdit(c, 'Draft failed, write it yourself.'); }
      if (focus && !editing) $('h2', c).focus();
      paint();
    }
    function exit(c, then) {
      if (reduced) { then(); return; }
      c.classList.add('exit'); setTimeout(then, 160);
    }
    function msg(c, text) { var m = $('.cardmsg', c); m.textContent = text || ''; m.hidden = !text; }
    function advance(c) {
      var i = live.indexOf(c); live.splice(i, 1);
      if (idx >= live.length) idx = Math.max(live.length - 1, 0);
      else idx = i;
      show(true, true);
    }

    // --- approve / edit
    function draftText(c) { return $('[data-draft]', c).textContent; }
    function approve(c, edited) {
      if (busy || !c) return;
      var body = { id: c.dataset.id, confirm_lint: c.classList.contains('armed') };
      if (edited) body.final_text = $('.draft-edit', c).value;
      busy = true; msg(c, '');
      post('approve', body).then(function (r) {
        busy = false;
        if (r.ok) { onApproved(c, r); return; }
        if (r.error === 'lint_confirm_required') {
          c.classList.add('armed');
          if (edited) renderLint(c, r.lint || []);
          var a = $('.armnote', c); if (a) a.textContent = 'Press A again to send anyway.';
          return;
        }
        if (r.error === 'not_pending') { msg(c, r.message + ' Reload to refresh.'); return; }
        var m = $('.cardmsg', c); m.textContent = 'Not sent: ' + (r.message || 'unknown error') + ' ';
        var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = 'Retry';
        b.addEventListener('click', function () { approve(c, edited); }); m.appendChild(b); m.hidden = false;
      });
    }
    function renderLint(c, hits) {
      var bar = $('.lintbar', c);
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'lintbar'; bar.setAttribute('role', 'alert');
        bar.innerHTML = '<b>Lint warnings. Check before sending.</b><ul></ul><span class="armnote">Press A again to send anyway.</span>';
        $('.cols', c).parentNode.insertBefore(bar, $('.cols', c));
      }
      var ul = $('ul', bar); ul.innerHTML = '';
      hits.forEach(function (h) { var li = document.createElement('li'); li.textContent = h.type + ': ' + h.text; ul.appendChild(li); });
      bar.hidden = false; c.dataset.lint = String(hits.length);
    }
    function onApproved(c, r) {
      var wasEdited = r.edited;
      if (editing) endEdit(false);
      sent++;
      var idxAt = live.indexOf(c);
      var note = wasEdited && r.diff ? ' You changed ' + r.diff.changed + ' sentence' + (r.diff.changed === 1 ? '' : 's') + '.' : '';
      var entry = { card: c, at: idxAt };
      var t = toast('Sent.' + note, {
        ttl: UNDO_MS, undo: function () { undo(entry); },
        expire: function () { undos = undos.filter(function (e) { return e !== entry; }); }
      });
      entry.toast = t; undos.push(entry);
      exit(c, function () { advance(c); });
    }
    function undo(entry) {
      if (!entry) entry = undos[undos.length - 1];
      if (!entry) { toast('Nothing to undo.'); return; }
      post('undo', { id: entry.card.dataset.id }).then(function (r) {
        if (!r.ok) { toast(r.message || 'Too late, already sending.', { bad: true, ttl: 5000 }); entry.toast.close(); undos = undos.filter(function (e) { return e !== entry; }); return; }
        entry.toast.close(); undos = undos.filter(function (e) { return e !== entry; });
        sent = Math.max(sent - 1, 0);
        var c = entry.card; c.classList.remove('armed'); msg(c, '');
        live.splice(Math.min(entry.at, live.length), 0, c);
        idx = live.indexOf(c); show(true, true);
        toast('Back in the deck.');
      });
    }
    function startEdit(c, note) {
      if (editing || !c) return;
      var d = $('[data-draft]', c), ta = document.createElement('textarea');
      ta.className = 'draft-edit'; ta.value = d.textContent; ta.setAttribute('aria-label', 'Edit your reply');
      ta.dataset.original = d.textContent;
      d.hidden = true; d.parentNode.insertBefore(ta, d.nextSibling);
      var n = $('.editnote', c); if (note) { n.textContent = note; n.hidden = false; }
      editing = c; actbar.hidden = true; editbar.hidden = false; ta.focus();
      ta.addEventListener('input', function () { c.classList.remove('armed'); });
      ta.addEventListener('keydown', function (ev) {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); approve(c, true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endEdit(true); }
      });
    }
    function endEdit(refocus) {
      var c = editing; if (!c) return;
      var ta = $('.draft-edit', c); if (ta) ta.remove();
      $('[data-draft]', c).hidden = false; var n = $('.editnote', c); n.hidden = true;
      editing = null; actbar.hidden = false; editbar.hidden = true;
      if (refocus) $('h2', c).focus();
    }

    // --- reject / later
    function startReject(c) {
      var row = $('.reasonrow', c); row.hidden = false; $('.reason', c).focus();
    }
    function cancelReject(c) { $('.reasonrow', c).hidden = true; $('h2', c).focus(); }
    function doReject(c) {
      if (busy) return; busy = true;
      post('reject', { id: c.dataset.id, reason: $('.reason', c).value }).then(function (r) {
        busy = false;
        if (!r.ok) { msg(c, 'Not rejected: ' + r.message); return; }
        rejected++; $('.reasonrow', c).hidden = true;
        exit(c, function () { advance(c); });
      });
    }
    function later(c) {
      if (busy || !c || live.length < 2) { if (c && live.length < 2) toast('Only one card left.'); return; }
      busy = true;
      post('later', { id: c.dataset.id }).then(function (r) {
        busy = false;
        if (!r.ok) { msg(c, r.message); return; }
        exit(c, function () {
          var i = live.indexOf(c); live.splice(i, 1); live.push(c);
          idx = i < live.length - 1 ? i : 0; show(true, true);
        });
      });
    }
    function move(d) {
      if (editing || !live.length) return;
      var n = Math.min(Math.max(idx + d, 0), live.length - 1);
      if (n !== idx) { idx = n; show(true, true); }
    }

    function act(name) {
      var c = cur();
      switch (name) {
        case 'approve': if (editing) approve(c, true); else approve(c, false); break;
        case 'edit': startEdit(c); break;
        case 'edit-send': approve(c, true); break;
        case 'edit-cancel': endEdit(true); break;
        case 'reject': startReject(c); break;
        case 'reject-confirm': doReject(c); break;
        case 'reject-cancel': cancelReject(c); break;
        case 'later': later(c); break;
        case 'sheet': openSheet(); break;
      }
    }
    deck.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (b) act(b.dataset.act);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.altKey) return;
      var t = ev.target;
      if (t && t.classList && t.classList.contains('reason')) {
        if (ev.key === 'Enter') { ev.preventDefault(); doReject(cur()); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancelReject(cur()); }
        return;
      }
      if (typing(t) || (sheet && sheet.open)) return;
      if (ev.metaKey || ev.ctrlKey) return;
      var k = ev.key.toLowerCase();
      if (k === 'a') { ev.preventDefault(); act('approve'); }
      else if (k === 'e') { ev.preventDefault(); act('edit'); }
      else if (k === 'r') { ev.preventDefault(); act('reject'); }
      else if (k === 'l') { ev.preventDefault(); act('later'); }
      else if (k === 'u') { ev.preventDefault(); undo(); }
      else if (k === 'j') { move(-1); }
      else if (k === 'k') { move(1); }
      else if (k === '?') { ev.preventDefault(); openSheet(); }
      else if (k === 'escape') { location.href = '/'; }
    });
    show(true, false);
  }

  // ---------------------------------------------------------------- Today + global
  document.addEventListener('keydown', function (ev) {
    if (deck || typing(ev.target) || (sheet && sheet.open)) return;
    if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey) {
      var s = $('#start'); if (s && document.activeElement === document.body) { location.href = s.getAttribute('href'); }
    } else if (ev.key === '?') { openSheet(); }
  });

  // ---------------------------------------------------------------- pipeline panel
  var panel = $('#panel');
  if (panel) {
    var open = function (id) {
      panel.hidden = false; panel.innerHTML = '<p class="muted">Loading…</p>';
      fetch('/pipeline?fragment=1&deal=' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.text() : Promise.reject(); })
        .then(function (h) { panel.innerHTML = h; var hd = $('h2', panel); hd.tabIndex = -1; hd.focus(); })
        .catch(function () { panel.innerHTML = '<p class="err">Could not load this deal.</p>'; });
    };
    var close = function () { panel.hidden = true; panel.innerHTML = ''; };
    document.addEventListener('click', function (ev) {
      var cl = ev.target.closest('[data-close]'); if (cl) { ev.preventDefault(); close(); return; }
      var tr = ev.target.closest('tr[data-deal]'); if (!tr) return;
      ev.preventDefault(); open(tr.dataset.deal);
    });
    document.addEventListener('keydown', function (ev) {
      var tr = ev.target.closest && ev.target.closest('tr[data-deal]');
      if (tr && ev.key === 'Enter') { open(tr.dataset.deal); }
      if (ev.key === 'Escape') { if (!panel.hidden) close(); else if (!(sheet && sheet.open)) location.href = '/'; }
    });
  } else if (!deck) {
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !typing(ev.target) && !(sheet && sheet.open) && location.pathname !== '/') location.href = '/';
    });
  }
})();

/* Premium layer: command palette, g-navigation, count-up, entrance. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var typing = function (t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };

  document.documentElement.classList.add('js-ready');

  var pal = document.getElementById('palette'), q = document.getElementById('pal-q');
  var items = pal ? Array.prototype.slice.call(pal.querySelectorAll('li')) : [];
  var sel = 0;
  function visible() { return items.filter(function (li) { return !li.hidden; }); }
  function paint() {
    var v = visible();
    items.forEach(function (li) { li.classList.remove('sel'); li.setAttribute('aria-selected', 'false'); });
    if (v[sel]) { v[sel].classList.add('sel'); v[sel].setAttribute('aria-selected', 'true'); }
  }
  function go(li) {
    var h = li.dataset.href; pal.close();
    if (h === '?') { var sh = document.getElementById('sheet'); if (sh) sh.showModal(); return; }
    window.location.href = h;
  }
  function openPal() {
    if (!pal || pal.open) return;
    q.value = ''; items.forEach(function (li) { li.hidden = false; }); sel = 0; paint();
    pal.showModal(); q.focus();
  }
  if (pal) {
    q.addEventListener('input', function () {
      var t = q.value.trim().toLowerCase();
      items.forEach(function (li) { li.hidden = t && li.textContent.toLowerCase().indexOf(t) === -1; });
      sel = 0; paint();
    });
    q.addEventListener('keydown', function (ev) {
      var v = visible();
      if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(sel + 1, v.length - 1); paint(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (ev.key === 'Enter' && v[sel]) { ev.preventDefault(); go(v[sel]); }
      ev.stopPropagation();
    });
    items.forEach(function (li) {
      li.addEventListener('click', function () { go(li); });
      li.addEventListener('mousemove', function () { sel = visible().indexOf(li); paint(); });
    });
    pal.addEventListener('click', function (ev) { if (ev.target === pal) pal.close(); });
    document.querySelectorAll('[data-cmdk]').forEach(function (b) { b.addEventListener('click', openPal); });
  }

  var gArmed = 0;
  document.addEventListener('keydown', function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openPal(); return; }
    if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey || (pal && pal.open)) return;
    var k = ev.key.toLowerCase();
    if (k === 'g') { gArmed = Date.now(); return; }
    if (gArmed && Date.now() - gArmed < 900) {
      var dest = { t: '/', p: '/pipeline', a: '/agents', h: '/health', s: '/settings' }[k];
      gArmed = 0;
      if (dest) { ev.preventDefault(); ev.stopImmediatePropagation(); window.location.href = dest; }
    }
  }, true);

  if (!reduce) {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var txt = el.textContent.trim(), m = txt.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/);
      if (!m) return;
      var target = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length;
      if (!target) return;
      var t0 = null, dur = 700;
      function fmt(v) { return m[1] + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]; }
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = p < 1 ? fmt(target * e) : txt;
        if (p < 1) requestAnimationFrame(step);
      }
      el.textContent = fmt(0); requestAnimationFrame(step);
    });
  }
})();

/* Theme (studio / console) + mobile sidebar. */
(function () {
  'use strict';
  var root = document.documentElement;
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.dataset.theme === 'console' ? 'studio' : 'console';
      root.dataset.theme = next;
      try { localStorage.setItem('eos-theme', next); } catch (_) {}
    });
  });
  var sb = document.getElementById('sidebar');
  document.querySelectorAll('[data-menu]').forEach(function (b) {
    b.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
  });
  document.addEventListener('click', function (ev) {
    if (document.body.classList.contains('nav-open') && sb && !sb.contains(ev.target) && !ev.target.closest('[data-menu]')) {
      document.body.classList.remove('nav-open');
    }
  });
})();
