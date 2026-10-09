#!/usr/bin/env python3
"""
Warm contacts: companies Ehab has built for, prioritized for referral outreach.
Used in /work page to build social proof gallery.

FORMAT: name, company, wedge(s), what was built, logo path, warm ask angle
"""

WARM_CONTACTS = [
    {
        'priority': 1,
        'name': 'Ehab',
        'company': 'Total Parco',
        'wedge': 'fuel_retail',
        'built': 'Fuel retail forecourt systems and hardware integration.',
        'logo': '/logos/total-parco.png',
        'angle': 'Industrial monitoring and fuel-pump integration',
    },
    {
        'priority': 1,
        'name': 'The Courts team',
        'company': 'Master Paints',
        'wedge': 'other',
        'built': 'Live AR colour on customer walls + ops portal routing cash-on-delivery orders to dealers via WhatsApp.',
        'logo': '/logos/master-paints.png',
        'angle': 'Mobile apps, AR, integrations (WhatsApp logistics)',
    },
    {
        'priority': 1,
        'name': 'Areeb Areel',
        'company': 'Areeb Areel Filling Station',
        'wedge': 'fuel_retail',
        'built': 'Fuel management and station operations system.',
        'logo': '/logos/areeb-areel.webp',
        'angle': 'Protocol decode + fuel retail automation',
    },
    {
        'priority': 2,
        'name': 'FabricPort team',
        'company': 'Fabricport',
        'wedge': 'industrial_monitoring',
        'built': 'B2B surplus-fabric marketplace: four role-scoped portals over RLS Postgres, 3D fabric-scan viewer, automated colour classification (205-product catalogue), scheduled FX refresh.',
        'logo': None,
        'angle': 'Marketplaces, 3D visualization, automation',
    },
    {
        'priority': 2,
        'name': 'Lineamode team',
        'company': 'Lineamode',
        'wedge': 'industrial_monitoring',
        'built': 'Editorial-grade apparel house site built to brand system with controlled-disruption grid.',
        'logo': None,
        'angle': 'Web design, brand systems',
    },
    {
        'priority': 2,
        'name': 'YS Group',
        'company': 'YS Group',
        'wedge': 'other',
        'built': 'Corporate group site + logistics, intelligence, and technology services.',
        'logo': None,
        'angle': 'Web, logistics, analytics',
    },
    {
        'priority': 3,
        'name': 'Deskless team',
        'company': 'deskless',
        'wedge': 'other',
        'built': 'Compliance and evidence layer for UK letting agents (Section 11 + Awaab\'s Law on one statutory clock).',
        'logo': '/logos/deskless.png',
        'angle': 'Product, compliance automation',
    },
    {
        'priority': 3,
        'name': 'Padel Reserve',
        'company': 'The Padel Reserve',
        'wedge': 'other',
        'built': 'Single-page site for padel club with regulation court modelled in Three.js.',
        'logo': None,
        'angle': '3D visualization, booking systems',
    },
    {
        'priority': 3,
        'name': 'Al Maymanah',
        'company': 'Al Maymanah',
        'wedge': 'industrial_monitoring',
        'built': 'Industrial operations system.',
        'logo': '/logos/al-maymanah.png',
        'angle': 'Industrial automation',
    },
]

# Top priority for initial CASH PLAY push: Total Parco, Master Paints, Areeb Areel
PRIORITY_1 = [c for c in WARM_CONTACTS if c['priority'] == 1]
