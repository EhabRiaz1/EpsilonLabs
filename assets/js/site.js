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
        var first = $('a', menu);
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


  /* ═══ start: qualifying intake ═════════════════════════════════════ */

  /* Composes a mailto rather than posting anywhere. A static site cannot
     process a form without a third party, and a form that silently fails is
     worse than no form — so the answers go into the visitor's own email
     client where they can see exactly what is being sent. */

  var intake = $('#intake');
  if (intake) {
    /* Only reveal the picker once we know scripting works; the plain
       instructions stay for everyone else. */
    intake.hidden = false;
    var fallback = $('#intake-fallback');
    if (fallback) fallback.hidden = true;

    var picked = { need: '', when: '', budget: '' };
    var offer = '';

    /* Names and prices come from the page, which renders them from
       tools/offers.py. A hand-copied table here drifted once already
       (eFuelPro stayed at $550 after the offer moved to $650). */
    var OFFER_NAMES = {};
    try { OFFER_NAMES = JSON.parse(($('#offer-index') || {}).textContent || '{}'); }
    catch (err) { console.error('intake: bad offer index', err); }

    var match = $('#intake-match');
    var send = $('#intake-send');
    var note = $('#intake-note');

    var refresh = function () {
      if (offer && OFFER_NAMES[offer]) {
        match.innerHTML = 'Looks like <b>' + OFFER_NAMES[offer] + '</b>. ' +
          '<a href="' + offer + '" style="box-shadow:inset 0 -1px 0 var(--rule-bright)">Read the scope</a> ' +
          'before you send, if you like.';
      } else if (picked.need) {
        match.textContent = 'Not one of the listed offers — which is fine. ' +
          'Tell us the constraint and we will say whether we are the right people.';
      }

      var body = [
        'What the work is: ' + (picked.need || '—'),
        'Deadline: ' + (picked.when || '—'),
        'Budget: ' + (picked.budget || '—'),
        '',
        'The constraint I am most worried about:',
        (note && note.value.trim()) || '',
        '',
        '---',
        'Sent from epsilon-labs.co/start/'
      ].join('\n');

      var subject = offer && OFFER_NAMES[offer]
        ? OFFER_NAMES[offer].split(' — ')[0] + ' — enquiry'
        : 'Project enquiry';

      send.href = 'mailto:er@epsilon-labs.co?subject=' +
        encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    };

    $$('.intake__opts').forEach(function (group) {
      var key = group.getAttribute('data-group');
      $$('button', group).forEach(function (btn) {
        btn.addEventListener('click', function () {
          $$('button', group).forEach(function (b) {
            b.setAttribute('aria-pressed', String(b === btn));
          });
          picked[key] = btn.getAttribute('data-value');
          if (key === 'need') offer = btn.getAttribute('data-offer') || '';
          refresh();
        });
        btn.setAttribute('aria-pressed', 'false');
      });
    });

    if (note) note.addEventListener('input', refresh);
    refresh();
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
