#!/usr/bin/env python3
"""Generate a portal theme stylesheet from the approved design mockups, scoped to one site.

    python3 platform/scripts/build-theme.py admin  ~/.gstack/projects/epsilon-labs/designs/admin-v3-20261015/round3
    python3 platform/scripts/build-theme.py client ~/.gstack/projects/epsilon-labs/designs/admin-v3-20261015/client

Writes platform/app/styles/<site>-theme.css (or --out PATH). Do not hand-edit the output: change the mockups (or
the small blocks below) and regenerate. Hand-written page rules live in admin-pages*.css / client-pages.css.

How the scoping works
---------------------
The root layout's THEME_BOOT script sets <html data-site="admin|client"> from the hostname before first paint, and
<html data-theme="light|dark">. Every rule here is rewritten under that attribute so the two portals never leak
into each other:

  both  -> :root[data-site="<site>"] <selector>                          (structure, both modes)
  light -> :root[data-site="<site>"]:not([data-theme="dark"]) <selector> (theme-t1.css, "brand light")
  dark  -> :root[data-site="<site>"][data-theme="dark"] <selector>       (theme-t2.css, "brand dark")
  late  -> :root:root[data-site="<site>"] <selector>                     (client only: client-t.css + INK)

"late" exists because the light/dark prefixes carry one extra attribute of specificity, so a later "both" rule
could never override them. The mockups load client-t.css after the theme files; the doubled :root gives late
rules the same specificity as light/dark ones, and being later in the file, they win, exactly as in the mockup.

Inputs (all from <source_dir>; system.css is the shared base and is never edited)
  admin : overrides-v2.css, today-t1.html <style>, pages-t.css, theme-t1.css, theme-t2.css
  client: overrides-v2.css, brand.css, theme-t1.css, theme-t2.css, client-t.css
Fonts are self-hosted (repo assets/fonts/fonts.css, copied to app/styles/fonts/); the mockups' Google Fonts
@import is dropped, and the brand mark's inline data-URI mask is replaced by ./epsilon.svg.
"""
import argparse
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
STYLES = REPO / "platform/app/styles"


def scope_sel(s, mode, site):
    s = s.strip()
    root = f':root[data-site="{site}"]'
    base = {
        "both": root,
        "light": root + ':not([data-theme="dark"])',
        "dark": root + '[data-theme="dark"]',
        "late": ":root" + root,
    }[mode]
    m = re.match(r'^(:root|html)\b(.*)$', s)
    if m:
        return base + m.group(2)
    m = re.match(r'^((?:\[data-(?:theme|accent)[^\]]*\])+)(.*)$', s)
    if m:
        attrs = m.group(1)
        if mode in ("light", "dark"):
            attrs = re.sub(r'\[data-theme[^\]]*\]', '', attrs)  # the mode prefix already decides
        return base + attrs + m.group(2)
    return base + " " + s


def scope(css, mode, site):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    css = re.sub(r'@import\s+url\([^)]*\)[^;]*;', '', css)

    def block(text):
        res, j = [], 0
        while j < len(text):
            k = text.find('{', j)
            if k < 0:
                break
            head = text[j:k].strip()
            depth, e = 1, k + 1
            while depth and e < len(text):
                depth += {'{': 1, '}': -1}.get(text[e], 0)
                e += 1
            body = text[k + 1:e - 1]
            if head.startswith('@media') or head.startswith('@supports'):
                res.append(f"{head} {{\n{block(body)}\n}}")
            elif head.startswith('@keyframes') or head.startswith('@font-face'):
                res.append(f"{head} {{{body}}}")
            elif head:
                sels = [scope_sel(x, mode, site) for x in head.split(',') if x.strip()]
                seen = []
                for x in sels:
                    if x not in seen:
                        seen.append(x)
                res.append(f"{', '.join(seen)} {{{body.strip()}}}")
            j = e
        return "\n".join(res)

    return block(css)


# the website's mark (epsilon.svg, as in site.css) instead of the mockups' inline data URI
BRAND = """
/* brand: the website's mark (epsilon.svg, as in site.css) + the nav wordmark */
.brand-mark { display: block; width: auto; height: 20px; aspect-ratio: 73 / 100; flex: none; color: var(--ink); background: currentColor; }
@supports (mask-image: url("#m")) or (-webkit-mask-image: url("#m")) {
  .brand-mark { -webkit-mask: url("./epsilon.svg") center / contain no-repeat; mask: url("./epsilon.svg") center / contain no-repeat; }
}
@supports not ((mask-image: url("#m")) or (-webkit-mask-image: url("#m"))) {
  .brand-mark { background: none; width: auto; }
  .brand-mark::before { content: "\\03B5"; font-size: 1.25em; line-height: 0.8; }
}
"""

# client only, after client-t.css: ink is the action colour everywhere (client-t.css covers .btn-primary);
# copper stays for "waiting on you" (.pill-acc, .needs-c .tag, the Needs you column, hot counts, the bell ping).
INK = """
.input:focus, .textarea:focus, .select:focus { box-shadow: 0 0 0 2px var(--ink), var(--shadow-sm); }
.otp input:focus { box-shadow: 0 0 0 2px var(--ink), var(--shadow-sm); }
.check input, input[type="radio"], input[type="checkbox"] { accent-color: var(--ink); }
.tl li[data-kind="client"] .tl-dot { background: var(--ink); }
.c-accent, .tl-pill.client { color: var(--ink); }
.drop:hover, .drop[data-over] { border-color: var(--ink); background: var(--surface-2); }
.drop:focus-within { box-shadow: 0 0 0 2px var(--ink); }
.link-btn { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.btn-soft { background: var(--surface-3); color: var(--ink); }
.btn-soft:hover { background: color-mix(in srgb, var(--ink) 10%, var(--surface-3)); }
.btn-primary .i, .btn-primary > i { color: inherit; }
.pill .dot.live, .dot.live { background: currentColor; }
.tab:focus-visible, .btn:focus-visible, .nav-item:focus-visible, .rowx:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.seg button[aria-pressed="true"] { box-shadow: inset 0 0 0 1px var(--line), var(--shadow-sm); }
"""

HEADERS = {
    "admin": (
        "/* Admin theme (design review 2026-10-15, D11/D13): the website's identity on the V2 'Linear-light' structure.\n"
        "   Generated from the approved mockups in ~/.gstack/projects/epsilon-labs/designs/admin-v3-20261015/round3/\n"
        "   (overrides-v2.css, today-t*.html, pages-t.css, theme-t1.css, theme-t2.css). Every rule is scoped to\n"
        "   :root[data-site=\"admin\"] so the client portal keeps the approved v2 system. Light = T1 brand light,\n"
        "   dark = T2 brand dark. system.css is not edited. */\n"
    ),
    "client": (
        "/* Client portal theme (design review 2026-10-16): the admin brand theme (website identity, Instrument Sans +\n"
        "   IBM Plex Mono, paper/ink light, void dark) with the client mockups' components. GENERATED by\n"
        "   platform/scripts/build-theme.py from ~/.gstack/projects/epsilon-labs/designs/admin-v3-20261015/client/\n"
        "   (overrides-v2.css, brand.css, theme-t1.css, theme-t2.css, client-t.css) plus the script's INK block; do not\n"
        "   edit by hand. Every rule is scoped to :root[data-site=\"client\"]. Buttons are ink (black in light, white in\n"
        "   dark); copper only marks \"waiting on you\". Hand-written page rules live in client-pages.css. */\n"
    ),
}


def build(site, src):
    fonts = (REPO / "assets/fonts/fonts.css").read_text().replace("url(/assets/fonts/", "url(./fonts/")
    if site == "admin":
        today = (src / "today-t1.html").read_text()
        inline = re.search(r'<style>(.*?)</style>', today, re.S).group(1)
        inline = re.sub(r'@supports \(mask-image.*?\n  \}\n', '', inline, flags=re.S)  # data-URI mask: BRAND
        parts = [
            HEADERS[site],
            fonts,
            "/* ---- structure + material (both modes) ---- */",
            scope((src / "overrides-v2.css").read_text(), "both", site),
            "/* ---- page components from the mockups (both modes) ---- */",
            scope(inline, "both", site),
            scope(BRAND, "both", site),
            scope((src / "pages-t.css").read_text(), "both", site),
            "/* ---- T1 brand light ---- */",
            scope((src / "theme-t1.css").read_text(), "light", site),
            "/* ---- T2 brand dark ---- */",
            scope((src / "theme-t2.css").read_text(), "dark", site),
        ]
    else:
        brand = (src / "brand.css").read_text()
        brand = re.sub(r'@supports \(mask-image.*?\n  \}\n', '', brand, flags=re.S)  # data-URI mask: BRAND
        parts = [
            HEADERS[site],
            fonts,
            "/* ---- brand lockup + sidebar extras (brand.css, both modes) ---- */",
            scope(brand, "both", site),
            scope(BRAND, "both", site),
            "/* ---- structure + material (overrides-v2.css, both modes) ---- */",
            scope((src / "overrides-v2.css").read_text(), "both", site),
            "/* ---- T1 brand light ---- */",
            scope((src / "theme-t1.css").read_text(), "light", site),
            "/* ---- T2 brand dark ---- */",
            scope((src / "theme-t2.css").read_text(), "dark", site),
            "/* ---- client components (client-t.css), after the themes as in the mockups ---- */",
            scope((src / "client-t.css").read_text(), "late", site),
            "/* ---- ink is the action colour (build-theme.py INK) ---- */",
            scope(INK, "late", site),
        ]
    return "\n\n".join(parts) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("site", choices=["admin", "client"])
    ap.add_argument("source_dir", type=pathlib.Path, help="the approved mockup folder")
    ap.add_argument("--out", type=pathlib.Path, help="default: platform/app/styles/<site>-theme.css")
    a = ap.parse_args()
    out = a.out or STYLES / f"{a.site}-theme.css"
    out.write_text(build(a.site, a.source_dir.expanduser()))
    print(out, len(out.read_text().splitlines()), "lines")


if __name__ == "__main__":
    main()
