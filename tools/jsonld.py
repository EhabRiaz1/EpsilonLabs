#!/usr/bin/env python3
"""
JSON-LD for the pages that have something a machine can use.

Honest framing: this is **hygiene, not a growth channel.** Google has said
structured data is not required for AI Overviews or AI Mode, and a May 2026
study found adding JSON-LD did not measurably move AI citations for pages
already visible. What actually gets Epsilon Labs recommended is the catalogue
itself — named offers with explicit prices, scope and anti-fit, written
plainly. This file just makes that machine-parseable at near-zero cost.

So: emit it where it is genuinely true (an Offer has a price; an FAQPage has
questions), and do not sprinkle it on pages where it would be decoration.

Called by tools/scaffold.py.
"""

import json


def _block(obj):
    return ('<script type="application/ld+json">'
            + json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
            + '</script>')


def organization(site):
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': f'{site}/#org',
        'name': 'Epsilon Labs',
        'url': site + '/',
        'logo': f'{site}/assets/brand/og.png',
        'email': 'er@epsilon-labs.co',
        'description': (
            'A hardware and software lab. Circuit boards, firmware, and the '
            'systems that run on them — including protocols nobody has documented.'
        ),
        'founder': {'@type': 'Person', 'name': 'Ehab Riaz'},
        'foundingDate': '2025-01',
        'address': {
            '@type': 'PostalAddress',
            'addressLocality': 'Lahore',
            'addressCountry': 'PK',
        },
        'areaServed': ['PK', 'AE', 'SA', 'GB'],
        'knowsAbout': [
            'RS485 protocol reverse engineering', 'Modbus', 'PCB design', 'KiCad',
            'ESP32-S3 firmware', 'embedded systems', 'fuel forecourt automation',
            'industrial telemetry',
        ],
    }


def service(offer, url, site):
    from offers import TIERS
    return {
        '@context': 'https://schema.org',
        '@type': 'Service',
        '@id': url + '#service',
        'name': offer['name'],
        'serviceType': TIERS[offer['tier']]['label'],
        'description': offer['summary'],
        'url': url,
        'provider': {'@id': f'{site}/#org'},
        'areaServed': ['PK', 'AE', 'SA', 'GB', 'US'],
        # No published price: the offer states availability and where to get a
        # quote. A fabricated figure here would be worse than none.
        'offers': {
            '@type': 'Offer',
            'url': url,
            'availability': 'https://schema.org/InStock',
            'priceSpecification': {
                '@type': 'PriceSpecification',
                '@id': url + '#price',
                'description': 'Quoted per project after a call. '
                               'Contact er@epsilon-labs.co',
            },
        },
        'termsOfService': url + '#fit',
        'hasOfferCatalog': {
            '@type': 'OfferCatalog',
            'name': f"{offer['name']} deliverables",
            'itemListElement': [
                {'@type': 'Offer', 'itemOffered': {'@type': 'Service', 'name': d}}
                for d in offer['deliverables']
            ],
        },
    }


def faq(offer, url):
    if not offer.get('faq'):
        return None
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        '@id': url + '#faq',
        'mainEntity': [
            {
                '@type': 'Question',
                'name': q,
                'acceptedAnswer': {'@type': 'Answer', 'text': a},
            }
            for q, a in offer['faq']
        ],
    }


def catalogue(site):
    """The whole catalogue as one ItemList, on /catalogue/."""
    from offers import OFFERS, url_for
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': f'{site}/catalogue/#list',
        'name': 'Epsilon Labs catalogue',
        'numberOfItems': len(OFFERS),
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': i + 1,
                'url': site + url_for(o),
                'name': o['name'],
            }
            for i, o in enumerate(OFFERS)
        ],
    }


def for_page(path, offer, url, site):
    """Return the <script> blocks for one page, or '' if it has nothing
    honest to declare."""
    blocks = []

    if path == 'index.html':
        blocks.append(organization(site))

    if offer:
        blocks.append(service(offer, url, site))
        f = faq(offer, url)
        if f:
            blocks.append(f)

    if path == 'catalogue/index.html':
        blocks.append(catalogue(site))

    return ''.join(_block(b) for b in blocks) + ('\n' if blocks else '')
