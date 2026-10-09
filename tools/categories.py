#!/usr/bin/env python3
"""
Solution categories — what Epsilon Labs can build, by kind of problem.

Offers (tools/offers.py) are specific, priced engagements. Categories are
the open-ended layer above them: "we build CRMs", "we automate mills". Each
category gets its own page and points down at the offers that start it.

Honesty rules for this file:
  - `builds` is a list of (title, detail) pairs: a two-or-three word title
    for the stepper tab, and the whole sentence for the panel. Both describe
    what we CAN build, phrased as example builds, never as past clients.
  - `examples` are illustrative builds for the same reason.
  - `proof` is only filled in where there is real shipped work behind it.
    Leave it out rather than stretch.
  - `price_from` is kept for building a quote from. Nothing on the site
    prints it while SHOW_PRICES is off in offers.py.
"""

AREAS = {
    'software': {'label': 'Software', 'path': '/software/'},
    'hardware': {'label': 'Hardware', 'path': '/hardware/'},
}

GROUPS = {
    'software': [
        ('business', 'Business systems', 'The systems a company runs on, every day.'),
        ('customer', 'Customer-facing', 'What your customers see, tap and pay through.'),
        ('platform', 'Desktop & developer', 'Native apps, tools and the plumbing between systems.'),
        ('ai', 'AI & automation', 'Work that should not need a person doing it by hand.'),
    ],
    'hardware': [
        ('industrial', 'Industrial automation', 'Plants, mills and lines that run themselves and report back.'),
        ('monitoring', 'Monitoring & IoT', 'Machines and sites you can see from anywhere, live.'),
        ('products', 'Hardware products', 'Devices designed, built and put in customers\' hands.'),
        ('engineering', 'Engineering', 'The board, the firmware and the build behind all of it.'),
    ],
}

C = []


def cat(**k):
    C.append(k)


# ══ Software · Business systems ═════════════════════════════════════════
cat(slug='crm', area='software', group='business', name='CRM',
    tagline='Every lead, deal and customer in one place.',
    summary='A customer relationship system shaped around how your team actually sells and '
            'follows up — pipelines, records, reminders and reporting, without forcing you into '
            'someone else\'s template.',
    builds=[('Weighted pipeline', 'Sales pipelines with your own stages and a weighted forecast'),
            ('One customer record', 'One customer record across email, WhatsApp, web and phone'),
            ('Chasing that escalates', 'Follow-up reminders and deadlines that escalate before anything slips'),
            ('Quotes and contracts', 'Quotes, documents and contracts stored against the customer'),
            ('Role-based access', 'Role-based access for sales, support and management'),
            ('Import from anywhere', 'Import from spreadsheets or the CRM you are leaving')],
    examples=['A service firm\'s pipeline with SLA timers per case',
              'A B2B distributor\'s account management with reorder reminders',
              'A clinic\'s patient enquiry and follow-up tracker'],
    stack=['React', 'Next.js', 'Postgres', 'Supabase', 'WhatsApp & SMS APIs'],
    fit=['Teams that drifted back to spreadsheets', 'Service businesses with case deadlines',
         'B2B sellers with long sales cycles'],
    offers=['crm'], price_from=7000,
    proof=('We built a case-management system with a role-based admin portal, SLA tracking, '
           'document workflows and identity verification.', '/work/'))

cat(slug='erp', area='software', group='business', name='ERP',
    tagline='Purchasing, stock, production and accounts that agree with each other.',
    summary='An operations system for businesses that have outgrown a stack of disconnected '
            'tools — built in modules, so you replace the painful parts first and keep what works.',
    builds=[('Purchasing and goods-in', 'Purchasing, suppliers and goods received'),
            ('Stock across locations', 'Stock across locations with real-time movements'),
            ('Production and job costing', 'Production orders, bills of materials and job costing'),
            ('Orders and invoicing', 'Sales orders, invoicing and credit control'),
            ('Links to accounting', 'Links to your accounting package rather than replacing it'),
            ('Departmental dashboards', 'Dashboards for each department')],
    examples=['A manufacturer\'s job costing from raw material to dispatch',
              'A trading company\'s purchase-to-invoice flow across three warehouses',
              'A workshop\'s parts, labour and billing in one system'],
    stack=['React', 'Postgres', 'Supabase', 'Accounting APIs', 'PDF generation'],
    fit=['Manufacturers and traders running on spreadsheets', 'Businesses with several '
         'tools that disagree', 'Companies not ready for an enterprise ERP rollout'],
    offers=['inventory', 'dashboards'], price_from=15000)

cat(slug='inventory', area='software', group='business', name='Inventory',
    tagline='Know you are running low before your customer does.',
    summary='Live stock per item and location, updated the moment something is sold or received, '
            'with reorder suggestions before the shelf is empty.',
    builds=[('Live stock', 'Live stock per SKU, variant and location'), ('Scanning from any phone', 'Barcode and QR scanning from any phone'),
            ('Reorder points', 'Reorder points and suggested purchase orders'), ('Auditable stock-takes', 'Stock-takes with a full audit trail'),
            ('Till and store sync', 'Sync with your till or online store'), ('Lead times and costs', 'Supplier lead times and cost history')],
    examples=['A retailer\'s shop and online stock kept in one count',
              'A restaurant group\'s ingredient stock and wastage',
              'A distributor\'s multi-warehouse transfers'],
    stack=['React', 'React Native', 'Postgres', 'POS & store APIs'],
    fit=['Shops, warehouses, restaurants, workshops', 'Anyone selling in-store and online',
         'Businesses with a stock count nobody trusts'],
    offers=['inventory'], price_from=7000,
    proof=('The Courts deducts stock in real time at the point of sale.', '/work/'))

cat(slug='dashboards', area='software', group='business', name='Dashboards',
    tagline='Every number you check, in one place, live.',
    summary='Sales, operations and finance numbers pulled live from the systems you already run, '
            'with drill-down to the transactions behind every figure.',
    builds=[('Revenue and margin', 'Revenue, orders and margin by period, region and product'),
            ('Connected sources', 'Connections to your POS, accounting, store and databases'),
            ('Drill-down to records', 'Drill-down from any number to the records behind it'),
            ('Out-of-range alerts', 'Alerts when something moves outside its normal range'),
            ('Scheduled summaries', 'Scheduled email and WhatsApp summaries'), ('Per-manager views', 'Per-manager views and permissions')],
    examples=['A retail chain\'s daily sales by branch and hour',
              'A factory\'s output and downtime board',
              'An e-commerce brand\'s channel and margin view'],
    stack=['React', 'Postgres', 'Charting', 'ETL pipelines'],
    fit=['Owners who find out how last month went halfway through this one',
         'Teams whose reports are exported spreadsheets', 'Multi-branch businesses'],
    offers=['dashboards'], price_from=5000,
    proof=('eFuelPro\'s dashboard shows per-nozzle, per-shift and per-day sales read straight '
           'off the dispenser.', '/work/efuelpro/'))

cat(slug='internal-tools', area='software', group='business', name='Admin tools',
    tagline='The back office your team actually wants to use.',
    summary='Admin panels, approval flows and operational tools built on top of your existing '
            'data — the small systems that remove hours of manual work every week.',
    builds=[('Admin consoles', 'Admin consoles over your existing database'), ('Approvals and sign-off', 'Approval and sign-off workflows'),
            ('Support and ticketing', 'Customer support and ticketing tools'), ('Validated data entry', 'Data entry that validates as you type'),
            ('Access and audit log', 'Role-based access and a full audit log'), ('Bulk import and export', 'Bulk import, export and editing')],
    examples=['An operations team\'s order-exception queue',
              'A finance team\'s expense approval flow',
              'A support desk wired to the product database'],
    stack=['React', 'Postgres', 'Supabase', 'Row-level security'],
    fit=['Teams working in raw database tables or spreadsheets',
         'Operations with repetitive manual steps', 'Products that need an admin side'],
    offers=['dashboards'], price_from=4000)

cat(slug='quoting', area='software', group='business', name='Quoting',
    tagline='A quote in thirty seconds, not three days.',
    summary='Configure-price-quote for made-to-measure products: dimensions in, a costed, '
            'dimensioned quotation out, from your own formulas.',
    builds=[('Your costing formulas', 'Your costing formulas encoded and tested against past quotes'),
            ('A configurator', 'A configurator your sales team can use without training'),
            ('Dimensioned PDFs', 'Dimensioned technical quotations as PDFs'),
            ('Margin you can see', 'Margin visible to you, hidden from the customer'),
            ('Every quote logged', 'Every quote logged and re-issuable')],
    examples=['Tanks, windows and ducting priced by size',
              'Signage and fabrication quoted from drawings',
              'Cabinetry and joinery priced by material and finish'],
    stack=['TypeScript', 'React', 'PDF generation'],
    fit=['Made-to-measure manufacturers', 'Sales teams waiting on one estimator'],
    offers=['quote-engine'], price_from=6000,
    proof=('We built a quoting engine for GRP water tanks that derives cost from surface-area '
           'and height-tier formulas and emits dimensioned PDFs.', '/work/'))

# ══ Software · Customer-facing ══════════════════════════════════════════
cat(slug='web-apps', area='software', group='customer', name='Web apps',
    tagline='Software your customers use in a browser, fast.',
    summary='Customer portals, SaaS products and web platforms — designed, built, hosted and '
            'handed over, from the first screen to the billing page.',
    builds=[('Customer portals', 'Customer portals and self-service accounts'), ('Subscriptions and billing', 'SaaS products with subscriptions and billing'),
            ('Sign-up and identity', 'Sign-up, login and identity verification'), ('Real-time updates', 'Real-time updates and notifications'),
            ('The admin side', 'Admin side for your team'), ('Hosting and backups', 'Hosting, monitoring and backups')],
    examples=['A customer portal for tracking orders and documents',
              'A subscription SaaS for a niche industry',
              'A booking-and-payments platform for a service business'],
    stack=['Next.js', 'React', 'TypeScript', 'Postgres', 'Stripe and local gateways'],
    fit=['Founders launching a first product', 'Businesses moving a process online',
         'Teams replacing an outdated web system'],
    offers=['dashboards', 'marketplace'], price_from=6000,
    proof=('Lineamode, deskless and Finance AI are web products we built.', '/work/'))

cat(slug='mobile-apps', area='software', group='customer', name='Mobile apps',
    tagline='iOS and Android from one codebase.',
    summary='Mobile apps that work on the mid-range phones your customers actually own — '
            'including camera, AR, offline use and push notifications.',
    builds=[('One codebase, both stores', 'One codebase for iOS and Android, published to both stores'),
            ('Camera, AR, barcodes', 'Camera, AR and barcode scanning'), ('Offline-first data', 'Offline-first data that syncs later'),
            ('Biometric login', 'Biometric login and identity checks'), ('Notifications', 'Push, SMS and in-app notifications'),
            ('The backend behind it', 'The backend and admin portal behind it')],
    examples=['A field team\'s inspection app that works without signal',
              'A retail brand\'s loyalty and ordering app',
              'A visualiser that previews products in a customer\'s room'],
    stack=['React Native', 'Expo', 'TypeScript', 'Supabase'],
    fit=['Consumer brands and service businesses', 'Field teams', 'Products needing the camera'],
    offers=['mobile-apps'], price_from=10000,
    proof=('Master Paints previews paint colours live on a customer\'s own wall from a '
           'mid-range Android phone.', '/work/master-paints/'))

cat(slug='marketplaces', area='software', group='customer', name='Marketplaces',
    tagline='Buyers, sellers and your cut in the middle.',
    summary='Online stores and multi-vendor marketplaces with separate buyer, seller and admin '
            'sides — catalogue, orders, payouts and multi-currency pricing.',
    builds=[('Three sides, one system', 'Storefront, seller portal and admin console'), ('Catalogue and media', 'Catalogue with variants and media'),
            ('Commission and payouts', 'Orders, commission and payouts'), ('Multi-currency pricing', 'Multi-currency pricing'),
            ('Seller onboarding', 'Seller onboarding and verification'), ('Separated data', 'Strict separation between parties\' data')],
    examples=['A B2B marketplace for surplus materials',
              'A brand\'s direct-to-consumer store',
              'A services marketplace with booking and payment'],
    stack=['Next.js', 'Postgres', 'Row-level security', 'Payment gateways'],
    fit=['Niche B2B platforms', 'Brands selling direct', 'Founders turning a network into a platform'],
    offers=['marketplace'], price_from=12000,
    proof=('Fabricport is a B2B surplus-fabric marketplace with four role-scoped portals.', '/work/'))

cat(slug='booking', area='software', group='customer', name='Booking',
    tagline='Stop selling slots. Start filling them.',
    summary='Online booking, payments and a scheduler that closes the dead gaps between '
            'bookings — for anything people reserve by the hour.',
    builds=[('Your own booking page', 'Booking on your own domain and brand'), ('A gap-filling scheduler', 'A scheduler that fills gaps between bookings'),
            ('Memberships and waitlists', 'Memberships, packages and waitlists'), ('Front-desk point of sale', 'Point of sale for the front desk'),
            ('Occupancy reporting', 'Occupancy and revenue reporting'), ('Your customer list', 'Your customer list, owned by you')],
    examples=['Sports courts and studios', 'Clinics and salons', 'Service bays and workshops'],
    stack=['React', 'Postgres', 'Payment gateways'],
    fit=['Venues paying a marketplace a cut', 'Businesses booking by phone and paper'],
    offers=['bookings'], price_from=8000,
    proof=('The Courts runs booking and point of sale for a padel and pickleball facility.', '/work/'))

# ══ Software · Desktop & developer ══════════════════════════════════════
cat(slug='macos-apps', area='software', group='platform', name='macOS apps',
    tagline='Native Mac software that feels like it belongs there.',
    summary='Desktop applications for macOS — menu-bar utilities, document tools and '
            'full apps — signed, notarised and ready to distribute.',
    builds=[('Native desktop apps', 'Native or cross-platform desktop apps'), ('Menu-bar utilities', 'Menu-bar utilities and background agents'),
            ('File and media processing', 'File, document and media processing'), ('Local-first data', 'Local-first data with optional sync'),
            ('Signed and notarised', 'Code signing, notarisation and auto-update'), ('Download or App Store', 'Direct download or App Store release')],
    examples=['A studio\'s asset-management desktop tool',
              'An operations dashboard that lives in the menu bar',
              'A desktop client for an existing web product'],
    stack=['Swift', 'Tauri', 'Electron', 'Rust'],
    fit=['Teams whose workflow lives on Macs', 'Products needing offline desktop use'],
    offers=[], price_from=8000,
    proof=('cottonAI, a desktop app we built, ships as a native Tauri build.', '/work/'))

cat(slug='windows-apps', area='software', group='platform', name='Windows apps',
    tagline='Desktop software for the machines on the shop floor.',
    summary='Windows applications for offices, counters and factory PCs — including software '
            'that talks to printers, scanners, scales and serial devices.',
    builds=[('Windows 10 and 11', 'Desktop apps for Windows 10 and 11'), ('Printers and scales', 'Integration with printers, scales and scanners'),
            ('Serial and USB devices', 'Serial and USB device communication'), ('Works offline', 'Offline operation with later sync'),
            ('Installers and updates', 'Installers and silent updates'), ('Kiosk mode', 'Kiosk and locked-down modes')],
    examples=['A weighbridge operator\'s ticketing app',
              'A counter app driving a receipt printer and cash drawer',
              'A factory PC collecting readings from a serial device'],
    stack=['C#/.NET', 'Tauri', 'Electron', 'Serial & USB'],
    fit=['Businesses on Windows counters and shop-floor PCs', 'Anything wired to a device'],
    offers=['protocol-decode'], price_from=8000)

cat(slug='cli-tools', area='software', group='platform', name='Developer tools',
    tagline='Tools your engineers reach for every day.',
    summary='Command-line tools, build and deploy scripts, and internal developer tooling that '
            'turn a page of manual steps into one command.',
    builds=[('Tools that explain themselves', 'Command-line tools with clear help and errors'), ('Build and release', 'Build, test and release automation'),
            ('Migrations and maintenance', 'Data migration and maintenance scripts'), ('Generators', 'Code generators and scaffolders'),
            ('Checks before shipping', 'Checkers that stop mistakes before they ship'), ('Packaged everywhere', 'Packaged for macOS, Linux and Windows')],
    examples=['A one-command release pipeline for a mobile app',
              'A data-migration tool with a dry-run mode',
              'A site generator with a consistency checker'],
    stack=['Python', 'TypeScript', 'Go', 'Rust', 'Shell'],
    fit=['Engineering teams losing time to manual steps', 'Products that need a developer CLI'],
    offers=[], price_from=3000,
    proof=('This site is built with its own scaffolder and consistency checker.', '/about/'))

cat(slug='integrations', area='software', group='platform', name='Integrations',
    tagline='Make your systems talk to each other.',
    summary='APIs, webhooks and integrations that connect the tools you already use — so data '
            'moves by itself instead of by copy-and-paste.',
    builds=[('APIs and webhooks', 'REST and webhook APIs for your product'), ('Two-way sync', 'Two-way sync between business systems'),
            ('Payments and messaging', 'Payment, SMS, WhatsApp and email integrations'), ('Accounting connectors', 'Accounting and ERP connectors'),
            ('Queues and retries', 'Reliable queues with retries and logs'), ('Machines and devices', 'Integration with machines and devices')],
    examples=['An online store synced to an accounting package',
              'A CRM wired to WhatsApp and SMS',
              'Device data landing in a cloud database'],
    stack=['Node.js', 'Python', 'Postgres', 'Queues', 'Edge functions'],
    fit=['Businesses re-keying data between systems', 'Products needing a public API'],
    offers=['remote-decode'], price_from=4000)

# ══ Software · AI & automation ══════════════════════════════════════════
cat(slug='ai-agents', area='software', group='ai', name='AI agents',
    tagline='Agents that do real work — and ask before they change anything.',
    summary='AI agents wired to your own data and tools, able to research, draft and propose '
            'actions, with every change gated behind a person\'s approval.',
    builds=[('Agents with real tools', 'Agents with a catalogue of tools over your systems'),
            ('Grounded answers', 'Answers grounded in your data, with sources'),
            ('Nothing without approval', 'Proposed actions that wait for human approval'),
            ('Scoped access', 'Access scoped to what each user may see'),
            ('Logged end to end', 'Full logs of every question, action and approval'),
            ('Cost controls', 'Streaming responses and cost controls')],
    examples=['An operations analyst over the company database',
              'A sales assistant that drafts follow-ups from the CRM',
              'A support agent that resolves tickets from the knowledge base'],
    stack=['Claude', 'Tool calling', 'Retrieval', 'Postgres', 'Row-level security'],
    fit=['Teams with questions queued behind one analyst',
         'Businesses that want AI but not an unsupervised one'],
    offers=['ops-analyst'], price_from=8000,
    proof=('Finance AI is an agentic analyst with a 22-tool catalogue and approval-gated '
           'write operations.', '/work/finance-ai/'))

cat(slug='automation', area='software', group='ai', name='Automation',
    tagline='The repetitive work, done without anyone doing it.',
    summary='Automations that move data, send messages, generate documents and trigger actions '
            'across your tools — on a schedule or the moment something happens.',
    builds=[('Scheduled and triggered', 'Scheduled and event-driven workflows'), ('Automatic reports', 'Automatic reports and summaries'),
            ('Documents and invoices', 'Document and invoice generation'), ('Notifications', 'Email, SMS and WhatsApp notifications'),
            ('Hand-offs', 'Hand-offs between teams and systems'), ('Failure alerts', 'Monitoring that tells you when a step fails')],
    examples=['Daily sales reports emailed to every branch manager',
              'New orders routed to the right supplier automatically',
              'Overdue invoices chased on a schedule'],
    stack=['Python', 'Node.js', 'Queues', 'Cron', 'Messaging APIs'],
    fit=['Teams doing the same steps every day', 'Businesses growing faster than headcount'],
    offers=[], price_from=3500,
    proof=('Our founder built an automation service, in a previous role, that classified and '
           'routed live cases by risk and urgency, cutting manual triage time by 40%.', '/about/'))

cat(slug='document-ai', area='software', group='ai', name='Reading documents',
    tagline='PDFs, scans and emails turned into clean data.',
    summary='Pipelines that read invoices, contracts, forms and emails and turn them into '
            'structured records you can search, check and report on.',
    builds=[('Extraction', 'Extraction from PDFs, scans and email'), ('Your own rules', 'Validation against your own rules'),
            ('A review queue', 'A review queue for anything uncertain'), ('Search everything', 'Search across every document'),
            ('Export anywhere', 'Export to your database or spreadsheets'), ('Source-to-record trail', 'Audit trail from source to record')],
    examples=['Supplier invoices captured into accounts',
              'Contract terms extracted into a register',
              'Shipping and trade documents turned into a ledger'],
    stack=['Python', 'OCR', 'Claude', 'Postgres'],
    fit=['Teams re-typing documents', 'Finance and operations back offices'],
    offers=[], price_from=5000)

# ══ Hardware · Industrial automation ════════════════════════════════════
cat(slug='factory-automation', area='hardware', group='industrial', name='Factory automation',
    tagline='A production line that reports on itself.',
    summary='Sensors, controllers and software that automate steps on a production line and '
            'show output, downtime and faults live — added to the machines you already have.',
    builds=[('Output and downtime', 'Machine monitoring for output, downtime and faults'),
            ('Line controllers', 'Controllers for repetitive line steps'), ('Operator screens', 'Operator screens and alarms'),
            ('Shift reporting', 'Shift and batch reporting'), ('Works with your PLCs', 'Integration with PLCs and existing controls'),
            ('Management dashboards', 'Dashboards for management, viewable anywhere')],
    examples=['An output and downtime board for a packaging line',
              'Automatic batch counting and reject logging',
              'Alarms sent to a supervisor\'s phone when a machine stops'],
    stack=['ESP32 & STM32', 'RS485 / Modbus', 'PLC integration', 'Cloud dashboards'],
    fit=['Factories running on paper shift logs', 'Plants with machines that cannot report'],
    offers=['epsilon1', 'protocol-decode'], price_from=15000)

cat(slug='mill-automation', area='hardware', group='industrial', name='Mill automation',
    tagline='Flour, rice and textile mills that run on numbers, not guesses.',
    summary='Monitoring and control for mills — throughput, motor load, bin levels and energy '
            'use — so the owner sees the mill\'s real performance from anywhere.',
    builds=[('Throughput and yield', 'Throughput and yield measurement'), ('Motor load and vibration', 'Motor load, temperature and vibration monitoring'),
            ('Bin and silo levels', 'Bin and silo level sensing'), ('Energy per tonne', 'Energy use per shift and per tonne'),
            ('Batch records', 'Batch and shift records'), ('Stoppage alerts', 'Alerts for stoppages and faults')],
    examples=['A flour mill\'s yield and energy per tonne',
              'A rice mill\'s motor and bin monitoring',
              'A textile mill\'s loom uptime board'],
    stack=['Epsilon1 terminal', 'RS485 / Modbus', 'Load and level sensors', 'Cloud dashboards'],
    fit=['Mill owners who cannot be on site', 'Mills losing yield without knowing where'],
    offers=['epsilon1', 'sensing'], price_from=12000)

cat(slug='retrofits', area='hardware', group='industrial', name='Machine retrofits',
    tagline='Old machines, new data.',
    summary='Connect machines that were never designed to be connected — including ones with '
            'undocumented protocols — and bring their data into modern software.',
    builds=[('Protocol decoding', 'Protocol capture and decoding'), ('A terminal on the bus', 'A terminal that reads the machine directly'),
            ('Noisy lines handled', 'Resilient parsing on noisy, shared lines'), ('Into your database', 'Data into your cloud or database'),
            ('Remote updates', 'Remote configuration and updates'), ('The machine untouched', 'No change to the machine itself')],
    examples=['A weighbridge feeding a ticketing system',
              'Legacy CNC machines reporting job counts',
              'Fuel dispensers read without the vendor\'s console'],
    stack=['RS485', 'RS232', 'Modbus', 'CAN', 'ESP32-S3'],
    fit=['Plants with machines the vendor will not integrate', 'Mixed old and new equipment'],
    offers=['protocol-decode', 'remote-decode', 'epsilon1'], price_from=6000,
    proof=('For eFuelPro we decoded an undocumented dispenser protocol and built the board '
           'that reads it.', '/work/efuelpro/'))

cat(slug='hmi-scada', area='hardware', group='industrial', name='Operator screens',
    tagline='Screens operators can read at a glance.',
    summary='Touchscreen panels and control-room views for machines and plants — clear status, '
            'alarms and history, on the floor and remotely.',
    builds=[('Operator panels', 'Touchscreen operator panels'), ('Control-room views', 'Control-room and remote views'), ('Alarms and history', 'Alarm handling and history'),
            ('Trend charts', 'Trend charts for key readings'), ('Role-based controls', 'Role-based controls'), ('Digital twin views', 'Digital twin views of a site')],
    examples=['A machine-side panel replacing a tangle of indicators',
              'A multi-site status wall for an operator',
              'A 3D view of a site with live machine states'],
    stack=['Embedded TFT displays', 'Web dashboards', 'Three.js', 'Modbus'],
    fit=['Plants with cryptic machine panels', 'Operators managing several sites'],
    offers=['digital-twin', 'epsilon1'], price_from=8000)

# ══ Hardware · Monitoring & IoT ═════════════════════════════════════════
cat(slug='industrial-iot', area='hardware', group='monitoring', name='Machine monitoring',
    tagline='Every machine you own, visible from anywhere.',
    summary='Connected terminals that read machines and sensors on site and deliver the data to '
            'a live dashboard — built to keep working when the network does not.',
    builds=[('Terminals on the machine', 'Terminals that read machines and sensors'), ('Survives outages', 'Offline-first queues that survive outages'),
            ('Live and historical', 'Live and historical dashboards'), ('Alerts that reach you', 'Alerts by SMS, WhatsApp and email'),
            ('Over-the-air config', 'Over-the-air configuration'), ('Fleet across sites', 'Fleet management across sites')],
    examples=['A fleet of sites reporting live from one dashboard',
              'Machines on a patchy connection that never lose a reading',
              'Remote configuration of hundreds of devices'],
    stack=['Epsilon1', 'ESP32-S3', 'RS485 / Modbus', 'Cloud ledger'],
    fit=['Multi-site operators', 'Anyone collecting machine data by hand'],
    offers=['epsilon1'], price_from=650)

cat(slug='energy-monitoring', area='hardware', group='monitoring', name='Energy & generators',
    tagline='Know what your power actually costs.',
    summary='Monitoring for generators, solar, grid and load — fuel use, runtime and energy per '
            'machine — so you can cut the waste you currently cannot see.',
    builds=[('Generator runtime and fuel', 'Generator runtime, load and fuel use'), ('Solar and grid metering', 'Solar and grid energy metering'),
            ('Energy per machine', 'Energy per machine, shift or product'), ('Abnormal-use alerts', 'Alerts for faults and abnormal use'),
            ('Cost and maintenance', 'Reports for cost and maintenance'), ('Every site, remotely', 'Remote monitoring across sites')],
    examples=['A factory\'s generator fuel and runtime log',
              'A site\'s solar, grid and generator split',
              'Energy per tonne on a production line'],
    stack=['Energy meters', 'Modbus', 'ESP32', 'Cloud dashboards'],
    fit=['Sites running on generators', 'Businesses with rising energy bills'],
    offers=['epsilon1', 'sensing'], price_from=5000)

cat(slug='cold-chain', area='hardware', group='monitoring', name='Cold chain',
    tagline='Temperature you can prove.',
    summary='Temperature, humidity and door monitoring for cold rooms, freezers and vehicles, '
            'with alerts and an unbroken record for audits.',
    builds=[('Temperature logging', 'Temperature and humidity logging'), ('Door and power alerts', 'Door and power-failure alerts'),
            ('Records that survive', 'Records that survive network outages'), ('Audit-ready reports', 'Audit-ready reports'),
            ('Alerts in real time', 'Alerts to phones in real time'), ('Calibration checks', 'Calibration and drift checks')],
    examples=['A cold store\'s continuous temperature record',
              'A pharmacy fridge alarm with an audit log',
              'Refrigerated vehicles tracked across a route'],
    stack=['Temperature & humidity sensors', 'ESP32', 'Offline queue', 'Cloud dashboards'],
    fit=['Food, pharma and cold storage', 'Anyone who needs proof for an auditor'],
    offers=['sensing', 'epsilon1'], price_from=5000)

cat(slug='tank-monitoring', area='hardware', group='monitoring', name='Tank levels',
    tagline='Levels you never have to dip by hand.',
    summary='Level, volume and flow monitoring for tanks, silos and reservoirs — with alerts '
            'before they run dry or overflow.',
    builds=[('Level and volume', 'Level and volume sensing'), ('Flow and consumption', 'Flow and consumption tracking'), ('Level alerts', 'Low and high level alerts'),
            ('Delivery reconciliation', 'Delivery reconciliation'), ('Remote readings', 'Remote readings across sites'), ('History and reporting', 'History and reporting')],
    examples=['Fuel and water tank levels across sites',
              'Silo levels in a mill or feed plant',
              'Delivery volumes checked against what arrived'],
    stack=['Level sensors', 'RS485 / Modbus', 'ESP32', 'Cloud dashboards'],
    fit=['Fuel, water and bulk storage', 'Businesses reconciling deliveries by hand'],
    offers=['epsilon1', 'sensing'], price_from=4000)

# ══ Hardware · Products ═════════════════════════════════════════════════
cat(slug='custom-hardware', area='hardware', group='products', name='Custom devices',
    tagline='From an idea on paper to a device in your hand.',
    summary='End-to-end product development: requirements, electronics, firmware, enclosure and '
            'the software around it — ready for small-batch production.',
    builds=[('Requirements and parts', 'Requirements and part selection'), ('Schematic and PCB', 'Schematic and PCB design'),
            ('Firmware and updates', 'Firmware and over-the-air updates'), ('Enclosure and prototypes', 'Enclosure design and prototyping'),
            ('Companion app', 'Companion app or cloud dashboard'), ('Manufacturing pack', 'Documentation for manufacturing')],
    examples=['A connected terminal for a retail counter',
              'A battery-powered sensor for remote sites',
              'A controller for a piece of specialist equipment'],
    stack=['KiCad', 'ESP32 & STM32', 'C/C++', '3D printing', 'Cloud & app'],
    fit=['Founders with a hardware idea', 'Companies turning a prototype into a product'],
    offers=['board-to-fab', 'design-review', 'firmware-rescue'], price_from=12000,
    proof=('Epsilon1 is a 120 mm terminal we designed and built, running in production.', '/work/efuelpro/'))

cat(slug='pos-terminals', area='hardware', group='products', name='Tills & kiosks',
    tagline='Counters and kiosks that print, scan and never lose a sale.',
    summary='Point-of-sale terminals and self-service kiosks with touchscreens, printers, card '
            'and RFID readers — and the ledger behind them.',
    builds=[('Terminals and kiosks', 'Touchscreen terminals and kiosks'), ('Verifiable receipts', 'Receipt printing with verifiable codes'),
            ('RFID and card readers', 'RFID, barcode and card readers'), ('Sales never block', 'Offline-first sales that never block'),
            ('Loyalty accounts', 'Loyalty and customer accounts'), ('Live sales ledger', 'Live sales ledger and reporting')],
    examples=['A counter terminal with receipts and loyalty',
              'A self-service ordering kiosk',
              'A payment point for an unattended site'],
    stack=['Epsilon1', 'Thermal printers', 'RFID', 'Touch TFT', 'Cloud ledger'],
    fit=['Retail, hospitality and fuel', 'Unattended and self-service sites'],
    offers=['efuelpro', 'epsilon1'], price_from=8000,
    proof=('eFuelPro prints verifiable receipts and runs RFID loyalty on our own terminal.', '/work/efuelpro/'))

cat(slug='rfid-attendance', area='hardware', group='products', name='Access & attendance',
    tagline='Know who was where, and when.',
    summary='RFID and card-based systems for staff attendance, access points and asset '
            'tracking, with reports that feed payroll and operations.',
    builds=[('RFID and card readers', 'RFID and card readers'), ('Attendance and shifts', 'Staff attendance and shift records'), ('Door and gate access', 'Door and gate access control'),
            ('Asset tracking', 'Asset and tool tracking'), ('Payroll reports', 'Reports for payroll'), ('Card management', 'Remote management of cards')],
    examples=['Shift attendance on a factory floor',
              'Tool check-in and check-out in a workshop',
              'Access to restricted rooms with an audit log'],
    stack=['RC522 / RFID', 'ESP32', 'Cloud dashboards'],
    fit=['Factories and sites with shift workers', 'Workshops tracking tools'],
    offers=['epsilon1'], price_from=4000,
    proof=('eFuelPro runs staff attendance on the same RFID reader it uses for loyalty.', '/work/efuelpro/'))

cat(slug='fuel-forecourt', area='hardware', group='products', name='Fuel forecourts',
    tagline='Every litre has a record, and the record has a receipt.',
    summary='Forecourt terminals that read the dispenser directly, print verifiable receipts, '
            'run loyalty and attendance, and keep a ledger that works offline.',
    builds=[('Direct dispenser reading', 'Direct dispenser reading'), ('Verifiable receipts', 'Verifiable receipts'), ('RFID loyalty', 'RFID loyalty and attendance'),
            ('Offline-first ledger', 'Offline-first ledger'), ('Live station view', 'Live station dashboard'), ('Remote price updates', 'Remote price updates')],
    examples=['An independent station\'s live sales view',
              'A small chain\'s reconciliation across sites',
              'A dealer network\'s reporting'],
    stack=['Epsilon1', 'RS485', 'Thermal printer', 'Cloud ledger'],
    fit=['Independent stations and chains', 'Dealers and OMCs'],
    offers=['efuelpro'], price_from=650,
    proof=('eFuelPro runs in production on live dispenser hardware.', '/work/efuelpro/'))

# ══ Hardware · Engineering ══════════════════════════════════════════════
cat(slug='pcb-design', area='hardware', group='engineering', name='PCB design',
    tagline='Boards that come back from the fab right the first time.',
    summary='Schematic capture, layout, libraries drawn from datasheets, orderable BOMs and '
            'fabrication packages — or a review of a board someone else drew.',
    builds=[('Schematic and layout', 'Schematic and layout in KiCad'), ('Datasheet-drawn libraries', 'Libraries drawn from manufacturer datasheets'),
            ('Power and protection', 'Power protection and decoupling'), ('Orderable BOMs', 'Orderable BOMs with alternates'),
            ('Fabrication outputs', 'Gerbers, drill files and assembly notes'), ('Pre-fab review', 'Pre-fabrication design reviews')],
    examples=['A 2-layer controller board', 'A 4-layer mixed-signal sensor board',
              'A review before a first fabrication run'],
    stack=['KiCad', 'Altium', 'JLCPCB & local fabs'],
    fit=['Product teams without a hardware engineer', 'Anyone about to pay for a fab run'],
    offers=['board-to-fab', 'design-review', 'footprint', 'bom-audit'], price_from=900,
    proof=('Epsilon1 is a 2-layer board with five peripherals across two SPI buses, I²C, two '
           'UARTs and USB-CDC.', '/work/efuelpro/'))

cat(slug='embedded-firmware', area='hardware', group='engineering', name='Embedded firmware',
    tagline='Firmware that keeps running when things go wrong.',
    summary='Bare-metal and RTOS firmware for microcontrollers — drivers, communication, '
            'fault recovery and over-the-air updates.',
    builds=[('Drivers', 'Drivers for displays, sensors and radios'), ('Every bus', 'Serial, SPI, I²C, CAN and USB communication'),
            ('Detects and recovers', 'Fault detection and automatic recovery'), ('Crash-safe storage', 'Crash-safe storage and queues'),
            ('Over-the-air updates', 'Over-the-air updates'), ('Rescue work', 'Rescue of firmware nobody understands')],
    examples=['A device that recovers itself after a power cut',
              'A sensor node that runs for months on a battery',
              'Taking over an abandoned codebase'],
    stack=['C/C++', 'ESP-IDF', 'Arduino / PlatformIO', 'FreeRTOS', 'STM32'],
    fit=['Devices failing in the field', 'Products needing reliable firmware'],
    offers=['firmware-rescue', 'board-to-fab'], price_from=8000,
    proof=('eFuelPro runs 8,700 lines of C++ firmware on ESP32-S3 in production.', '/work/efuelpro/'))

cat(slug='sensing', area='hardware', group='engineering', name='Sensors & calibration',
    tagline='Readings you can trust after the first week.',
    summary='Force, pressure, load, temperature and motion sensing — characterised, calibrated '
            'and corrected for drift, with calibration that survives a re-flash.',
    builds=[('Sensor selection', 'Sensor selection and custom sensing'), ('Characterisation', 'Characterisation across temperature and load'),
            ('Per-unit calibration', 'Automated calibration per unit'), ('Drift detection', 'Drift detection in firmware'),
            ('Versioned profiles', 'Versioned calibration profiles'), ('Production test tooling', 'Production test tooling')],
    examples=['Load cells for weighing', 'Pressure sensing on a process line',
              'Motion sensing on moving equipment'],
    stack=['Load cells', 'IMUs', 'Python calibration', 'Firmware'],
    fit=['Products where a wrong reading costs money', 'Teams calibrating units by hand'],
    offers=['sensing'], price_from=9000,
    proof=('eFuelPro calibrates itself on site against measured price-per-unit within 1% '
           'tolerance.', '/work/efuelpro/'))

cat(slug='small-batch', area='hardware', group='engineering', name='Enclosures & small runs',
    tagline='From one prototype to your first hundred units.',
    summary='Enclosure design, prototyping and the documentation and test tooling that make '
            'small-batch production repeatable.',
    builds=[('Enclosures and prototypes', 'Enclosure design and 3D-printed prototypes'), ('Assembly drawings', 'Assembly instructions and drawings'),
            ('Test jigs', 'Test jigs and production tests'), ('BOM costing', 'BOM costing at your volumes'),
            ('Supplier coordination', 'Supplier and assembler coordination'), ('First-article inspection', 'First-article inspection')],
    examples=['Ten pilot units for a field trial', 'A hundred units for a first customer',
              'A test jig that checks every board in seconds'],
    stack=['Fusion 360', 'SolidWorks', '3D printing', 'Test automation'],
    fit=['Products moving from prototype to production'],
    offers=['board-to-fab', 'bom-audit'], price_from=5000)


# ── lookups ─────────────────────────────────────────────────────────────

CATEGORIES = C
BY_CAT = {c['slug']: c for c in C}


def cats_in(area, group=None):
    return [c for c in C if c['area'] == area and (group is None or c['group'] == group)]


def cat_path(c):
    return f"{c['area']}/{c['slug']}/index.html"


def cat_url(c):
    return f"/{c['area']}/{c['slug']}/"


if __name__ == '__main__':
    from offers import BY_SLUG
    bad = [(c['slug'], o) for c in C for o in c['offers'] if o not in BY_SLUG]
    dup = len(C) - len(BY_CAT)
    print(f'{len(C)} categories | dangling offer refs: {bad or "none"} | duplicate slugs: {dup}')
    for a in AREAS:
        for g, label, _ in GROUPS[a]:
            print(f'  {a}/{label}: ' + ', '.join(c['name'] for c in cats_in(a, g)))
