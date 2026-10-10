"""UK Contracts Finder (below-threshold and central-government UK opportunities), OCDS search.

    GET https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search
        ?publishedFrom=YYYY-MM-DD&publishedTo=YYYY-MM-DD&stages=tender&limit=100   (no key; verified live 2026-10-11)
Response: an OCDS release package, no paging links. `publishedTo` behaves as exclusive: a window with from == to
returns nothing, from=D to=D+1 returns D. We therefore walk two-day windows [D, D+2) so a busy week cannot be
silently cut at the page size (limit 100); the overlap is harmless because releases are keyed by ocid.
Notice page: documents[tenderNotice].url.
"""
from datetime import date, timedelta

from core.feeds import base, ocds
from core.feeds.base import Opp

SOURCE = "uk_cf"
URL = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"
LIMIT = 100
MAX_DAYS = 14


def notice_url(rel: dict) -> str:
    for d in (rel.get("tender") or {}).get("documents") or []:
        if isinstance(d, dict) and d.get("url") and d.get("documentType") == "tenderNotice":
            return d["url"]
    nid = str(rel.get("id") or "").rsplit("-", 1)[0]
    return f"https://www.contractsfinder.service.gov.uk/Notice/{nid}" if nid else ""


def fetch(since: date, client=None, today: date | None = None) -> list[Opp]:
    c = client or base.client()
    today = today or date.today()
    day = max(since, today - timedelta(days=MAX_DAYS))
    out: dict[str, Opp] = {}
    first = True
    while day <= today:
        if not first:
            base.pause()
        first = False
        params = {"publishedFrom": day.isoformat(), "publishedTo": (day + timedelta(days=2)).isoformat(),
                  "stages": "tender", "limit": LIMIT}
        data = base.request(c, "GET", URL, params=params).json()
        for rel in data.get("releases") or []:
            o = ocds.parse_release(rel, SOURCE, notice_url)
            if o:
                out[o.source_id] = o
        day += timedelta(days=2)
    return list(out.values())
