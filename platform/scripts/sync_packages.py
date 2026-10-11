#!/usr/bin/env python3
"""Writes platform/lib/packages.json: the packages a proposal may use, with their catalogue prices.

The public catalogue.json says "pricing: on request", so the prices come from its source, tools/offers.py
(price_from, currency, price_note). Only offers listed in catalogue.json are included. Proposal lines copy
`price_from` as the unit price; the admin cannot type a price.

Run after editing tools/offers.py:  python3 platform/scripts/sync_packages.py
epsilon-os/tests/test_platform_packages.py fails while this file is stale.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "platform" / "lib" / "packages.json"


def build() -> list[dict]:
    sys.path.insert(0, str(ROOT / "tools"))
    from offers import OFFERS  # noqa: E402

    catalogue = {o["slug"]: o for o in json.loads((ROOT / "catalogue.json").read_text())["offers"]}
    out = []
    for o in OFFERS:
        c = catalogue.get(o["slug"])
        if c is None or not isinstance(o.get("price_from"), (int, float)) or o["price_from"] <= 0:
            continue
        out.append({
            "slug": o["slug"],
            "name": c["name"],
            "category": c["category"],
            "price_from": o["price_from"],
            "currency": o.get("currency", "USD"),
            "price_note": o.get("price_note", ""),
            "duration": c.get("duration", ""),
        })
    return out


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
    print(f"wrote {OUT.relative_to(ROOT)} ({len(build())} packages)")
