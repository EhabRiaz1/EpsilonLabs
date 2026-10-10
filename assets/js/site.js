/* ═══════════════════════════════════════════════════════════════════════
   EPSILON LABS — interface

   Everything that is not the field: the header, the mobile menu, reveals,
   and the year in the footer. Deliberately a classic script, not a module,
   so it runs and paints before the scene's module graph has resolved.

   Nothing here is load-bearing for content. Kill JavaScript entirely and
   every page still reads top to bottom.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ═══ header ═══════════════════════════════════════════════════════ */

  var nav = $('#nav');
  if (nav) {
    var ticking = false;
    var last = window.scrollY || window.pageYOffset;
    var NAV_H = 72;          /* past this, the bar has cleared the top */
    var SLOP = 6;            /* ignore the jitter of a trackpad at rest */

    var onScroll = function () {
      var y = window.scrollY || window.pageYOffset;
      var d = y - last;

      nav.classList.toggle('is-stuck', y > 24);

      /* Never hide at the very top, never hide while a menu is open — a
         panel sliding off screen under the cursor is its own bug — and
         never hide over the elastic overscroll at either end. */
      var menuOpen = nav.querySelector('.mega.is-open') ||
        nav.querySelector('[aria-expanded="true"]');
      var atEnd = y + innerHeight >= document.documentElement.scrollHeight - 2;

      if (Math.abs(d) > SLOP && !menuOpen && !atEnd) {
        nav.classList.toggle('is-away', d > 0 && y > NAV_H * 2);
      }
      if (y <= NAV_H) nav.classList.remove('is-away');

      last = y;
      ticking = false;
    };

    addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(onScroll);
    }, { passive: true });

    /* Tab into something behind a hidden bar and the bar comes back. */
    addEventListener('focusin', function (ev) {
      if (nav.contains(ev.target)) nav.classList.remove('is-away');
    });

    onScroll();
  }

  /* ═══ mega menu ════════════════════════════════════════════════════ */

  /* Hover or keyboard focus on a category opens its panel; leaving the
     header or pressing Escape closes it. Touch devices never see it — the
     links just navigate — because hover does not exist there. */
  var megaLinks = $$('[data-mega]');
  if (nav && megaLinks.length && matchMedia('(hover: hover) and (min-width: 1000px)').matches) {
    var openMega = null, closeTimer = 0;
    var show = function (key) {
      clearTimeout(closeTimer);
      megaLinks.forEach(function (a) {
        var on = a.getAttribute('data-mega') === key;
        a.setAttribute('aria-expanded', String(on));
        var p = $('#mega-' + a.getAttribute('data-mega'));
        if (!p) return;
        if (on) { p.hidden = false; requestAnimationFrame(function () { p.classList.add('is-open'); }); }
        else { p.classList.remove('is-open'); p.hidden = true; }
      });
      openMega = key;
    };
    var hideAll = function () {
      megaLinks.forEach(function (a) {
        a.setAttribute('aria-expanded', 'false');
        var p = $('#mega-' + a.getAttribute('data-mega'));
        if (p) { p.classList.remove('is-open'); p.hidden = true; }
      });
      openMega = null;
    };
    megaLinks.forEach(function (a) {
      a.addEventListener('mouseenter', function () { show(a.getAttribute('data-mega')); });
      a.addEventListener('focus', function () { show(a.getAttribute('data-mega')); });
    });
    /* Other nav items close any open panel, so hovering Catalogue after
       Software does not leave Software's panel hanging. */
    $$('.nav__links a:not([data-mega]), .nav__right, .nav__mark').forEach(function (el) {
      el.addEventListener('mouseenter', hideAll);
    });
    /* Same for the keyboard: tabbing on to another nav item closes the panel. */
    $$('.nav__links a:not([data-mega]), .nav__right a, .nav__right button, .nav__mark').forEach(function (el) {
      el.addEventListener('focus', hideAll);
    });
    /* Down arrow on a category jumps into its panel — otherwise its links
       sit at the end of the header's tab order, after the Company menu. */
    megaLinks.forEach(function (a) {
      a.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown') return;
        var first = $('#mega-' + a.getAttribute('data-mega') + ' a');
        if (first) { e.preventDefault(); show(a.getAttribute('data-mega')); first.focus(); }
      });
    });
    /* A short grace period, so crossing the gap between link and panel
       does not snap it shut. */
    nav.addEventListener('mouseleave', function () { closeTimer = setTimeout(hideAll, 140); });
    nav.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
    nav.addEventListener('focusout', function (e) { if (!nav.contains(e.relatedTarget)) hideAll(); });
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMega) hideAll(); });
  }

  /* ═══ company dropdown ═════════════════════════════════════════════ */

  var co = $('#navco');
  if (co) {
    var coBtn = $('button', co);
    var setCo = function (open) {
      co.classList.toggle('is-open', open);
      coBtn.setAttribute('aria-expanded', String(open));
    };
    coBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setCo(!co.classList.contains('is-open'));
    });
    /* Hover opens it too on a real pointer, as a top nav is expected to. */
    if (matchMedia('(hover: hover)').matches) {
      co.addEventListener('mouseenter', function () { setCo(true); });
      co.addEventListener('mouseleave', function () { setCo(false); });
    }
    document.addEventListener('click', function (e) { if (!co.contains(e.target)) setCo(false); });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && co.classList.contains('is-open')) { setCo(false); coBtn.focus(); }
    });
  }

  /* ═══ mobile menu ══════════════════════════════════════════════════ */

  var burger = $('#burger');
  var menu = $('#menu');

  if (burger && menu) {
    var setMenu = function (open) {
      document.body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', String(!open));
      if (open) {
        var first = $('summary, a', menu);
        if (first) first.focus({ preventScroll: true });
      }
    };

    burger.addEventListener('click', function () {
      setMenu(!document.body.classList.contains('menu-open'));
    });

    $$('a', menu).forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });

    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
        setMenu(false);
        burger.focus({ preventScroll: true });
      }
    });

    /* The sections drop open rather than appearing: the height runs from
       nothing to what the list needs (and back), with the items fading in
       behind it. <details> still does the opening, so it works unanimated
       without script and under reduced motion. */
    $$('.menu__area', menu).forEach(function (area) {
      var summary = $('summary', area);
      var sub = $('.menu__sub', area);
      var run = null;
      summary.addEventListener('click', function (e) {
        if (reduced || !sub.animate) return;
        e.preventDefault();
        if (run) run.cancel();
        var opening = !area.open || area.classList.contains('is-closing');
        area.classList.remove('is-closing');
        var from = area.open ? sub.offsetHeight : 0;
        if (opening) area.open = true;
        var to = opening ? sub.scrollHeight : 0;
        if (!opening) area.classList.add('is-closing');
        run = sub.animate(
          [{ height: from + 'px', opacity: opening ? 0 : 1 },
           { height: to + 'px', opacity: opening ? 1 : 0 }],
          { duration: opening ? 320 : 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
        run.onfinish = function () {
          run = null;
          if (!opening) { area.open = false; area.classList.remove('is-closing'); }
        };
      });
    });

    /* A menu left open across a resize into desktop layout traps scroll. */
    matchMedia('(min-width: 1000px)').addEventListener('change', function (e) {
      if (e.matches) setMenu(false);
    });

    setMenu(false);
  }

  /* ═══ reveals ══════════════════════════════════════════════════════ */

  var reveals = $$('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        /* Stagger siblings so a row of cards arrives in sequence rather
           than all at once — reads as considered, not as a transition. */
        var sibs = $$('.reveal', en.target.parentNode).filter(function (n) {
          return n.parentNode === en.target.parentNode;
        });
        var i = Math.max(0, sibs.indexOf(en.target));
        en.target.style.transitionDelay = Math.min(i * 70, 350) + 'ms';
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    reveals.forEach(function (el) { io.observe(el); });
  }


  /* ═══ start: guided intake ═════════════════════════════════════════ */

  /* One question per card, branching on software / hardware / both. It
     composes a mailto rather than posting anywhere: a static site cannot
     process a form without a third party, and the visitor sees exactly what
     is sent. Offer names come from #offer-index (rendered from offers.py). */

  var wiz = $('#wiz');
  if (wiz) {
    wiz.hidden = false;
    var wizFallback = $('#intake-fallback');
    if (wizFallback) wizFallback.hidden = true;

    var OFFER_NAMES = {};
    try { OFFER_NAMES = JSON.parse(($('#offer-index') || {}).textContent || '{}'); }
    catch (err) { console.error('intake: bad offer index', err); }

    var ICONS = {
      software: '<svg viewBox="0 0 32 32" fill="none"><rect x="4" y="6" width="24" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M11 13l-3 3 3 3M21 13l3 3-3 3M17 12l-2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      hardware: '<svg viewBox="0 0 32 32" fill="none"><rect x="9" y="9" width="14" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M13 9V5M19 9V5M13 27v-4M19 27v-4M9 13H5M9 19H5M27 13h-4M27 19h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>',
      both: '<svg viewBox="0 0 32 32" fill="none"><rect x="3" y="11" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="18" y="8" width="11" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M14 16.5h4" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.5 1.5"/></svg>'
    };

    var TRACKS = [
      { v: 'software', t: 'Software', d: 'Apps, dashboards, internal tools, AI agents — the systems a business runs on.' },
      { v: 'hardware', t: 'Hardware', d: 'Boards, firmware, devices, and machines that speak protocols nobody documented.' },
      { v: 'both', t: 'Both', d: 'A device in the field and the software that makes its data worth having.' }
    ];

    var NEEDS = {
      software: [
        { t: 'An app my customers use', d: 'Mobile or web — ordering, accounts, a product in their pocket.', o: '/products/mobile-apps/' },
        { t: 'A dashboard for numbers I already have', d: 'Sales, admin, ops — one screen instead of six spreadsheets.', o: '/products/dashboards/' },
        { t: 'Inventory, stock or orders', d: 'Know what you have, where it is, and what is running out.', o: '/products/inventory/' },
        { t: 'A CRM or case system', d: 'Every customer, deal and ticket in one place with a history.', o: '/products/crm/' },
        { t: 'Bookings and scheduling', d: 'Courts, rooms, appointments — packed tight, never double-booked.', o: '/products/bookings/' },
        { t: 'A marketplace', d: 'Buyers, sellers, roles, payments and the admin behind it.', o: '/products/marketplace/' },
        { t: 'Quotes that take too long', d: 'Turn a two-day quoting loop into a two-minute one.', o: '/products/quote-engine/' },
        { t: 'An AI agent that does real work', d: 'Reads your data, answers the question, drafts the next step.', o: '/products/ops-analyst/' },
        { t: 'Something else', d: 'Describe it at the end — we will say whether we are the right people.', o: '' }
      ],
      hardware: [
        { t: 'A board about to go to fabrication', d: 'Catch the board-killer before you pay for a hundred of them.', o: '/services/design-review/' },
        { t: 'A product that needs a board designed', d: 'From a requirement to a fab-ready PCB and first articles.', o: '/services/board-to-fab/' },
        { t: 'Firmware that half-works', d: 'Resets, lockups, a field failure nobody can reproduce.', o: '/services/firmware-rescue/' },
        { t: 'A machine nobody can read', d: 'An undocumented protocol on the wire, decoded frame by frame.', o: '/services/protocol-decode/' },
        { t: 'Captures I can send remotely', d: 'Logic-analyser or serial dumps — decoded without a site visit.', o: '/services/remote-decode/' },
        { t: 'A BOM I am worried about', d: 'Lifecycle, single-source and counterfeit risk before you buy.', o: '/services/bom-audit/' },
        { t: 'A device that needs a security test', d: 'Hardware and authorisation testing — not compliance sign-off.', o: '/services/device-pentest/' },
        { t: 'Something else', d: 'Describe it at the end — we will say whether we are the right people.', o: '' }
      ],
      both: [
        { t: 'A fuel forecourt I cannot see into', d: 'Every pump, every litre, on a live ledger you read from anywhere.', o: '/products/efuelpro/' },
        { t: 'Machines I cannot see in real time', d: 'Mills, generators, lines — live status and alerts off the wire.', o: '/products/epsilon1/' },
        { t: 'An old machine that should report', d: 'Retrofit sensing and a dashboard without replacing the machine.', o: '/hardware/retrofits/', n: 'Machine retrofits' },
        { t: 'A connected product, device to app', d: 'The board, the firmware, the cloud and the interface — one team.', o: '/hardware/custom-hardware/', n: 'Custom hardware' },
        { t: 'A digital twin of a real system', d: 'A live model of the plant, fed by the plant.', o: '/products/digital-twin/' },
        { t: 'Sensing that has to be trusted', d: 'Measurement, calibration and the data chain behind it.', o: '/products/sensing/' },
        { t: 'Something else', d: 'Describe it at the end — we will say whether we are the right people.', o: '' }
      ]
    };

    var STATE_Q = {
      software: { q: 'What runs this today?', opts: [
        { t: 'Nothing yet', d: 'It is an idea, or a process that lives in people’s heads.' },
        { t: 'Spreadsheets and WhatsApp', d: 'It works, until it does not.' },
        { t: 'A system we are outgrowing', d: 'Off-the-shelf or old custom software that no longer fits.' },
        { t: 'A system that is broken', d: 'Something exists and needs rescuing or replacing.' }
      ]},
      hardware: { q: 'What is in your hands right now?', opts: [
        { t: 'An idea and a datasheet', d: 'Requirements, maybe a sketch, no board yet.' },
        { t: 'A prototype on the bench', d: 'It mostly works. Mostly.' },
        { t: 'Units already in the field', d: 'Shipped, deployed, and something needs fixing.' },
        { t: 'A machine we did not build', d: 'Someone else’s equipment we need to read or control.' }
      ]},
      both: { q: 'Where is it stuck?', opts: [
        { t: 'We have not started', d: 'Clean slate — hardware and software both to build.' },
        { t: 'Hardware works, software does not', d: 'The data exists; nobody can see it.' },
        { t: 'Software is ready, nothing feeds it', d: 'A system waiting for a device to talk to.' },
        { t: 'The two do not talk', d: 'Both exist, the link between them is the problem.' }
      ]}
    };

    var WHEN = [
      { t: 'Inside a month', d: 'There is a hard date.' },
      { t: 'One to three months', d: 'Soon, with room to plan.' },
      { t: 'This quarter', d: 'No hard date, but not someday.' },
      { t: 'Exploring', d: 'Working out whether it is worth doing.' }
    ];

    var BUDGET = [
      { t: 'Under $2k', d: 'A review, an audit, a decode.' },
      { t: '$2k – $10k', d: 'A focused build or a rescue.' },
      { t: '$10k – $50k', d: 'A product, a platform, a fleet.' },
      { t: 'Over $50k', d: 'Multi-phase, multi-site.' },
      { t: 'Not set yet', d: 'Tell us the scope and we will tell you the range.' }
    ];

    var PLACEHOLDER = {
      software: 'Who uses it, what it has to connect to, and the thing that keeps going wrong today…',
      hardware: 'Model numbers, the interface (RS485, CAN, Modbus…), unit volume, and what fails in the field…',
      both: 'The equipment, how many sites, what you want to see on the screen, and what it connects to…'
    };

    var a = { track: '', need: null, state: '', when: '', budget: '', name: '', company: '', note: '' };
    var step = 0;
    var TOTAL = 7;

    var stage = $('#wiz-stage');
    var back = $('#wiz-back');
    var count = $('#wiz-count');
    var fill = $('#wiz-fill');

    var el = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    var offerName = function () {
      if (!a.need || !a.need.o) return '';
      return OFFER_NAMES[a.need.o] || a.need.n || '';
    };

    var mailto = function () {
      var lines = [
        'Track: ' + (a.track ? a.track.charAt(0).toUpperCase() + a.track.slice(1) : '—'),
        'What the work is: ' + (a.need ? a.need.t : '—'),
        'Where it stands: ' + (a.state || '—'),
        'Deadline: ' + (a.when || '—'),
        'Budget: ' + (a.budget || '—'),
        '',
        'Details:',
        a.note || '',
        '',
        a.name ? '— ' + a.name + (a.company ? ', ' + a.company : '') : '',
        '',
        '---',
        'Sent from epsilon-labs.co/start/'
      ];
      var on = offerName();
      var subject = (on ? on : 'Project enquiry') + (a.company ? ' — ' + a.company : '');
      return 'mailto:er@epsilon-labs.co?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(lines.join('\n'));
    };

    var card = function (opt, picked, accent, onPick, big) {
      var b = el('button', 'wiz__card' + (big ? ' wiz__card--big' : ''));
      b.type = 'button';
      if (accent) b.setAttribute('data-accent', accent);
      b.setAttribute('aria-pressed', String(picked));
      if (big && ICONS[opt.v]) {
        var ic = el('span', 'wiz__icon');
        ic.innerHTML = ICONS[opt.v];
        b.appendChild(ic);
      }
      b.appendChild(el('span', 'wiz__t', opt.t));
      if (opt.d) b.appendChild(el('span', 'wiz__d', opt.d));
      b.addEventListener('click', function () {
        $$('.wiz__card', b.parentNode).forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        onPick();
        setTimeout(function () { go(step + 1); }, reduced ? 0 : 220);
      });
      return b;
    };

    var question = function (kicker, q, sub) {
      var h = el('div', 'wiz__q');
      h.appendChild(el('p', 'mono wiz__kicker', kicker));
      var h2 = el('h2', 'wiz__h', q);
      h2.tabIndex = -1;
      h.appendChild(h2);
      if (sub) h.appendChild(el('p', 'wiz__sub', sub));
      return h;
    };

    var grid = function (cls) { return el('div', 'wiz__grid' + (cls ? ' ' + cls : '')); };

    var accentFor = function () {
      return a.track === 'software' ? 'signal' : a.track === 'hardware' ? 'copper' : 'both';
    };

    var render = function () {
      var view = el('div', 'wiz__view');
      var g;

      if (step === 0) {
        view.appendChild(question('First', 'What are we building?', 'Pick the closest. You can change it later.'));
        g = grid('wiz__grid--3');
        TRACKS.forEach(function (t) {
          var acc = t.v === 'software' ? 'signal' : t.v === 'hardware' ? 'copper' : 'both';
          g.appendChild(card(t, a.track === t.v, acc, function () {
            if (a.track !== t.v) { a.need = null; a.state = ''; }
            a.track = t.v;
          }, true));
        });
        view.appendChild(g);
      }

      if (step === 1) {
        var heads = { software: 'What should the software do?', hardware: 'What is the hardware problem?', both: 'What should the system do?' };
        view.appendChild(question(a.track.charAt(0).toUpperCase() + a.track.slice(1), heads[a.track]));
        g = grid();
        NEEDS[a.track].forEach(function (n) {
          g.appendChild(card(n, a.need === n, accentFor(), function () { a.need = n; }));
        });
        view.appendChild(g);
      }

      if (step === 2) {
        var sq = STATE_Q[a.track];
        view.appendChild(question('Where it stands', sq.q));
        g = grid('wiz__grid--2');
        sq.opts.forEach(function (o) {
          g.appendChild(card(o, a.state === o.t, accentFor(), function () { a.state = o.t; }));
        });
        view.appendChild(g);
      }

      if (step === 3) {
        view.appendChild(question('Timing', 'When does it have to be done?'));
        g = grid('wiz__grid--2');
        WHEN.forEach(function (o) {
          g.appendChild(card(o, a.when === o.t, accentFor(), function () { a.when = o.t; }));
        });
        view.appendChild(g);
      }

      if (step === 4) {
        view.appendChild(question('Budget', 'What is the budget band?', 'A band, not a commitment. It tells us which shape of answer to give you.'));
        g = grid();
        BUDGET.forEach(function (o) {
          g.appendChild(card(o, a.budget === o.t, accentFor(), function () { a.budget = o.t; }));
        });
        view.appendChild(g);
      }

      if (step === 5) {
        view.appendChild(question('Details', 'The part that matters most.',
          a.track === 'software' ? 'What you would tell an engineer in the first five minutes.' :
          'If there is hardware involved, a model number and a photo of the connector save us both a week.'));
        var form = el('form', 'wiz__form');
        var row = el('div', 'wiz__row');
        var mk = function (label, key, ph, type) {
          var w = el('label', 'wiz__field');
          w.appendChild(el('span', 'mono', label));
          var i = el('input');
          i.type = type || 'text'; i.placeholder = ph; i.value = a[key];
          i.addEventListener('input', function () { a[key] = i.value.trim(); });
          w.appendChild(i);
          return w;
        };
        row.appendChild(mk('Your name', 'name', 'Name'));
        row.appendChild(mk('Company', 'company', 'Company (optional)'));
        form.appendChild(row);
        var tw = el('label', 'wiz__field');
        tw.appendChild(el('span', 'mono', 'The constraint you are most worried about'));
        var ta = el('textarea');
        ta.rows = 5; ta.placeholder = PLACEHOLDER[a.track]; ta.value = a.note;
        ta.addEventListener('input', function () { a.note = ta.value.trim(); });
        tw.appendChild(ta);
        form.appendChild(tw);
        var nx = el('button', 'btn wiz__next', 'Review');
        nx.type = 'submit';
        form.appendChild(nx);
        form.addEventListener('submit', function (e) { e.preventDefault(); go(6); });
        view.appendChild(form);
      }

      if (step === 6) {
        var on = offerName();
        view.appendChild(question('Where this lands', on ? on : 'A conversation first.',
          on ? 'That is the offer this maps to. Read the scope if you like, then send.' :
               'Not one of the listed offers — which is fine. We will reply and say whether we are the right people.'));
        var sum = el('dl', 'wiz__sum');
        [['Track', a.track.charAt(0).toUpperCase() + a.track.slice(1), 0],
         ['The work', a.need ? a.need.t : '—', 1],
         ['Today', a.state || '—', 2],
         ['Timing', a.when || '—', 3],
         ['Budget', a.budget || '—', 4],
         ['Details', a.note || '—', 5]].forEach(function (r) {
          var d = el('div');
          d.appendChild(el('dt', 'mono', r[0]));
          var dd = el('dd', null, r[1]);
          var ed = el('button', 'wiz__edit', 'Edit');
          ed.type = 'button';
          ed.addEventListener('click', function () { go(r[2]); });
          d.appendChild(dd);
          d.appendChild(ed);
          sum.appendChild(d);
        });
        view.appendChild(sum);
        var acts = el('div', 'wiz__acts');
        var send = el('a', 'btn', 'Send to er@epsilon-labs.co');
        send.href = mailto();
        acts.appendChild(send);
        if (on && a.need.o) {
          var rd = el('a', 'arrow', 'Read the scope');
          rd.href = a.need.o;
          acts.appendChild(rd);
        }
        view.appendChild(acts);
        view.appendChild(el('p', 'wiz__hint', 'Opens your email app with everything filled in. Nothing is sent from this page.'));
      }

      return view;
    };

    var go = function (n) {
      if (n > 0 && !a.track) n = 0;
      step = Math.max(0, Math.min(TOTAL - 1, n));
      var view = render();
      stage.innerHTML = '';
      stage.appendChild(view);
      back.hidden = step === 0;
      var sec = $('#intake-sec');
      if (sec) sec.classList.toggle('is-going', step > 0);
      count.textContent = String(step + 1).padStart(2, '0') + ' / ' + String(TOTAL).padStart(2, '0');
      fill.style.width = ((step + 1) / TOTAL * 100) + '%';
      wiz.setAttribute('data-accent', a.track ? accentFor() : '');
      var h = $('.wiz__h', view);
      if (h && document.activeElement && document.activeElement !== document.body) h.focus({ preventScroll: true });
      var top = wiz.getBoundingClientRect().top;
      if (top < 0) wiz.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    };

    back.addEventListener('click', function () { go(step - 1); });
    go(0);
  }

  /* ═══ problem finder ═══════════════════════════════════════════════ */

  /* The commitment ladder, done honestly: name your problem (one click), see
     the fix and its real price (no click), start it with an email that
     already says what you picked (one more). Each step is small, and the
     visitor can see exactly what the next one costs before they take it.
     Without JavaScript every problem is a plain link to its offer page. */

  $$('[data-finder]').forEach(function (finder) {
    var blob = $('[data-finder-offers]', finder);
    var fix = $('.fix', finder);
    if (!blob || !fix) return;

    var offers;
    try { offers = JSON.parse(blob.textContent); }
    catch (err) {
      /* Leave the links working; they still go to the right page. */
      console.error('finder: bad offer data', err);
      return;
    }

    var cards = $$('.problem', finder);
    var open = null;

    var mail = function (problem, o) {
      var body = [
        'The problem: ' + problem,
        'Looks like: ' + o.name + ' (' + o.price + ')',
        '',
        'What it has to do:',
        '',
        'Deadline:',
        '',
        '---',
        'Sent from epsilon-labs.co'
      ].join('\n');
      return 'mailto:er@epsilon-labs.co?subject=' + encodeURIComponent(o.name + ' — ' + problem) +
        '&body=' + encodeURIComponent(body);
    };

    var node = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    var close = function () {
      if (open) open.setAttribute('aria-expanded', 'false');
      open = null;
      fix.hidden = true;
      fix.textContent = '';
    };

    var show = function (card) {
      var o = offers[card.getAttribute('data-slug')];
      if (!o) return;                      // unknown offer: let the link navigate
      if (open === card) { close(); return; }
      if (open) open.setAttribute('aria-expanded', 'false');
      open = card;
      card.setAttribute('aria-expanded', 'true');

      var problem = card.textContent.trim();
      fix.textContent = '';
      var text = node('div');
      text.appendChild(node('p', 'fix__k', 'We fix this · ' + o.tier));
      text.appendChild(node('p', 'fix__name', o.name));
      text.appendChild(node('p', 'fix__line', o.line));
      var price = node('p', 'fix__price', o.price + ' · ' + o.duration + ' ');
      price.appendChild(node('small', null, '(' + o.note + ')'));
      text.appendChild(price);

      var cta = node('div', 'fix__cta');
      var go = node('a', 'btn', 'Start this');
      go.href = mail(problem, o);
      var read = node('a', 'btn btn--ghost', 'Read the scope');
      read.href = o.url;
      cta.appendChild(go);
      cta.appendChild(read);

      fix.appendChild(text);
      fix.appendChild(cta);
      fix.hidden = false;

      /* Bring the answer into view only if it landed below the fold —
         never yank the page when it is already visible. */
      var r = fix.getBoundingClientRect();
      if (r.bottom > innerHeight) {
        fix.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      }
    };

    cards.forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (!offers[card.getAttribute('data-slug')]) return;
        e.preventDefault();
        show(card);
      });
    });

    /* "Show all" opens the rest in place; without script it is a link to
       the catalogue, so nothing is ever out of reach. */
    var more = $('[data-finder-more]', finder);
    if (more) {
      finder.classList.add('is-trimmed');
      more.addEventListener('click', function (e) {
        e.preventDefault();
        finder.classList.remove('is-trimmed');
        more.remove();
      });
    }

    $$('.finder__tab', finder).forEach(function (tab) {
      tab.addEventListener('click', function () {
        var area = tab.getAttribute('data-area');
        $$('.finder__tab', finder).forEach(function (t) {
          t.setAttribute('aria-pressed', String(t === tab));
        });
        cards.forEach(function (c) {
          c.hidden = area !== 'all' && c.getAttribute('data-area') !== area;
        });
        if (open && open.hidden) close();
      });
    });
  });

  /* ═══ rails ═════════════════════════════════════════════════════════
     A rail is a plain scroll container. The only thing script adds is
     honesty: the "scroll sideways" hint stays hidden unless the track is
     actually wider than its window, which depends on the viewport. */

  var rails = $$('.railwrap');
  if (rails.length) {
    var measure = function () {
      rails.forEach(function (wrap) {
        var rail = $('.rail', wrap);
        if (!rail) return;
        wrap.classList.toggle('is-scrollable', rail.scrollWidth - rail.clientWidth > 4);
      });
    };
    measure();
    addEventListener('resize', measure, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  }

  /* ═══ stepper ═══════════════════════════════════════════════════════
     One quality at a time, after Anduril's build-qualities slice. Every
     panel is in the HTML already — this only hides the ones that are not
     current, so the page reads in full without JavaScript. Tabs follow the
     ARIA pattern: arrows move and activate, Home/End jump to the ends. */

  $$('[data-step]').forEach(function (step) {
    var tabs = $$('[role="tab"]', step);
    var panels = $$('[role="tabpanel"]', step);
    if (tabs.length !== panels.length || !tabs.length) return;

    function show(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panels[j].classList.toggle('is-on', on);
      });
      if (focus) tabs[i].focus();
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(i); });
      t.addEventListener('keydown', function (ev) {
        var k = ev.key;
        var next = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1
          : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1
            : k === 'Home' ? 0
              : k === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        ev.preventDefault();
        show((next + tabs.length) % tabs.length, true);
      });
    });

    show(0);
  });

  /* ═══ footer year ══════════════════════════════════════════════════ */

  $$('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
