"""Prospecting strategies S2-S13 as data (S1 tenders is code in agents/tenders.py; S6 is the quota loop in agents/prospector.py).

S2-S10 hunt hardware and industrial buyers; S11-S13 hunt SMB software buyers (Settings prospector.mix splits the daily
quota between the two groups). S13 is not web research: code reads the monthly Hacker News "Seeking freelancer" thread
(core/feeds/hn_freelancer.py) and a tool-less model only scores what code found.

Each strategy carries what the research prompt needs (brief, example queries, evidence rules, who counts as a buyer),
what the pitch needs (default offer set, angle, which outbound prompt) and how code validates the answer
(recency window, strict offer set). Plain text on purpose: edit the words here, not in the prompt template.
"""
from dataclasses import dataclass

from core.settings import STRATEGY_IDS, STRATEGY_LABEL

TRIGGER_TYPES = ("funding", "expansion", "grant", "end_of_life", "regulation", "partner_page", "rfq", "fulltime_post",
                 "orphaned", "tradeshow", "crowdfunding", "cohort", "tooling_switch", "ops_hire", "other")


@dataclass(frozen=True)
class Strategy:
    id: str
    name: str
    segment: str            # natural segment: fills the legacy segment/wedge when the model does not name a valid one
    brief: str
    queries: str
    evidence_rules: str
    buyer_rules: str
    offers: tuple           # default offer set (slugs); the prompt prefers these
    angle: str              # how the first touch should be pitched
    outbound: str = "outbound"        # prompt file
    strict_offers: bool = False       # code rejects a suggested offer outside `offers`
    max_age_days: int | None = None   # code rejects dated evidence older than this
    dated_types: tuple = ()           # trigger types for which an evidence_date is required
    trigger_types: tuple = ()         # trigger_type values code accepts for this strategy
    max_future_days: int = 2          # evidence_date may lie this far ahead (S8: shows are in the future)
    max_headcount: int | None = None  # code rejects a stated headcount above this (S11: SMBs only)


S2 = Strategy(
    id="s2_trigger", name="Trigger events", segment="oem_hardware",
    brief=(
        "Companies that have just had an event which creates engineering work. Four kinds:\n"
        "1. FUNDING: hardware, IoT and robotics startups that announced a seed, Series A or Series B round in the last 120 days "
        "(TechCrunch, EU-Startups, Sifted, the company's own blog, a press release). They now have money and a roadmap and usually too few embedded, PCB or firmware people.\n"
        "2. EXPANSION: manufacturers announcing a new plant, line or expansion in the last 120 days, with no named automation integrator for monitoring or controls.\n"
        "3. GRANT: recipients of public energy-efficiency or industrial-decarbonisation grants (UK Industrial Energy Transformation Fund, US DOE and Inflation Reduction Act programmes, "
        "EU Innovation Fund and national schemes; the grantee lists are public) who must now install metering and prove measured savings.\n"
        "4. END OF LIFE: plants running controllers or drives the vendor has discontinued (obsolescence notices, forum threads from the operating company)."),
    queries=(
        "\"raises\" \"seed\" OR \"Series A\" hardware OR IoT OR robotics startup <month> <year> (also site:eu-startups.com, site:sifted.eu, site:techcrunch.com); "
        "\"announces new production line\" OR \"plant expansion\" manufacturer <month> <year>; "
        "\"Industrial Energy Transformation Fund\" recipients; \"Industrial Demonstrations Program\" selections; \"Innovation Fund\" selected projects manufacturing; "
        "\"end of life\" OR \"obsolescence notice\" PLC OR controller OR drive plant forum \"replacement\"."),
    evidence_rules=(
        "- evidence_url is the announcement itself (article, press release, grantee list entry, notice). Open it and read it.\n"
        "- evidence_date is the announcement date, YYYY-MM-DD. Funding and expansion: within the last 120 days. Grant: within the last 12 months. End of life: a date if the page has one, else empty.\n"
        "- trigger is one plain sentence naming what happened (for example \"raised a EUR 8M Series A on 2026-09-02\"). trigger_type is funding, expansion, grant or end_of_life.\n"
        "- The company must still be independent and small to mid-sized; skip subsidiaries of listed groups and companies with a named engineering partner for this work."),
    buyer_rules=(
        "Buyers are the companies that had the event, with a founder or engineering lead who decides. Skip investors, accelerators, agencies, recruiters, "
        "universities and large listed companies. Software-only startups do not count for funding triggers: the product must be hardware, IoT, robotics or industrial."),
    offers=("hardware-rescue", "firmware-rescue", "board-to-fab", "design-review", "protocol-decode", "plant-visibility-pilot",
            "sensing", "remote-decode", "ops-software-build", "dashboards"),
    angle=("Pitch at the trigger, in the first sentence of the body: \"now that you've raised...\", \"with the new line...\", \"the grant requires measured savings...\", "
           "\"with the controller going end of life...\". Frame the offer as capacity for the work the event creates, with concrete deliverables."),
    max_age_days=365, dated_types=("funding", "expansion", "grant"),
    trigger_types=("funding", "expansion", "grant", "end_of_life"))

S3 = Strategy(
    id="s3_regulation", name="Regulation", segment="oem_hardware",
    brief=(
        "Makers of connected products (devices with a network interface, an app or cloud link, or updatable firmware) sold into the EU or the UK, who are exposed to "
        "new security obligations: the EU Cyber Resilience Act (reporting duties from 2026, most obligations phasing in through 2027) and the UK Product Security and Telecommunications Infrastructure (PSTI) Act, in force now "
        "(no default passwords, a published vulnerability-disclosure contact, a stated support period).\n"
        "Two ways in: (a) the maker shows NO published vulnerability-disclosure policy (no security.txt, no security or PSIRT page, no disclosure contact) and no visible update mechanism, "
        "or (b) the maker mentions compliance work (CRA, PSTI, RED cybersecurity, EN 18031, IEC 62443, 'security by design') on its site or blog.\n"
        "The offer is engineering only: fixing the firmware gaps these obligations expose on product lines already on sale (recovering an SBOM from the firmware, vulnerability triage, "
        "and retrofitting secure boot or signed updates onto existing boards), framed as 'keep selling this product into the EU after December 2027'. Never claim legal or certification expertise.\n"
        "Strongest fits: product lines 3+ years old, firmware downloads or release notes on the support site, small engineering teams, microcontroller (STM32, ESP32, nRF) or embedded Linux devices.\n"
        "Prefer makers with NO disclosure route. A maker that already publishes a vulnerability-disclosure policy, PSIRT page or PSTI statement qualifies only if the page also shows security work still ahead "
        "(preparing for the CRA, no independent product test mentioned, no signed-update mechanism described); otherwise skip it and keep looking."),
    queries=(
        "\"Cyber Resilience Act\" our products OR \"preparing for\" manufacturer IoT OR smart OR connected; \"PSTI\" compliance \"connected\" product maker; "
        "smart home OR industrial IoT OR wearable OR EV charger hardware company EU OR UK \"firmware update\" OR \"OTA\"; "
        "check <domain>/.well-known/security.txt and <domain>/security; \"vulnerability disclosure\" absent on a connected-device maker's site."),
    evidence_rules=(
        "- evidence_url is a page that shows the connected product and that it is sold in the EU or UK (product page, shop, distributor list), or a page where the company mentions compliance work. Open it.\n"
        "- For the 'no disclosure policy' case, WebFetch <domain>/.well-known/security.txt and the site's security/contact page and say what you found in the observation (for example \"no security.txt, no security page, footer lists no disclosure contact\"). "
        "Never claim absence you did not check.\n"
        "- evidence_quote is a sentence from the product or compliance page, not from your checking. trigger is the exposure in one sentence (for example \"sells a Wi-Fi thermostat in the UK with no disclosure contact\"). trigger_type is regulation.\n"
        "- evidence_date may be empty for product pages; give it when the page is dated."),
    buyer_rules=(
        "Buyers are the manufacturer or brand owner of the connected product (10 to 500 people). The contact must be a NAMED person: CTO, head of engineering, firmware or R&D lead, "
        "or a technical founder at a small company, with an address published on the company's own site or press material (never a shared inbox, never an address from GitHub). Skip pure software companies, resellers, "
        "large listed manufacturers with their own product-security team, and compliance consultancies. The company may be anywhere in a target market (a US maker selling into the EU counts)."),
    offers=("firmware-rescue", "hardware-rescue", "device-pentest"),
    angle=("Open with one true, specific fact about the maker's older product line. Then: since 11 September 2026 the CRA requires a 24-hour early warning for actively exploited vulnerabilities, "
           "including in products already on sale, and from December 2027 products sold in the EU need an SBOM and a secure update path; on older lines that is engineering, not paperwork. "
           "Offer: recover the SBOM from the firmware, triage what matters and fix it (for example signed updates on a shipping board), and a one-page gap read at no cost if they send one firmware image. "
           "Close by asking whether that product line is on their CRA list yet. Never give legal or certification advice, never say the product is non-compliant, never imply a finding you have not made."),
    strict_offers=True, trigger_types=("regulation", "other"))

S4 = Strategy(
    id="s4_partner", name="Partners", segment="oem_hardware",
    brief=(
        "Product-design studios, hardware and IoT consultancies, software development agencies and system integrators in the US, UK, EU and Australia whose public portfolio shows client hardware, "
        "device or industrial projects but who show NO in-house embedded firmware, PCB or protocol-decode depth (no firmware engineers on the team page, no electronics case studies with board-level detail), "
        "or who publish a subcontractor, 'partner with us' or 'work with us as a studio/freelancer' page.\n"
        "The idea is white-label capacity: Epsilon delivers fixed-scope embedded, PCB, protocol and security work under the studio's brand, and the client relationship stays theirs. These are partners, not end buyers."),
    queries=(
        "\"industrial design\" OR \"product design\" studio hardware \"IoT\" portfolio client; \"IoT consultancy\" OR \"embedded consultancy\" OR \"product development agency\" case studies; "
        "\"subcontractor\" OR \"partner with us\" OR \"become a partner\" OR \"white label\" agency electronics OR firmware OR IoT; "
        "software agency \"IoT\" OR \"connected device\" projects portfolio; system integrator \"SCADA\" OR \"industrial IoT\" portfolio \"partners\". Add US, UK, Germany, Netherlands, Australia."),
    evidence_rules=(
        "- evidence_url is the studio's portfolio, services, team or partner page (never the bare homepage) that shows the hardware or industrial client work, or the subcontractor/partner page. Open it. "
        "Do not claim they use or lack an outside partner unless a page says so.\n"
        "- evidence_quote is a sentence from that page. observation states what the portfolio shows and what depth is not visible (for example \"portfolio lists three IoT products; the team page lists no firmware or electronics engineers\"). State only what you saw.\n"
        "- trigger is the reason they are a fit as a partner in one sentence. trigger_type is partner_page when they publish a subcontractor or partner page, otherwise other.\n"
        "- evidence_date may be empty; give it when the page is dated.\n"
        "- contact: a partnerships, studio, hello or founder address the studio publishes. Not a careers or recruiting address."),
    buyer_rules=(
        "Here, and only here, agencies, consultancies, studios and integrators ARE the target (the usual 'skip agencies' rule does not apply). Size roughly 3 to 200 people, independent, in the US, UK, EU or Australia. "
        "Skip studios that already employ embedded firmware and PCB engineers, global consultancies (Accenture, Capgemini, Frog, IDEO and similar), staffing firms and freelance marketplaces."),
    offers=("protocol-decode", "firmware-rescue", "board-to-fab", "hardware-rescue", "design-review", "remote-decode", "device-pentest",
            "plant-visibility-pilot", "mobile-apps", "dashboards", "ops-software-build"),
    angle=("White-label capacity for the studio's own client projects: we deliver the embedded, board, protocol or security piece under their brand at fixed scope, and their client relationship stays theirs. "
           "This is a peer-to-peer note proposing a working arrangement, not an offer to a customer."),
    outbound="partner_outbound", trigger_types=("partner_page", "other"))

S5 = Strategy(
    id="s5_intent", name="Outsourcing intent", segment="industrial",
    brief=(
        "Companies that say in plain words that they want to buy outside engineering or development: \"looking for a firm / agency / contractor / consultancy\", \"RFQ\", \"request for proposal\", "
        "\"statement of work\", \"outsourced firmware / PCB / SCADA / app development\", \"development partner\". Look on company sites, procurement or supplier pages of private companies, "
        "industry forums and marketplaces that NAME the buyer.\n"
        "LAST RESORT ONLY: a full-time job post counts only when the company is small (under about 50 people) AND the post is more than 45 days old (they are struggling to hire). "
        "Mark those with trigger_type fulltime_post and fill headcount and post_age_days. Never return a full-time post otherwise."),
    queries=(
        "\"looking for\" \"firmware development partner\" OR \"embedded development partner\" OR \"PCB design partner\"; \"request for proposal\" OR \"RFQ\" \"firmware\" OR \"SCADA\" OR \"PLC\" OR \"mobile app\" private company <month> <year>; "
        "\"statement of work\" \"outsourced\" development; \"we are seeking a contractor\" OR \"seeking a vendor\" embedded OR industrial OR dashboard; "
        "supplier or vendor-registration page of a private manufacturer; industry forum posts that name the company and ask for a firm."),
    evidence_rules=(
        "- evidence_url is the page with the explicit outsourcing language and the buyer's name. Open it. It must be live and not closed or awarded; posted or updated in the last 120 days.\n"
        "- evidence_quote is the sentence with the outsourcing language. evidence_date is the posting date, YYYY-MM-DD, when shown.\n"
        "- trigger_type is rfq for an explicit request for a firm, contractor or proposal; fulltime_post only for the last-resort case. "
        "For fulltime_post you must have found headcount (under 50, from the company site or a reliable page) and the post's age in days (over 45); if you cannot establish both, drop the company.\n"
        "- Public-sector tenders are not in this strategy (a separate system handles them); skip governments, agencies and universities."),
    buyer_rules=(
        "Buyers are small and mid-sized private companies (roughly 5 to 500 people) where a founder or engineering lead decides. Skip large enterprises, listed multinationals, governments, universities, recruiters, "
        "job boards, software agencies and consultancies (competitors, not buyers). Never list an individual."),
    offers=("firmware-rescue", "hardware-rescue", "plant-visibility-pilot", "ops-software-build", "protocol-decode", "board-to-fab",
            "mobile-apps", "dashboards", "inventory", "crm"),
    angle=("Answer the explicit request: say you saw they are looking for outside help with the named work and offer a fixed-scope engagement for it. "
           "If the signal is a last-resort job post, the angle is a fixed-scope engagement that delivers while they hire."),
    max_age_days=120, trigger_types=("rfq", "fulltime_post", "other"))

S7 = Strategy(
    id="s7_orphaned", name="Orphaned devices", segment="industrial",
    brief=(
        "Businesses left holding equipment or an IoT fleet after the vendor shut down, was acquired, or dropped support. Method: first find the shutdown or end-of-support news "
        "(a cloud service switched off, a company liquidated, a product line discontinued, an app removed); then find that vendor's public customer case studies, reference-customer pages, "
        "or forum, Reddit-style and Stack Exchange threads from stranded users who name their company. The buyers are those customers, not the failed vendor.\n"
        "This is a very strong fit for Epsilon: decode the device's protocol or cloud API and stand up a replacement backend or dashboard so the fleet keeps working."),
    queries=(
        "\"shutting down\" OR \"end of support\" OR \"discontinued\" cloud-connected OR IoT OR \"remote monitoring\" platform customers stranded <year>; "
        "\"vendor went out of business\" OR \"company was acquired\" controller OR gateway OR sensors \"no longer supported\" plant OR fleet; "
        "\"case study\" customer of <failed vendor> ; forum \"the cloud service is gone\" devices \"still working\" locally."),
    evidence_rules=(
        "- evidence_url is the page that names the stranded business (a vendor case study, a customer thread, the business's own post). Open it.\n"
        "- evidence_date is the shutdown or end-of-support date, YYYY-MM-DD, within the last 3 years.\n"
        "- trigger names the vendor and what ended (for example \"Acme Cloud shut down its monitoring service on 2026-03-31\"). trigger_type is orphaned.\n"
        "- The business should still run, or have run, the equipment. A vendor's own reference-customer page or case study naming the customer is enough; prefer cases with no announced replacement, but do not drop a candidate only because one is mentioned."),
    buyer_rules=(
        "Buyers are the operators or product companies that depend on the orphaned devices (5 to 500 people). Skip the failed vendor, its liquidators, resellers, individuals, "
        "households and large listed groups."),
    offers=("protocol-decode", "remote-decode", "plant-visibility-pilot", "dashboards", "firmware-rescue", "ops-software-build", "sensing"),
    angle=("Name the vendor that went away in the first sentence and offer to decode the devices' protocol and build a replacement backend or dashboard so the fleet keeps running. "
           "State only what the page shows; do not assume which devices they run beyond it."),
    max_age_days=1095, trigger_types=("orphaned", "other"))

S8 = Strategy(
    id="s8_tradeshow", name="Trade-show exhibitors", segment="oem_hardware",
    brief=(
        "Small OEMs, startups and integrators exhibiting at relevant trade shows in the next 6 months (or that exhibited in the last 30 days): Embedded World, SPS Nuremberg, Hannover Messe, Automate, "
        "Sensors Converge, Electronica, GITEX, Big 5, ADIPEC, Middle East Energy. Exhibitor lists are public. Exhibiting means a product launch or a demo is due, with a deadline for firmware, boards and demos."),
    queries=(
        "<show> exhibitor list <year> new product OR \"world premiere\" startup OR \"first time\" ; \"we will be exhibiting\" OR \"visit us at\" hall booth hardware OR IoT OR embedded <show> <year>; "
        "exhibitor directory pages of Embedded World, SPS, Hannover Messe, Automate, Sensors Converge, Electronica, GITEX, Big 5, ADIPEC, Middle East Energy."),
    evidence_rules=(
        "- evidence_url is the exhibitor listing or the company's own announcement of its stand. Open it.\n"
        "- evidence_date is the first day of the show, YYYY-MM-DD (between 30 days ago and 200 days ahead). trigger names the show and the booth or product (for example \"exhibiting at SPS Nuremberg, Hall 4, 25 November 2026\"). trigger_type is tradeshow.\n"
        "- Pick independent exhibitors of up to about 500 people that make or integrate hardware, IoT or automation products. A listing in the official exhibitor directory is enough evidence; you do not need a booth page. Skip the show organisers and large listed groups."),
    buyer_rules=(
        "Buyers are the exhibiting OEMs, startups and integrators with a product to show. Skip organisers, sponsors, media, universities, large multinationals and pure software exhibitors."),
    offers=("hardware-rescue", "firmware-rescue", "board-to-fab", "design-review", "protocol-decode", "device-pentest", "dashboards", "mobile-apps", "sensing"),
    angle=("Reference the show by name in the first sentence and offer capacity for the work before it: firmware bring-up, a board respin, a demo dashboard or app. "
           "Do not assume what they are launching beyond what the page says."),
    max_age_days=30, dated_types=("tradeshow",), trigger_types=("tradeshow", "other"), max_future_days=200)

S9 = Strategy(
    id="s9_crowdfund", name="Crowdfunded hardware", segment="oem_hardware",
    brief=(
        "Kickstarter, Indiegogo and Crowd Supply hardware campaigns whose public updates mention firmware problems, manufacturing or tooling issues, certification (CE, FCC, UKCA) or shipping delays. "
        "The team has backers waiting and often no firmware, DFM or certification depth. Find the campaign's updates page, read the recent updates, then find the team's own company website and domain."),
    queries=(
        "site:kickstarter.com OR site:indiegogo.com OR site:crowdsupply.com hardware update \"firmware\" delay <month> <year>; \"shipping delay\" \"certification\" OR \"FCC\" OR \"CE\" hardware campaign update; "
        "\"manufacturing\" \"tooling\" OR \"DFM\" delay backers update <year>; Crowd Supply \"production update\" firmware."),
    evidence_rules=(
        "- evidence_url is the campaign update that mentions the problem. Open it. evidence_date is the update date, YYYY-MM-DD, within the last 120 days.\n"
        "- domain and name are the creator's OWN company and website, never kickstarter.com, indiegogo.com or crowdsupply.com. If the creator has no company site, skip it.\n"
        "- trigger names the problem as the update states it (for example \"update 14 says the firmware OTA is delayed to Q1\"). trigger_type is crowdfunding. Do not exaggerate; quote the update."),
    buyer_rules=(
        "Buyers are the creators' companies (1 to 100 people) with a shipping or soon-to-ship hardware product. Skip campaigns that are fully delivered, cancelled for fraud or abandoned, "
        "individual hobbyists with no company, and projects with a named big manufacturing partner for the problem."),
    offers=("hardware-rescue", "firmware-rescue", "design-review", "board-to-fab"),
    angle=("Acknowledge the update they published (one phrase), then offer a fixed-scope rescue of the specific piece: firmware, a design review for manufacturing and certification, or a board fix. "
           "Be calm and respectful: they have backers waiting; never imply they failed."),
    max_age_days=120, dated_types=("crowdfunding",), trigger_types=("crowdfunding", "other"))

S10 = Strategy(
    id="s10_accelerator", name="Accelerators and spinouts", segment="oem_hardware",
    brief=(
        "Current hardware, climate-tech and industrial-IoT accelerator cohorts and university spinout lists: HAX, Greentown Labs, Plug and Play, Techstars industrial and IoT programmes, "
        "university spinout and incubator lists. Early teams that need contract engineering before they can hire."),
    queries=(
        "HAX OR \"Greentown Labs\" OR \"Plug and Play\" OR Techstars cohort <year> hardware OR IoT OR industrial OR climate startups announced; "
        "\"spinout\" OR \"spin-out\" university hardware OR robotics OR sensor <year> seed; accelerator demo day hardware <year> companies list."),
    evidence_rules=(
        "- evidence_url is the cohort or spinout announcement naming the company. Open it. evidence_date is the announcement date when shown (cohorts within about 15 months).\n"
        "- trigger names the programme (for example \"joined the HAX 2026 hardware cohort\"). trigger_type is cohort.\n"
        "- The team must make a physical or industrial product and be early (under about 30 people). Verify the company's own website."),
    buyer_rules=(
        "Buyers are the early hardware, climate or industrial teams in the cohort with a founder or CTO. Skip the accelerators and investors themselves, software-only startups and companies past Series B."),
    offers=("hardware-rescue", "firmware-rescue", "board-to-fab", "design-review", "protocol-decode", "device-pentest", "sensing", "dashboards"),
    angle=("Reference the programme they joined and offer contract engineering capacity until they hire: bring-up, boards, firmware, an update path. "
           "Frame it as extending the team, not as fixing anything."),
    max_age_days=460, trigger_types=("cohort", "other"))

S11 = Strategy(
    id="s11_software", name="Software triggers", segment="smb_software",
    brief=(
        "Small and mid-sized businesses (about 10 to 300 people) whose operations run on people, spreadsheets and off-the-shelf tools, and that have just had "
        "an event which implies a software build. Four kinds, each within the last 120 days:\n"
        "1. FUNDING: raised a seed or Series A round and runs an operations-heavy model (logistics, field services, clinics, marketplaces, "
        "property, retail chains, light manufacturing, booking-based services), so internal tools must scale with the money.\n"
        "2. NEW LOCATIONS: opened new sites, branches, depots, clinics or stores (more locations mean scheduling, stock and reporting across sites).\n"
        "3. TOOLING SWITCH: says publicly it is moving off spreadsheets, replacing or migrating its ERP or CRM, or digitising its operations.\n"
        "4. OPS HIRE: publishes a job post for an internal-tools, operations-systems, business-systems or ops-automation role "
        "(the work exists now; a fixed-scope build delivers while they hire).\n"
        "The offer is software: an ops software build, dashboards, CRM, inventory, booking, mobile apps, an AI ops analyst, or a software penetration test."),
    queries=(
        "\"raises\" \"seed\" OR \"Series A\" logistics OR \"field service\" OR clinics OR marketplace OR \"multi-location\" <month> <year>; "
        "\"opens new location\" OR \"new branch\" OR \"new clinic\" OR \"new depot\" small business <month> <year>; "
        "\"moving off spreadsheets\" OR \"replaced our spreadsheets\" OR \"migrating to a new ERP\" OR \"new CRM\" company <year>; "
        "\"internal tools\" OR \"business systems\" OR \"operations systems\" engineer OR manager job <month> <year> -agency."),
    evidence_rules=(
        "- evidence_url is the announcement, press release, company blog post or job post that shows the event. Open it and read it.\n"
        "- evidence_date is the date of that page, YYYY-MM-DD, within the last 120 days. Always give it; undated pages do not count here.\n"
        "- trigger is one plain sentence naming what happened (for example \"opened two new clinics in Leeds in September 2026\"). "
        "trigger_type is funding, expansion (new locations), tooling_switch (off spreadsheets, ERP or CRM change) or ops_hire (internal-tools or ops-systems job post).\n"
        "- headcount: the company's size if a reliable page states it; it must be 300 or fewer.\n"
        "- The company must be the operating business itself, independent, and not a software vendor."),
    buyer_rules=(
        "Buyers are operating SMBs of roughly 10 to 300 people where a founder, COO, head of operations or CTO decides. Skip software agencies, "
        "development shops and consultancies (competitors), SaaS and software vendors (they build their own tools), companies over 300 staff, "
        "subsidiaries of listed groups, investors, recruiters and job boards."),
    offers=("ops-software-build", "dashboards", "crm", "inventory", "bookings", "mobile-apps", "ops-analyst", "quote-engine",
            "software-pentest", "authz-review"),
    angle=("Pitch at the event in the first sentence: \"with the new round...\", \"with the new locations...\", \"moving off the spreadsheets...\", "
           "\"I saw you are hiring for internal tools...\". Offer a fixed-scope build of the system the event calls for (one system the team actually uses), "
           "with concrete deliverables. For a job post, frame it as delivering while they hire, never as replacing the hire."),
    max_age_days=120, dated_types=("funding", "expansion", "tooling_switch", "ops_hire"),
    trigger_types=("funding", "expansion", "tooling_switch", "ops_hire"), max_headcount=300)

S12 = Strategy(
    id="s12_devpartner", name="Seeking a dev partner", segment="smb_software",
    brief=(
        "Public posts by a NAMED company asking for an outside agency, studio or contractor to build software, an IoT product or embedded firmware: "
        "\"looking for a development partner\", \"seeking an agency to build our app\", \"need a contractor for firmware\", \"partners wanted\" pages, "
        "LinkedIn-style posts by a founder or manager on behalf of the company, and forum or community posts that name the company. "
        "Posted in the last 90 days and still open."),
    queries=(
        "\"looking for a development partner\" OR \"looking for a dev agency\" OR \"seeking a software development partner\" <month> <year>; "
        "\"looking for an agency to build\" app OR platform OR dashboard <year>; \"need a contractor\" OR \"seeking a contractor\" firmware OR IoT OR embedded <year>; "
        "\"partners wanted\" OR \"become our development partner\" OR \"technology partner wanted\" company; site:linkedin.com/posts \"looking for\" \"development agency\"."),
    evidence_rules=(
        "- evidence_url is the post or page with the request. Open it. It must name the company (in the post, or the company the author posts for, or the page's own site) "
        "and the company's own website must exist.\n"
        "- evidence_quote is the sentence with the request. evidence_date is the posting date, YYYY-MM-DD, within the last 90 days. Undated posts do not count.\n"
        "- trigger names what they asked for (for example \"asked for an agency to build a field-service app, 2026-09-20\"). trigger_type is rfq.\n"
        "- Skip it if the post says the work is taken, closed or awarded."),
    buyer_rules=(
        "Buyers are the named companies (roughly 2 to 500 people) that posted the request, with a founder, product or engineering lead who decides. "
        "Skip anonymous posts, individuals with personal projects, recruiters and staffing agencies, job boards, freelance marketplaces (Upwork, Fiverr, Toptal), "
        "agencies looking for subcontractors, and public-sector buyers (tenders are handled elsewhere)."),
    offers=("ops-software-build", "mobile-apps", "dashboards", "crm", "inventory", "bookings", "marketplace", "ops-analyst",
            "firmware-rescue", "hardware-rescue", "protocol-decode", "board-to-fab"),
    angle=("Answer their public request directly: say you saw they are looking for a partner for the named work and offer a fixed-scope engagement for it, "
           "with the concrete deliverables of the focus offer. Short and specific; no sales language."),
    max_age_days=90, dated_types=("rfq",), trigger_types=("rfq",))

S13 = Strategy(
    id="s13_hn", name="Hacker News Seeking Freelancer", segment="smb_software",
    brief=(
        "The monthly Hacker News thread \"Ask HN: Freelancer? Seeker of freelancer?\". Code reads it through the official HN Algolia API and keeps the "
        "top-level comments that start with SEEKING FREELANCER and mention work Epsilon does (embedded, firmware, IoT, hardware, dashboards, apps, AI). "
        "Each one is a company asking in public for outside help, so the post itself is the evidence."),
    queries="(no web search: code reads the thread from https://hn.algolia.com/api/v1)",
    evidence_rules=(
        "- evidence_url is the HN comment; evidence_quote is the start of the comment; evidence_date is the comment date. Code sets all three.\n"
        "- The post must name a company, and that company's own website must be one of the domains code found in the post.\n"
        "- trigger_type is rfq."),
    buyer_rules=(
        "Buyers are named companies with their own website in an allowed market. Skip individuals with no company, recruiters, staffing firms, agencies looking "
        "for subcontractors, and posts that only link a job board or freelance marketplace."),
    offers=("ops-software-build", "dashboards", "mobile-apps", "ops-analyst", "crm", "firmware-rescue", "hardware-rescue",
            "protocol-decode", "board-to-fab", "sensing", "software-pentest"),
    angle=("Reply to their Seeking Freelancer post: say you saw their post in this month's Hacker News freelancer thread, name the work they asked for in a few words, "
           "and offer a fixed-scope engagement with concrete deliverables. Keep it peer-to-peer and short."),
    max_age_days=45, dated_types=("rfq",), trigger_types=("rfq",))

STRATEGIES = {s.id: s for s in (S2, S3, S4, S5, S7, S8, S9, S10, S11, S12, S13)}
ORDER = tuple(STRATEGIES)
assert ORDER == STRATEGY_IDS and all(STRATEGY_LABEL[i] == s.name for i, s in STRATEGIES.items())


def get(sid: str) -> Strategy:
    return STRATEGIES[sid]
