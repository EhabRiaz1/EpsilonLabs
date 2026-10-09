/* ═══════════════════════════════════════════════════════════════════════
   EPSILON LABS — product demos

   Small working versions of the software we sell, shaped like screenshots.
   Each mounts into an element marked data-demo="<name>" and replaces the
   static fallback inside it. Without JavaScript the fallback stays — a
   description and a link — so nothing on the page depends on this file.

   Every figure in here is demo data and every demo says so on its title
   bar. None of it is a client's real numbers, and none of it pretends to be.

   Rules held across all four:
     - nothing animates on its own under prefers-reduced-motion; the demo
       stays fully usable by hand
     - anything that ticks pauses when scrolled out of view
     - every demo ends in the same place: the offer page for the real thing
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var hosts = document.querySelectorAll('[data-demo]');
  if (!hosts.length) return;

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
  var num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The window chrome every demo sits in. The "Demo data" badge is not
     optional: it is what keeps an illustrative figure from being read as a
     claim about a real client. */
  function frame(host, title, badge) {
    host.textContent = '';
    host.classList.add('is-live');
    var app = el('div', 'app');
    var bar = el('div', 'app__bar');
    bar.appendChild(el('span', 'app__dots'));
    bar.appendChild(el('span', 'app__title', title));
    bar.appendChild(el('span', 'app__badge', badge || 'Demo data'));
    var body = el('div', 'app__body');
    app.appendChild(bar);
    app.appendChild(body);
    host.appendChild(app);
    return body;
  }

  /* Run a callback only while the host is on screen. */
  function whileVisible(host, start, stop) {
    if (!('IntersectionObserver' in window)) { start(); return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? start() : stop(); });
    }, { threshold: 0.15 }).observe(host);
  }

  /* ══ 1. Quote Engine ══════════════════════════════════════════════════ */

  function quote(host) {
    var body = frame(host, 'Quote Engine — new quotation');

    var state = { L: 3, W: 2, H: 1.5, food: false };
    /* Illustrative only. Real engines encode the client's own formulas. */
    var RATE = 38, FOOD = 1.22, FIXED = 240;
    var TIER = { 1: 1.0, 1.5: 1.08, 2: 1.18, 2.5: 1.31 };

    var grid = el('div', 'q');
    var controls = el('div', 'q__controls');
    var out = el('div', 'q__out');

    function slider(label, key, min, max, step) {
      var row = el('label', 'q__field');
      var head = el('span', 'q__lab');
      head.appendChild(document.createTextNode(label + ' '));
      var val = el('b', null, state[key] + ' m');
      head.appendChild(val);
      var input = el('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step;
      input.value = state[key];
      input.setAttribute('aria-label', label + ' in metres');
      input.addEventListener('input', function () {
        state[key] = parseFloat(input.value);
        val.textContent = state[key] + ' m';
        render();
      });
      row.appendChild(head);
      row.appendChild(input);
      return row;
    }

    controls.appendChild(slider('Length', 'L', 1, 8, 0.5));
    controls.appendChild(slider('Width', 'W', 1, 4, 0.5));

    var hRow = el('div', 'q__field');
    hRow.appendChild(el('span', 'q__lab', 'Height tier'));
    var seg = el('div', 'q__seg');
    [1, 1.5, 2, 2.5].forEach(function (h) {
      var b = el('button', null, h + ' m');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(h === state.H));
      b.addEventListener('click', function () {
        state.H = h;
        seg.querySelectorAll('button').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        render();
      });
      seg.appendChild(b);
    });
    hRow.appendChild(seg);
    controls.appendChild(hRow);

    var food = el('label', 'q__check');
    var cb = el('input'); cb.type = 'checkbox';
    cb.addEventListener('change', function () { state.food = cb.checked; render(); });
    food.appendChild(cb);
    food.appendChild(document.createTextNode(' Food-grade resin'));
    controls.appendChild(food);

    /* A live dimensioned drawing. Isometric box, scaled to the inputs. */
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 260 170');
    svg.setAttribute('class', 'q__draw');
    svg.setAttribute('aria-hidden', 'true');

    var price = el('div', 'q__price');
    var facts = el('dl', 'q__facts');
    var go = el('button', 'btn', 'Generate PDF');
    go.type = 'button';
    var toast = el('p', 'q__toast');
    toast.setAttribute('aria-live', 'polite');
    var qn = 411;
    go.addEventListener('click', function () {
      qn += 1;
      toast.textContent = 'Quotation Q-' + new Date().getFullYear() + '-0' + qn +
        ' generated — dimensioned drawing and costing attached.';
      toast.classList.remove('is-on'); void toast.offsetWidth; toast.classList.add('is-on');
    });

    out.appendChild(svg);
    out.appendChild(price);
    out.appendChild(facts);
    out.appendChild(go);
    out.appendChild(toast);
    grid.appendChild(controls);
    grid.appendChild(out);
    body.appendChild(grid);

    function line(x1, y1, x2, y2, cls) {
      var l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      if (cls) l.setAttribute('class', cls);
      svg.appendChild(l);
    }
    function label(x, y, text) {
      var t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('class', 'q__dim');
      t.textContent = text;
      svg.appendChild(t);
    }

    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      /* Fixed scale, sized so the largest configuration (8 x 4 x 2.5 m)
         still fits the frame. Not fit-to-frame: then the box would stay the
         same size and only its proportions would move, and watching it grow
         is the point. */
      var k = 20;                                   // px per metre — solved, not guessed:
                                                    // 21 overflows at 8 x 4 x 2.5
      var L = state.L * k, W = state.W * k * 0.6, H = state.H * k * 1.4;
      var dx = W * 0.87, dy = W * 0.5;              // isometric offset for depth

      /* Centre on what is actually drawn, labels included — the height label
         hangs off the left and the width label off the right, so centring the
         bare box leaves the whole drawing lopsided. */
      var hl = (state.H + ' m').length * 6, wl = (state.W + ' m').length * 6;
      var left = -26 - hl / 2;
      var right = Math.max(L + dx, L + dx / 2 + 16 + wl / 2);
      var top = -(H + dy), bottom = 21;
      var ox = (260 - (right - left)) / 2 - left;
      var oy = (170 - (bottom - top)) / 2 - top;
      // front face
      line(ox, oy, ox + L, oy); line(ox, oy, ox, oy - H);
      line(ox + L, oy, ox + L, oy - H); line(ox, oy - H, ox + L, oy - H);
      // depth
      line(ox + L, oy, ox + L + dx, oy - dy);
      line(ox + L, oy - H, ox + L + dx, oy - H - dy);
      line(ox, oy - H, ox + dx, oy - H - dy);
      line(ox + dx, oy - H - dy, ox + L + dx, oy - H - dy);
      line(ox + L + dx, oy - dy, ox + L + dx, oy - H - dy);
      // dimension callouts
      line(ox, oy + 9, ox + L, oy + 9, 'q__dimline');
      label(ox + L / 2, oy + 21, state.L + ' m');
      line(ox - 9, oy, ox - 9, oy - H, 'q__dimline');
      label(ox - 26, oy - H / 2 + 4, state.H + ' m');
      label(ox + L + dx / 2 + 16, oy - dy / 2 + 14, state.W + ' m');
    }

    function render() {
      var area = 2 * (state.L * state.W + state.L * state.H + state.W * state.H);
      var litres = state.L * state.W * state.H * 1000;
      var cost = area * RATE * TIER[state.H] * (state.food ? FOOD : 1) + FIXED;
      price.textContent = usd.format(Math.round(cost / 5) * 5);
      facts.innerHTML = '';
      [['Surface area', num.format(area) + ' m²'],
       ['Capacity', pkr.format(litres) + ' L'],
       ['Resin', state.food ? 'Food-grade' : 'Standard']].forEach(function (r) {
        var d = el('div');
        d.appendChild(el('dt', null, r[0]));
        d.appendChild(el('dd', null, r[1]));
        facts.appendChild(d);
      });
      draw();
    }
    render();
  }

  /* ══ 2. Courts ════════════════════════════════════════════════════════ */

  function bookings(host) {
    var body = frame(host, 'Bookings — Saturday');
    var COURTS = 4, HOURS = [16, 17, 18, 19, 20, 21, 22, 23], PRICE = 32;
    /* Deliberately mixed: the scheduler does not care what is being booked. */
    var NAMES = [['Court 1', 'C1'], ['Studio A', 'SA'], ['Room 3', 'R3'], ['Bay 4', 'B4']];

    /* A believable Saturday: busy at peak, with the awkward one-hour holes
       a real schedule leaves behind. Deterministic, so it looks the same on
       every visit. */
    var seed = [
      '11011101',
      '10111011',
      '01101110',
      '11100111',
    ];
    var booked = seed.map(function (r) { return r.split('').map(function (c) { return c === '1'; }); });
    var recovered = {};

    var head = el('div', 'c__stats');
    var occ = el('div', 'c__stat');
    var rev = el('div', 'c__stat');
    head.appendChild(occ); head.appendChild(rev);

    var table = el('div', 'c__grid');
    table.setAttribute('role', 'grid');
    /* The label width comes from CSS so a phone can narrow it; the slot
       tracks are minmax(0, 1fr) so they shrink instead of overflowing. */
    table.style.gridTemplateColumns = 'var(--c-label) repeat(' + HOURS.length + ', minmax(0, 1fr))';

    /* Long and short forms of every label, swapped by CSS at narrow widths. */
    function dual(cls, long, short) {
      var s = el('span', cls);
      s.appendChild(el('span', 'c__lg', long));
      s.appendChild(el('span', 'c__sm', short));
      return s;
    }

    table.appendChild(el('span', 'c__h'));
    HOURS.forEach(function (h) { table.appendChild(dual('c__h', h + ':00', String(h))); });

    var cells = [];
    for (var c = 0; c < COURTS; c++) {
      table.appendChild(dual('c__court', NAMES[c][0], NAMES[c][1]));
      cells[c] = [];
      for (var h = 0; h < HOURS.length; h++) {
        (function (c, h) {
          var b = el('button', 'c__slot');
          b.type = 'button';
          b.setAttribute('aria-label', NAMES[c][0] + ' at ' + HOURS[h] + ':00');
          b.addEventListener('click', function () {
            booked[c][h] = !booked[c][h];
            delete recovered[c + ':' + h];
            paint();
          });
          cells[c][h] = b;
          table.appendChild(b);
        })(c, h);
      }
    }

    var foot = el('div', 'c__foot');
    var pack = el('button', 'btn', 'Pack the gaps');
    pack.type = 'button';
    var msg = el('p', 'c__msg');
    msg.setAttribute('aria-live', 'polite');
    foot.appendChild(pack);
    foot.appendChild(msg);

    body.appendChild(head);
    body.appendChild(table);
    body.appendChild(foot);

    /* The scheduler's point, in miniature: a single empty hour between two
       bookings almost never sells on its own. Offer it to the people on the
       waitlist at that hour and it usually does. */
    pack.addEventListener('click', function () {
      var found = [];
      for (var c = 0; c < COURTS; c++) {
        for (var h = 0; h < HOURS.length; h++) {
          if (booked[c][h]) continue;
          var before = h === 0 || booked[c][h - 1];
          var after = h === HOURS.length - 1 || booked[c][h + 1];
          if (before && after) found.push([c, h]);
        }
      }
      if (!found.length) {
        msg.textContent = 'No isolated gaps left to fill.';
        return;
      }
      found.forEach(function (p, i) {
        setTimeout(function () {
          booked[p[0]][p[1]] = true;
          recovered[p[0] + ':' + p[1]] = true;
          paint();
        }, reduced ? 0 : i * 110);
      });
      msg.textContent = found.length + ' dead hour' + (found.length === 1 ? '' : 's') +
        ' offered to the waitlist and filled — ' + usd.format(found.length * PRICE) +
        ' that would otherwise not exist.';
    });

    function paint() {
      var n = 0;
      for (var c = 0; c < COURTS; c++) {
        for (var h = 0; h < HOURS.length; h++) {
          var on = booked[c][h];
          if (on) n++;
          cells[c][h].classList.toggle('is-on', on);
          cells[c][h].classList.toggle('is-new', !!recovered[c + ':' + h]);
          cells[c][h].setAttribute('aria-pressed', String(on));
        }
      }
      var total = COURTS * HOURS.length;
      occ.innerHTML = '<span>Occupancy</span><b>' + Math.round(n / total * 100) + '%</b>';
      rev.innerHTML = '<span>Revenue</span><b>' + usd.format(n * PRICE) + '</b>';
    }
    paint();
  }

  /* ══ 3. Forecourt ledger (eFuelPro) ═══════════════════════════════════ */

  function ledger(host) {
    var body = frame(host, 'eFuelPro — live ledger');

    var PPL = 272.5;       // PKR per litre, illustrative
    var pumps = [1, 2, 3, 4].map(function (n) { return { n: n, state: 'Idle' }; });

    var pills = el('div', 'l__pumps');
    var pillEls = pumps.map(function (p) {
      var d = el('div', 'l__pump');
      d.appendChild(el('span', null, 'Pump ' + p.n));
      var s = el('b', null, p.state);
      d.appendChild(s);
      pills.appendChild(d);
      return { box: d, label: s };
    });

    var totals = el('div', 'l__totals');
    var tL = el('div'), tR = el('div'), tN = el('div');
    totals.appendChild(tL); totals.appendChild(tR); totals.appendChild(tN);

    var list = el('ol', 'l__feed');
    list.setAttribute('aria-live', 'off');

    var controls = el('div', 'l__controls');
    var one = el('button', 'btn btn--ghost', 'Simulate a sale');
    one.type = 'button';
    controls.appendChild(one);

    body.appendChild(pills);
    body.appendChild(totals);
    body.appendChild(list);
    body.appendChild(controls);

    var sum = { litres: 0, pkr: 0, n: 0 };
    var seq = 4180;

    function fmtTime(d) {
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) +
        ':' + ('0' + d.getSeconds()).slice(-2);
    }

    function paintTotals() {
      tL.innerHTML = '<span>Litres</span><b>' + num.format(sum.litres) + '</b>';
      tR.innerHTML = '<span>Revenue</span><b>PKR ' + pkr.format(sum.pkr) + '</b>';
      tN.innerHTML = '<span>Sales</span><b>' + sum.n + '</b>';
    }

    /* One transaction: the pump goes to Filling, then a frame lands and the
       ledger records it with a verifiable receipt code. */
    function sale() {
      var p = Math.floor(Math.random() * pumps.length);
      var litres = Math.round((4 + Math.random() * 38) * 100) / 100;
      pillEls[p].box.classList.add('is-busy');
      pillEls[p].label.textContent = 'Filling';

      setTimeout(function () {
        pillEls[p].box.classList.remove('is-busy');
        pillEls[p].label.textContent = 'Idle';

        var amount = litres * PPL;
        sum.litres += litres; sum.pkr += amount; sum.n += 1;
        seq += 1;

        var li = el('li', 'l__row');
        li.appendChild(el('span', 'l__t', fmtTime(new Date())));
        li.appendChild(el('span', null, 'P' + pumps[p].n));
        li.appendChild(el('span', 'l__n', num.format(litres) + ' L'));
        li.appendChild(el('span', 'l__n', 'PKR ' + pkr.format(amount)));
        li.appendChild(el('span', 'l__code', 'RX-' + seq));
        list.insertBefore(li, list.firstChild);
        while (list.children.length > 6) list.removeChild(list.lastChild);
        paintTotals();
      }, reduced ? 0 : 700);
    }

    one.addEventListener('click', sale);
    paintTotals();
    for (var i = 0; i < 3; i++) sale();

    /* Ticks on its own only when motion is allowed and it is on screen. */
    if (!reduced) {
      var timer = null;
      whileVisible(host,
        function () { if (!timer) timer = setInterval(sale, 2400); },
        function () { clearInterval(timer); timer = null; });
    }
  }

  /* ══ 4. Ops Analyst ═══════════════════════════════════════════════════ */

  function analyst(host) {
    var body = frame(host, 'Ops Analyst');

    /* Scripted, because a demo must not call a real model with a visitor's
       keystrokes. Two read questions and one write — and the write is the
       point: it proposes, and nothing happens until a person approves. */
    var SCRIPT = [
      {
        q: 'Which depot had the most failed deliveries last week?',
        a: 'North depot: 41 failed deliveries last week, up from 23 the week before. ' +
           '29 of them were "customer not home" on the 16:00–18:00 slot.',
        sql: "select depot, count(*) from deliveries\nwhere status = 'failed'\n  and delivered_at >= now() - interval '7 days'\ngroup by depot order by 2 desc limit 1;",
      },
      {
        q: 'Which invoices are more than 30 days overdue?',
        a: '12 invoices are over 30 days overdue, totalling $48,210. The three largest ' +
           'are all from the same customer.',
        sql: "select id, customer, amount, due_at from invoices\nwhere paid_at is null\n  and due_at < now() - interval '30 days'\norder by amount desc;",
      },
      {
        q: 'Pause reorders for SKUs whose demand is falling.',
        a: 'Found 3 SKUs with demand down more than 40% over 60 days and a reorder ' +
           'scheduled this week. I can pause those reorders — this changes data, so it ' +
           'needs your approval.',
        sql: "update reorders set status = 'paused'\nwhere sku in ('AX-220', 'AX-221', 'BR-104')\n  and scheduled_for < now() + interval '7 days';",
        write: true,
      },
    ];

    var log = el('div', 'a__log');
    log.setAttribute('aria-live', 'polite');
    var chips = el('div', 'a__chips');

    SCRIPT.forEach(function (s) {
      var b = el('button', 'a__chip', s.q);
      b.type = 'button';
      b.addEventListener('click', function () { ask(s); });
      chips.appendChild(b);
    });

    body.appendChild(log);
    body.appendChild(el('p', 'a__hint', 'Ask it something:'));
    body.appendChild(chips);

    var busy = false;

    function bubble(cls, text) {
      var b = el('div', 'a__msg ' + cls, text);
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }

    /* Word-by-word, the way a streamed answer arrives. Instant under
       reduced motion. */
    function stream(node, text, done) {
      if (reduced) { node.textContent = text; done(); return; }
      var words = text.split(' '), i = 0;
      node.textContent = '';
      (function tick() {
        node.textContent += (i ? ' ' : '') + words[i++];
        log.scrollTop = log.scrollHeight;
        if (i < words.length) setTimeout(tick, 34);
        else done();
      })();
    }

    function ask(s) {
      if (busy) return;
      busy = true;
      chips.classList.add('is-busy');
      bubble('a__msg--you', s.q);
      var reply = bubble('a__msg--ai', '…');

      setTimeout(function () {
        stream(reply, s.a, function () {
          var d = el('details', 'a__sql');
          d.appendChild(el('summary', null, s.write ? 'Proposed change' : 'The query it ran'));
          d.appendChild(el('pre', null, s.sql));
          reply.appendChild(d);

          if (s.write) {
            var act = el('div', 'a__approve');
            var yes = el('button', 'btn', 'Approve');
            var no = el('button', 'btn btn--ghost', 'Reject');
            yes.type = no.type = 'button';
            act.appendChild(yes); act.appendChild(no);
            reply.appendChild(act);

            var settle = function (ok) {
              act.remove();
              var t = new Date();
              var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
              bubble('a__msg--sys', ok
                ? 'Done. 3 reorders paused. Approved by you at ' + hh + ' — logged.'
                : 'Nothing changed. Rejection logged at ' + hh + '.');
              busy = false;
              chips.classList.remove('is-busy');
            };
            yes.addEventListener('click', function () { settle(true); });
            no.addEventListener('click', function () { settle(false); });
          } else {
            busy = false;
            chips.classList.remove('is-busy');
          }
          log.scrollTop = log.scrollHeight;
        });
      }, reduced ? 0 : 450);
    }

    bubble('a__msg--sys', 'Connected to ops_db · read access · writes need your approval');
  }


  /* ── shared helpers for the business demos ─────────────────────────── */

  /* Seeded, so a demo shows the same believable numbers on every visit. */
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Count a number up to its new value — the small motion that makes a
     dashboard feel live. Instant under reduced motion. */
  function countTo(node, from, to, fmt) {
    if (reduced || from === to) { node.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 520;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      k = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function seg(labels, active, onPick) {
    var wrap = el('div', 'ui-seg');
    labels.forEach(function (l) {
      var b = el('button', null, l[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(l[0] === active));
      b.addEventListener('click', function () {
        wrap.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(l[0]);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ══ 5. Sales dashboard ═══════════════════════════════════════════════ */

  function dashboard(host) {
    var body = frame(host, 'Sales — overview');
    var state = { period: 30, region: 'all' };
    var REG = { all: 1, north: 0.42, south: 0.33, online: 0.25 };

    var bar = el('div', 'd__bar');
    bar.appendChild(seg([[7, '7D'], [30, '30D'], [90, '90D']], 30, function (v) { state.period = v; render(); }));
    bar.appendChild(seg([['all', 'All'], ['north', 'North'], ['south', 'South'], ['online', 'Online']], 'all',
      function (v) { state.region = v; render(); }));
    body.appendChild(bar);

    var kpis = el('div', 'd__kpis');
    var K = {};
    [['rev', 'Revenue'], ['ord', 'Orders'], ['aov', 'Avg order'], ['conv', 'Conversion']].forEach(function (k) {
      var c = el('div', 'd__kpi');
      c.appendChild(el('span', null, k[1]));
      var v = el('b', null, '—');
      var d = el('em', null, '');
      c.appendChild(v); c.appendChild(d);
      kpis.appendChild(c);
      K[k[0]] = { v: v, d: d, last: 0 };
    });
    body.appendChild(kpis);

    var chartWrap = el('div', 'd__chart');
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 600 150');
    svg.setAttribute('preserveAspectRatio', 'none');
    var tip = el('div', 'd__tip');
    chartWrap.appendChild(svg); chartWrap.appendChild(tip);
    body.appendChild(chartWrap);

    var top = el('ol', 'd__top');
    body.appendChild(top);

    var PRODUCTS = ['Wireless earbuds', 'Running shoes', 'Espresso beans 1kg', 'Desk lamp', 'Yoga mat'];

    /* salt varies the seed only. It used to be folded into the region name
       ("allx"), which then indexed REG, came back undefined, and turned every
       comparison into NaN. */
    function series(days, region, salt) {
      /* Seed from the whole name. Seeding from its length gave "north" and
         "south" (five letters each) identical growth — which reads as fake. */
      var h = 0;
      for (var c = 0; c < region.length; c++) h = (h * 31 + region.charCodeAt(c)) >>> 0;
      var r = seeded(days * 7 + h + (salt || 0));
      var out = [];
      for (var i = 0; i < days; i++) {
        var weekly = 1 + 0.28 * Math.sin((i / 7) * Math.PI * 2 - 1.2);
        var trend = 1 + i / days * 0.22;
        out.push((2600 + r() * 1400) * weekly * trend * REG[region]);
      }
      return out;
    }

    /* "All" is the regions added together, not a series of its own — so the
       whole always reconciles to its parts, which is the first thing anyone
       checking a sales dashboard does. */
    function regional(days, region, salt) {
      if (region !== 'all') return series(days, region, salt);
      var parts = ['north', 'south', 'online'].map(function (r) { return series(days, r, salt); });
      return parts[0].map(function (_, i) { return parts[0][i] + parts[1][i] + parts[2][i]; });
    }

    function render() {
      var days = state.period;
      var s = regional(days, state.region);
      var prev = regional(days, state.region, 9973).map(function (v) { return v * 0.9; });
      var rev = s.reduce(function (a, b) { return a + b; }, 0);
      var prevRev = prev.reduce(function (a, b) { return a + b; }, 0);
      var aov = 48 + seeded(days + 3)() * 14;
      var ord = rev / aov;
      var conv = 2.1 + seeded(days * 3 + REG[state.region] * 10)() * 1.4;

      function kpi(key, val, fmt, delta) {
        countTo(K[key].v, K[key].last, val, fmt);
        K[key].last = val;
        K[key].d.textContent = (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(1) + '%';
        K[key].d.className = delta >= 0 ? 'up' : 'down';
      }
      var growth = (rev / prevRev - 1) * 100;
      kpi('rev', rev, function (v) { return usd.format(v); }, growth);
      kpi('ord', ord, function (v) { return Math.round(v).toLocaleString('en-US'); }, growth * 0.8);
      kpi('aov', aov, function (v) { return usd.format(v); }, growth * 0.2);
      kpi('conv', conv, function (v) { return v.toFixed(2) + '%'; }, -0.4 + growth * 0.05);

      /* 90 days is too many bars to read; roll it up into weeks. */
      var bars = s;
      if (days === 90) {
        bars = [];
        for (var w = 0; w < 13; w++) bars.push(s.slice(w * 7, w * 7 + 7).reduce(function (a, b) { return a + b; }, 0));
      }
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var max = Math.max.apply(null, bars);
      var bw = 600 / bars.length;
      bars.forEach(function (v, i) {
        var h = Math.max(2, v / max * 132);
        var r = document.createElementNS(svgNS, 'rect');
        r.setAttribute('x', i * bw + bw * 0.14);
        r.setAttribute('y', 150 - h);
        r.setAttribute('width', bw * 0.72);
        r.setAttribute('height', h);
        r.setAttribute('rx', Math.min(3, bw * 0.2));
        r.setAttribute('class', 'd__b');
        if (!reduced) r.style.animationDelay = (i * (days === 7 ? 40 : 12)) + 'ms';
        r.addEventListener('mouseenter', function () {
          tip.textContent = (days === 90 ? 'Week ' + (i + 1) : 'Day ' + (i + 1)) + ' · ' + usd.format(v);
          tip.style.left = ((i + 0.5) / bars.length * 100) + '%';
          tip.classList.add('is-on');
        });
        r.addEventListener('mouseleave', function () { tip.classList.remove('is-on'); });
        svg.appendChild(r);
      });

      top.textContent = '';
      var rr = seeded(days + REG[state.region] * 100);
      var shares = PRODUCTS.map(function () { return 0.3 + rr(); });
      var tot = shares.reduce(function (a, b) { return a + b; }, 0);
      PRODUCTS.map(function (n, i) { return [n, rev * shares[i] / tot * 0.62]; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .forEach(function (p, i, arr) {
          var li = el('li');
          li.appendChild(el('span', null, p[0]));
          var track = el('i');
          var fill = el('i');
          fill.style.width = (p[1] / arr[0][1] * 100) + '%';
          track.appendChild(fill);
          li.appendChild(track);
          li.appendChild(el('b', null, usd.format(p[1])));
          top.appendChild(li);
        });
    }
    render();
  }

  /* ══ 6. Inventory ═════════════════════════════════════════════════════ */

  function inventory(host) {
    var body = frame(host, 'Inventory — Main warehouse');
    var items = [
      ['SKU-1042', 'Wireless earbuds', 64, 20, 18],
      ['SKU-1107', 'USB-C cable 2m', 9, 25, 4],
      ['SKU-2210', 'Running shoes 42', 14, 12, 41],
      ['SKU-2214', 'Running shoes 43', 3, 12, 41],
      ['SKU-3301', 'Espresso beans 1kg', 38, 30, 16],
      ['SKU-4102', 'Desk lamp', 0, 8, 22],
      ['SKU-4450', 'Yoga mat', 27, 10, 13],
      ['SKU-5120', 'Water bottle', 11, 15, 6],
    ].map(function (r) { return { sku: r[0], name: r[1], qty: r[2], rop: r[3], cost: r[4] }; });

    var onlyLow = false;
    var bar = el('div', 'd__bar');
    var recv = el('button', 'btn btn--ghost', 'Receive delivery');
    recv.type = 'button';
    bar.appendChild(seg([[false, 'All stock'], [true, 'Low only']], false, function (v) { onlyLow = v; paint(); }));
    bar.appendChild(recv);
    body.appendChild(bar);

    var table = el('div', 'i__table');
    body.appendChild(table);

    var po = el('div', 'i__po');
    body.appendChild(po);
    var toast = el('p', 'q__toast');
    toast.setAttribute('aria-live', 'polite');
    body.appendChild(toast);

    function say(t) { toast.textContent = t; toast.classList.remove('is-on'); void toast.offsetWidth; toast.classList.add('is-on'); }

    function status(it) {
      if (it.qty === 0) return ['Out', 'out'];
      if (it.qty <= it.rop) return ['Low', 'low'];
      return ['In stock', 'ok'];
    }

    recv.addEventListener('click', function () {
      var n = 0;
      items.forEach(function (it) { if (it.qty <= it.rop) { it.qty += it.rop * 2; n++; } });
      say(n ? 'Delivery received — ' + n + ' SKUs restocked to twice their reorder point.' : 'Nothing is low. No delivery needed.');
      paint();
    });

    function paint() {
      table.textContent = '';
      var head = el('div', 'i__row i__head');
      ['Item', 'Stock', 'Qty', 'Status', ''].forEach(function (h) { head.appendChild(el('span', null, h)); });
      table.appendChild(head);

      items.forEach(function (it) {
        var st = status(it);
        if (onlyLow && st[1] === 'ok') return;
        var row = el('div', 'i__row');
        var name = el('span', 'i__name');
        name.appendChild(el('b', null, it.name));
        name.appendChild(el('small', null, it.sku));
        row.appendChild(name);

        var track = el('span', 'i__track');
        var fill = el('i', 'i__fill i__fill--' + st[1]);
        fill.style.width = Math.min(100, it.qty / (it.rop * 3) * 100) + '%';
        var rop = el('i', 'i__rop');
        rop.style.left = (1 / 3 * 100) + '%';
        track.appendChild(fill); track.appendChild(rop);
        row.appendChild(track);

        row.appendChild(el('span', 'i__qty', String(it.qty)));
        row.appendChild(el('span', 'i__st i__st--' + st[1], st[0]));

        var sell = el('button', 'i__sell', 'Sell 1');
        sell.type = 'button';
        sell.disabled = it.qty === 0;
        sell.addEventListener('click', function () {
          it.qty = Math.max(0, it.qty - 1);
          if (it.qty === it.rop) say(it.name + ' just hit its reorder point — added to the suggested order.');
          paint();
        });
        row.appendChild(sell);
        table.appendChild(row);
      });

      var low = items.filter(function (it) { return it.qty <= it.rop; });
      po.textContent = '';
      if (!low.length) {
        po.appendChild(el('p', null, 'Everything is above its reorder point.'));
        return;
      }
      var cost = low.reduce(function (a, it) { return a + (it.rop * 2 - it.qty) * it.cost; }, 0);
      var t = el('p');
      t.appendChild(el('b', null, 'Suggested order: '));
      t.appendChild(document.createTextNode(low.length + ' SKUs · ' + usd.format(cost)));
      var go = el('button', 'btn', 'Create PO');
      go.type = 'button';
      go.addEventListener('click', function () {
        say('PO-' + (4200 + low.length) + ' drafted for ' + low.length + ' SKUs and sent for approval.');
      });
      po.appendChild(t); po.appendChild(go);
    }
    paint();
  }

  /* ══ 7. CRM pipeline ══════════════════════════════════════════════════ */

  function crm(host) {
    var body = frame(host, 'Pipeline — Q3');
    var STAGES = [['lead', 'Lead', 0.1], ['qual', 'Qualified', 0.3], ['prop', 'Proposal', 0.6], ['won', 'Won', 1]];
    var deals = [
      ['Northwind Traders', 12000, 'lead', 2], ['Harbor Clinics', 8400, 'lead', 9],
      ['Atlas Logistics', 26000, 'qual', 4], ['Brightside Dental', 5200, 'qual', 12],
      ['Kestrel Foods', 18500, 'prop', 3], ['Meridian Studios', 9800, 'prop', 8],
      ['Oakline Retail', 14000, 'won', 1],
    ].map(function (d, i) { return { id: i, name: d[0], value: d[1], stage: d[2], days: d[3] }; });
    var queue = ['Summit Fitness', 'Blue Harbour Cafe', 'Crescent Motors', 'Pinecrest Labs'];

    var stats = el('div', 'd__kpis d__kpis--3');
    var S = {};
    [['pipe', 'Pipeline'], ['fore', 'Weighted forecast'], ['won', 'Won']].forEach(function (k) {
      var c = el('div', 'd__kpi');
      c.appendChild(el('span', null, k[1]));
      var v = el('b', null, '—');
      c.appendChild(v);
      stats.appendChild(c);
      S[k[0]] = { v: v, last: 0 };
    });
    body.appendChild(stats);

    var board = el('div', 'k__board');
    body.appendChild(board);
    var foot = el('div', 'c__foot');
    var add = el('button', 'btn btn--ghost', 'Add lead');
    add.type = 'button';
    var hint = el('p', 'c__msg', 'Drag a deal to move it, or press → on the card. Red means it has sat too long.');
    foot.appendChild(add); foot.appendChild(hint);
    body.appendChild(foot);

    var dragging = null;

    add.addEventListener('click', function () {
      if (!queue.length) { hint.textContent = 'No more leads in the queue — that is a good problem.'; return; }
      deals.push({ id: deals.length + 50, name: queue.shift(), value: 4000 + Math.round(Math.random() * 20) * 800, stage: 'lead', days: 0 });
      paint();
    });

    function move(d, stage) {
      d.stage = stage;
      d.days = 0;
      paint();
    }

    function paint() {
      board.textContent = '';
      STAGES.forEach(function (st, si) {
        var col = el('div', 'k__col');
        col.setAttribute('data-stage', st[0]);
        var list = deals.filter(function (d) { return d.stage === st[0]; });
        var sum = list.reduce(function (a, d) { return a + d.value; }, 0);
        var h = el('div', 'k__head');
        h.appendChild(el('b', null, st[1]));
        h.appendChild(el('span', null, usd.format(sum)));
        col.appendChild(h);

        col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('is-over'); });
        col.addEventListener('dragleave', function () { col.classList.remove('is-over'); });
        col.addEventListener('drop', function (e) {
          e.preventDefault(); col.classList.remove('is-over');
          if (dragging) move(dragging, st[0]);
        });

        list.forEach(function (d) {
          var card = el('div', 'k__card' + (d.days > 7 && st[0] !== 'won' ? ' is-stale' : ''));
          card.draggable = true;
          card.addEventListener('dragstart', function () { dragging = d; card.classList.add('is-drag'); });
          card.addEventListener('dragend', function () { dragging = null; card.classList.remove('is-drag'); });
          card.appendChild(el('b', null, d.name));
          var meta = el('div', 'k__meta');
          meta.appendChild(el('span', null, usd.format(d.value)));
          meta.appendChild(el('span', null, d.days + 'd'));
          card.appendChild(meta);
          if (si < STAGES.length - 1) {
            var nx = el('button', 'k__next', '→');
            nx.type = 'button';
            nx.setAttribute('aria-label', 'Move ' + d.name + ' to ' + STAGES[si + 1][1]);
            nx.addEventListener('click', function () { move(d, STAGES[si + 1][0]); });
            card.appendChild(nx);
          }
          col.appendChild(card);
        });
        board.appendChild(col);
      });

      var open = deals.filter(function (d) { return d.stage !== 'won'; });
      var pipe = open.reduce(function (a, d) { return a + d.value; }, 0);
      var fore = open.reduce(function (a, d) {
        return a + d.value * STAGES.filter(function (s) { return s[0] === d.stage; })[0][2];
      }, 0);
      var won = deals.filter(function (d) { return d.stage === 'won'; }).reduce(function (a, d) { return a + d.value; }, 0);
      [['pipe', pipe], ['fore', fore], ['won', won]].forEach(function (p) {
        countTo(S[p[0]].v, S[p[0]].last, p[1], function (v) { return usd.format(v); });
        S[p[0]].last = p[1];
      });
    }
    paint();
  }

  /* ══ 8. Marketplace — three roles, one system ═════════════════════════ */

  /* The point of this demo is the role switch. A marketplace is three
     products, and the hard part is that each party sees only what is
     theirs. Buy something as a buyer, then look at it as the seller and as
     the admin. */
  function market(host) {
    var body = frame(host, 'Marketplace');
    var FEE = 0.1;
    var catalogue = [
      ['Loomworks', 'Linen, natural, per metre', 'Fabric', 14],
      ['Loomworks', 'Organic cotton twill', 'Fabric', 11],
      ['Northmill', 'Walnut offcuts, 20kg', 'Timber', 38],
      ['Northmill', 'Oak boards, planed', 'Timber', 64],
      ['Forge & Co', 'Steel angle, 3m', 'Metal', 22],
      ['Forge & Co', 'Aluminium sheet', 'Metal', 47],
    ].map(function (r, i) { return { id: i, vendor: r[0], name: r[1], cat: r[2], price: r[3] }; });
    var orders = [
      { item: 3, qty: 2 }, { item: 0, qty: 5 }, { item: 4, qty: 1 },
    ];
    var cart = [];
    var role = 'buyer', cat = 'All';
    var ME = 'Loomworks';

    var bar = el('div', 'd__bar');
    bar.appendChild(seg([['buyer', 'Buyer'], ['seller', 'Seller: ' + ME], ['admin', 'Admin']], 'buyer',
      function (v) { role = v; paint(); }));
    body.appendChild(bar);
    var view = el('div', 'm__view');
    body.appendChild(view);

    function paint() {
      view.textContent = '';
      if (role === 'buyer') buyer();
      else if (role === 'seller') seller();
      else admin();
    }

    function buyer() {
      var chips = el('div', 'a__chips');
      ['All', 'Fabric', 'Timber', 'Metal'].forEach(function (c) {
        var b = el('button', 'a__chip' + (c === cat ? ' is-on' : ''), c);
        b.type = 'button';
        b.addEventListener('click', function () { cat = c; paint(); });
        chips.appendChild(b);
      });
      view.appendChild(chips);

      var grid = el('div', 'm__grid');
      catalogue.filter(function (p) { return cat === 'All' || p.cat === cat; }).forEach(function (p) {
        var card = el('div', 'm__card');
        var sw = el('span', 'm__sw m__sw--' + p.cat.toLowerCase());
        card.appendChild(sw);
        card.appendChild(el('b', null, p.name));
        card.appendChild(el('small', null, 'by ' + p.vendor));
        var row = el('div', 'm__row');
        row.appendChild(el('span', null, usd.format(p.price)));
        var add = el('button', 'i__sell', 'Add');
        add.type = 'button';
        add.addEventListener('click', function () { cart.push(p.id); paint(); });
        row.appendChild(add);
        card.appendChild(row);
        grid.appendChild(card);
      });
      view.appendChild(grid);

      var sum = el('div', 'i__po');
      var total = cart.reduce(function (a, id) { return a + catalogue[id].price; }, 0);
      var t = el('p');
      t.appendChild(el('b', null, 'Cart: '));
      t.appendChild(document.createTextNode(cart.length + ' items · ' + usd.format(total)));
      sum.appendChild(t);
      var buy = el('button', 'btn', 'Check out');
      buy.type = 'button';
      buy.disabled = !cart.length;
      buy.addEventListener('click', function () {
        cart.forEach(function (id) { orders.push({ item: id, qty: 1 }); });
        cart = [];
        paint();
        var note = el('p', 'c__msg', 'Ordered. Now switch to Seller or Admin and look at the same order from their side.');
        view.appendChild(note);
      });
      sum.appendChild(buy);
      view.appendChild(sum);
    }

    function seller() {
      var mine = orders.filter(function (o) { return catalogue[o.item].vendor === ME; });
      var gross = mine.reduce(function (a, o) { return a + catalogue[o.item].price * o.qty; }, 0);
      var k = el('div', 'd__kpis d__kpis--3');
      [['Your orders', String(mine.length)], ['Gross', usd.format(gross)], ['Your payout', usd.format(gross * (1 - FEE))]]
        .forEach(function (x) { var c = el('div', 'd__kpi'); c.appendChild(el('span', null, x[0])); c.appendChild(el('b', null, x[1])); k.appendChild(c); });
      view.appendChild(k);
      var list = el('ol', 'l__feed');
      mine.slice().reverse().forEach(function (o) {
        var li = el('li', 'l__row m__ord');
        li.appendChild(el('span', null, catalogue[o.item].name));
        li.appendChild(el('span', 'l__n', '×' + o.qty));
        li.appendChild(el('span', 'l__n', usd.format(catalogue[o.item].price * o.qty)));
        list.appendChild(li);
      });
      view.appendChild(list);
      view.appendChild(el('p', 'c__msg', 'Signed in as ' + ME + '. Orders from other sellers are not visible here — not hidden, not queryable.'));
    }

    function admin() {
      var gmv = orders.reduce(function (a, o) { return a + catalogue[o.item].price * o.qty; }, 0);
      var k = el('div', 'd__kpis d__kpis--3');
      [['GMV', usd.format(gmv)], ['Commission (10%)', usd.format(gmv * FEE)], ['Orders', String(orders.length)]]
        .forEach(function (x) { var c = el('div', 'd__kpi'); c.appendChild(el('span', null, x[0])); c.appendChild(el('b', null, x[1])); k.appendChild(c); });
      view.appendChild(k);
      var top = el('ol', 'd__top');
      ['Loomworks', 'Northmill', 'Forge & Co'].map(function (v) {
        var g = orders.filter(function (o) { return catalogue[o.item].vendor === v; })
          .reduce(function (a, o) { return a + catalogue[o.item].price * o.qty; }, 0);
        return [v, g];
      }).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (v, i, arr) {
        var li = el('li');
        li.appendChild(el('span', null, v[0] + ' — payout due'));
        var track = el('i'), fill = el('i');
        fill.style.width = (arr[0][1] ? v[1] / arr[0][1] * 100 : 0) + '%';
        track.appendChild(fill);
        li.appendChild(track);
        li.appendChild(el('b', null, usd.format(v[1] * (1 - FEE))));
        top.appendChild(li);
      });
      view.appendChild(top);
    }
    paint();
  }

  /* ══ mount ═══════════════════════════════════════════════════════════ */

  var DEMOS = {
    quote: quote, bookings: bookings, ledger: ledger, analyst: analyst,
    dashboard: dashboard, inventory: inventory, crm: crm, market: market,
  };

  function mount(host) {
    if (host.classList.contains('is-live') || host.hasAttribute('data-mounted')) return;
    var fn = DEMOS[host.getAttribute('data-demo')];
    if (!fn) return;               // e.g. "twin" — a module mounts that one
    host.setAttribute('data-mounted', '');
    /* frame() empties the host before a demo builds, so a demo that throws
       halfway would otherwise leave a blank box. Snapshot the static
       fallback and put it back. */
    var fallback = host.innerHTML;
    try {
      fn(host);
    } catch (err) {
      host.innerHTML = fallback;
      host.classList.remove('is-live');
      console.error('demo "' + host.getAttribute('data-demo') + '" failed:', err);
    }
  }

  /* Demos outside the suite mount now; the suite mounts each tab's demo the
     first time that tab is opened, so a page with nine demos does not build
     nine demos before anyone has looked at one. */
  Array.prototype.forEach.call(hosts, function (host) {
    if (!host.closest('[data-suite]')) mount(host);
  });

  /* ══ mosaic tiles ════════════════════════════════════════════════════ */

  /* A tile shows a real demo at its natural 720px width, scaled to fit,
     like a screenshot that happens to be running. Contain, never crop. */
  Array.prototype.forEach.call(document.querySelectorAll('.tile__scale'), function (box) {
    var tile = box.closest('.tile');
    var fit = function () {
      var inner = box.firstElementChild;
      var h = inner ? inner.offsetHeight : 600;
      var w = box.offsetWidth || 720;       // 720 for a desktop window, 360 for a phone
      var s = Math.min(tile.clientWidth * 0.9 / w, tile.clientHeight * 0.74 / Math.max(h, 1), 1.1);
      box.style.setProperty('--s', s.toFixed(3));
    };
    new ResizeObserver(fit).observe(tile);
    if (box.firstElementChild) new ResizeObserver(fit).observe(box.firstElementChild);
    fit();
  });

  /* ══ the suite: every product in one window ═══════════════════════════ */

  Array.prototype.forEach.call(document.querySelectorAll('[data-suite]'), function (suite) {
    var tabs = suite.querySelectorAll('[role="tab"]');
    var panels = suite.querySelectorAll('[role="tabpanel"]');

    function show(name, focus) {
      Array.prototype.forEach.call(tabs, function (t) {
        var on = t.getAttribute('data-tab') === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      Array.prototype.forEach.call(panels, function (p) {
        var on = p.getAttribute('data-panel') === name;
        p.hidden = !on;
        if (on) {
          var h = p.querySelector('[data-demo]');
          if (h) {
            mount(h);
            /* The twin is a module; tell it its panel just became visible. */
            h.dispatchEvent(new CustomEvent('demo:show', { bubbles: true }));
          }
        }
      });
    }

    Array.prototype.forEach.call(tabs, function (t, i) {
      t.addEventListener('click', function () { show(t.getAttribute('data-tab')); });
      /* Arrow keys between tabs, per the ARIA tabs pattern. */
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = tabs[(i + d + tabs.length) % tabs.length];
        show(n.getAttribute('data-tab'), true);
      });
    });

    suite.classList.add('is-live');
    show(tabs[0].getAttribute('data-tab'));
  });
})();
