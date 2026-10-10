#!/usr/bin/env python3
"""
Render offer pages and the catalogue from tools/offers.py.

Every offer page is the same eight blocks in the same order. That is
deliberate: a consistent shape is what makes a page skimmable by a buyer and
extractable by a machine, and it means adding an offer is a data change
rather than a design exercise.

Called by tools/scaffold.py. Not run directly.
"""

import html

from offers import OFFERS, SALES, TIERS, by_tier, price_label, price_note, url_for

ARROW = ('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">'
         '<path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" '
         'stroke-linecap="round" stroke-linejoin="round"/></svg>')

TICK = ('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">'
        '<path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.7" '
        'stroke-linecap="round" stroke-linejoin="round"/></svg>')

CROSS = ('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">'
         '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.7" '
         'stroke-linecap="round"/></svg>')


def e(s):
    return html.escape(str(s), quote=False)


def mailto(offer):
    subject = f"{offer['name']} — enquiry"
    body = (f"Offer: {offer['name']}\n\n"
            "What it has to do:\n\n"
            "Deadline:\n\n"
            "The constraint I'm most worried about:\n\n")
    from urllib.parse import quote
    return f"mailto:er@epsilon-labs.co?subject={quote(subject)}&body={quote(body)}"


# ── the boot curtain ────────────────────────────────────────────────────
#
# The field is the loading screen. While the ε assembles out of its scattered
# shell the page is still black; when the mark has arrived the curtain lifts,
# the chrome fades in and the same object settles into the hero frame as the
# background it will stay. One object, two jobs, no second animation.
#
# It is decorative and announced to nobody: the page underneath is complete
# HTML, and `prefers-reduced-motion`, a missing WebGL context or a slow glyph
# all skip it (see the inline script in chrome.html).

BOOT_UI = """<div class="boot" aria-hidden="true">
  <div class="boot__in">
    <p class="boot__mark">EPSILON LABS</p>
    <p class="boot__line"><i></i></p>
    <p class="boot__cap">Hardware and software</p>
  </div>
</div>"""


# ── offer page ──────────────────────────────────────────────────────────

# Each shelf gets its own ground colour, so a service page and a product page
# are not the same black scroll with different words on it.
TIER_SKIN = {
    'service':  'slate',
    'product':  'ore',
    'lab':      'stone',
    'security': 'stone',
    'desk':     'slate',
}


def offer_body(offer):
    o = offer
    tier = TIERS[o['tier']]
    accent = 'var(--signal)' if o['tier'] in ('saas',) else 'var(--copper)'
    parts = []

    # ── 1. hero: name, tagline, summary, price. Price above the fold. ──
    parts.append(f'''
  <section class="sec sec--flush sec--open" data-scene="{o['scene']}" style="padding-block:calc(var(--nav-h) + var(--s-96)) var(--s-64)">
    <div class="shell">
      <p class="mono reveal" style="margin-bottom:var(--s-24)">
        <a href="/catalogue/" style="color:inherit">{e(tier['label'])}</a> · {e(o['name'])}
      </p>
      <h1 class="h1 reveal" style="max-width:17ch">{e(o['tagline'])}</h1>
      <p class="lede reveal" style="margin-top:var(--s-32);max-width:50ch">{e(o['summary'])}</p>

    </div>
  </section>''')

    # ── 2. the terms, as a datasheet card ──
    terms = [
        ('Typical length', o['duration']),
        ('What you get', f"{len(o['deliverables'])} written deliverables, listed below"),
        ('What decides the number', o['price_drivers']),
        ('Scoping', 'One call, then a written scope. We say no when it is not ours.'),
    ]
    rows = ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in terms)
    parts.append(f'''
  <section class="sec" id="terms">
    <div class="shell specslice">
      <div class="speccard notch reveal">
        <p class="speccard__k">{e(o['name'])}</p>
        <dl>{rows}</dl>
        <p class="speccard__cta"><b>{e(price_label(o))}</b><a href="{mailto(o)}">Get a quote {ARROW}</a></p>
      </div>
      <div class="specslice__say reveal">
        <p class="sec__label"><b>01</b> <i>The terms</i></p>
        <p>{e(price_note(o))}. We do not publish a band for this, because a number without a scope is a guess and you would have to unpick it later anyway.</p>
        <p>Tell us what the work has to do and when it has to be done, and you get the scope and the number in writing — or a straight answer that this is not ours.</p>
      </div>
    </div>
  </section>''')

    # ── the product, working, before any argument about it ──
    if o.get('demo'):
        parts.append(f'''
  <section class="sec" id="try">
    <div class="shell">
      <p class="sec__label"><b>02</b> <i>Try it</i></p>
      <div class="demo" data-demo="{o['demo']}">
        <div class="demo__fallback">
          <p class="mono" style="margin-bottom:var(--s-8)">Interactive demo</p>
          <p>{e(DEMO_FALLBACK[o['demo']])}</p>
        </div>
      </div>
    </div>
  </section>''')

    # ── 2. the problem ──
    probs = '\n'.join(f'          <p>{e(p)}</p>' for p in o['problem'])
    parts.append(f'''
  <section class="sec sec--paper" id="problem">
    <div class="shell">
      <p class="sec__label"><b>03</b> <i>The problem</i></p>
      <div class="prose reveal">
{probs}
      </div>
    </div>
  </section>''')

    # ── 3. what you get ──
    items = '\n'.join(
        f'        <li class="reveal"><i>{TICK}</i><span>{e(d)}</span></li>'
        for d in o['deliverables'])
    parts.append(f'''
  <section class="sec sec--open" id="deliverables" data-scene="{o['scene']}">
    <div class="shell">
      <p class="sec__label"><b>04</b> <i>What you get</i></p>
      <ul class="checks">
{items}
      </ul>
    </div>
  </section>''')

    # ── 4. how it runs ──
    steps = '\n'.join(
        f'        <div><dt>{e(when)}</dt><dd>{e(what)}</dd></div>'
        for when, what in o['process'])
    parts.append(f'''
  <section class="sec sec--stone" id="process">
    <div class="shell">
      <p class="sec__label"><b>05</b> <i>How it runs</i></p>
      <dl class="spec reveal">
{steps}
      </dl>
    </div>
  </section>''')

    # ── 5 + 6. for / not for ──
    yes = '\n'.join(f'          <li><i>{TICK}</i><span>{e(x)}</span></li>' for x in o['for'])
    no = '\n'.join(f'          <li><i>{CROSS}</i><span>{e(x)}</span></li>' for x in o['not_for'])
    parts.append(f'''
  <section class="sec" id="fit">
    <div class="shell">
      <p class="sec__label"><b>06</b> <i>Whether this is for you</i></p>
      <div class="grid grid--2">
        <div class="fit reveal">
          <h3 class="h3">This is for you if</h3>
          <ul class="checks checks--tight">
{yes}
          </ul>
        </div>
        <div class="fit fit--no reveal">
          <h3 class="h3">This is not for you if</h3>
          <ul class="checks checks--tight">
{no}
          </ul>
        </div>
      </div>
    </div>
  </section>''')

    # ── 7. proof ──
    pr = o['proof']
    parts.append(f'''
  <section class="sec" id="proof">
    <div class="shell">
      <p class="sec__label"><b>07</b> <i>Proof</i></p>
      <div class="note reveal" style="max-width:var(--measure)">
        <p>{e(pr['text'])}</p>
        <p style="margin-top:var(--s-24)">
          <a class="arrow" href="{pr['href']}">{e(pr['label'])} {ARROW}</a>
        </p>
      </div>
    </div>
  </section>''')

    # ── 8. questions ──
    qs = '\n'.join(f'''        <div class="reveal">
          <h3 class="h3">{e(q)}</h3>
          <p>{e(a)}</p>
        </div>''' for q, a in o['faq'])
    parts.append(f'''
  <section class="sec" id="questions">
    <div class="shell">
      <p class="sec__label"><b>08</b> <i>Questions</i></p>
      <div class="faq">
{qs}
      </div>
    </div>
  </section>''')

    # ── cta ──
    skin = TIER_SKIN.get(o['tier'], 'slate')
    parts.append(f'''
  <section class="sec sec--{skin} sec--end" id="cta">
    <div class="shell">
      <p class="sec__label"><b>Next</b> {e(o['duration'])}</p>
      <h2 class="display reveal">{e(o['name'])}</h2>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:46ch">Tell us what the work has to do and when it has to be done. You will get a person who has read it, not a sequence.</p>
      <div class="reveal" style="display:flex;flex-wrap:wrap;gap:var(--s-12);margin-top:var(--s-48)">
        <a class="btn" href="{mailto(o)}">Start this {ARROW}</a>
        <a class="btn btn--ghost" href="/catalogue/">See everything else</a>
      </div>
    </div>
  </section>''')

    return '\n'.join(parts)


# ── catalogue ───────────────────────────────────────────────────────────

def catalogue_body():
    parts = ['''
  <section class="sec sec--flush sec--open" data-scene="mark" style="padding-block:calc(var(--nav-h) + var(--s-64)) var(--s-32)">
    <div class="shell">
      <p class="mono reveal" style="margin-bottom:var(--s-16)">Catalogue</p>
      <h1 class="h1 reveal" style="max-width:16ch">What you can hire us for.</h1>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:48ch">
        Every one of these has a written scope, a typical length, and a line
        saying who it is not for. Prices are not published: we quote the work
        after a call, because a number without a scope is a guess.
      </p>
    </div>
  </section>''']

    # One section, three groups. Three separate <section>s cost about 2,000px
    # of padding and pushed the offers below two folds — on a catalogue the
    # things for sale have to be the thing you see.
    groups = []
    n = 0
    for key, meta in TIERS.items():
        rows = by_tier(key)
        if not rows:
            continue
        n += 1
        items = []
        for o in rows:
            items.append(f'''          <li>
            <a class="cat__row reveal" href="{url_for(o)}">
              <span class="cat__name">{e(o['name'])}</span>
              <span class="cat__what">{e(o['tagline'])}</span>
              <span class="cat__price"><b>{e(o['duration'])}</b><small>{e(SALES)}</small></span>
            </a>
          </li>''')
        rows_html = '\n'.join(items)
        groups.append(f'''      <div class="cat__group" id="tier-{key}">
        <p class="sec__label"><b>{n:02d}</b> <i>{e(meta['label'])}</i></p>
        <p class="cat__blurb reveal">{e(meta['blurb'])}</p>
        <ol class="cat">
{rows_html}
        </ol>
      </div>''')

    # Each shelf sits on its own ground, so the catalogue scans as three
    # places rather than one long list of twenty-three rows.
    SKINS = ['', 'sec--paper', 'sec--stone', 'sec--slate', '']
    parts.append('\n'.join(
        f'  <section class="sec {SKINS[i % len(SKINS)]}" id="offers-{i}">'
        f'\n    <div class="shell">\n{g}\n    </div>\n  </section>'
        for i, g in enumerate(groups)))

    parts.append(f'''
  <section class="sec sec--ore sec--end" id="cta">
    <div class="shell">
      <p class="sec__label"><b>Next</b> Not sure which</p>
      <h2 class="display reveal">Not sure which one it is?</h2>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:42ch">
        Describe the thing that is going wrong. We will tell you which of
        these it is, or that it is none of them.
      </p>
      <div class="reveal" style="display:flex;flex-wrap:wrap;gap:var(--s-12);margin-top:var(--s-48)">
        <a class="btn" href="/start/">Start here {ARROW}</a>
        <a class="btn btn--ghost" href="/work/">See the work</a>
      </div>
    </div>
  </section>''')

    return '\n'.join(parts)



# ── home page teaser ────────────────────────────────────────────────────

def home_offers(slugs):
    """A few offers on the landing page. Same data, same prices — the home
    page can never quote a figure the catalogue has moved on from."""
    from offers import BY_SLUG
    items = []
    for slug in slugs:
        o = BY_SLUG[slug]
        items.append(f'''        <li>
          <a class="cat__row reveal" href="{url_for(o)}">
            <span class="cat__name">{e(o['name'])}</span>
            <span class="cat__what">{e(o['tagline'])}</span>
            <span class="cat__price"><b>{e(o['duration'])}</b><small>{e(SALES)}</small></span>
          </a>
        </li>''')
    return '\n'.join(items)


# ── the problem finder ──────────────────────────────────────────────────

# The six the home page leads with: the decode first, then the commonest
# software asks, one forecourt, one security. The rest wait behind "show all".
FINDER_FEATURED = ['protocol-decode', 'dashboards', 'quote-engine', 'bookings',
                   'efuelpro', 'device-pentest']


def finder(area=None, tabs=True, featured=None):
    """Problems in the buyer's words, each opening onto the offer that fixes
    it. Without JavaScript every problem is simply a link to its offer page;
    with it, the fix opens underneath without leaving the page.

    The offer data the fix panel needs is embedded from offers.py, so the
    price a visitor sees here is the price on the offer page. Always."""
    import json
    from offers import BY_SLUG, problems_for, TIERS

    probs = problems_for(area)
    if featured:
        rank = {slug: i for i, slug in enumerate(featured)}
        probs = sorted(probs, key=lambda p: rank.get(p[2], len(rank)))
    used = []
    for _, _, slug in probs:
        if slug not in used:
            used.append(slug)

    data = {}
    for slug in used:
        o = BY_SLUG[slug]
        data[slug] = {
            'name': o['name'],
            'tier': TIERS[o['tier']]['label'],
            'line': o['summary'],
            'price': price_label(o),
            'note': price_note(o),
            'duration': o['duration'],
            'url': url_for(o),
        }

    tab_html = ''
    if tabs:
        areas = [('all', 'Everything'), ('software', 'Software'),
                 ('hardware', 'Hardware'), ('frontier', 'Frontier'),
                 ('security', 'Security')]
        tab_html = ('      <div class="finder__tabs" role="group" aria-label="Filter problems">\n'
                    + '\n'.join(
                        f'        <button type="button" class="finder__tab" data-area="{k}" '
                        f'aria-pressed="{"true" if k == "all" else "false"}">{e(v)}</button>'
                        for k, v in areas)
                    + '\n      </div>\n')

    cards = '\n'.join(
        f'        <a class="problem" href="{url_for(BY_SLUG[slug])}" data-area="{a}" '
        f'data-slug="{slug}" aria-expanded="false"'
        f'{" data-more" if featured and i >= len(featured) else ""}>{e(text)}</a>'
        for i, (a, text, slug) in enumerate(probs))
    more = ''
    if featured and len(probs) > len(featured):
        more = (f'      <a class="ulink finder__more" href="/catalogue/" data-finder-more>'
                f'Show all {len(probs)} problems</a>\n')

    blob = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')

    return f'''    <div class="finder" data-finder>
{tab_html}      <div class="finder__grid">
{cards}
      </div>
{more}      <div class="fix" hidden aria-live="polite"></div>
      <script type="application/json" data-finder-offers>{blob}</script>
    </div>'''


# ── demo showcases ──────────────────────────────────────────────────────

DEMO_FALLBACK = {
    'quote': 'Drag the dimensions and the price and the dimensioned drawing update live.',
    'bookings': 'Click to book a slot, then let the scheduler fill the dead hours between bookings.',
    'dashboard': 'Switch period and region; revenue, orders and the chart update live.',
    'inventory': 'Sell stock and watch reorder points trigger a suggested purchase order.',
    'crm': 'Drag deals through the pipeline and watch the weighted forecast move.',
    'market': 'Buy as a buyer, then see the same order as the seller and as the admin.',
    'twin': 'A 3D model of a working fuel station — orbit it and click any dispenser for its live state.',
    'ledger': 'Every sale off the pump lands in the ledger with a verifiable receipt code.',
    'analyst': 'Ask it a question. When it wants to change data, it has to ask you first.',
}


def showcase(slug, demo, flip=False, kicker=None):
    """A working demo beside the offer that sells the real thing. Price and
    copy come from offers.py, so the showcase can never quote a stale figure."""
    from offers import BY_SLUG
    o = BY_SLUG[slug]
    k = kicker or o['name']
    return f'''      <div class="showcase{' showcase--flip' if flip else ''} reveal">
        <div>
          <p class="mono showcase__k">{e(k)}</p>
          <h3>{e(o['tagline'])}</h3>
          <p>{e(o['summary'])}</p>
          <p class="showcase__price">{e(o['duration'])}<small>{e(price_note(o))}</small></p>
          <div class="showcase__cta">
            <a class="btn" href="{mailto(o)}">Start this {ARROW}</a>
            <a class="btn btn--ghost" href="{url_for(o)}">Read the scope</a>
          </div>
        </div>
        <div class="demo" data-demo="{demo}">
          <div class="demo__fallback">
            <p class="mono" style="margin-bottom:var(--s-8)">Interactive demo</p>
            <p>{e(DEMO_FALLBACK[demo])}</p>
          </div>
        </div>
      </div>'''


# ── the suite ───────────────────────────────────────────────────────────

SUITE_LABEL = {
    'dashboards': 'Sales dashboard', 'inventory': 'Inventory', 'crm': 'CRM',
    'marketplace': 'Marketplace', 'bookings': 'Bookings', 'quote-engine': 'Quotes',
    'ops-analyst': 'AI analyst', 'digital-twin': 'Digital twin', 'efuelpro': 'Live ledger',
}


def suite(slugs):
    """Every product in one window: a tab per offer, each panel pairing the
    working demo with the offer that sells the real thing. All from
    offers.py, so a tab can never quote a stale price."""
    from offers import BY_SLUG, TIERS
    tabs, panels = [], []
    for i, slug in enumerate(slugs):
        o = BY_SLUG[slug]
        demo = o['demo']
        label = SUITE_LABEL.get(slug, o['name'])
        tabs.append(
            f'        <button type="button" role="tab" class="suite__tab" id="tab-{slug}" '
            f'data-tab="{slug}" aria-controls="panel-{slug}" '
            f'aria-selected="{"true" if i == 0 else "false"}">{e(label)}'
            f'<i>{e(o["duration"])}</i></button>')
        panels.append(f'''      <div class="suite__panel" role="tabpanel" id="panel-{slug}" data-panel="{slug}" aria-labelledby="tab-{slug}">
        <aside class="suite__side">
          <p class="mono" style="color:var(--signal)">{e(TIERS[o['tier']]['label'])}</p>
          <h3>{e(o['name'])}</h3>
          <p>{e(o['tagline'])}</p>
          <p class="showcase__price">{e(o['duration'])}<small>{e(price_note(o))}</small></p>
          <div class="showcase__cta">
            <a class="btn" href="{mailto(o)}">Start this {ARROW}</a>
            <a class="btn btn--ghost" href="{url_for(o)}">Read the scope</a>
          </div>
        </aside>
        <div class="demo" data-demo="{demo}">
          <div class="demo__fallback">
            <p class="mono" style="margin-bottom:var(--s-8)">Interactive demo · {e(label)}</p>
            <p>{e(DEMO_FALLBACK[demo])}</p>
          </div>
        </div>
      </div>''')
    return ('    <div class="suite" data-suite>\n'
            '      <div class="suite__tabs" role="tablist" aria-label="Products">\n'
            + '\n'.join(tabs) + '\n      </div>\n'
            + '\n'.join(panels) + '\n    </div>')


def offer_index():
    """url -> "Name — from $X", for the intake picker."""
    import json
    from offers import OFFERS
    data = {url_for(o): o['name'] for o in OFFERS}
    return ('<script type="application/json" id="offer-index">'
            + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>')


# ── home mosaic ─────────────────────────────────────────────────────────

MOSAIC = [
    # (slug, demo, size)  — Anduril's rhythm: full, three, tall + wide, two
    ('digital-twin', 'twin', 'full'),
    ('dashboards', 'dashboard', ''),
    ('crm', 'crm', ''),
    ('bookings', 'bookings', ''),
    ('mobile-apps', 'market', 'tall'),     # a portrait slot holds a phone
    ('quote-engine', 'quote', 'wide'),
    ('efuelpro', 'ledger', ''),
    ('inventory', 'inventory', ''),
]


def mosaic():
    from offers import BY_SLUG
    out = []
    for slug, demo, size in MOSAIC:
        o = BY_SLUG[slug]
        cls = 'tile' + (f' tile--{size}' if size else '')
        if demo == 'twin':
            view = (f'<div class="demo" data-demo="twin"><div class="demo__fallback">'
                    f'<p>{e(DEMO_FALLBACK["twin"])}</p></div></div>')
        elif size == 'tall':
            view = (f'<div class="tile__scale tile__scale--phone"><div class="phone"><div class="phone__notch"></div>'
                    f'<div class="demo" data-demo="{demo}"><div class="demo__fallback"><p>{e(DEMO_FALLBACK[demo])}</p>'
                    f'</div></div></div></div>')
        else:
            view = (f'<div class="tile__scale"><div class="demo" data-demo="{demo}">'
                    f'<div class="demo__fallback"><p>{e(DEMO_FALLBACK[demo])}</p></div></div></div>')
        out.append(f'''      <a class="{cls}" href="{url_for(o)}">
        <div class="tile__view" aria-hidden="true">{view}</div>
        <div class="tile__label">
          <p class="tile__name">{e(o['name'])}</p>
          <p class="tile__more"><span>{e(o['tagline'])}</span><b>See it {ARROW}</b></p>
        </div>
      </a>''')
    return '    <div class="mosaic">\n' + '\n'.join(out) + '\n    </div>'


# ── nav mega menu (anduril-style) ───────────────────────────────────────

MEGA = [
    # (key, title, page, [(group label, tiers)])
    # Software and Hardware list solution categories (tools/categories.py);
    # the others list priced offers.
    ('software', 'Software', '/software/', 'CATEGORIES'),
    ('hardware', 'Hardware', '/hardware/', 'CATEGORIES'),
    ('frontier', 'Frontier', '/catalogue/#tier-lab', [('The hard ones', ['lab'])]),
    ('security', 'Security', '/catalogue/#tier-security', [('Assessments', ['security'])]),
]


def mega():
    """One full-width panel per nav item, listing that area's offers with
    their prices. Rendered from offers.py, so the menu never quotes a price
    the offer page has moved on from."""
    UP = ('<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">'
          '<path d="M3 9l6-6M4 3h5v5" stroke="currentColor" stroke-width="1.3"/></svg>')
    panels = []
    for key, title, href, groups in MEGA:
        cols = []
        from offers import BY_SLUG, TIERS as _T
        if groups == 'CATEGORIES':
            import render_cats
            cols = render_cats.mega_cols(key)
            groups = []
        for label, keys in groups:
            # a key is either a tier or a single offer slug
            offers = [o for k in keys for o in (by_tier(k) if k in _T else [BY_SLUG[k]])]
            items = ''.join(
                f'<li><a href="{url_for(o)}"><span>{e(o["name"])}</span>'
                f'<small>{e(o["duration"])}</small></a></li>'
                for o in offers)
            cols.append(f'<div class="mega__col"><p class="mega__k">{e(label)}</p><ul>{items}</ul></div>')
        panels.append(
            f'<div class="mega" id="mega-{key}" data-mega-panel="{key}" hidden>'
            f'<div class="mega__in"><div class="mega__intro"><p class="mega__title">{e(title)}</p>'
            f'<a class="ulink" href="{href}">View all {UP}</a></div>'
            f'<div class="mega__cols">{"".join(cols)}</div></div></div>')
    return '\n'.join(panels)


def mobile_menu():
    """The phone menu's top level: one tap-to-open section per mega-menu
    area, listing the same things the desktop panels do — solution groups
    for Software and Hardware, offers for the rest. <details> needs no
    script and is announced as expandable by screen readers."""
    import render_cats
    from offers import BY_SLUG, TIERS as _T
    out = []
    for key, title, href, groups in MEGA:
        if groups == 'CATEGORIES':
            items = [(label, f'{render_cats.AREAS[key]["path"]}#{g}')
                     for g, label, _ in render_cats.GROUPS[key]]
        else:
            items = [(o['name'], url_for(o)) for _, keys in groups for k in keys
                     for o in (by_tier(k) if k in _T else [BY_SLUG[k]])]
        links = ''.join(f'<a href="{h}">{e(n)}</a>' for n, h in items)
        out.append(f'    <details class="menu__area"><summary>{e(title)}</summary>'
                   f'<div class="menu__sub">{links}<a class="menu__all" href="{href}">All {e(title.lower())} →</a></div></details>')
    return '\n'.join(out)

