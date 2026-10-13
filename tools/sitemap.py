#!/usr/bin/env python3
"""
Write sitemap.xml and point robots.txt at it.

The domain itself lives in tools/scaffold.py as SITE — that is the single
place it is written down, and the scaffolder stamps absolute canonicals,
og:url and og:image from it. This just enumerates the pages.

    python3 tools/scaffold.py && python3 tools/sitemap.py
"""

import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 404 is deliberately absent: it must not be indexed.
EXCLUDE = {'404.html'}

PRIORITY = {
    '/': '1.0',
    '/work/': '0.9',
    '/work/efuelpro/': '0.9',
    '/hardware/': '0.8',
    '/software/': '0.8',
    '/contact/': '0.7',
}


def pages():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # only the site: not the OS, the platform app, design docs or agent worktrees
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'tools', 'node_modules', '.claude', '.vercel',
                                                        'epsilon-os', 'platform', 'docs')]
        for f in filenames:
            if not f.endswith('.html'):
                continue
            rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
            if rel in EXCLUDE:
                continue
            out.append(rel)
    return sorted(out)


def route(rel):
    return '/' + (rel[:-len('index.html')] if rel.endswith('index.html') else rel)


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from scaffold import SITE
    site = SITE.rstrip('/')

    today = datetime.date.today().isoformat()
    urls = []

    for rel in pages():
        path = os.path.join(ROOT, rel)
        html = open(path).read()
        url = site + route(rel)

        if url not in html:
            print(f'  warning: {rel} does not carry its own canonical — '
                  f'run tools/scaffold.py first')
        urls.append(url)

    body = '\n'.join(
        f'  <url><loc>{u}</loc><lastmod>{today}</lastmod>'
        f'<priority>{PRIORITY.get(u[len(site):], "0.6")}</priority></url>'
        for u in urls)

    with open(os.path.join(ROOT, 'sitemap.xml'), 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                f'{body}\n</urlset>\n')

    robots = os.path.join(ROOT, 'robots.txt')
    txt = open(robots).read() if os.path.exists(robots) else 'User-agent: *\nAllow: /\n'
    txt = re.sub(r'\nSitemap: .*\n?', '\n', txt).rstrip() + f'\n\nSitemap: {site}/sitemap.xml\n'
    open(robots, 'w').write(txt)

    print(f'{len(urls)} URLs written to sitemap.xml')
    print(f'domain: {site} (from tools/scaffold.py)')
    print('robots.txt now points at the sitemap')


if __name__ == '__main__':
    main()
