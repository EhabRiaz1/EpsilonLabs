"""Deterministic relevance, deadline and value filters for tender notices. No model involved.

A notice is a candidate only with at least one keyword hit: CPV 72/48/... covers every kind of IT and
equipment purchase (most of which is not our work), so a code match alone is not enough. A CPV/NAICS match
adds one point to the rank, so among equal keyword scores the right class of notice goes first. The agent
sends only the top N a day to the model.
"""
import re
from datetime import datetime, timedelta

from core.feeds.base import Opp, to_usd

CPV_PREFIXES = ("72", "48", "38", "31", "32", "51", "50", "71", "73")
NAICS_PREFIXES = ("541511", "541512", "541330", "541715", "334", "811")
MIN_DAYS_TO_DEADLINE = 10

# (phrase, weight). Strong, specific terms weigh 3; generic ones 1 so "monitoring and evaluation" cannot dominate.
KEYWORDS: tuple[tuple[str, int], ...] = (
    ("scada", 3), ("plc", 3), ("telemetry", 3), ("firmware", 3), ("embedded", 3), ("iot", 3),
    ("internet of things", 3), ("sensor", 2), ("sensors", 2), ("data logger", 3), ("datalogger", 3),
    ("penetration test", 3), ("penetration testing", 3), ("pentest", 3), ("reverse engineering", 3),
    ("digital twin", 3), ("condition monitoring", 3), ("remote monitoring", 3), ("data acquisition", 3),
    ("protocol", 1), ("modbus", 3), ("industrial automation", 2), ("pcb", 2), ("circuit board", 2),
    ("software development", 2), ("bespoke software", 2), ("custom software", 2), ("web application", 2),
    ("mobile app", 2), ("mobile application", 2), ("booking system", 2), ("inventory", 1), ("crm", 2),
    ("dashboard", 1), ("monitoring", 1), ("cyber security testing", 2), ("security testing", 2),
)
# Extra terms for one source only. Pakistani federal tenders name the kit (CCTV, biometric, RFID, smart meters, tank
# gauging) where other feeds say "monitoring system"; the feed's own pre-filter (core/feeds/ppra_epms.py) has
# already dropped supply and works lots, so these only rank what is left.
SOURCE_KEYWORDS: dict[str, tuple[tuple[str, int], ...]] = {
    "ppra_epms": (("cctv", 2), ("biometric", 2), ("rfid", 2), ("smart meter", 3), ("smart metering", 3),
                  ("tank gauging", 3), ("automatic tank gauge", 3), ("vapt", 3), ("cybersecurity", 2),
                  ("cyber security", 2), ("software", 1), ("automation", 1), ("artificial intelligence", 2),
                  ("video surveillance", 2), ("web portal", 2), ("ami", 2)),
}


def _compile(pairs) -> list:
    return [(re.compile(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", re.I), k, w) for k, w in pairs]


_KW = _compile(KEYWORDS)
_SOURCE_KW = {s: _compile(pairs) for s, pairs in SOURCE_KEYWORDS.items()}


def keyword_hits(text: str) -> list[str]:
    return [k for rx, k, _ in _KW if rx.search(text or "")]


def keyword_score(opp: Opp) -> int:
    text = f"{opp.title}\n{opp.summary}"
    kws = _KW + _SOURCE_KW.get(opp.source, [])
    seen = {k: w for rx, k, w in kws if rx.search(text)}
    # a title hit counts double: that is what the buyer says they are buying
    title_bonus = sum(w for rx, k, w in kws if rx.search(opp.title or ""))
    return sum(seen.values()) + title_bonus


CPV_SOURCES = ("ted", "uk_fts", "uk_cf")   # CanadaBuys and AusTender use UNSPSC/GSIN, which only look like CPV


def code_match(opp: Opp) -> bool:
    """CPV prefix (EU/UK feeds) or NAICS prefix (SAM.gov). Other schemes are ignored, never guessed."""
    for c in opp.cpv_or_naics:
        c = str(c).strip().split("-")[0]
        if opp.source in CPV_SOURCES and len(c) == 8 and c.startswith(CPV_PREFIXES):
            return True
        if opp.source == "samgov" and len(c) == 6 and c.startswith(NAICS_PREFIXES):
            return True
    return False


def relevance(opp: Opp) -> int:
    """Rank: keyword score, plus 1 for a CPV/NAICS match. Only meaningful when is_relevant()."""
    return keyword_score(opp) + (1 if code_match(opp) else 0)


def is_relevant(opp: Opp) -> bool:
    return keyword_score(opp) > 0


def deadline_ok(opp: Opp, now: datetime, min_days: int = MIN_DAYS_TO_DEADLINE) -> bool:
    """True when there are at least `min_days` left. An unknown deadline is kept: the brief says so."""
    if opp.deadline_at is None:
        return True
    return opp.deadline_at - now >= timedelta(days=min_days)


def value_usd(opp: Opp) -> tuple[float | None, float | None]:
    return to_usd(opp.value_min, opp.currency), to_usd(opp.value_max, opp.currency)


def value_ok(opp: Opp, lo: float, hi: float) -> bool:
    """Keep unknown values. For a stated range, keep when it overlaps the band [lo, hi] (USD equivalent)."""
    vmin, vmax = value_usd(opp)
    if vmin is None and vmax is None:
        return True
    vmin = vmax if vmin is None else vmin
    vmax = vmin if vmax is None else vmax
    return vmax >= lo and vmin <= hi
