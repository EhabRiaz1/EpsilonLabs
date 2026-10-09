#!/usr/bin/env python3
"""
Guard against the drift that duplicated chrome invites.

Every page carries its own copy of the head, the nav, the mobile menu and
the footer — that keeps first paint instant and the HTML crawlable, but it
means a hand-edit to one page can silently leave eleven others behind. This
checks that they still agree, and that a few house rules hold.

    python3 tools/consistency.py

Exit code 0 when clean, 1 when something drifted. No dependencies.
"""

import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCENES = {'epsilon', 'traces', 'lattice', 'mark'}

REQUIRED_HEAD = [
    ('charset',      r'<meta charset="utf-8">'),
    ('viewport',     r'<meta name="viewport"'),
    ('title',        r'<title>[^<]+</title>'),
    ('description',  r'<meta name="description" content="[^"]{40,}"'),
    ('theme-color',  r'<meta name="theme-color" content="#08090A">'),
    ('favicon',      r'<link rel="icon" href="/assets/brand/favicon.svg"'),
    ('canonical',    r'<link rel="canonical" href="https?://[^"]+">'),
    ('og:title',     r'<meta property="og:title"'),
    ('og:image',     r'<meta property="og:image" content="https?://[^"]+/assets/brand/og\.png">'),
    ('og:url',       r'<meta property="og:url" content="https?://[^"]+">'),
    ('stylesheet',   r'<link rel="stylesheet" href="/assets/css/site.css">'),
    ('site.js',      r'<script src="/assets/js/site\.js" defer></script>'),
    ('scene.js',     r'<script type="module" src="/assets/js/scene\.js"></script>'),
    ('skip link',    r'<a class="skip" href="#main">'),
    ('canvas',       r'<canvas id="scene" aria-hidden="true"></canvas>'),
    ('scrim',        r'<div class="scrim" aria-hidden="true"></div>'),
    ('main id',      r'<main class="page" id="main">'),
]

# Colours are policed only inside style="..." attributes. A client's brand
# hex quoted in a spec table is content, not a styling decision.
STYLE_ATTR = re.compile(r'style="([^"]*)"')
HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')


def pages():
    found = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'tools', 'node_modules')]
        for f in filenames:
            if f.endswith('.html'):
                found.append(os.path.relpath(os.path.join(dirpath, f), ROOT))
    return sorted(found)


def block(html, start, end):
    """Pull a chunk out of a page so it can be compared across pages."""
    i = html.find(start)
    if i < 0:
        return None
    j = html.find(end, i)
    if j < 0:
        return None
    return html[i:j + len(end)]


def main():
    problems = []
    files = pages()
    if not files:
        sys.exit('no pages found')

    docs = {p: open(os.path.join(ROOT, p)).read() for p in files}

    # ── head and structure ──────────────────────────────────────────────
    for p, html in docs.items():
        for label, pattern in REQUIRED_HEAD:
            if not re.search(pattern, html):
                problems.append(f'{p}: missing {label}')

        m = re.search(r'<body data-scene="([^"]*)"', html)
        if not m:
            problems.append(f'{p}: <body> has no data-scene')
        elif m.group(1) not in SCENES:
            problems.append(f'{p}: boot scene "{m.group(1)}" is not one of {sorted(SCENES)}')

        for scene in re.findall(r'data-scene="([^"]+)"', html):
            if scene not in SCENES:
                problems.append(f'{p}: unknown data-scene="{scene}"')

        if html.count('<h1') != 1:
            problems.append(f'{p}: expected exactly one <h1>, found {html.count("<h1")}')

        for style in STYLE_ATTR.findall(html):
            for hexcode in set(HEX.findall(style)):
                problems.append(f'{p}: raw colour {hexcode} in a style attribute — use a token')

    # ── shared chrome ───────────────────────────────────────────────────
    regions = {
        'nav':    ('<header class="nav" id="nav">', '</header>'),
        'menu':   ('<nav class="menu" id="menu"', '</nav>'),
        'footer': ('<footer class="foot">', '</footer>'),
    }
    for name, (start, end) in regions.items():
        shapes = defaultdict(list)
        for p, html in docs.items():
            b = block(html, start, end)
            if b is None:
                problems.append(f'{p}: no {name} block')
                continue
            # aria-current legitimately differs per page
            shapes[re.sub(r' aria-current="page"', '', b)].append(p)
        if len(shapes) > 1:
            groups = sorted(shapes.values(), key=len, reverse=True)
            odd = [p for g in groups[1:] for p in g]
            problems.append(
                f'{name} differs across pages — {len(groups)} variants; '
                f'odd ones out: {", ".join(sorted(odd))}')

    # ── links resolve on disk ───────────────────────────────────────────
    for p, html in docs.items():
        for href in set(re.findall(r'href="(/[^"#?]*)"', html)):
            target = href.lstrip('/')
            candidates = [target, os.path.join(target, 'index.html')]
            if not any(os.path.exists(os.path.join(ROOT, c)) for c in candidates if c):
                if href != '/':
                    problems.append(f'{p}: href="{href}" does not resolve on disk')

    # ── report ──────────────────────────────────────────────────────────
    print(f'checked {len(files)} pages')
    if problems:
        print(f'\n{len(problems)} problem(s):\n')
        for x in problems:
            print('  ' + x)
        return 1
    print('clean — chrome in sync, heads complete, links resolve, no raw colours')
    return 0


if __name__ == '__main__':
    sys.exit(main())
