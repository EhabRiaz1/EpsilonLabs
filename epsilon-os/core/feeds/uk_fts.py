"""UK Find a Tender Service (above-threshold UK procurement), OCDS release packages.

    GET https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
        ?updatedFrom=YYYY-MM-DDTHH:MM:SS&stages=tender&limit=100        (no key; verified live 2026-10-11)
Response: an OCDS release package. `links.next` (when present) is the full URL of the next page (cursor).
Notice page: https://www.find-tender.service.gov.uk/Notice/<release id>.
"""
from datetime import date

from core.feeds import base, ocds
from core.feeds.base import Opp

SOURCE = "uk_fts"
URL = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
LIMIT = 100
MAX_PAGES = 15


def notice_url(rel: dict) -> str:
    return f"https://www.find-tender.service.gov.uk/Notice/{rel.get('id')}"


def fetch(since: date, client=None) -> list[Opp]:
    c = client or base.client()
    params = {"updatedFrom": f"{since.isoformat()}T00:00:00", "stages": "tender", "limit": LIMIT}
    out: dict[str, Opp] = {}
    url, kw = URL, {"params": params}
    for page in range(MAX_PAGES):
        if page:
            base.pause()
        data = base.request(c, "GET", url, **kw).json()
        for rel in data.get("releases") or []:
            o = ocds.parse_release(rel, SOURCE, notice_url)
            if o:
                out[o.source_id] = o  # a later release of the same notice supersedes the earlier one
        nxt = (data.get("links") or {}).get("next")
        if not nxt:
            break
        url, kw = nxt, {}
    return list(out.values())
