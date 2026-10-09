# Epsilon Labs

The lab's own site. Static HTML, one stylesheet, one WebGL scene, no build
step and no `node_modules`.

```bash
python3 tools/serve.py           # → http://localhost:8080
```

A server is required: the scene is an ES module and the glyph is read back
off a canvas, and browsers refuse both over `file://`. Opening `index.html`
directly still gives you the whole site — just without the field.

Use `tools/serve.py` rather than `python3 -m http.server`: the stock server
lets Chrome reuse a cached stylesheet while serving fresh HTML, so CSS edits
look like they are not applying.

Deploy the folder as-is to Netlify, Vercel, Cloudflare Pages, GitHub Pages
or any static host. There is nothing to build.

---

## The field

One WebGL scene renders exactly one object: the epsilon, held as 12–40k
points depending on the device. It morphs between four named states, and a
section opts into a state with `data-scene`:

| State | What it is | Colour |
|---|---|---|
| `epsilon` | The mark at hero scale | ink |
| `traces` | The Epsilon1 board — outline, mounting holes, module footprints, routing | copper |
| `lattice` | A volumetric graph: the software half | signal |
| `mark` | The mark, small, parked clear of the text column | muted |

```html
<body data-scene="epsilon">                  <!-- boot state -->
  <section class="sec sec--open" data-scene="traces">   <!-- on scroll -->
```

`sec--open` makes a section's background transparent so the field shows
through. Without it the section paints over the scene.

An `IntersectionObserver` follows whichever marked section is most visible.
Morphing is a GPU lerp between two position attributes driven by one
uniform — there is no per-frame CPU work over the point set, which is how
it holds 120fps while the page is also scrolling.

Two things make it behave like an object rather than a backdrop:

- **It arrives.** On load the mark assembles out of a scattered shell while
  the camera pushes in (`ENTRANCE`, ~2.3s). It plays once, and reduced
  motion skips it.
- **Scroll turns it.** A bounded sine (`SPIN_MAX`, ±22°) — never a term
  linear in `scrollY`, which accumulates until the mark stops reading as an
  epsilon by the foot of a long page.

`.sec--stage` makes a section full-height with its copy vertically centred:
a headline, one line and a link, with the field as the subject. Use it when
the page should slow down; use a normal `.sec` when it has something to say.

**The mark is not a font.** `assets/brand/epsilon.svg` is traced from
`assets/brand/epsilon-raster.png`, which is the 120px epsilon embedded in
the Epsilon1 firmware (`src/StartupLogoPng.h`) — the one that lights up on
the terminal at boot. `tools/trace_logo.py` regenerates it.

### It degrades on purpose

| Condition | Behaviour |
|---|---|
| No WebGL | Canvas removed, `.no-webgl` set on `<html>`, scrim hidden. Site reads in full. |
| `prefers-reduced-motion` | One static frame per state. No animation loop. State still follows scroll. |
| No JavaScript | Everything is in the HTML. `.no-js .reveal` keeps content visible. |
| Phone / coarse pointer | 12k points, flat scrim instead of a directional one. |
| Tab hidden | Loop stops. |

---

## The catalogue

`tools/offers.py` is the single source of truth for everything the lab sells.
One entry per offer — price, duration, deliverables, process, who it is for,
**who it is not for**, what moves the price above the floor, proof and FAQ.

Everything downstream is derived from it, so a price can only ever be changed
in one place:

| Derived | By |
|---|---|
| `/services/*/` and `/products/*/` pages | `tools/render.py` via `scaffold.py` |
| `/catalogue/` | `render.catalogue_body()` |
| The home-page teaser and mosaic | `render.home_offers()`, `render.mosaic()` |
| `llms.txt`, `index.md` twins, `catalogue.json` | `tools/agent.py` |
| JSON-LD `Service` / `Offer` / `FAQPage` | `tools/jsonld.py` |

```bash
python3 tools/scaffold.py && python3 tools/agent.py && python3 tools/sitemap.py
python3 tools/consistency.py
```

### Prices are not published

`SHOW_PRICES = False` in `tools/offers.py` is the switch. Every band still
lives in that file — a quote gets built from it — but nothing on the site
prints a number: offer pages, the catalogue, the mega menu, `llms.txt`,
`catalogue.json` and the JSON-LD all say the work is scoped and quoted after
a call. Flip it to `True` and the published bands come back everywhere at
once. `price_label()` and `price_note()` are the only two functions that
decide what a price reads as; nothing else formats one.

The honest trade: an assistant asked "who can review a PCB for under $2,000"
can no longer match us on a number, and a buyer cannot self-qualify on price
before writing. That is the cost of quoting by hand, and it is deliberate.

### Solutions — what we build, by category

`tools/categories.py` is the second source of truth: 33 solution categories
(CRM, ERP, macOS apps, CLI tools, AI agents, mill automation, factory
automation, PCB design…) in four groups per area. Each entry carries what we
build, example builds, fit, stack, a typical starting price, the offers it
leads into, and — only where the work is real — a proof link.
`tools/render_cats.py` turns it into `/software/<slug>/` and
`/hardware/<slug>/`, the Software and Hardware index grids, the home page's
"What we build" block and the Software/Hardware mega-menu columns;
`agent.py` lists every category in `llms.txt` and under `solutions` in
`catalogue.json`. Example builds are labelled on the page as range, not a
client list. `python3 tools/categories.py` validates slugs and references.

Adding an offer is a data change. Every offer page renders the same eight
blocks in the same order — a consistent shape is what makes a page skimmable
by a buyer and extractable by a machine.

### The home page layout (after anduril.com)

The home page follows anduril.com's structure, not its brand: a 72px nav
(wordmark · six links centred · Start a project + Company ⊕). Hovering Software or Hardware drops a full-width panel of that area's solution categories; Frontier and Security list their offers — all with prices, rendered from `MEGA` in `tools/render.py`; ↓ on a category moves focus into its panel. The field does not react to the cursor — that was removed on request; the hero as a
framed panel with 32px black gutters and a condensed uppercase title card
over it; a "What we build" index of every category; a problem finder; a grey
feature band; a cream proof section with one story; two colour half-panels; a black footer with columns
from the midline.

Where their panels hold video, ours are **windows onto the one WebGL
scene**. `.win` is a transparent frame that paints a 100vmax box-shadow in its
section's colour, so the fixed canvas shows through the frame and nowhere
else — the hero frame shows the ε, the Epsilon1 band shows the same field
morphed into the board. `body[data-layout="panel"]` (home only) centres the
object and drops the side scrim. The interactive demos now live on the
offer pages only; the home page no longer showcases past products.

### Interactive demos, the suite and the twin

`assets/js/demos.js` holds eight working mini-products, each mounted into an
element with `data-demo`: `dashboard` (sales and admin), `inventory`, `crm`
(drag-and-drop pipeline), `market` (buyer / seller / admin — the role switch
is the point), `bookings`, `quote`, `analyst` (proposes, waits for approval)
and `ledger`. `assets/js/twin.js` is the ninth: the eFuelPro station twin,
ported from the React Three Fiber original (`Desktop/ε/modbus/dashboard-
frontend/src/components/IsometricStation.js`) to plain Three.js, same
dimensions, restyled, with simulated data.

Which offer each demo sells lives in `DEMO_FOR` in `tools/offers.py`. An offer
with a demo shows it on its own page automatically.

Markers expanded by `scaffold.py` inside a page body:

```html
<!--SUITE:dashboards,inventory,crm-->    every product in one tabbed window
<!--DEMO:twin-->                         a demo on its own, full width
<!--SHOW:quote-engine:quote::Kicker-->     a demo beside its offer
<!--FINDER-->  <!--FINDER:software-->     the problem finder
```

The suite mounts only the open tab's demo; the rest build the first time
their tab is opened. Ticking demos and the twin render only while on screen.
Every demo carries a **Demo data** badge, and it stays — without it an
illustrative figure reads as a claim about a real client. Numbers inside a
demo still have to reconcile (the dashboard's "All" is the exact sum of its
regions): engineers add things up.

### Persuasion, and where it stops

The site is built to move a visitor toward buying, deliberately: problems in
the buyer's own words (people recognise their problem long before a service
name), a small-step commitment ladder (pick a problem → see the fix and its
real price → start with an email that already names what you picked), real
prices anchored against each other, products you can touch before you ask
for anything, and one obvious next action at every step.

It does **not** use fake countdown timers, fabricated "N people viewing"
counts, invented scarcity, confirmshaming, or testimonials that did not
happen. The buyers are engineers who spot these at once, the blind tests go
straight for anything unverifiable, and fake timers and fake scarcity are
unlawful under UK CMA and EU consumer rules. Keep it that way.

### The security offers have a hard boundary

`device-pentest` and `authz-review` are scoped narrowly on purpose, and the
scope is a constraint rather than modesty. Epsilon Labs holds **no security
accreditation** — no CREST, OSCP or CEH, no published CVEs, no prior paid
security engagement. What it holds is hardware engineering, which is what a
device assessment actually consists of.

So both pages must keep saying, in the copy and not just in a footnote:

- **Written authorisation is required before anything starts**, every time,
  and we decline without it.
- **We are not an accredited firm.** For PCI, SOC 2, FedRAMP or CE/UKCA
  sign-off the buyer needs someone who is, and we say so.
- **No generic web-application or corporate-network testing.** That market is
  certification-gated and we have no track record in it.

Do not widen these offers to "penetration testing" in general. On a site
whose whole thesis is verifiable accuracy, an unevidenced credential claim is
the one thing that unravels the rest — and the blind test goes straight for
it.

### The agent layer, honestly

`llms.txt`, the markdown twins and the JSON-LD are **hygiene, not a growth
channel.** Google has said structured data is not required for AI Overviews
and has explicitly called `llms.txt` unnecessary; a May 2026 study found
JSON-LD did not measurably move AI citations. Ship it — Lighthouse audits for
it, coding agents consume it, and it costs an hour — but do not expect it to
sell anything on its own.

What actually gets the lab recommended is the catalogue itself: named offers
with published prices, written scope and an explicit anti-fit. An assistant
returns one to three options, not ten links, and it cannot match a budget to
a page with no number on it.

**These pages were blind-tested** by handing `llms.txt` and two offer twins to
a model with no other context and asking what Epsilon Labs sells, what it
costs, and who it is not for. That test caught three real contradictions —
a refund promise stated two incompatible ways, a bundle priced below the part
it contains, and an index line that hid eFuelPro's monthly. Re-run it after
any substantial change to the offers.

### Surfaces — a page is not one long black scroll

`.sec--paper`, `.sec--stone`, `.sec--ore` and `.sec--slate` give a section its
own ground. They work by **rebinding tokens**, not by restyling components:
each one sets `--ink`, `--muted`, `--rule`, `--void`, `--copper` and
`--signal` for its subtree, so every check list, tag, rule, label, note and
button inside adapts on its own. Adding a component needs no surface-specific
CSS; using a raw colour instead of a token is what breaks it.

Every pairing is measured and passes WCAG AA — the numbers are in the accent
block at the top of `site.css` (lowest is 4.50:1). `TIER_SKIN` in
`render.py` gives each shelf its closing colour, `SURFACES` in
`render_cats.py` alternates the four groups on an area index, and category
pages end on their area's colour: slate for software, ore for hardware.

### Rows and rails, not a wall of boxes

Lists are laid out one of two ways, and neither is a grid of cards:

- **Rows** (`.rowlist` / `.row`) run down the page — hairline, name at
  reading size, the line that explains it, an arrow. The names line up so the
  eye can run down them, and the page keeps one frame instead of seventeen.
  Used for the solutions on an area index, the four groups on the home page,
  and the problem finder.
- **Rails** (`.railwrap` / `.rail`) run across it — equal panels on a
  scroll-snapping track, for a set worth browsing rather than reading in
  order. Used for a category's examples and for the siblings at the foot of
  a category page. They are plain scroll containers: no carousel, no timers,
  no hijacked wheel. Script only toggles `is-scrollable`, so the "scroll
  sideways" hint appears when the track really is wider than its window.

The retired `.cgrid`/`.ccard`/`.xgrid`/`.xcard`/`.hgroup` rules are gone with
them — about 2.8KB of CSS. The home mosaic stays: those tiles are live demos,
not cards of text.

### The nav rides with you

`position: fixed`, transparent over the top of a page, solid with a blur
once you have left it, and `translateY(-100%)` the moment you scroll down.
The first upward scroll brings it back, so reaching the menu never means
scrolling to the top of the document. It refuses to hide while a menu is
open, within the first 144px, over the elastic overscroll at either end, or
under 6px of trackpad jitter; `focusin` brings it back for keyboard users,
and `prefers-reduced-motion` keeps it still.

### How much of the catalogue the nav shows

The menu lists the four **groups** in a practice, each with its line and the
three things people ask for most, then `+ n more` into the index. Putting all
thirty-three names in a dropdown was thirty-three niche terms to read
standing up. Names are plain for the same reason: Operator screens, not
HMI & SCADA; Machine monitoring, not Industrial IoT & telemetry; Reading
documents, not Document & data extraction. Slugs and URLs did not move — only
what a person reads.

### Product-page slices (after anduril.com)

Anduril builds a product page out of a fixed sequence of slices — big-type
header, notched spec card, numbered stepper of build qualities, an
interactive band, a closing statement. Ours runs the same grammar with our
own content, in the same order on every category and offer page, so two
pages are comparable and a machine can read either:

| Slice | What it is here |
|---|---|
| Header | Name at full size, a bracketed `[SW · CRM]` code, tagline, summary |
| `speccard` | The terms as a datasheet: built with, a first step, what you own, where it runs, scoping — ending in **Contact sales** |
| `stepper` | `builds` one at a time: tab title, `03 / 06`, a huge numeral, the sentence |
| `iband` | Where a demo honestly fits, the demo itself under giant type. Their band advertises an interactive view; ours *is* one |
| Examples / fit / a smaller way to start / proof | As before |
| Closing | The area's colour, one action |

`builds` in `categories.py` is therefore `(title, detail)` pairs — the title
is the tab, the detail is the panel. The kicker above a panel sentence is
dropped automatically when the sentence already opens with the title, so a
panel never says the same thing twice. The stepper follows the ARIA tab
pattern (arrows move and activate, Home/End jump, roving `tabindex`), and
with JavaScript off every panel is visible and the tab row is hidden — the
page becomes the list it used to be.

`.notch` is the one borrowed shape: a single cut corner, `clip-path`, 28px
(36px from 900px up).

### The boot curtain

The loading screen and the background are the same object. On the home page
only, `<html>` carries `data-boot="1"`; an inline script in `chrome.html`
adds `.booting` before the first paint, which blacks out the chrome and stops
the hero frame masking the field, so the ε assembles full-bleed with a
wordmark and a filling hairline. `scene.js` fires `epsilon:ready` at 62% of
the entrance; the class flips to `.booted`, the chrome fades up and the
frame's 100vmax shadow animates back in — the field settling into the panel
it stays in. One object, two jobs, no second animation.

It gets out of the way at every opportunity: `prefers-reduced-motion`, a
missing WebGL context, a glyph that never loads, a 4-second failsafe, and
`sessionStorage` so it plays once per tab rather than on every visit home.

## Layout

```
index.html  hardware/  software/  work/  about/  contact/  404.html
assets/
  css/site.css        every token, every rule — one file
  js/scene.js         the field: states, morph shader, choreography
  js/site.js          nav, menu, reveals, intake, problem finder
  js/demos.js         eight interactive product demos + the tabbed suite
  js/twin.js          the station digital twin (module)
  js/states/          epsilon.js · traces.js · lattice.js
  js/lib/rng.js       deterministic PRNG, so the field is identical every load
  vendor/             three.module.min.js
  brand/              epsilon.svg, favicon.svg, og.png, epsilon-raster.png
llms.txt  catalogue.json  _headers  vercel.json
tools/
  offers.py           the catalogue — single source of truth
  categories.py       the 33 solution categories — second source of truth
  render.py           offer pages, catalogue, home teaser, mega menu
  render_cats.py      category pages, area indexes, home "What we build"
  agent.py            llms.txt, markdown twins, catalogue.json
  jsonld.py           structured data
  scaffold.py         stamps chrome onto every page
  consistency.py      guards against drift
  sitemap.py          sitemap.xml + robots
  serve.py            no-cache dev server
```

### Editing a page

Page bodies live in `tools/content/`, the shared chrome in
`tools/chrome.html`. Edit one, then:

```bash
python3 tools/scaffold.py            # all pages
python3 tools/scaffold.py work/      # just one subtree
python3 tools/consistency.py         # verify nothing drifted
```

This is a **scaffolder, not a build step**. The HTML it writes is the
deployed artifact and is committed; nothing at runtime needs Python. You can
hand-edit a page directly — `consistency.py` is what catches it when a
hand-edit leaves the other eleven pages behind.

`consistency.py` checks that every page has a complete head, exactly one
`<h1>`, a known `data-scene`, identical nav/menu/footer, links that resolve
on disk, and no raw hex colours in `style` attributes.

The domain lives in one place: `SITE` in `tools/scaffold.py`. Change it there
and re-run `scaffold.py` then `sitemap.py`.

### Design tokens

All of them are at the top of `assets/css/site.css`. Contrast against the
canvas `#08090A`, computed rather than eyeballed:

| Token | Ratio | |
|---|---|---|
| `--ink` `#EDF0F1` | 17.40:1 | AAA |
| `--signal` `#5FC6D6` | 9.99:1 | AAA |
| `--muted` `#8A949B` | 6.45:1 | AA |
| `--copper` `#D2793C` | 6.21:1 | AA |

Re-run the numbers if you change any of them. Spacing comes from
`--s-4 … --s-192`, type from `--t-12 … --t-104`. Two typefaces, no more:
Instrument Sans and IBM Plex Mono.

---

## Before launch

1. **Client logos.** `assets/clients/` is empty and the client wall falls
   back to names set in the house type, which reads correctly — it is not a
   row of broken images. Drop SVGs in and swap the `<b>` for `<img>`.

2. **Photographs of the Epsilon1 terminal** — the bare board, and one
   installed at a pump. This is the highest-value asset the site is still
   missing; the hardware pages currently argue in words what a photograph
   would settle instantly.

3. **Confirm the facts** on `/work/` for **Total Parco**, **YS Intelligence**
   and **YS Technologies**. Those three are still one-line placeholders —
   nothing describing them was on the machine this site was built from.
   Everything else on the site traces to a repo, a BOM, a protocol capture
   or `Desktop/ResumeMER/ehab-riaz-resume.html`.
