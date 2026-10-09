#!/usr/bin/env python3
"""
Render the solution-category pages, the Software / Hardware indexes, and the
home page's "What we build" block, all from tools/categories.py.

Called by tools/scaffold.py.
"""

from urllib.parse import quote

from categories import AREAS, CATEGORIES, GROUPS, cat_url, cats_in
from offers import BY_SLUG, SALES, url_for
from render import ARROW, DEMO_FALLBACK, TICK, e

UP = ('<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">'
      '<path d="M3 9l6-6M4 3h5v5" stroke="currentColor" stroke-width="1.3"/></svg>')


def money(n):
    """No published prices: every build is scoped and quoted by hand."""
    return SALES


def _mail(c):
    subj = f"{c['name']} — enquiry"
    body = f"Category: {c['name']}\n\nWhat it has to do:\n\nDeadline:\n\n"
    return f"mailto:er@epsilon-labs.co?subject={quote(subj)}&body={quote(body)}"


# ── the slices ──────────────────────────────────────────────────────────
#
# A category page is assembled out of a fixed set of slices, the way
# anduril.com assembles a product page: header, spec card, stepper,
# interactive band, examples, ways to start, closing colour. The order never
# varies, so two pages are comparable and a machine can read either one.

# What each area hands over and where it runs. These are the lab's standing
# terms, not per-category claims, so they are written once here.
TERMS = {
    'software': ('Source code, the repository and the accounts it runs on. '
                 'No per-seat licence to us.',
                 'Your own cloud account, or ours if you would rather not run it.'),
    'hardware': ('Schematics, board files, firmware source and the bill of '
                 'materials. Yours to have built by anyone.',
                 'Installed on site. Pakistan, the Gulf and the UK.'),
}


def spec_slice(c, mail):
    """The datasheet card. Every row is either data from this category or a
    standing term of the lab — nothing here is invented per page."""
    owns, runs = TERMS[c['area']]
    rows = [('Built with', ', '.join(c['stack']))]
    if c['offers']:
        o = BY_SLUG[c['offers'][0]]
        rows.append(('A first step', f"{o['name']} — {o['duration']}"))
    rows.append(('You own', owns))
    rows.append(('Where it runs', runs))
    rows.append(('Scoping', 'One call, then a written scope. We say no when it is not ours.'))
    body = ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in rows)
    return f'''
  <section class="sec" id="terms">
    <div class="shell specslice">
      <div class="speccard notch reveal">
        <p class="speccard__k">{e(c['name'])}</p>
        <dl>{body}</dl>
        <p class="speccard__cta"><b>{e(SALES)}</b><a href="{mail}">Get a quote {ARROW}</a></p>
      </div>
      <div class="specslice__say reveal">
        <p class="sec__label"><b>01</b> <i>The terms</i></p>
        <p>We quote the work after one call, in writing, against a scope you can hold us to. No published band, because a number without a scope is a guess — and no retainer that quietly renews.</p>
        <p>What you get at the end is the thing itself and everything needed to keep it running without us. That is the deal on every job, whatever it is.</p>
      </div>
    </div>
  </section>'''


def kicker(title, detail):
    """The small label above the sentence — dropped when the sentence already
    opens with it, so the panel never says the same thing twice."""
    if detail.lower().startswith(title.lower()):
        return ''
    return f'<p class="step__k">{e(title)}</p>'


def stepper(items, label):
    """The numbered stepper, after Anduril's build-qualities slice: one thing
    at a time, the count stated, the short title on the tab and the whole
    sentence in the panel. Every panel is in the HTML, so the page still
    reads with JavaScript off."""
    n = len(items)
    tabs = ''.join(
        f'<button type="button" role="tab" id="stab-{i}" aria-controls="spanel-{i}" '
        f'aria-selected="{"true" if i == 0 else "false"}" tabindex="{0 if i == 0 else -1}">'
        f'{e(title)}</button>'
        for i, (title, _) in enumerate(items))
    panels = ''.join(
        f'<div class="step__panel{" is-on" if i == 0 else ""}" role="tabpanel" id="spanel-{i}" '
        f'aria-labelledby="stab-{i}">'
        f'<p class="step__n">{i + 1:02d} <span>/ {n:02d}</span><b>{i + 1}</b></p>'
        f'<div class="step__body">{kicker(title, detail)}'
        f'<p class="step__t">{e(detail)}</p></div></div>'
        for i, (title, detail) in enumerate(items))
    return f'''
  <section class="sec" id="builds">
    <div class="shell">
      <p class="sec__label"><b>02</b> <i>What we build</i></p>
      <div class="step reveal" data-step>
        <div class="step__tabs" role="tablist" aria-label="What we build in {e(label)}">{tabs}</div>
        {panels}
      </div>
    </div>
  </section>'''


# A category gets the live band only where one of our demos honestly shows
# that kind of software. The rest of the pages simply do not have the slice.
DEMO_FOR_CAT = {
    'crm': ('crm', 'A pipeline you can drag'),
    'inventory': ('inventory', 'Stock that answers back'),
    'dashboards': ('dashboard', 'Numbers, live'),
    'booking': ('bookings', 'A week you can fill'),
    'quoting': ('quote', 'A quote in thirty seconds'),
    'marketplaces': ('market', 'Buyer, seller, admin'),
    'mobile-apps': ('market', 'The same thing, in a hand'),
    'ai-agents': ('analyst', 'It asks before it writes'),
    'fuel-forecourt': ('ledger', 'Every litre, on the record'),
}


def demo_slice(c):
    pair = DEMO_FOR_CAT.get(c['slug'])
    if not pair:
        return ''
    demo, line = pair
    fb = DEMO_FALLBACK[demo]
    return f'''
  <section class="sec iband" id="live">
    <div class="shell">
      <p class="iband__corner"><span><b>Live</b> &middot; not a screenshot</span><span>Running in this page</span></p>
      <h2 class="iband__big reveal">{e(line)}</h2>
      <div class="iband__stage reveal">
        <div class="demo" data-demo="{demo}"><div class="demo__fallback"><p>{e(fb)}</p></div></div>
      </div>
      <p class="iband__foot"><span>{e(fb)}</span><span>Demo data, ours, built for this page</span></p>
    </div>
  </section>'''


def category_page(c):
    area = AREAS[c['area']]
    glabel = {g: l for g, l, _ in GROUPS[c['area']]}[c['group']]
    scene = 'lattice' if c['area'] == 'software' else 'traces'
    acc = 'var(--signal)' if c['area'] == 'software' else 'var(--copper)'
    mail = _mail(c)
    P = []

    code = f"{c['area'][:2].upper()} · {c['slug'].replace('-', ' ').upper()}"
    P.append(f'''
  <section class="sec sec--flush sec--open" data-scene="{scene}" style="padding-block:calc(var(--nav-h) + var(--s-96)) var(--s-64)">
    <div class="shell">
      <p class="mono reveal" style="margin-bottom:var(--s-24)"><a href="{area['path']}" style="color:inherit">{e(area['label'])}</a> · {e(glabel)} <span style="color:{acc}">[{e(code)}]</span></p>
      <h1 class="h1 reveal" style="max-width:15ch">{e(c['name'])}</h1>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:40ch;color:var(--ink)">{e(c['tagline'])}</p>
      <p class="reveal" style="margin-top:var(--s-24);max-width:56ch;color:var(--muted)">{e(c['summary'])}</p>
      <div class="reveal" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-16) var(--s-32);margin-top:var(--s-48)">
        <a class="btn" href="{mail}">Talk to us about this {ARROW}</a>
        <span class="mono" style="color:var(--muted)">Scoped and quoted after one call</span>
      </div>
    </div>
  </section>''')

    # ── the spec card: the terms of the work, stated like a datasheet ──
    P.append(spec_slice(c, mail))

    P.append(stepper(c['builds'], c['name']))
    P.append(demo_slice(c))

    ex = ''.join(f'<div class="rail__item reveal"><span class="rail__k">{i + 1:02d} / {len(c["examples"]):02d}</span>'
                 f'<p class="rail__t">{e(x)}</p></div>'
                 for i, x in enumerate(c['examples']))
    P.append(f'''
  <section class="sec sec--stone" id="examples">
    <div class="shell">
      <p class="sec__label"><b>03</b> <i>Examples</i></p>
      <p class="reveal" style="max-width:52ch;margin-bottom:var(--s-48);color:var(--muted)">Three things we could build for you here. They show the range; they are not a client list.</p>
      <div class="railwrap"><div class="rail">{ex}</div>
        <p class="rail__hint"><span class="rail__more">Scroll sideways for the rest</span><span>{len(c['examples'])} examples</span></p></div>
    </div>
  </section>''')

    stack = ''.join(f'<span class="tag">{e(x)}</span>' for x in c['stack'])
    fit = ''.join(f'<li><i>{TICK}</i><span>{e(x)}</span></li>' for x in c['fit'])
    P.append(f'''
  <section class="sec" id="fit">
    <div class="shell">
      <p class="sec__label"><b>04</b> <i style="color:{acc}">Is this you?</i></p>
      <div class="grid grid--2">
        <div class="fit reveal"><h3 class="h3">Who asks for this</h3><ul class="checks checks--tight">{fit}</ul></div>
        <div class="fit reveal"><h3 class="h3">What we build it with</h3><div style="display:flex;flex-wrap:wrap;gap:var(--s-8)">{stack}</div></div>
      </div>
    </div>
  </section>''')

    n = 5
    if c['offers']:
        rows = ''.join(
            f'<li><a class="cat__row reveal" href="{url_for(BY_SLUG[o])}">'
            f'<span class="cat__name">{e(BY_SLUG[o]["name"])}</span>'
            f'<span class="cat__what">{e(BY_SLUG[o]["tagline"])}</span>'
            f'<span class="cat__price"><b>{e(BY_SLUG[o]["duration"])}</b><small>{e(SALES)}</small></span></a></li>'
            for o in c['offers'])
        P.append(f'''
  <section class="sec" id="start">
    <div class="shell">
      <p class="sec__label"><b>{n:02d}</b> <i style="color:{acc}">A smaller way to start</i></p>
      <ol class="cat">{rows}</ol>
    </div>
  </section>''')
        n += 1

    if c.get('proof'):
        text, href = c['proof']
        P.append(f'''
  <section class="sec" id="proof">
    <div class="shell">
      <p class="sec__label"><b>{n:02d}</b> <i style="color:{acc}">Related work</i></p>
      <div class="note reveal" style="max-width:var(--measure)"><p>{e(text)}</p>
        <p style="margin-top:var(--s-16)"><a class="arrow" href="{href}">See it {ARROW}</a></p></div>
    </div>
  </section>''')

    sibs = [x for x in cats_in(c['area'], c['group']) if x['slug'] != c['slug']]
    if sibs:
        items = ''.join(
            f'<a class="rail__item reveal" href="{cat_url(x)}">'
            f'<span class="rail__k">{e(x["name"])}</span>'
            f'<p class="rail__t">{e(x["tagline"])}</p></a>' for x in sibs)
        P.append(f'''
  <section class="sec" id="more">
    <div class="shell">
      <p class="sec__label"><b>{n:02d}</b> <i style="color:{acc}">Next to this</i></p>
      <div class="railwrap"><div class="rail">{items}</div>
        <p class="rail__hint"><span class="rail__more">Scroll sideways for the rest</span><a href="{area['path']}#{c['group']}">All {e(area['label'].lower())} solutions</a></p></div>
    </div>
  </section>''')
        n += 1

    end = 'sec--slate' if c['area'] == 'software' else 'sec--ore'
    P.append(f'''
  <section class="sec {end} sec--end" id="cta">
    <div class="shell">
      <p class="sec__label"><b>Next</b> {e(c['name'])}</p>
      <h2 class="display reveal">Tell us what it has to do.</h2>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:44ch">No form, no sales sequence. Write two lines about the problem and you will get a person who has read them.</p>
      <div class="reveal" style="display:flex;flex-wrap:wrap;gap:var(--s-12);margin-top:var(--s-48)">
        <a class="btn" href="{mail}">Start this {ARROW}</a>
        <a class="btn btn--ghost" href="{area['path']}">All {e(area['label'].lower())} solutions</a>
      </div>
    </div>
  </section>''')
    return '\n'.join(P)


def cat_rows(area):
    """The solutions in one area, as row lists under their group headings.
    Rows rather than cards: the names line up down the page and there is one
    frame on the screen instead of seventeen."""
    out = []
    for i, (g, label, blurb) in enumerate(GROUPS[area]):
        rows = ''.join(
            f'<a class="row reveal" href="{cat_url(c)}" id="">'
            f'<span class="row__n">{e(c["name"])}</span>'
            f'<span class="row__what">{e(c["tagline"])}</span>'
            f'<span class="row__go">Open {UP}</span></a>'
            for c in cats_in(area, g))
        surf = SURFACES[i % len(SURFACES)]
        out.append(f'''  <section class="blk {('sec ' + surf) if surf else 'blk--void'} wide cgroup" id="{g}">
    <div class="hrow"><h2>{e(label)}</h2><p class="cgroup__blurb">{e(blurb)}</p></div>
    <div class="rowlist">{rows}</div>
  </section>''')
    return '\n'.join(out)


# The four groups alternate ground, so an index page reads as four places
# rather than one long list.
SURFACES = ['', 'sec--paper', 'sec--stone', '']


HEADS = {
    'software': ('Software, whatever shape it needs to be.',
                 'Business systems, customer apps, desktop software, developer tools, AI agents '
                 'and automation — designed, built and handed over, owned by you.'),
    'hardware': ('Hardware that runs the real world.',
                 'Automation for factories and mills, monitoring for machines and sites, '
                 'devices built from the board up, and the engineering underneath.'),
}


def area_index(area):
    A = AREAS[area]
    n = len([c for c in CATEGORIES if c['area'] == area])
    scene = 'lattice' if area == 'software' else 'traces'
    h1, lede = HEADS[area]
    return f'''
  <section class="sec sec--flush sec--open" data-scene="{scene}" style="padding-block:calc(var(--nav-h) + var(--s-96)) var(--s-48)">
    <div class="shell">
      <p class="mono reveal" style="margin-bottom:var(--s-24)">{e(A['label'])} · {n} solutions</p>
      <h1 class="h1 reveal" style="max-width:16ch">{e(h1)}</h1>
      <p class="lede reveal" style="margin-top:var(--s-32);max-width:48ch">{e(lede)}</p>
    </div>
  </section>
  <div id="solutions">
{cat_rows(area)}
  </div>
  <section class="sec {'sec--slate' if area == 'software' else 'sec--ore'} sec--end" id="cta">
    <div class="shell">
      <p class="sec__label"><b>Next</b> Not on the list</p>
      <h2 class="display reveal">If it runs on code or current, ask.</h2>
      <p class="lede reveal" style="margin-top:var(--s-24);max-width:46ch">The list above is what we are asked for most, not the limit. Describe the problem in two lines and we will tell you whether it is ours.</p>
      <div class="reveal" style="display:flex;flex-wrap:wrap;gap:var(--s-12);margin-top:var(--s-48)">
        <a class="btn" href="/start/">Describe the problem {ARROW}</a>
        <a class="btn btn--ghost" href="/catalogue/">What we sell</a>
      </div>
    </div>
  </section>'''


def home_build():
    """The home page names the four groups in each practice, not all
    thirty-three solutions. Somebody standing at the front door needs to know
    the shape of the place, not its index."""
    out = []
    for area, A in AREAS.items():
        rows = ''
        for g, label, blurb in GROUPS[area]:
            k = len(cats_in(area, g))
            rows += (f'<a class="row reveal" href="{A["path"]}#{g}">'
                     f'<span class="row__n">{e(label)}</span>'
                     f'<span class="row__what">{e(blurb)}</span>'
                     f'<span class="row__go">{k} solutions {UP}</span></a>')
        out.append(f'''    <div class="harea harea--{area}">
      <div class="hrow"><h2>{e(A['label'])}</h2><a class="ulink" href="{A['path']}">All {e(A['label'].lower())} solutions {UP}</a></div>
      <div class="rowlist">{rows}</div>
    </div>''')
    return '\n'.join(out)


def mega_cols(area):
    """A menu column per group: the group itself, the three things people ask
    for most, and a way to the rest. The whole catalogue in a dropdown was
    thirty-three niche names and nobody reads that standing up."""
    cols = []
    for g, label, blurb in GROUPS[area]:
        cats = cats_in(area, g)
        items = ''.join(f'<li><a href="{cat_url(c)}"><span>{e(c["name"])}</span></a></li>'
                        for c in cats[:3])
        rest = len(cats) - 3
        more = (f'<li><a href="{AREAS[area]["path"]}#{g}"><small>+ {rest} more</small></a></li>'
                if rest > 0 else '')
        cols.append(f'<div class="mega__col">'
                    f'<p class="mega__k"><a href="{AREAS[area]["path"]}#{g}">{e(label)}</a></p>'
                    f'<p class="mega__b">{e(blurb)}</p>'
                    f'<ul>{items}{more}</ul></div>')
    return cols
