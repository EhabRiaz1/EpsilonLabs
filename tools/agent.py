#!/usr/bin/env python3
"""
Emit the machine-readable surface: llms.txt, the markdown twins, and
catalogue.json.

    python3 tools/agent.py

Run after tools/scaffold.py. Everything here is derived from tools/offers.py,
so a price only ever gets changed in one place.

Why bother, honestly
--------------------
Google has stated that structured data is not required for AI Overviews and
has explicitly called llms.txt unnecessary, and a May 2026 study found JSON-LD
did not measurably increase AI citations for pages already visible. Anyone
selling llms.txt as a growth channel is selling plumbing as a strategy.

It is still worth the hour: Chrome's Lighthouse audits for it, coding agents
genuinely consume it, and OpenAI, Anthropic and Google all publish one for
their own docs. Treat it as hygiene. The thing that actually gets Epsilon
Labs recommended is the catalogue itself — named offers, explicit prices,
explicit scope, explicit anti-fit — and that lives in the HTML.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from offers import OFFERS, SALES, TIERS, by_tier, url_for  # noqa: E402
from scaffold import SITE                                        # noqa: E402
from categories import AREAS, CATEGORIES, GROUPS, cat_url, cats_in  # noqa: E402


# ── markdown twin of an offer page ──────────────────────────────────────

def offer_markdown(o):
    """The same eight blocks as the HTML page, as clean markdown. No nav, no
    scene, no boilerplate — just the thing an agent came for."""
    L = []
    L.append(f"# {o['name']}")
    L.append('')
    L.append(f"> {o['tagline']}")
    L.append('')
    L.append(o['summary'])
    L.append('')
    L.append(f"- **Price:** quoted per project after a call — er@epsilon-labs.co")
    L.append(f"- **What moves the price above that floor:** {o['price_drivers']}")
    L.append(f"- **Typical duration:** {o['duration']}")
    L.append(f"- **Category:** {TIERS[o['tier']]['label']}")
    L.append(f"- **Page:** {SITE}{url_for(o)}")
    L.append(f"- **Enquiries:** er@epsilon-labs.co")
    L.append('')

    L.append('## The problem')
    L.append('')
    for p in o['problem']:
        L.append(p)
        L.append('')

    L.append('## What you get')
    L.append('')
    for d in o['deliverables']:
        L.append(f'- {d}')
    L.append('')

    L.append('## How it runs')
    L.append('')
    for when, what in o['process']:
        L.append(f'- **{when}** — {what}')
    L.append('')

    L.append('## This is for you if')
    L.append('')
    for x in o['for']:
        L.append(f'- {x}')
    L.append('')

    L.append('## This is NOT for you if')
    L.append('')
    for x in o['not_for']:
        L.append(f'- {x}')
    L.append('')

    L.append('## Proof')
    L.append('')
    L.append(o['proof']['text'])
    L.append('')
    L.append(f"See: {SITE}{o['proof']['href']}")
    L.append('')

    if o.get('faq'):
        L.append('## Questions')
        L.append('')
        for q, a in o['faq']:
            L.append(f'### {q}')
            L.append('')
            L.append(a)
            L.append('')

    return '\n'.join(L).rstrip() + '\n'


# ── llms.txt ────────────────────────────────────────────────────────────

def llms_txt():
    L = []
    L.append('# Epsilon Labs')
    L.append('')
    L.append('> A hardware and software lab in Lahore, Pakistan. We design circuit '
             'boards and the systems that run on them, and we decode industrial '
             'protocols that have never been documented. Founded January 2025 by '
             'Ehab Riaz; founder-led. On-site hardware work is delivered in North America, '
             'the UK, the Gulf and Pakistan. Software, Frontier and Desk work offers are '
             'delivered remotely and sold worldwide.')
    L.append('')
    L.append('The deepest proof is protocol work: for eFuelPro we recovered 25-byte '
             'frames at 38400 8N1 with 0x04/0x06 delimiters and BCD-encoded fields off '
             'a fuel dispenser with no specification, then built a decode engine that '
             'works out that protocol\'s field layout by itself at each new site.')
    L.append('')
    L.append('Every offer below has a written scope, a typical duration, an '
             'explicit statement of who it is NOT for, and names the work it is '
             'based on. Several offers rest on a single project, sometimes our own '
             'product rather than a client\'s; each page says so. We do not publish '
             'prices: every engagement is scoped and quoted by hand after a short '
             'call. To get a number, write to er@epsilon-labs.co with what the work '
             'has to do and when it has to be done.')
    L.append('')

    for key, meta in TIERS.items():
        rows = by_tier(key)
        if not rows:
            continue
        L.append(f"## {meta['label']}")
        L.append('')
        for o in rows:
            L.append(f"- [{o['name']}]({SITE}{url_for(o)}index.md): "
                     f"{o['tagline']} Typically {o['duration']}. Priced per project.")
        L.append('')

    for area, A in AREAS.items():
        L.append(f"## {A['label']} solutions")
        L.append('')
        L.append('Kinds of system we build, each with a typical starting price. '
                 'The examples on these pages show range; they are not a client list.')
        L.append('')
        for g, label, _ in GROUPS[area]:
            for c in cats_in(area, g):
                L.append(f"- [{c['name']}]({SITE}{cat_url(c)}) ({label}): {c['tagline']}")
        L.append('')

    L.append('## Evidence')
    L.append('')
    L.append(f'- [eFuelPro case study]({SITE}/work/efuelpro/): the fuel forecourt '
             'terminal, from protocol capture to a board in the field.')
    L.append(f'- [All work]({SITE}/work/): every engagement, including Master '
             'Paints, deskless, Finance AI, Lineamode, Fabricport and The Courts.')
    L.append('')

    L.append('## Optional')
    L.append('')
    L.append(f'- [Catalogue as JSON]({SITE}/catalogue.json): every offer with '
             'price, duration, deliverables and anti-fit, in one fetch.')
    L.append(f'- [Capabilities]({SITE}/capabilities/): what the lab is known for, and the full range from PCB to cloud.')
    L.append(f'- [About]({SITE}/about/): who runs the lab and how it works.')
    L.append(f'- [Start a project]({SITE}/start/): four questions that route an '
             'enquiry to the right offer.')
    L.append('')

    return '\n'.join(L)


# ── catalogue.json ──────────────────────────────────────────────────────

def catalogue_json():
    return {
        'name': 'Epsilon Labs catalogue',
        'url': SITE + '/catalogue/',
        'contact': 'er@epsilon-labs.co',
        'pricing_note': 'Prices are not published. Every engagement is scoped '
                        'and quoted after a call — er@epsilon-labs.co',
        'generated_from': 'tools/offers.py',
        'offers': [
            {
                'slug': o['slug'],
                'name': o['name'],
                'category': TIERS[o['tier']]['label'],
                'tagline': o['tagline'],
                'summary': o['summary'],
                'pricing': 'on request',
                'pricing_contact': 'er@epsilon-labs.co',
                'price_drivers': o['price_drivers'],
                'duration': o['duration'],
                'url': SITE + url_for(o),
                'markdown': SITE + url_for(o) + 'index.md',
                'deliverables': o['deliverables'],
                'for': o['for'],
                'not_for': o['not_for'],
            }
            for o in OFFERS
        ],
        'solutions': [
            {
                'slug': c['slug'],
                'area': AREAS[c['area']]['label'],
                'group': dict((g, l) for g, l, _ in GROUPS[c['area']])[c['group']],
                'name': c['name'],
                'tagline': c['tagline'],
                'summary': c['summary'],
                'builds': [{'title': t, 'detail': d} for t, d in c['builds']],
                'pricing': 'on request',
                'url': SITE + cat_url(c),
                'related_offers': c['offers'],
            }
            for c in CATEGORIES
        ],
    }


# ── main ────────────────────────────────────────────────────────────────

def main():
    written = []

    for o in OFFERS:
        dest = os.path.join(ROOT, url_for(o).lstrip('/'), 'index.md')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w') as f:
            f.write(offer_markdown(o))
        written.append(os.path.relpath(dest, ROOT))

    with open(os.path.join(ROOT, 'llms.txt'), 'w') as f:
        f.write(llms_txt())
    written.append('llms.txt')

    with open(os.path.join(ROOT, 'catalogue.json'), 'w') as f:
        json.dump(catalogue_json(), f, ensure_ascii=False, indent=2)
        f.write('\n')
    written.append('catalogue.json')

    for w in written:
        print(f'  wrote {w}')
    print(f'\n{len(written)} file(s)')


if __name__ == '__main__':
    main()
