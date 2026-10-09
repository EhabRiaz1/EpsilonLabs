#!/usr/bin/env python3
"""
Dev server. Use this rather than `python3 -m http.server`.

    python3 tools/serve.py          # → http://localhost:8080
    python3 tools/serve.py 9000

The stock server sends Last-Modified and nothing else, which lets Chrome
reuse a cached stylesheet while serving fresh HTML — CSS edits then appear
not to apply and you go hunting for a bug that is not there. This sends
no-store on everything.
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    # Python maps .md to application/octet-stream, which makes a browser
    # download the markdown twins instead of showing them — and the llms.txt
    # convention expects text/markdown. Mirror what production serves.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.md': 'text/markdown; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else ''
        if code and not str(code).startswith('2'):
            sys.stderr.write(f'  {args[0]} -> {code}\n')


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCache, directory=ROOT)
    print(f'serving {ROOT}\n  http://localhost:{port}/   (no-store)')
    try:
        http.server.HTTPServer(('127.0.0.1', port), handler).serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    main()
