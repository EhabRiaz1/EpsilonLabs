"""Run SQL on the live Supabase project through the Management API (no MCP session to expire).

    .venv/bin/python scripts/sb_sql.py migrations/016_analytics_demo.sql     # a file
    .venv/bin/python scripts/sb_sql.py -c "select 1"                          # inline

The personal access token lives in the macOS keychain (service epsilon-os-supabase-pat); it is never printed.
A migration file's own begin/commit make it atomic: the API runs the whole text as one request.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

from core import config

REF = config.SUPABASE_URL.split("//", 1)[1].split(".", 1)[0]


def token() -> str:
    return subprocess.run(["security", "find-generic-password", "-s", "epsilon-os-supabase-pat", "-a", "management", "-w"],
                          capture_output=True, text=True, check=True).stdout.strip()


def query(sql: str) -> list:
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json",
                                          "User-Agent": "epsilon-os"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read() or b"[]")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode(errors='replace')[:2000]}")


if __name__ == "__main__":
    args = sys.argv[1:]
    sql = args[1] if args[:1] == ["-c"] else open(args[0]).read()
    print(json.dumps(query(sql), indent=1, default=str)[:20000])
