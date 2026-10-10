"""Official open feeds for public tenders (strategy S1). One module per source, each with
`fetch(since: date) -> list[Opp]`. Deterministic HTTP only; no model is involved in finding notices.

`collect` runs the enabled feeds and isolates failures: one broken feed is reported and never stops the others.
"""
import importlib
import sys
from datetime import date

# Working feeds first, then the ones that ship disabled (see each module's docstring for why).
LIVE = ("ted", "uk_fts", "uk_cf", "canadabuys", "austender", "ungm", "samgov", "worldbank", "ebrd")
DISABLED = ("adb", "afdb", "isdb", "aiib", "etimad", "dubai", "monaqasat", "oman", "bahrain", "kuwait")
SOURCES = LIVE + DISABLED


def module(source: str):
    if source not in SOURCES:
        raise KeyError(source)
    return importlib.import_module(f"core.feeds.{source}")


def collect(sources, since: date, fetchers: dict | None = None) -> tuple[list, dict]:
    """Run each enabled feed. Returns (opps, report) with report[source] = {"ok": bool, "n": int, "error": str}.

    `fetchers` maps source -> callable(since) and exists so tests can swap feeds without network.
    """
    from core.feeds import base
    opps, report = [], {}
    for s in sources:
        try:
            fn = (fetchers or {}).get(s) or module(s).fetch
            got = fn(since)
            opps.extend(got)
            report[s] = {"ok": True, "n": len(got), "error": ""}
        except Exception as e:  # any one feed may fail for any reason; never raise out of here
            msg = str(e)[:160] if isinstance(e, base.FeedError) else type(e).__name__
            off = isinstance(e, base.Disabled)
            report[s] = {"ok": False, "n": 0, "error": msg, "disabled": off}
            if not off:
                print(f"tenders: feed {s} failed ({msg})", file=sys.stderr)
    return opps, report
