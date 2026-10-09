#!/usr/bin/env python3
"""
Stamp the shared chrome (head, nav, mobile menu, footer, scripts) onto every
page that has a body in tools/content/.

    python3 tools/scaffold.py            # rewrite every page
    python3 tools/scaffold.py work/      # just the pages under work/

This is a scaffolder, not a build step. It runs when you change the chrome in
tools/chrome.html or a body in tools/content/; the HTML it writes is the
deployed artifact and is checked in. Nothing at runtime depends on Python.

`tools/consistency.py` is the guard that the pages have not drifted apart
after someone hand-edits one of them.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from offers import OFFERS, path_for, url_for          # noqa: E402
import render                                          # noqa: E402
import jsonld                                          # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHROME = os.path.join(HERE, 'chrome.html')
CONTENT = os.path.join(HERE, 'content')

CURRENT = ' aria-current="page"'

# The canonical home of the site. Canonicals, og:url and og:image are emitted
# absolute from here, so re-running the scaffolder can never quietly revert
# them to root-relative — which is what happened when the domain lived only
# in sitemap.py.
SITE = 'https://epsilon-labs.co'

# path on disk            nav key     boot scene   title / description
PAGES = {
    'index.html': (None, 'epsilon',
        'Epsilon Labs — hardware and software, built to tolerance',
        'Epsilon Labs designs circuit boards and the systems that run on them. '
        'Schematic to shipped: PCB, firmware, cloud, interface. Fuel retail, '
        'paint, apparel, property, finance.'),

    'hardware/index.html': ('hardware', 'traces',
        'Hardware — Epsilon Labs',
        'Hardware solutions from Epsilon Labs: factory and mill automation, machine retrofits, '
        'industrial IoT, monitoring, custom hardware products, PCB design and firmware.'),

    'software/index.html': ('software', 'lattice',
        'Software — Epsilon Labs',
        'Software solutions from Epsilon Labs: CRM, ERP, inventory, dashboards, web and mobile '
        'apps, macOS and Windows apps, CLI tools, integrations, AI agents and automation.'),

    'work/index.html': ('work', 'mark',
        'Work — Epsilon Labs',
        'Fuel retail, paint, apparel, property and finance. Every engagement '
        'Epsilon Labs has shipped, and what each one actually took.'),

    'work/efuelpro/index.html': ('work', 'traces',
        'eFuelPro · Epsilon1 — Epsilon Labs',
        'A fuel-pump terminal built from nothing: the dispenser RS485 protocol '
        'reverse-engineered from raw frames, a 120 mm board, and a live ledger.'),

    'work/master-paints/index.html': ('work', 'mark',
        'Master Paints — Epsilon Labs',
        'Live AR colour on a customer wall, and the ops portal that routes the '
        'resulting cash-on-delivery orders to the nearest dealer.'),

    'work/deskless/index.html': ('work', 'mark',
        'deskless — Epsilon Labs',
        'The compliance and evidence layer for UK letting agents: Section 11 and '
        "Awaab's Law on one statutory clock, with an ombudsman-grade record."),

    'work/finance-ai/index.html': ('work', 'mark',
        'Finance AI — Epsilon Labs',
        'An institutional-grade investment terminal with live market data and a '
        'portfolio-aware analyst.'),

    'work/lineamode/index.html': ('work', 'mark',
        'Lineamode — Epsilon Labs',
        'An editorial-grade site for an apparel house, built to a brand system '
        "down to the grid's controlled disruption."),

    'about/index.html': ('about', 'epsilon',
        'About — Epsilon Labs',
        'A hardware and software lab in Lahore. Who runs it, how it works, and '
        'what we will not do.'),

    'contact/index.html': ('contact', 'mark',
        'Contact — Epsilon Labs',
        'Tell us what it has to do and we will tell you what it takes. '
        'Direct lines, no form.'),

    'start/index.html': (None, 'mark',
        'Start a project — Epsilon Labs',
        'Four questions that tell you which Epsilon Labs offer your problem is, '
        'what it costs, and whether we are the wrong people for it.'),

    'capabilities/index.html': ('capabilities', 'traces',
        'Capabilities — Epsilon Labs',
        'What Epsilon Labs can do: fuel retail automation, industrial monitoring and '
        'retrofits, remote protocol decode and firmware rescue, and the full range from '
        'PCB to cloud.'),

    'catalogue/index.html': ('catalogue', 'mark',
        'Catalogue — Epsilon Labs',
        'Everything Epsilon Labs sells, priced. Pre-fab design review, protocol '
        'decode, board-to-fab, firmware rescue, eFuelPro and the Epsilon1 terminal.'),

    '404.html': (None, 'epsilon',
        'Not found — Epsilon Labs',
        'That page does not exist. Epsilon Labs builds hardware and software '
        'from schematic to shipped — start again from the work or the practice.'),
}


# Offer pages come from tools/offers.py rather than tools/content/, so an
# offer is a data change and every page keeps the same eight-block shape.
for _o in OFFERS:
    PAGES[path_for(_o)] = (
        'catalogue', _o['scene'],
        f"{_o['name']} — Epsilon Labs",
        _o['summary'],
    )

GENERATED = {path_for(o): o for o in OFFERS}

# Solution categories and the two area indexes are generated too.
import render_cats                                      # noqa: E402
from categories import CATEGORIES, cat_path             # noqa: E402
for _c in CATEGORIES:
    PAGES[cat_path(_c)] = (
        _c['area'], 'lattice' if _c['area'] == 'software' else 'traces',
        f"{_c['name']} — {_c['area'].title()} — Epsilon Labs",
        _c['summary'])
CAT_PAGES = {cat_path(c): c for c in CATEGORIES}
GENERATED_BODY = {'catalogue/index.html': render.catalogue_body}


import re as _re


def expand_markers(body):
    """Swap data-driven placeholders in a hand-written page body for blocks
    rendered from tools/offers.py. Keeps hand-written pages free of prices."""
    def finder(m):
        area = m.group(1) or None
        return render.finder(area, tabs=area is None)

    def show(m):
        parts = m.group(1).split(':')
        slug, demo = parts[0], parts[1]
        flip = len(parts) > 2 and parts[2] == 'flip'
        kicker = parts[3] if len(parts) > 3 else None
        return render.showcase(slug, demo, flip, kicker)

    body = _re.sub(r'<!--SUITE:([a-z0-9,-]+)-->',
                   lambda m: render.suite(m.group(1).split(',')), body)
    body = _re.sub(r'<!--DEMO:([a-z]+)-->',
                   lambda m: ('      <div class="demo" data-demo="%s"><div class="demo__fallback">'
                              '<p class="mono" style="margin-bottom:var(--s-8)">Interactive demo</p>'
                              '<p>%s</p></div></div>' % (m.group(1), render.e(render.DEMO_FALLBACK[m.group(1)]))),
                   body)
    body = body.replace('<!--MOSAIC-->', render.mosaic())
    body = body.replace('<!--BUILD-->', render_cats.home_build())
    body = body.replace('<!--CAPINDEX-->', render_cats.capability_index())
    body = body.replace('<!--OFFERINDEX-->', render.offer_index())
    body = _re.sub(r'<!--FINDER(?::([a-z]+))?-->', finder, body)
    body = _re.sub(r'<!--SHOW:([^>]+?)-->', show, body)
    return body


def canonical(path):
    if path == '404.html':
        return '/404.html'
    return '/' + path[:-len('index.html')]



def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ''
    chrome = open(CHROME).read()

    written, skipped = 0, []
    for path, (navkey, scene, title, desc) in PAGES.items():
        if only and not path.startswith(only):
            continue

        if path in GENERATED:
            body = render.offer_body(GENERATED[path])
        elif path in CAT_PAGES:
            body = render_cats.category_page(CAT_PAGES[path])
        elif path in ('software/index.html', 'hardware/index.html'):
            body = render_cats.area_index(path.split('/')[0])
        elif path in GENERATED_BODY:
            body = GENERATED_BODY[path]()
        else:
            body_file = os.path.join(CONTENT, path.replace('/', '__'))
            if not os.path.exists(body_file):
                skipped.append(path)
                continue
            body = open(body_file).read()

        out = chrome
        out = out.replace('{{TITLE}}', title)
        out = out.replace('{{DESC}}', desc)
        url = SITE + canonical(path)
        out = out.replace('{{URL}}', url)
        out = out.replace('{{SITE}}', SITE)

        # Markdown twin, per the llms.txt v2 convention: a URL with no file
        # name gets index.md. Only offer pages have one — there is no point
        # advertising a twin for a page that is mostly a WebGL scene.
        offer = GENERATED.get(path)
        alt = ''
        if offer:
            alt = (f'<link rel="alternate" type="text/markdown" '
                   f'href="{url}index.md">\n')
        out = out.replace('{{ALT}}', alt)
        out = out.replace('{{JSONLD}}', jsonld.for_page(path, offer, url, SITE))
        out = out.replace('{{MEGA}}', render.mega())
        out = out.replace('{{SCENE}}', scene)
        out = out.replace('{{LAYOUT}}', ' data-layout="panel"' if path == 'index.html' else '')
        # The boot curtain plays on the home page only: it is an arrival, and
        # you only arrive once.
        home = path == 'index.html'
        out = out.replace('{{BOOT}}', ' data-boot="1"' if home else '')
        out = out.replace('{{BOOTUI}}', render.BOOT_UI if home else '')
        body = expand_markers(body)
        if '<!--OFFERS-->' in body:
            body = body.replace('<!--OFFERS-->', render.home_offers([
                'design-review', 'protocol-decode', 'efuelpro', 'epsilon1',
            ]))
        out = out.replace('{{MAIN}}', body.rstrip())

        for key in ('catalogue', 'hardware', 'software', 'work', 'about', 'contact', 'capabilities'):
            out = out.replace('{{NAV_%s}}' % key.upper(),
                              CURRENT if key == navkey else '')

        dest = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w') as f:
            f.write(out)
        written += 1
        print(f'  wrote {path}')

    print(f'\n{written} page(s) written')
    if skipped:
        print(f'{len(skipped)} without a body in tools/content/: ' + ', '.join(skipped))


if __name__ == '__main__':
    main()
