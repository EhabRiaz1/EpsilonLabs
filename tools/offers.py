#!/usr/bin/env python3
"""
The catalogue. One source of truth for everything Epsilon Labs sells.

This file feeds all of it:

  tools/scaffold.py   renders the offer pages from these entries
  tools/agent.py      emits catalogue.json, llms.txt and the .md twins

Nothing about an offer is written down twice. Change a price here and the
page, the JSON, the markdown twin and the JSON-LD all move together — which
is the only way a catalogue this size stays honest.

THE DATA-HANDLING TERMS ARE PROPOSALS TOO — NDA before receipt, encrypted at
rest, deleted 30 days after the report, staging credentials only, rotate on
completion. They are standard and defensible, but Ehab has to actually mean
them before they stay on the page.

PRICES ARE PROPOSALS. They are anchored on the Pakistani fuel-software
incumbents (DigitalManager, Oscar, FuelRegisters, ~PKR 2,500-3,000/month)
and on solo-operator economics. Ehab sets the real ones.

Every offer carries `not_for`. It is the most trust-building block on a sales
page and the one that stops the wrong enquiries reaching a solo operator.

Every offer also carries `price_drivers` — what moves the figure above the
floor. A blind test of these pages found "from $6,000 with no sense of what
takes it to $25,000" to be the single biggest gap, and it is the question
every real buyer asks second.
"""

# ── tiers ───────────────────────────────────────────────────────────────

TIERS = {
    'service': {
        'label': 'Engagements',
        'blurb': 'Fixed scope, fixed fee, a written deliverable and a clean ending.',
    },
    'security': {
        'label': 'Security',
        'blurb': ('Hardware and authorisation, not compliance sign-off. We test devices '
                  'and data isolation; we are not an accredited firm and will say so.'),
    },
    'desk': {
        'label': 'Desk work',
        'blurb': 'Flat fee, done remotely, no site visit. You send files; we send findings.',
    },
    'product': {
        'label': 'Products',
        'blurb': 'Hardware we designed and own, with the software that makes it useful.',
    },
    'platform': {
        'label': 'Platform',
        'blurb': 'The terminal and the decode engine, licensed to build on.',
    },
    'saas': {
        'label': 'Software',
        'blurb': ('The software every business runs on — dashboards, inventory, CRM, '
                  'marketplaces, bookings, apps. Built for you, owned by you.'),
    },
    'lab': {
        'label': 'Frontier',
        'blurb': ('The hard ones. Digital twins, robot-learning infrastructure, '
                  'sensing that has to be trusted. Scoped honestly, priced as discovery.'),
    },
}

# ── the catalogue ───────────────────────────────────────────────────────

OFFERS = [

    # ══ Tier 1 — services ═══════════════════════════════════════════════
    {
        'slug': 'design-review',
        'tier': 'service',
        'name': 'Pre-Fab Design Review',
        'tagline': 'Find the board-killer before you pay for a hundred of them.',
        'summary': (
            'Send us your schematic and BOM before you commit to fabrication. '
            'We review it the way we review our own and send back a written '
            'findings list, ranked by what it would cost you to discover later.'
        ),
        'price_from': 900,
        'currency': 'USD',
        'price_note': 'per board revision',
        'duration': '3–5 days',
        'price_drivers': (
            'Layer count and part count. A four-layer mixed-signal board with 300 components is not a two-layer sensor board, and we will tell you which you have before you pay.'
        ),
        'scene': 'traces',

        'problem': [
            'A board respin is four weeks and a fabrication run you have already paid '
            'for. The faults that cause it are almost never exotic — a voltage domain '
            'crossed, a footprint taken from a parts site instead of a datasheet, a '
            'regulator with no margin, protection that was assumed rather than specified.',
            'They are also nearly invisible to the person who drew the board, because '
            'they are looking at what they meant rather than at what is on the canvas.',
        ],
        'deliverables': [
            'Written findings list, ranked by cost-if-missed',
            'Power architecture review — rails, margin, protection, thermal',
            'Voltage-domain check across every interface on the board',
            'Footprint and land-pattern spot check against manufacturer datasheets',
            'BOM review — lifecycle risk, lead times, second sources',
            'DRC readiness and fabrication-output check',
            'A call to walk through anything you want to argue about',
        ],
        'process': [
            ('Day 0', 'You send schematic, board file and BOM. Any format we can open.'),
            ('Days 1–3', 'Review. We work from the module datasheets, not from the internet.'),
            ('Days 4–5', 'Written findings delivered, then a call to walk through them.'),
        ],
        'for': [
            'You have a board about to go to fabrication and nobody senior has read it',
            'A previous revision came back wrong and you do not know why',
            'Your layout was outsourced and you want it checked before you pay the fab',
            'You are a software team who inherited a hardware product',
        ],
        'not_for': [
            'Boards already in production with no revision planned — there is nothing to act on',
            'Full layout work. That is Board-to-Fab.',
            'Certification, EMC pre-compliance or safety approval. We are not a test house.',
        ],
        'proof': {
            'text': 'On Epsilon1, datasheet review caught a 5 V-only RS485 transceiver '
                    'that would have driven 5 V into the ESP32\'s 3.3 V RX pin. A dead '
                    'board and a four-week respin, found for the cost of an afternoon.',
            'href': '/hardware/',
            'label': 'The hardware practice',
        },
        'faq': [
            ('What do you need from me?',
             'The schematic, the board file and the BOM. KiCad, Altium and Eagle are all fine; '
             'PDFs work if that is all you have, though we can say less about the layout.'),
            ('Is it confidential?',
             'Yes. We will sign your NDA before you send anything, or provide ours.'),
            ('What if you find nothing?',
             'That happens and it is a real result. You get the written review saying so, '
             'which is worth having when you sign off the fabrication order.'),
        ],
    },

    {
        'slug': 'protocol-decode',
        'tier': 'service',
        'name': 'Protocol Decode Sprint',
        'tagline': 'Your machine is already talking. We work out what it is saying.',
        'summary': (
            'A serial bus with no published specification, no vendor support and no '
            'integration partner willing to return a call. We capture it, decode it, '
            'and hand you a validated parser plus the written specification nobody else has.'
        ),
        'price_from': 6000,
        'currency': 'USD',
        'price_note': 'per protocol, fixed fee',
        'duration': '2–4 weeks',
        'price_drivers': (
            'How many genuinely distinct protocols there are, whether we can get physical access for the capture phase, and how much other traffic shares the bus. One vendor across several model years is almost always one protocol; separate vendors are separate sprints.'
        ),
        'scene': 'traces',

        'problem': [
            'Most integration work stops at the API. When there is no API — an industrial '
            'machine speaking an undocumented serial protocol to a console the vendor will '
            'not open — the project usually stops with it.',
            'The machine is not the problem. It is broadcasting everything you need, '
            'continuously. What is missing is somebody willing to sit with a logic analyser '
            'and a controlled stimulus matrix until the bytes give themselves up.',
        ],
        'deliverables': [
            'Written protocol specification — framing, delimiters, field map, encoding, checksums',
            'Validated parser in C/C++ or Python, with the capture set it was verified against',
            'Raw captures and the stimulus matrix used to produce them, so you can re-derive it',
            'Resynchronisation strategy for a shared or noisy bus',
            'A go/no-go call at the halfway point — if it is no-go you stop there and we refund the balance',
        ],
        'process': [
            ('Week 1', 'Tap the bus, capture continuously, build the stimulus matrix. '
                       'Framing separated from payload.'),
            ('Week 2', 'Field mapping. One quantity varied at a time until each byte is '
                       'accounted for. Halfway go/no-go call lands here.'),
            ('Weeks 3–4', 'Parser, validation against held-back captures, written spec, handover.'),
        ],
        'for': [
            'Fuel dispensers, industrial meters, weighbridges, PLCs, medical or lab instruments',
            'RS485, RS232, Modbus, CAN, or something proprietary on top of one of them',
            'A vendor who will not share the specification, or no longer exists',
            'A mixed fleet where every machine speaks slightly differently',
        ],
        'not_for': [
            'Encrypted or cryptographically authenticated protocols — that is a different problem '
            'and usually the wrong one to solve',
            'Any equipment you do not own or have written authorisation from the owner to '
            'interface with. We ask in writing before we start, every time, and we will '
            'decline without it.',
            'Wireless or network protocols. This is wires.',
        ],
        'proof': {
            'text': 'For eFuelPro we recovered 25-byte frames at 38400 8N1 with 0x04/0x06 '
                    'delimiters and BCD fields off a fuel dispenser with no documentation — '
                    'then built a decode engine that works the field map out by itself on '
                    'each new site.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('What if the protocol turns out to be undecodable?',
             'You get a go/no-go call at the halfway point. If it is no-go you stop there and '
             'we refund the balance. We would rather lose half a fee than sell you a quarter '
             'you cannot use.'),
            ('Do you need physical access to the machine?',
             'Usually yes, at least for the capture phase. Where that is impossible we can '
             'work from captures you take with a rig we specify and ship.'),
            ('Who owns the result?',
             'You do. Specification, parser, captures, all of it.'),
            ('I have a mixed fleet. Is that one sprint or several?',
             'Usually one. Machines from one vendor across a few model years are nearly always '
             'the same protocol with fields in different places, and the decode engine handles '
             'that variation by itself. Genuinely different vendors are separate protocols and '
             'we price them separately — we will tell you which you have on the first call, '
             'before you commit to anything.'),
        ],
    },

    {
        'slug': 'board-to-fab',
        'tier': 'service',
        'name': 'Board-to-Fab',
        'tagline': 'Schematic to fabrication-ready, owned by you.',
        'summary': (
            'Schematic capture, PCB layout, custom symbol and footprint libraries drawn '
            'from datasheets, an orderable BOM and a complete fabrication package. '
            'Everything needed to build it again without us.'
        ),
        'price_from': 12000,
        'currency': 'USD',
        'price_note': 'typical 2–4 layer board, quoted per project',
        'duration': '6–10 weeks',
        'price_drivers': (
            'Layer count, part count, mechanical and enclosure constraints, and whether firmware is in scope. Firmware alongside the board is cheaper than firmware after it, because the person who drew the board writes the driver.'
        ),
        'scene': 'traces',

        'problem': [
            'Contract layout houses give you a board. They rarely give you the libraries, '
            'the reasoning, or a BOM you can actually order from — so the second revision '
            'costs as much as the first and you are still dependent.',
            'And footprints copied from a parts site rather than drawn from the mechanical '
            'drawing are how a board comes back from the fab 0.4 mm wrong.',
        ],
        'deliverables': [
            'Schematic, in KiCad 9 and as a readable PDF',
            'PCB layout, routed to clean DRC, with power on a widened netclass',
            'Custom symbol and footprint libraries drawn from manufacturer datasheets',
            'Orderable BOM with distributor part numbers and qualified alternates',
            'Fabrication package — Gerbers, Excellon drill, assembly notes',
            'Pin-to-pin netlist documentation written for someone who was not in the room',
            'Power protection specified, not assumed — fusing, reverse polarity, TVS',
        ],
        'process': [
            ('Weeks 1–2', 'Requirements, block diagram, part selection and lifecycle check. '
                          'One-way doors named before anything is drawn.'),
            ('Weeks 3–5', 'Schematic capture and library work. Datasheet review as we go.'),
            ('Weeks 6–8', 'Layout, DRC, 3D mechanical check for collisions and courtyards.'),
            ('Weeks 9–10', 'Fabrication outputs, BOM, documentation, handover.'),
        ],
        'for': [
            'An embedded product that needs a real board rather than a stack of dev kits',
            'A prototype on perfboard that has to become something manufacturable',
            'A team with firmware skills and no hardware engineer',
            'Small-batch industrial products, 10 to 1,000 units',
        ],
        'not_for': [
            'High-speed digital — DDR, multi-gigabit SERDES, RF front ends. Not our discipline '
            'and we will say so on the first call.',
            'Boards needing more than four layers, usually',
            'Safety-critical or certified medical hardware',
        ],
        'proof': {
            'text': 'Epsilon1 is 120 × 120 mm of 2-layer FR4 carrying five peripherals across '
                    'two SPI buses, I²C, two UARTs and USB-CDC, with ground pours on both '
                    'layers and an orderable BOM. It is in the field, not in a drawer.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('Do you handle assembly?',
             'We produce the fabrication package and work with your assembler, or point you at '
             'one. We do not run a production line.'),
            ('Can you do the firmware too?',
             'Yes, and it is usually cheaper together — the person who drew the board writes '
             'the driver. Quoted as a separate line.'),
            ('What if the first revision needs changes?',
             'Expected, and planned for. One revision cycle after bring-up is included.'),
        ],
    },

    {
        'slug': 'firmware-rescue',
        'tier': 'service',
        'name': 'Firmware Rescue',
        'tagline': 'It half-works, and whoever wrote it is gone.',
        'summary': (
            'We take over an embedded codebase nobody understands any more and make it '
            'reliable: bring-up, fault detection, watchdogs, automatic recovery, and an '
            'update path so the next fix does not need a site visit.'
        ),
        'price_from': 8000,
        'currency': 'USD',
        'price_note': 'after a paid assessment, credited if you proceed',
        'duration': '3–6 weeks',
        'price_drivers': (
            'How reproducible the failure is and how much of the original build survives. A codebase that builds on one laptop costs less to rescue than one that builds nowhere.'
        ),
        'scene': 'lattice',

        'problem': [
            'The device works on the bench and fails in the field. It locks up once a week '
            'and somebody drives out to power-cycle it. The original developer left, the '
            'build only runs on one laptop, and nobody wants to touch it.',
            'This is rarely a rewrite. It is almost always missing fault detection, missing '
            'recovery, and a handful of states nobody designed for.',
        ],
        'deliverables': [
            'Reproducible build, documented, running on more than one machine',
            'Fault detection and automatic recovery for the failures you actually see',
            'Watchdogs, brownout handling and a defined behaviour for every reset cause',
            'Offline tolerance — local commit first, sync second, no lost transactions',
            'OTA update path so the next fix is a push, not a two-hour drive',
            'A written map of the firmware for whoever comes after us',
        ],
        'process': [
            ('Week 1', 'Paid assessment. We reproduce the failure and write down the cause '
                       'chain. You get that document whether or not you continue.'),
            ('Weeks 2–4', 'Fixes, instrumented and verified against the reproduction.'),
            ('Weeks 5–6', 'Recovery paths, OTA, documentation, handover.'),
        ],
        'for': [
            'ESP32, STM32, RP2040, Arduino and PlatformIO codebases',
            'Devices already deployed that are costing you support visits',
            'A product that works until the network drops',
            'Teams who inherited firmware with no author and no documentation',
        ],
        'not_for': [
            'Ground-up firmware for a board that does not exist yet — that is Board-to-Fab',
            'Linux or Android embedded systems. This is bare metal and RTOS.',
            'Codebases we cannot build or hardware we cannot get hold of',
        ],
        'proof': {
            'text': 'The eFuelPro framing layer resynchronises byte by byte through corruption '
                    'on a bus shared with legacy equipment, where fixed-offset parsing had been '
                    'silently returning garbage that looked like data.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('Why a paid assessment first?',
             'Because quoting a rescue without reproducing the failure is guesswork, and you '
             'would be paying for the guess. The assessment is credited against the work if '
             'you proceed.'),
            ('What if the right answer is a rewrite?',
             'Then the assessment says so, with the reasoning, and you can take that document '
             'anywhere. It is the honest outcome maybe one time in five.'),
        ],
    },

    # ══ Tier 2 — products ═══════════════════════════════════════════════
    {
        'slug': 'efuelpro',
        'tier': 'product',
        'name': 'eFuelPro',
        'tagline': 'Every litre has a record, and the record has a receipt.',
        'summary': (
            'A forecourt terminal that reads the dispenser directly off the bus — not '
            'from a person typing numbers into a phone. Verifiable receipts, RFID '
            'loyalty and attendance, and a ledger that keeps working when the link drops.'
        ),
        'price_from': 650,
        'currency': 'USD',
        'price_note': 'per terminal, plus from $20 per pump per month',
        'duration': 'install in a day',
        'price_drivers': (
            "Number of pumps, and whether we already hold your dispenser's protocol. If we do not, a Protocol Decode Sprint comes first and is quoted separately."
        ),
        'scene': 'traces',

        'problem': [
            'A forecourt runs on trust and a clipboard. The dispenser knows exactly what it '
            'dispensed; the owner finds out later, from a total that has been through several '
            'hands. There is no dispute to resolve because there is no record to dispute.',
            'Pakistan\'s regulator now requires digital monitoring across more than 12,000 '
            'pumps, reported through an approved app. eFuelPro does not replace that '
            'reporting — it makes the numbers you report true, by taking them off the '
            'dispenser instead of off a clipboard.',
        ],
        'deliverables': [
            'Epsilon1 terminal, installed and reading your dispenser directly',
            'Self-calibrating decode — the device works out your pump\'s field map on site',
            'Thermal receipts with a QR code that resolves to the online record',
            'RFID loyalty per vehicle and per card, and staff attendance on the same reader',
            'Offline-first ledger — sales never block on the network',
            'Live dashboard: per-nozzle, per-shift, per-day, readable from anywhere',
            'OTA configuration, including price per litre, with no site visit',
        ],
        'process': [
            ('Week 0', 'We confirm your dispenser make and model and whether we already have '
                       'its protocol. If not, a Protocol Decode Sprint comes first.'),
            ('Install day', 'Terminal mounted, bus tapped, decode engine calibrated on site.'),
            ('Week 1', 'Attendants trained, receipts live, ledger reconciled against your books.'),
        ],
        'for': [
            'Independent stations and small chains who cannot see what they sold until the shift ends',
            'Dealers under a digital-monitoring obligation',
            'Sites with old or mixed dispenser fleets that other integrators have turned down',
            'OMCs wanting real telemetry rather than typed returns',
        ],
        'not_for': [
            'Anyone who wants manual entry software — that market is well served and cheaper',
            'Stations whose dispensers already expose a documented, supported integration',
            'Single-pump sites where the monthly will not pay for itself',
        ],
        'proof': {
            'text': 'Running in production on live dispenser hardware: 8,700 lines of C++ on '
                    'ESP32-S3, a 120 mm board we designed, and a protocol nobody had documented.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('My pumps are old and nobody will integrate them.',
             'That is the case we built this for. If we have not seen your protocol before, a '
             'Protocol Decode Sprint comes first and the terminal follows.'),
            ('What happens when the internet goes down?',
             'Nothing. Every transaction commits locally to a crash-safe queue with idempotent '
             'event IDs and drains when the link returns. The sale never waits.'),
            ('Can we resell this?',
             'Yes. Dealer and OMC terms are how we prefer to sell. Ask.'),
        ],
    },

    {
        'slug': 'epsilon1',
        'tier': 'platform',
        'name': 'Epsilon1',
        'tagline': 'A terminal that reads machines with undocumented protocols.',
        'summary': (
            'The board behind eFuelPro, pointed at any RS485 or Modbus machine. '
            'Generator, mill, chiller, weighbridge, loom — live readings into a ledger '
            'you can audit, on a terminal that keeps working when the network does not.'
        ),
        'price_from': 650,
        'currency': 'USD',
        'price_note': 'per node, plus from $25 per node per month. OEM licensing quoted.',
        'duration': '2–6 weeks to first vertical',
        'price_drivers': (
            'Whether your machine class is one we have decoded before. If it is Modbus or otherwise documented, this is fast. If it is undocumented, a Protocol Decode Sprint comes first.'
        ),
        'scene': 'traces',

        'problem': [
            'Industrial machines are full of data that never leaves the machine. The console '
            'shows it, the operator writes it on a sheet, and by the time it reaches a '
            'spreadsheet it is a day old and has been through two people.',
            'The blocker is almost never the cloud half. It is that the machine speaks a '
            'protocol nobody has written down.',
        ],
        'deliverables': [
            'Epsilon1 terminal — ESP32-S3, 4″ touch TFT, RS485, RFID, thermal printer, SD',
            'Self-calibrating decode engine, so each site configures itself',
            'Offline-first queue with idempotent event IDs',
            'Cloud ledger and dashboard, or an API into yours',
            'OTA configuration and firmware',
            'Board files, libraries and firmware source under OEM terms',
        ],
        'process': [
            ('Weeks 1–2', 'Protocol work on your machine class, if it is one we have not met.'),
            ('Weeks 3–4', 'Vertical configuration — what a transaction means for your machine.'),
            ('Weeks 5–6', 'Pilot on one site, then a rollout plan that does not need us.'),
        ],
        'for': [
            'Flour mills, generators, cold storage, weighbridges, textile plant',
            'Anyone running a fleet of machines they cannot see in real time',
            'Integrators who want to build on a proven terminal rather than design one',
        ],
        'not_for': [
            'Machines with a supported, documented API already — use it',
            'Consumer or home automation',
            'Anything needing certified safety instrumentation',
        ],
        'proof': {
            'text': 'eFuelPro is Epsilon1 pointed at a fuel dispenser. The board, the decode '
                    'engine and the offline ledger are the same; only the vertical changes.',
            'href': '/work/efuelpro/',
            'label': 'See it in one vertical',
        },
        'faq': [
            ('Is this a dev kit?',
             'No. It is a finished terminal with an enclosure, a screen and a ledger behind it. '
             'OEM terms exist if you want the board and the source to build your own.'),
            ('What if my machine uses Modbus?',
             'Then it is documented and we can skip the decode work, which makes it faster and '
             'cheaper. The hard cases are the ones that are not Modbus but pretend to be.'),
        ],
    },
    # ══ Security ════════════════════════════════════════════════════════
    # Scoped deliberately narrow. Epsilon Labs is not a CREST-accredited
    # pentest firm and does not sell generic web-application testing — the
    # buyers for that need certification we do not hold. What we do hold is
    # the ability to read a device: pull its firmware, find its debug ports,
    # and decode the bus it talks on. That is the same methodology, aimed
    # where almost nobody else can aim it.
    {
        'slug': 'device-pentest',
        'tier': 'security',
        'name': 'Device Penetration Test',
        'tagline': 'We take your device apart the way an attacker would.',
        'summary': (
            'Firmware extraction, debug-port discovery, bus interception, secrets '
            'in flash, update-path integrity. A hardware security assessment by '
            'people who design hardware — and a written report you can hand to a '
            'customer who asked whether your device is safe.'
        ),
        'price_from': 7500,
        'currency': 'USD',
        'price_note': 'per device, fixed fee',
        'price_drivers': (
            'How many distinct boards are in the product, whether the firmware is '
            'readable or locked, and whether you can give us a unit we are allowed '
            'to destroy. A device we can sacrifice is cheaper to assess than one we '
            'must return working.'
        ),
        'duration': '2–3 weeks',
        'scene': 'traces',

        'problem': [
            'An embedded product ships with a serial console nobody disabled, a '
            'firmware image anyone can pull off the flash, an API key compiled into '
            'that image, and an update path that accepts anything it is handed. '
            'None of these show up in a web application scan, because none of them '
            'are on the web.',
            'And the people who usually get asked to test it are network and '
            'application testers. They are good at their job. Their job is not a '
            'circuit board.',
        ],
        'deliverables': [
            'Written report: findings ranked by exploitability and impact, with reproduction steps',
            'Firmware extraction attempt — SPI flash, JTAG/SWD, UART bootloader',
            'Debug interface discovery: exposed UART, JTAG/SWD, test pads, unlocked fuses',
            'Secrets audit — keys, credentials and tokens recoverable from the image',
            'Bus interception on the device\'s own wires, including undocumented protocols',
            'Update-path review: is an unsigned or downgraded image accepted?',
            'Physical attack surface — enclosure, tamper evidence, exposed connectors',
            'A remediation list written for the engineer who has to fix it, not for an auditor',
        ],
        'process': [
            ('Before we start', 'Scope agreed and written authorisation signed. Nothing '
                                'begins without it. You ship us hardware; the clock starts '
                                'when it arrives.'),
            ('Week 1', 'Teardown, interface discovery, firmware extraction.'),
            ('Week 2', 'Firmware and protocol analysis, update path, secrets.'),
            ('Week 3', 'Report, ranked findings, remediation call.'),
        ],
        'for': [
            'You are shipping an embedded product and a customer has started asking security questions',
            'IoT, industrial, metering, access-control or point-of-sale hardware',
            'A device with a radio, a serial port, or a firmware update mechanism',
            'You suspect the answer is bad and would rather find out before a customer does',
        ],
        'not_for': [
            'Any device you do not own or have written authorisation from the owner to '
            'test. We ask for that authorisation in writing before we start, every '
            'time, and we will decline without it.',
            'Web application or corporate network penetration testing — that is a '
            'different discipline and you want an accredited firm for it.',
            'Certified assessments for PCI, SOC 2, FedRAMP or CE/UKCA sign-off. We are '
            'not an accredited lab and our report will not satisfy an auditor who '
            'needs one.',
            'Formal cryptographic review or protocol proof work',
        ],
        'proof': {
            'text': 'The methodology is the one we use as engineers. On eFuelPro we '
                    'tapped a live RS485 bus, recovered 25-byte frames nobody had '
                    'documented, and found a stray 0x88 broadcast from another device '
                    'quietly corrupting calibration. Reading hardware that does not '
                    'want to be read is the day job.',
            'href': '/work/efuelpro/',
            'label': 'How we read a bus',
        },
        'faq': [
            ('Are you CREST or OSCP certified?',
             'No, and if your buyer requires that certification you should hire a firm that '
             'holds it — we will say so on the first call. What we hold instead is hardware '
             'engineering: we design boards and decode undocumented buses, which is what a '
             'device assessment actually consists of. If your buyer needs a certificate, go '
             'elsewhere — we will tell you so on the first call rather than after you have '
             'paid. This is our first year selling security work as such, and we will not '
             'pretend otherwise.'),
            ('What happens to our data and our firmware?',
             'NDA signed before you send anything. Everything you give us — images, captures, '
             'schemas, credentials — is held encrypted, never shared outside the engagement, '
             'and deleted 30 days after the report unless you ask us to keep it for a retest. '
             'Credentials are staging-only and we ask you to rotate them when we finish.'),
            ('Will you destroy the device?',
             'Possibly. Firmware extraction sometimes means desoldering a flash chip. Send a '
             'unit you can spare and tell us if you need it back working — it changes the '
             'approach and the price.'),
            ('What if you find nothing serious?',
             'You get the report saying so, with everything we tried. That document is what '
             'you send the customer who asked the question.'),
        ],
    },

    {
        'slug': 'authz-review',
        'tier': 'security',
        'name': 'Authorisation Model Review',
        'tagline': 'Can tenant A read tenant B\'s row? We find out properly.',
        'summary': (
            'Multi-tenant isolation testing against your real schema and policies. '
            'Most testing proves you cannot log in as someone else. This proves that '
            'once you are legitimately logged in, you still cannot reach what is not '
            'yours.'
        ),
        'price_from': 3500,
        'currency': 'USD',
        'price_note': 'per application, fixed fee',
        'price_drivers': (
            'Number of roles, number of tables under policy, and whether there is a '
            'service-role key path that bypasses row-level security. Applications with '
            'one admin role are quick; ones with delegated per-organisation permissions '
            'are where the time goes.'
        ),
        'duration': '1 week',
        'scene': 'lattice',

        'problem': [
            'Authentication gets tested. Authorisation usually does not. The result is '
            'an application where every login works exactly as designed and one '
            'unparameterised query, one missing policy, or one service-role key on the '
            'client exposes every tenant to every other tenant.',
            'Row-level security written after the schema rather than with it is the '
            'usual cause. Policies added late are policies nobody can reason about, and '
            'the gaps are invisible until somebody goes looking.',
        ],
        'deliverables': [
            'Per-table, per-role matrix of what is actually reachable, tested against a live instance',
            'Cross-tenant read and write attempts from a legitimately authenticated session',
            'Row-level security policy review against the schema, not against the documentation',
            'Service-role and key-handling audit — anything that bypasses policy, and where it is exposed',
            'Storage and file-access isolation, which is usually where it leaks',
            'API and edge-function authorisation checks',
            'Written findings with the failing query for each one, so a fix can be verified',
        ],
        'process': [
            ('Day 0', 'Scope and written authorisation. Access to a staging instance '
                      'with representative data — never production.'),
            ('Days 1–3', 'Policy and schema review, then the reachability matrix built by testing.'),
            ('Days 4–5', 'Findings written up with reproductions, then a call.'),
        ],
        'for': [
            'Postgres and Supabase applications using row-level security',
            'Any B2B product where two customers share a database',
            'A team that inherited an application and does not know what its policies allow',
            'You are about to sign an enterprise customer who will ask this question',
        ],
        'not_for': [
            'Any system you do not own or have written authorisation from the owner to test. '
            'We ask in writing before we start and will decline without it.',
            'Stacks other than Postgres. This offer is built on Postgres row-level security — '
            'MySQL, Mongo and DynamoDB tenancy models are a different problem and we do not '
            'cover them.',
            'Testing against production data. Staging with representative data, always.',
            'Full web application penetration testing — this is one deep slice, not broad coverage',
            'Compliance certification',
        ],
        'proof': {
            'text': 'Fabricport runs four role-scoped portals — public catalogue, buyer, '
                    'supplier and admin — over row-level-secured Postgres. We write these '
                    'policies alongside the schema because policies bolted on afterwards '
                    'are the ones that leak.',
            'href': '/software/',
            'label': 'How we build them',
        },
        'faq': [
            ('Why not just run a scanner?',
             'A scanner does not know that order 4471 belongs to a different tenant. '
             'Authorisation bugs are semantic — they need somebody who has read your schema '
             'and understands what the data means.'),
            ('What happens to our data and our firmware?',
             'NDA signed before you send anything. Everything you give us — images, captures, '
             'schemas, credentials — is held encrypted, never shared outside the engagement, '
             'and deleted 30 days after the report unless you ask us to keep it for a retest. '
             'Credentials are staging-only and we ask you to rotate them when we finish.'),
            ('Do you need production access?',
             'No, and we will decline it. A staging instance with representative data is '
             'what we work against.'),
        ],
    },

    # ══ Desk work — flat fee, remote, no site visit ═════════════════════
    {
        'slug': 'remote-decode',
        'tier': 'desk',
        'name': 'Remote Protocol Decode',
        'tagline': 'You capture it. We decode it. Nobody gets on a plane.',
        'summary': (
            'The decode half of a Protocol Decode Sprint, without the site visit. '
            'We specify a capture rig, you run the stimulus matrix on your own '
            'machine, and we turn the resulting logs into a written specification '
            'and a working parser.'
        ),
        'price_from': 3500,
        'currency': 'USD',
        'price_note': 'per protocol, fixed fee, from your captures',
        'price_drivers': (
            'How complete your captures are. A full stimulus matrix run to our '
            'instructions decodes quickly; a single log of idle traffic often cannot '
            'be decoded at all, and we will tell you that before you pay.'
        ),
        'duration': '1–2 weeks',
        'scene': 'traces',

        'problem': [
            'The reason protocol work is expensive is usually travel. The machine is on '
            'a forecourt in one country and the person who can read it is in another, '
            'and half the fee is aeroplanes and hotel rooms.',
            'But the capture phase does not need us. It needs a cheap logic analyser, a '
            'precise list of what to vary, and somebody on site willing to follow it.',
        ],
        'deliverables': [
            'A capture protocol: exactly what hardware to buy, where to clip it, what to vary and in what order',
            'A free feasibility check on your first sample capture before you commit',
            'Written protocol specification — framing, delimiters, field map, encoding, checksums',
            'Validated parser in C/C++ or Python against your captures',
            'Everything you need to re-derive it yourself',
        ],
        'process': [
            ('Before we start', 'Written authorisation that you may interface with the '
                                'equipment. Then we send the capture protocol and a parts '
                                'list — typically under $150 of kit.'),
            ('Day 1–3', 'You capture. Send us the first sample and we tell you free '
                        'whether it is decodable before you go further.'),
            ('Week 1–2', 'Decode, parser, written specification, handover call.'),
        ],
        'for': [
            'A machine anywhere in the world with somebody on site who can clip on a probe',
            'Budgets that will not carry international travel',
            'A first step before committing to the full on-site sprint',
            'Anyone who has captures already and needs them read',
        ],
        'not_for': [
            'Any equipment you do not own or have written authorisation from the owner to '
            'interface with. We ask for that authorisation in writing before we send the '
            'capture protocol, every time, and we will decline without it.',
            'Encrypted or cryptographically authenticated protocols. We will not attempt to '
            'defeat an authentication scheme, and we would decline if asked.',
            'Situations where nobody on site can safely attach a probe — take the full sprint instead',
        ],
        'proof': {
            'text': 'The eFuelPro decode came out of captures and a controlled stimulus '
                    'matrix: nozzle up and down, 1 to 400 litres, both pump sides, every '
                    'dip-switch variant. The matrix is the method, and it travels.',
            'href': '/services/protocol-decode/',
            'label': 'The full on-site sprint',
        },
        'faq': [
            ('What if my captures turn out to be useless?',
             'We check your first sample free and tell you before you commit. That check is '
             'the whole reason this offer exists.'),
            ('How is this different from the full sprint?',
             'We are not in the room. You do the capture work to our instructions, which is '
             'most of the cost and none of the skill.'),
            ('What happens to our captures?',
             'NDA before you send anything. Captures are held encrypted, never shared outside '
             'the engagement, and deleted 30 days after handover unless you ask otherwise.'),
            ('Who owns the specification and the parser?',
             'You do — specification, parser and captures, the same as the full sprint. We keep '
             'no claim over the protocol or anything you build on it.'),
        ],
    },

    {
        'slug': 'bom-audit',
        'tier': 'desk',
        'name': 'BOM Risk Audit',
        'tagline': 'Find the part that goes end-of-life before your product does.',
        'summary': (
            'Send us your bill of materials. We come back with lifecycle status, real '
            'lead times, single-source exposure and a qualified alternate for every '
            'part that needs one.'
        ),
        'price_from': 600,
        'currency': 'USD',
        'price_note': 'per BOM, up to 150 line items',
        'price_drivers': (
            'Line count, and how many parts need an alternate qualified rather than '
            'just looked up. Over 150 lines we quote per project.'
        ),
        'duration': '3–5 days',
        'scene': 'traces',

        'problem': [
            'A board is only as manufacturable as its least available part. An '
            'end-of-life regulator, a 52-week lead time, or a component with exactly '
            'one source will stop a production run just as effectively as a design '
            'fault — and unlike a design fault, it arrives without warning.',
            'Most BOMs are assembled from what was in the designer\'s library, not from '
            'what a distributor can actually ship next quarter.',
        ],
        'deliverables': [
            'Lifecycle status for every line: active, NRND, or end-of-life',
            'Real distributor stock and lead times, not catalogue availability',
            'Single-source exposure flagged, with the risk stated plainly',
            'A qualified alternate for every part that needs one, checked for footprint and spec compatibility',
            'Cost roll-up at your build quantity',
            'A ranked list of what to redesign around now rather than later',
        ],
        'process': [
            ('Day 0', 'You send the BOM. CSV, Excel or a KiCad export — whatever you have.'),
            ('Days 1–4', 'Lifecycle, sourcing and alternates research.'),
            ('Day 5', 'Annotated BOM back, with the ranked risk list on top.'),
        ],
        'for': [
            'A board heading into its first production run',
            'A product that has been in production a while and nobody has re-checked the BOM',
            'Anyone who has been bitten by an allocation shortage once already',
        ],
        'not_for': [
            'Schematic or layout review — that is Pre-Fab Design Review',
            'Negotiating with distributors or placing orders on your behalf',
            'BOMs with no part numbers. We need something to look up.',
        ],
        'proof': {
            'text': 'Epsilon1 ships with a BOM carrying distributor part numbers and '
                    'qualified alternates, because a BOM you cannot order from is a '
                    'document rather than a deliverable.',
            'href': '/services/board-to-fab/',
            'label': 'Board-to-Fab',
        },
        'faq': [
            ('Is this included in Board-to-Fab?',
             'Yes. This offer is for boards somebody else designed.'),
        ],
    },

    {
        'slug': 'footprint',
        'tier': 'desk',
        'name': 'Datasheet to Footprint',
        'tagline': 'A footprint drawn from the mechanical drawing, not from the internet.',
        'summary': (
            'Send a datasheet, get back a KiCad symbol, footprint and 3D model built '
            'to the manufacturer\'s mechanical drawing and checked against IPC land '
            'pattern rules.'
        ),
        'price_from': 180,
        'currency': 'USD',
        'price_note': 'per part, symbol + footprint + 3D',
        'price_drivers': (
            'Pin count and package complexity. A two-pin passive is at the floor; a '
            'BGA or a connector with a complex mechanical keepout is more.'
        ),
        'duration': '2–3 days',
        'scene': 'traces',

        'problem': [
            'Footprints downloaded from a parts site are how a board comes back from '
            'the fab 0.4 mm wrong. They are drawn by somebody who did not read the '
            'mechanical drawing, and the error is invisible until the parts do not fit.',
            'Drawing one properly takes an hour you do not have, for a part you will '
            'use once.',
        ],
        'deliverables': [
            'KiCad symbol with correct pin numbering, electrical types and naming',
            'Footprint built to the manufacturer mechanical drawing, IPC-7351 land pattern',
            'Courtyard and keepout, including antenna keepouts where the part needs one',
            '3D model aligned to the footprint origin',
            'A note of every assumption we had to make where the datasheet was ambiguous',
        ],
        'process': [
            ('Day 0', 'You send the datasheet link or PDF and say which density level you want.'),
            ('Days 1–2', 'Drawn and checked against the drawing.'),
            ('Day 3', 'Library files delivered, with the assumptions noted.'),
        ],
        'for': [
            'An industrial module or connector with no decent library anywhere',
            'Teams who have been burned by a downloaded footprint',
            'Anyone standardising a house library they can actually trust',
        ],
        'not_for': [
            'Parts with a good manufacturer-supplied KiCad library already — use it and save the money',
            'Altium or Eagle native formats. We work in KiCad and export.',
            'Footprint checking without the datasheet. We need the mechanical drawing.',
        ],
        'proof': {
            'text': 'Every footprint on Epsilon1 was drawn from the module datasheets — '
                    'the ESP32-S3-DevKitC-1 mechanical drawing, the MSP4031 display, the '
                    'RC522 — rather than from whatever a parts site had lying around.',
            'href': '/hardware/',
            'label': 'The hardware practice',
        },
        'faq': [
            ('Can I send you ten at once?',
             'Yes, and it gets cheaper per part. Send the list and we will quote it.'),
        ],
    },

    {
        'slug': 'epsilon1-kit',
        'tier': 'platform',
        'name': 'Epsilon1 Design Package',
        'tagline': 'The whole board, licensed, so you can build it yourself.',
        'summary': (
            'Schematic, PCB, custom symbol and footprint libraries, orderable BOM, '
            'fabrication outputs and firmware reference for the Epsilon1 terminal — '
            'licensed to you as a starting point rather than a finished product.'
        ),
        'price_from': 2500,
        'currency': 'USD',
        'price_note': 'one-off licence, delivered on purchase',
        'price_drivers': (
            'Licence scope. Internal use at the floor; rights to manufacture and '
            'resell under your own brand are quoted separately.'
        ),
        'duration': 'immediate',
        'scene': 'traces',

        'problem': [
            'You need an industrial terminal — a screen, a serial bus, RFID, a printer, '
            'an offline queue — and designing one from nothing is two months you would '
            'rather spend on the thing that makes your product different.',
            'The alternative is usually a stack of dev boards in a box, which works on a '
            'bench and not in a field.',
        ],
        'deliverables': [
            'KiCad 9 schematic and PCB for the 120 × 120 mm Epsilon1 board',
            'Custom symbol and footprint libraries drawn from manufacturer datasheets',
            'Orderable BOM with distributor part numbers and qualified alternates',
            'Fabrication package — Gerbers, Excellon drill, assembly notes',
            'Pin-to-pin netlist documentation',
            'Firmware reference: offline queue, RS485 framing and resynchronisation, OTA pattern',
            'A licence that lets you modify it',
        ],
        'process': [
            ('On purchase', 'Licence agreed, repository access granted the same day.'),
            ('Optional', 'A paid handover call, and Board-to-Fab if you want it adapted for you.'),
        ],
        'for': [
            'Integrators who want a proven terminal rather than a design project',
            'Teams with firmware skills and no hardware engineer',
            'Anyone building a vertical on an industrial edge device',
        ],
        'not_for': [
            'Anyone expecting support. This is a design package, not a product — support is a separate engagement.',
            'Production-ready assembly. You still have to fabricate, assemble and test it.',
            'Resale under your own brand without agreeing those rights first',
        ],
        'proof': {
            'text': 'This is the board in eFuelPro: two-layer FR4, five peripherals across '
                    'two SPI buses, I²C, two UARTs and USB-CDC, ground pours on both '
                    'layers, in the field rather than in a drawer.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('Do I get the eFuelPro fuel application too?',
             'No. That is the vertical and it stays ours. You get the terminal and the '
             'reference firmware it is built on.'),
            ('Can I manufacture and sell it?',
             'With a resale licence, yes. Ask and we will quote it.'),
        ],
    },
    # ══ Software — productized builds ═══════════════════════════════════
    # Sold as builds rather than self-serve SaaS: the client owns the result
    # and there is no multi-tenant support burden on a solo operator. Each one
    # has been built once already, and the proof points at where.
    {
        'slug': 'bookings',
        'tier': 'saas',
        'name': 'Booking & Scheduling',
        'tagline': 'Stop selling slots. Start filling them.',
        'summary': (
            'Online booking, point of sale and a scheduler that packs time to '
            'maximise occupancy — for courts, rooms, chairs, bays or anything else '
            'people reserve by the hour. Your brand and your customers, not a '
            'marketplace\'s.'
        ),
        'price_from': 8000,
        'currency': 'USD',
        'price_note': 'build, then optional hosting from $150 per month',
        'price_drivers': (
            'Number of sites and bookable resources, whether you need memberships '
            'and packages, and which payment provider you settle through.'
        ),
        'duration': '4–6 weeks',
        'scene': 'lattice',
        'problem': [
            'An empty hour between two bookings is revenue that never comes back, and it '
            'is almost never sold on its own. Courts, treatment rooms, studios, salon '
            'chairs, service bays — the economics are identical.',
            'Marketplace apps fill the gaps by owning your customer. You pay a percentage '
            'forever and your regulars book through somebody else\'s brand.',
        ],
        'deliverables': [
            'Online booking on your own domain, in your brand',
            'A scheduler that packs bookings to close the dead gaps between them',
            'Point of sale for the front desk, with real-time stock deduction',
            'Memberships, packages, recurring bookings and waitlists',
            'Occupancy and revenue dashboard, per resource and per hour',
            'Your customer list, exportable, owned by you',
        ],
        'process': [
            ('Week 1', 'Your resources, pricing, peak hours and packages mapped.'),
            ('Weeks 2–4', 'Booking, scheduler and POS built against your real configuration.'),
            ('Weeks 5–6', 'Staff trained, live alongside your old system, then cut over.'),
        ],
        'for': [
            'Sports facilities, clinics, studios, salons, workshops, co-working spaces',
            'Anyone paying a marketplace a percentage of every booking',
            'Venues with a shop or cafe that needs one till, not two',
        ],
        'not_for': [
            'Anyone who wants a marketplace\'s customer discovery — we build your system, not a network',
            'A single resource, where a booking calendar is enough',
            'Airline, hotel or ticketing-scale inventory',
        ],
        'proof': {
            'text': 'The Courts runs booking and point of sale for a padel and pickleball '
                    'facility: a scheduler that packs court time to maximise utilisation, '
                    'real-time stock deduction, and sub-100 ms availability queries across '
                    'historical data.',
            'href': '/work/',
            'label': 'See the work',
        },
        'faq': [
            ('Do we have to leave our current booking app?',
             'No. We run alongside it until you are confident, then cut over.'),
            ('Who owns the customer data?',
             'You do, completely. It is your database and it exports.'),
        ],
    },

    {
        'slug': 'quote-engine',
        'tier': 'saas',
        'name': 'Quote Engine',
        'tagline': 'A quote in thirty seconds, not three days.',
        'summary': (
            'Configure-price-quote for made-to-measure products. Your sales team '
            'enters dimensions, the engine derives cost from your own formulas, and '
            'the customer gets a dimensioned technical quotation as a PDF — before '
            'your competitor has opened a spreadsheet.'
        ),
        'price_from': 6000,
        'currency': 'USD',
        'price_note': 'build, per product family',
        'price_drivers': (
            'How many product families you sell and how tangled the costing is. One '
            'formula family is at the floor; a catalogue with options that interact is '
            'where the work goes.'
        ),
        'duration': '3–5 weeks',
        'scene': 'lattice',
        'problem': [
            'Made-to-measure products are quoted by the one person who understands the '
            'spreadsheet. When they are busy, quotes wait. When they are away, quotes '
            'stop. And the customer who asked on Monday bought from whoever answered '
            'on Tuesday.',
            'The costing logic is usually sound. It is just trapped in a file nobody '
            'else can safely touch.',
        ],
        'deliverables': [
            'Your costing formulas encoded once, tested against quotes you have already sent',
            'A configurator your sales team can use without training',
            'Dimensioned technical quotations generated as vector PDFs',
            'Margin and material breakdown, visible to you and hidden from the customer',
            'Every quote logged, searchable, and re-issuable',
        ],
        'process': [
            ('Week 1', 'Your spreadsheet and your last fifty quotes. We find the formulas.'),
            ('Weeks 2–3', 'Engine built and checked against real past quotes to the cent.'),
            ('Weeks 4–5', 'PDF templates, sales team onboarding, handover.'),
        ],
        'for': [
            'Tanks, windows, ducting, fabricated steel, signage, cabinetry',
            'Any product where price depends on dimensions',
            'Sales teams bottlenecked on one person who understands costing',
        ],
        'not_for': [
            'Fixed-price catalogue products — you need a shop, not a configurator',
            'Full ERP or inventory replacement',
            'Products whose price is negotiated rather than calculated',
        ],
        'proof': {
            'text': 'For Al Maymanah we built a configure-price-quote engine for GRP water '
                    'tanks that derives cost from surface-area and height-tier formulas and '
                    'emits dimensioned technical quotations as vector PDFs.',
            'href': '/work/',
            'label': 'See the work',
        },
        'faq': [
            ('What if our formulas are wrong?',
             'We check the engine against quotes you have already sent. Where it disagrees '
             'with your history, we find out which one is right before going live.'),
        ],
    },

    {
        'slug': 'ops-analyst',
        'tier': 'saas',
        'name': 'Ops Analyst',
        'tagline': 'Ask your database a question. Approve what it wants to change.',
        'summary': (
            'An AI analyst over your own operational data that answers in plain '
            'language — and can propose changes, but never make one without a human '
            'clicking approve. Scoped by the same permissions as the rest of your app.'
        ),
        'price_from': 9000,
        'currency': 'USD',
        'price_note': 'build, plus your own model usage',
        'price_drivers': (
            'How many data sources it reads, how many actions it may propose, and how '
            'fine-grained your permissions are. Read-only is at the floor; write '
            'actions across several systems are where the time goes.'
        ),
        'duration': '4–6 weeks',
        'scene': 'lattice',
        'problem': [
            'Your operational data answers most of the questions your managers ask — '
            'but only if someone writes the query. So the questions wait for an analyst, '
            'or they do not get asked.',
            'The obvious fix, an AI assistant with database access, is the dangerous one '
            'done carelessly: a model that can read every row and change any of them on '
            'its own judgement is not a feature. It is an incident waiting for a date.',
        ],
        'deliverables': [
            'A conversational analyst over your own database, answering in plain language',
            'Every answer grounded in a real query you can inspect',
            'Proposed changes that require explicit human approval — never model discretion',
            'Scoped by row-level security, so it sees only what the asking user may see',
            'A full audit log of every question, query, proposal and approval',
            'Streamed responses and prompt caching to keep it fast and cheap',
        ],
        'process': [
            ('Weeks 1–2', 'Your data and your permissions mapped. What it may read, what it may propose.'),
            ('Weeks 3–4', 'Tool catalogue and approval flow built and red-teamed against your policies.'),
            ('Weeks 5–6', 'Pilot with one team, then rollout.'),
        ],
        'for': [
            'Operations teams whose questions queue behind one analyst',
            'Businesses that want AI over their data and refuse to hand it the keys',
            'Postgres and Supabase applications with row-level security already in place',
        ],
        'not_for': [
            'Autonomous agents that act without approval — we will not build that',
            'Customer-facing chatbots',
            'Data you cannot legally process with a third-party model',
        ],
        'proof': {
            'text': 'Finance AI is an agentic analyst console over a portfolio database: a '
                    'server-side tool-calling loop across a 22-tool catalogue with streamed '
                    'responses, prompt caching, and write operations gated behind explicit '
                    'user approval rather than model discretion.',
            'href': '/work/finance-ai/',
            'label': 'The Finance AI case study',
        },
        'faq': [
            ('Which model does it use?',
             'Claude by default, through your own account, so the usage is billed to you and '
             'your data stays under your agreement with the provider.'),
            ('Can it change data on its own?',
             'No. It proposes; a person approves. That is the design, not a setting.'),
        ],
    },
    # ══ Software — the categories every business needs ═══════════════════
    {
        'slug': 'dashboards',
        'tier': 'saas',
        'name': 'Sales & Admin Dashboards',
        'tagline': 'Every number you check, in one place, live.',
        'summary': (
            'The dashboard your business should already have: revenue, orders, '
            'margins and stock, pulled live from the systems you already run, with '
            'the admin tools to act on what you see.'
        ),
        'price_from': 5000,
        'currency': 'USD',
        'price_note': 'build, per dashboard',
        'price_drivers': (
            'How many systems the numbers come from and how clean they are. One '
            'database is at the floor; a POS, an accounting package and three '
            'spreadsheets that disagree is where the time goes.'
        ),
        'duration': '3–4 weeks',
        'scene': 'lattice',
        'problem': [
            'The numbers exist. They are in the POS, the accounting package, the '
            'e-commerce admin and a spreadsheet somebody updates on Fridays. Answering '
            '"how did we do last week" takes an afternoon, so it gets asked once a month.',
            'And the dashboards that ship with each tool only show that tool\'s half of '
            'the picture.',
        ],
        'deliverables': [
            'Live revenue, orders, average order value and margin, by period and by region',
            'Every source connected once — POS, accounting, store, database',
            'Drill-down from any figure to the transactions behind it',
            'Admin tools to act on what you see: refunds, stock, customers',
            'Role-based access, so each manager sees their own numbers',
            'Scheduled email and WhatsApp summaries',
        ],
        'process': [
            ('Week 1', 'Every source mapped, and the numbers reconciled against your books.'),
            ('Weeks 2–3', 'Dashboard and admin tools built against live data.'),
            ('Week 4', 'Roles, alerts, handover.'),
        ],
        'for': [
            'Retail, hospitality, distribution and e-commerce businesses',
            'Owners who find out how last month went in the middle of this one',
            'Teams whose reporting lives in exported spreadsheets',
        ],
        'not_for': [
            'Enterprise data warehouses and BI programmes',
            'Businesses whose only system already has good reporting',
            'Reporting on data you cannot get read access to',
        ],
        'proof': {
            'text': 'eFuelPro\'s dashboard shows per-nozzle, per-shift and per-day sales '
                    'read straight off the dispenser, viewable from anywhere. It is our own '
                    'product rather than a client dashboard over a POS and accounting '
                    'package — ask us for the specifics of a build like yours.',
            'href': '/products/efuelpro/',
            'label': 'eFuelPro',
        },
        'faq': [
            ('Can it connect to our accounting software?',
             'Almost always. If it has an API or an export we can read, it can feed the dashboard.'),
        ],
    },

    {
        'slug': 'inventory',
        'tier': 'saas',
        'name': 'Inventory & Stock',
        'tagline': 'Know you\'re running low before your customer does.',
        'summary': (
            'Stock levels, reorder points, suppliers and movements across every '
            'location, updated the moment something is sold or received — with the '
            'reorder suggested before the shelf is empty.'
        ),
        'price_from': 7000,
        'currency': 'USD',
        'price_note': 'build',
        'price_drivers': (
            'Number of locations, SKUs with variants, and whether stock has to sync '
            'with a POS or an online store in real time.'
        ),
        'duration': '4–6 weeks',
        'scene': 'lattice',
        'problem': [
            'Most businesses discover a stockout when a customer asks for the thing '
            'that is not there. The count in the system drifted weeks ago, because '
            'nothing updates it when a sale happens at the till.',
            'The fix is not a better spreadsheet. It is stock that moves when goods move.',
        ],
        'deliverables': [
            'Live stock per SKU, per variant, per location',
            'Real-time deduction from sales and receipt from deliveries',
            'Reorder points and suggested purchase orders',
            'Supplier records, lead times and cost history',
            'Stock-take and adjustment workflow with an audit trail',
            'Barcode and QR scanning from any phone',
        ],
        'process': [
            ('Week 1', 'Your catalogue, locations and suppliers imported and checked.'),
            ('Weeks 2–4', 'Stock engine, POS or store sync, reorder logic.'),
            ('Weeks 5–6', 'First stock-take on the new system, then live.'),
        ],
        'for': [
            'Shops, warehouses, distributors, restaurants, workshops',
            'Anyone selling the same stock in a shop and online',
            'Businesses with a stock count nobody believes',
        ],
        'not_for': [
            'Full ERP replacement — manufacturing resource planning is a different product',
            'Businesses with a working inventory module they are happy with',
            'Pharmaceutical or batch-regulated stock needing validated systems',
        ],
        'proof': {
            'text': 'The Courts deducts stock in real time at the point of sale, and '
                    'Fabricport runs a 205-product catalogue with automated colour '
                    'classification and an image-variant pipeline behind it.',
            'href': '/work/',
            'label': 'See the work',
        },
        'faq': [
            ('Can we keep our existing POS?',
             'Usually. If it exposes sales, the inventory system follows it.'),
        ],
    },

    {
        'slug': 'crm',
        'tier': 'saas',
        'name': 'CRM & Case Management',
        'tagline': 'No lead left in somebody\'s inbox.',
        'summary': (
            'A pipeline, a customer record and a case history in one place — built '
            'around how your team actually sells and follows up, not around a '
            'template for a company that is not yours.'
        ),
        'price_from': 7000,
        'currency': 'USD',
        'price_note': 'build',
        'price_drivers': (
            'Number of pipelines and roles, the channels it has to capture from — '
            'email, WhatsApp, web forms, calls — and whether it has to hold documents.'
        ),
        'duration': '4–6 weeks',
        'scene': 'lattice',
        'problem': [
            'Leads arrive by email, WhatsApp, the website and the phone, and live in '
            'four places. Follow-up depends on who remembers. The deal that went quiet '
            'went quiet because nobody noticed.',
            'Off-the-shelf CRMs fix this by making your team work their way, and half '
            'the team quietly goes back to the spreadsheet.',
        ],
        'deliverables': [
            'Pipeline with your stages, your fields and a live weighted forecast',
            'One record per customer across every channel',
            'Follow-up reminders and SLA timers that escalate before something is missed',
            'Documents stored securely against the customer, with verification if you need it',
            'Role-based admin portal and a customer-facing portal if you want one',
            'SMS, email and WhatsApp notifications',
        ],
        'process': [
            ('Week 1', 'How you actually sell, mapped from your last fifty deals.'),
            ('Weeks 2–4', 'Pipeline, records, channels and timers built.'),
            ('Weeks 5–6', 'Your existing contacts imported, team onboarded.'),
        ],
        'for': [
            'Service firms, agencies, consultancies, clinics, B2B sellers',
            'Teams that tried an off-the-shelf CRM and drifted back to spreadsheets',
            'Anyone managing cases with deadlines, not just sales with stages',
        ],
        'not_for': [
            'Teams happy on an off-the-shelf CRM — configure it rather than replace it',
            'Enterprise sales operations with hundreds of seats',
            'Marketing automation and email campaigns at volume',
        ],
        'proof': {
            'text': 'For an immigration consultancy we built a case-management system — '
                    'role-based admin portal, automated SLA tracking, document workflows and '
                    'biometric identity verification. That is the case-management half of '
                    'this offer; we have not yet shipped a sales-pipeline CRM for a client.',
            'href': '/work/',
            'label': 'See the work',
        },
        'faq': [
            ('Can it import from our current CRM or spreadsheet?',
             'Yes, and we reconcile the import with you before anyone relies on it.'),
        ],
    },

    {
        'slug': 'marketplace',
        'tier': 'saas',
        'name': 'Marketplaces',
        'tagline': 'Buyers on one side, sellers on the other, your cut in the middle.',
        'summary': (
            'A multi-vendor marketplace with separate portals for buyers, sellers and '
            'your team — catalogue, orders, commission and payouts — where every '
            'party sees exactly what is theirs and nothing else.'
        ),
        'price_from': 12000,
        'currency': 'USD',
        'price_note': 'build',
        'price_drivers': (
            'Number of roles, whether payments are split automatically, currencies, '
            'and how much of seller onboarding is self-serve.'
        ),
        'duration': '6–10 weeks',
        'scene': 'lattice',
        'problem': [
            'A marketplace is three products pretending to be one: a shop for buyers, a '
            'back office for sellers and a control room for you. Most are built as a '
            'shop with the other two bolted on, and it shows the first time a seller '
            'sees another seller\'s orders.',
            'Isolation between parties is the hardest part and the one nobody demos.',
        ],
        'deliverables': [
            'Buyer storefront, seller portal and admin console as separate role-scoped apps',
            'Catalogue with per-seller listings, variants and media pipeline',
            'Orders, commission and seller payouts',
            'Multi-currency quoting with scheduled exchange-rate refresh',
            'Row-level security so no party can see another\'s data',
            'Seller onboarding and verification',
        ],
        'process': [
            ('Weeks 1–2', 'Roles, commission model and data isolation designed first.'),
            ('Weeks 3–7', 'Storefront, seller portal and admin built in parallel.'),
            ('Weeks 8–10', 'Seed sellers onboarded, soft launch, then open.'),
        ],
        'for': [
            'Niche B2B marketplaces — materials, surplus stock, equipment, services',
            'Businesses turning a supplier network into a platform',
            'Founders who need a real first version, not a template',
        ],
        'not_for': [
            'Consumer marketplaces at national scale on day one',
            'A single-seller shop — you need a store, not a marketplace',
            'Regulated financial marketplaces',
        ],
        'proof': {
            'text': 'Fabricport is a B2B surplus-fabric marketplace we built: four '
                    'role-scoped portals — public catalogue, buyer, supplier and admin — over '
                    'row-level-secured Postgres, with a 3D fabric-scan viewer and scheduled FX '
                    'refresh for multi-currency quoting.',
            'href': '/work/',
            'label': 'See the work',
        },
        'faq': [
            ('Can sellers get paid automatically?',
             'Yes, through a payment provider that supports split payouts in your market. '
             'Where that is not available we build the payout ledger and you settle.'),
        ],
    },

    {
        'slug': 'mobile-apps',
        'tier': 'saas',
        'name': 'Mobile Apps',
        'tagline': 'Your customers live on their phones. So should you.',
        'summary': (
            'iOS and Android from one codebase, including the hard parts — live '
            'camera, AR, offline use, biometric verification and push notifications '
            '— on the mid-range handsets your customers actually own.'
        ),
        'price_from': 10000,
        'currency': 'USD',
        'price_note': 'build, iOS and Android',
        'price_drivers': (
            'Camera, AR and hardware integration, offline requirements, and how much '
            'backend has to be built alongside it.'
        ),
        'duration': '6–10 weeks',
        'scene': 'lattice',
        'problem': [
            'A mobile app that only works on the developer\'s flagship phone is not '
            'finished. Most of your customers are on mid-range Android, on a patchy '
            'connection, with a camera that behaves differently from the one in the demo.',
            'Those are the conditions to design for, not to discover at launch.',
        ],
        'deliverables': [
            'One codebase for iOS and Android, published to both stores',
            'Live camera and AR where the product needs it',
            'Offline-first data that syncs when the connection returns',
            'Biometric login and identity verification',
            'Push, SMS and in-app notifications',
            'The backend and admin portal it needs',
        ],
        'process': [
            ('Weeks 1–2', 'Flows designed and tested on real mid-range devices.'),
            ('Weeks 3–8', 'App and backend built, weekly builds on your phone.'),
            ('Weeks 9–10', 'Store submission, launch, handover.'),
        ],
        'for': [
            'Consumer brands, service businesses, field teams',
            'Products that need the camera, location or offline use',
            'Companies whose website is doing an app\'s job badly',
        ],
        'not_for': [
            'Games and high-end 3D',
            'Apps that are really a website — build the website',
            'Wearables and embedded platforms',
        ],
        'proof': {
            'text': 'Master Paints puts live AR colour on a customer\'s own wall from a '
                    'mid-range Android phone, and an immigration case-management app we '
                    'built verifies applicants biometrically.',
            'href': '/work/master-paints/',
            'label': 'The Master Paints case study',
        },
        'faq': [
            ('Native or cross-platform?',
             'React Native with Expo by default — one codebase, native modules where the '
             'product needs them.'),
        ],
    },

    # ══ Frontier — the hard ones ════════════════════════════════════════
    {
        'slug': 'digital-twin',
        'tier': 'lab',
        'name': 'Digital Twins',
        'tagline': 'Your whole site, live, in 3D, from anywhere.',
        'summary': (
            'A navigable 3D model of a physical site — a station, a warehouse, a '
            'plant floor — wired to the machines inside it, so the model shows what '
            'is actually happening right now. Click any machine to see its live state.'
        ),
        'price_from': 15000,
        'currency': 'USD',
        'price_note': 'first site; further sites of the same type quoted per site',
        'price_drivers': (
            'Site complexity, how many machines feed it live data, and whether that '
            'data already exists or has to be captured first — often the hardware '
            'half of the job.'
        ),
        'duration': '6–10 weeks',
        'scene': 'traces',
        'problem': [
            'An operations manager with twelve sites cannot be at any of them. The '
            'dashboards tell them numbers; they do not tell them which pump on which '
            'island is down, or that a bay has been idle since lunch.',
            'A spatial view answers in a glance what a table answers in a meeting.',
        ],
        'deliverables': [
            'A 3D model of your site, built from your layout, navigable in any browser',
            'Every machine wired to live data — status, throughput, alarms',
            'Click any asset to fly to it and see its live and historical state',
            'The data pipeline behind it, including hardware capture where none exists',
            'Runs on a laptop, a tablet or a control-room screen',
        ],
        'process': [
            ('Weeks 1–2', 'Site survey, layout, and every data source identified.'),
            ('Weeks 3–6', 'Model, live pipeline, and capture hardware if needed.'),
            ('Weeks 7–10', 'Interaction, alerts, and a costed plan for rolling out to your other sites.'),
        ],
        'for': [
            'Multi-site operators — fuel, logistics, manufacturing, facilities',
            'Control rooms that stare at tables of numbers',
            'Anyone whose machines already report data nobody looks at',
        ],
        'not_for': [
            'Engineering simulation or physics-accurate CFD — this is operational, not analytical',
            'Photorealistic architectural visualisation',
            'Sites with no data source and no appetite to create one',
        ],
        'proof': {
            'text': 'We built a digital twin of a fuel station for our own eFuelPro product: '
                    'the forecourt, canopy and six double-sided dispensers modelled in 3D, '
                    'each showing live status and volume from the eFuelPro ledger. It is one '
                    'site of one type — we have not yet built a warehouse or multi-site twin. '
                    'A version with demo data is on this page.',
            'href': '/products/efuelpro/',
            'label': 'Where its data comes from',
        },
        'faq': [
            ('Do we need 3D models of our equipment?',
             'No. We model from your layout and photos. Where a manufacturer model exists '
             'we use it.'),
        ],
    },

    {
        'slug': 'robotics-infra',
        'tier': 'lab',
        'name': 'Robot-Learning Infrastructure',
        'tagline': 'Your training runs should fail for research reasons, not DevOps ones.',
        'summary': (
            'Distributed training infrastructure for embodied AI — reinforcement '
            'learning and vision-language-action models — provisioned on rented GPUs, '
            'kept running, and monitored, so your researchers do research.'
        ),
        'price_from': 12000,
        'currency': 'USD',
        'price_note': 'setup, then optional monthly operation',
        'price_drivers': (
            'Cluster size, and how many frameworks and simulators you run.'
        ),
        'duration': '3–6 weeks',
        'scene': 'lattice',
        'problem': [
            'Robot-learning frameworks are research code. They assume a cluster '
            'configured exactly like the authors\' cluster, and they break in ways '
            'that eat a week of a researcher\'s time before a single useful run.',
            'The GPUs are rented by the hour whether the run works or not.',
        ],
        'deliverables': [
            'Environment build for your framework and simulators, reproducible',
            'Distributed training across multi-GPU rented instances',
            'Launch-path and configuration fixes, maintained on a branch you own',
            'Monitoring across runs, so a dead run is noticed in minutes',
            'Cost controls so idle GPUs are not billed overnight',
        ],
        'process': [
            ('Week 1', 'Your framework, simulators and target hardware.'),
            ('Weeks 2–4', 'Environment built, first distributed run reproduced.'),
            ('Weeks 5–6', 'Monitoring, cost controls, handover or ongoing operation.'),
        ],
        'for': [
            'Robotics startups and university labs training embodied policies',
            'Teams running open-source RL or VLA frameworks on rented GPUs',
            'Researchers losing weeks to infrastructure',
        ],
        'not_for': [
            'Model research itself — we run the infrastructure, you own the science',
            'Large-language-model pretraining at frontier scale',
            'Physical robot hardware integration — that is a separate engagement',
        ],
        'proof': {
            'text': 'Our founder provisioned and ran distributed training for RLinf, an '
                    'open-source reinforcement-learning framework for vision-language-action '
                    'models, on rented multi-GPU instances: environment build, launch-path and '
                    'config fixes on a dedicated branch, and monitoring across runs. It is one '
                    'framework, run as our own work rather than for a client.',
            'href': '/about/',
            'label': 'About the lab',
        },
        'faq': [
            ('Which clouds?',
             'Your own cloud account by default, so your data and checkpoints never leave it. '
             'If you have no preference we will suggest where the GPUs are cheapest.'),
        ],
    },

    {
        'slug': 'sensing',
        'tier': 'lab',
        'name': 'Sensing & Calibration',
        'tagline': 'Sensors that stay accurate after the first week.',
        'summary': (
            'Instrumentation that has to be trusted — force, pressure, tactile, '
            'motion — designed, calibrated and characterised, with drift correction '
            'and a calibration pipeline that survives a re-flash.'
        ),
        'price_from': 9000,
        'currency': 'USD',
        'price_note': 'per sensing system',
        'price_drivers': (
            'Number of channels, required accuracy, and whether the sensor exists or '
            'has to be designed and fabricated.'
        ),
        'duration': '4–8 weeks',
        'scene': 'traces',
        'problem': [
            'A sensor is accurate the day it is calibrated. After that it drifts with '
            'temperature, age and handling, and most products have no way to notice — '
            'so the numbers look fine long after they stopped being true.',
            'Calibration done once, by hand, on one unit, does not scale to a hundred.',
        ],
        'deliverables': [
            'Sensor selection or custom sensing hardware',
            'Characterisation across temperature and load',
            'Automated calibration fitting, per unit',
            'Drift detection and correction in firmware',
            'Versioned calibration profiles that survive a re-flash',
            'Test tooling so production calibration does not need an engineer',
        ],
        'process': [
            ('Weeks 1–2', 'Accuracy target, sensor choice, characterisation plan.'),
            ('Weeks 3–6', 'Hardware, firmware and the calibration pipeline.'),
            ('Weeks 7–8', 'Production test tooling and handover.'),
        ],
        'for': [
            'Tactile and force sensing, load cells, pressure, IMUs and motion',
            'Products where a wrong reading costs money or safety',
            'Teams calibrating units by hand and losing a day per batch',
        ],
        'not_for': [
            'Certified metrology or legal-for-trade calibration',
            'Medical diagnostic devices',
            'Sensors you cannot physically access or test',
        ],
        'proof': {
            'text': 'eFuelPro calibrates itself: it samples an idle baseline, scores every '
                    'candidate field mapping against measured price-per-unit within 1% '
                    'tolerance, and persists versioned calibration profiles as JSON so a '
                    'device can be re-flashed and restored. A 1,500-line Python toolchain '
                    'drives the fitting.',
            'href': '/work/efuelpro/',
            'label': 'The eFuelPro case study',
        },
        'faq': [
            ('Can you work with our existing sensors?',
             'Yes — most of the value is usually in characterisation and calibration, not '
             'in replacing the sensor.'),
        ],
    },
]

# Offers that have a working demo on the site. The offer page shows it, and
# the demo suite uses the same mapping, so a demo always sells its own offer.
DEMO_FOR = {
    'dashboards': 'dashboard',
    'inventory': 'inventory',
    'crm': 'crm',
    'marketplace': 'market',
    'bookings': 'bookings',
    'quote-engine': 'quote',
    'ops-analyst': 'analyst',
    'efuelpro': 'ledger',
    'digital-twin': 'twin',
}
for _o in OFFERS:
    _o['demo'] = DEMO_FOR.get(_o['slug'])

# ── problems — the front door ──────────────────────────────────────────

PROBLEMS = [
    # (area, what the buyer would say, offer slug)
    ('software', 'Our sales numbers live in five spreadsheets', 'dashboards'),
    ('software', 'We find out we\'re out of stock when a customer asks', 'inventory'),
    ('software', 'Leads fall through the cracks between calls', 'crm'),
    ('software', 'We want buyers and sellers on one platform, and a cut', 'marketplace'),
    ('software', 'Our rooms, courts or chairs sit empty between bookings', 'bookings'),
    ('software', 'Quotes wait on the one person who gets the spreadsheet', 'quote-engine'),
    ('software', 'Our customers want an app, not a website', 'mobile-apps'),
    ('software', 'Managers\' questions queue behind one analyst', 'ops-analyst'),
    ('hardware', 'My machine won\'t talk to anything', 'protocol-decode'),
    ('hardware', 'My board keeps coming back from the fab wrong', 'design-review'),
    ('hardware', 'Our firmware works on the bench and dies in the field', 'firmware-rescue'),
    ('hardware', 'I need a real board, not a box of dev kits', 'board-to-fab'),
    ('hardware', 'I can\'t see what my forecourt actually sold', 'efuelpro'),
    ('hardware', 'The machine is abroad and nobody can fly out', 'remote-decode'),
    ('frontier', 'I want to see my whole site live, in 3D, from anywhere', 'digital-twin'),
    ('frontier', 'Our robot-learning runs keep falling over', 'robotics-infra'),
    ('frontier', 'Our sensors drift and nobody trusts the readings', 'sensing'),
    ('security', 'A customer asked whether our device is secure', 'device-pentest'),
    ('security', 'An enterprise asked if tenants can see each other\'s data', 'authz-review'),
]


def problems_for(area=None):
    return [p for p in PROBLEMS if area is None or p[0] == area]


# ── lookups ─────────────────────────────────────────────────────────────

BY_SLUG = {o['slug']: o for o in OFFERS}


def by_tier(tier):
    return [o for o in OFFERS if o['tier'] == tier]


def path_for(offer):
    """Where an offer's page lives. Services and products are separate
    shelves because buyers shop them differently."""
    folder = 'services' if offer['tier'] in ('service', 'security', 'desk') else 'products'
    return f"{folder}/{offer['slug']}/index.html"


def url_for(offer):
    return '/' + path_for(offer)[:-len('index.html')]


# Published prices are OFF. Every number below still lives in this file so a
# quote can be built from it, but nothing on the site prints one: scope is
# quoted by hand after a conversation. Flip SHOW_PRICES to True to publish
# the bands again — every page, the menu, llms.txt and catalogue.json follow.
SHOW_PRICES = False
SALES = 'Contact sales'


def price_label(offer):
    if not SHOW_PRICES:
        return SALES
    sym = {'USD': '$', 'PKR': 'PKR ', 'GBP': '£'}.get(offer['currency'], '')
    return f"from {sym}{offer['price_from']:,}"


def price_note(offer):
    """The line under the price. Without published prices it says how the
    number is arrived at, not what it is."""
    if not SHOW_PRICES:
        return 'Quoted per project, after a call'
    return offer['price_note']


if __name__ == '__main__':
    print(f'{len(OFFERS)} offers\n')
    for tier, meta in TIERS.items():
        rows = by_tier(tier)
        if not rows:
            continue
        print(f"{meta['label']}:")
        for o in rows:
            print(f"  {price_label(o):>14}  {o['name']:<24} {url_for(o)}")
        print()
