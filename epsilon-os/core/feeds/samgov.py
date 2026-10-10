"""US SAM.gov Opportunities API v2.

    GET https://api.sam.gov/opportunities/v2/search
        ?api_key=<key>&postedFrom=MM/DD/YYYY&postedTo=MM/DD/YYYY&limit=1000&offset=0&ptype=o,k,r&ncode=<naics>
Key: keychain service `epsilon-os-samgov`, account `sam.gov`. When it is absent the feed is skipped silently
(`fetch` returns [] after one log line) and the key never appears in a log, an exception or the raw data.

Verified live 2026-10-11 with a real key (HTTP 200, response shape below; fixture saved from it with the
pointOfContact block removed): opportunitiesData[]: noticeId, title, solicitationNumber, fullParentPathName,
postedDate, type, responseDeadLine, naicsCode, classificationCode, typeOfSetAside(+Description), description
(a URL that needs the key; we do not follow it), uiLink, award, officeAddress (ISO3 countryCode),
placeOfPerformance. The search text is thin (title + type), so keyword relevance comes mostly from the title.
The API is rate-limited per key (HTTP 429 after ~9 calls in a minute, seen 2026-10-11), so we make one call per
1000 notices posted in the window (at most MAX_PAGES), with no NAICS filter, and filter locally by keyword/NAICS.
"""
import sys
from datetime import date

from core import config
from core.feeds import base
from core.feeds.base import Opp

SOURCE = "samgov"
URL = "https://api.sam.gov/opportunities/v2/search"
SERVICE, ACCOUNT = "epsilon-os-samgov", "sam.gov"
PTYPES = "o,k,r,p"   # solicitation, combined synopsis/solicitation, sources sought, presolicitation
LIMIT = 1000
MAX_PAGES = 3


def api_key() -> str | None:
    try:
        return config.secret(SERVICE, ACCOUNT)
    except Exception:
        return None


def _mdy(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def parse(item: dict) -> Opp | None:
    nid, title = item.get("noticeId"), base.clean_text(item.get("title"), 300)
    if not nid or not title:
        return None
    office = item.get("officeAddress") or {}
    pop = item.get("placeOfPerformance") or {}
    pop_country = ((pop.get("country") or {}).get("code") if isinstance(pop.get("country"), dict) else None) or ""
    codes = [str(c) for c in (item.get("naicsCode"), item.get("classificationCode")) if c]
    amount = base.num(((item.get("award") or {}).get("amount")))
    setaside = item.get("typeOfSetAside") or ""
    return Opp(
        source=SOURCE, source_id=str(nid), title=title, url=item.get("uiLink") or f"https://sam.gov/opp/{nid}/view",
        buyer=base.clean_text((item.get("fullParentPathName") or "").replace(".", " / "), 200),
        country=base.country_code(office.get("countryCode") or "US"), cpv_or_naics=codes,
        published_at=base.parse_dt(item.get("postedDate")), deadline_at=base.parse_dt(item.get("responseDeadLine")),
        value_min=amount, value_max=amount, currency="USD" if amount else "",
        summary=base.clean_text(" ".join(x for x in (item.get("type"), item.get("typeOfSetAsideDescription")) if x)),
        raw={"set_aside": setaside if setaside and setaside.upper() != "NONE" else "",
             "set_aside_description": item.get("typeOfSetAsideDescription") or "",
             "solicitation": item.get("solicitationNumber"), "notice_type": item.get("type"),
             "place_of_performance_country": pop_country},
    )


def fetch(since: date, client=None, today: date | None = None, key: str | None = None) -> list[Opp]:
    key = key or api_key()
    if not key:
        print("samgov: no API key in keychain (epsilon-os-samgov); feed skipped", file=sys.stderr)
        return []
    c = client or base.client()
    today = today or date.today()
    out: dict[str, Opp] = {}
    for page in range(MAX_PAGES):
        if page:
            base.pause()
        params = {"api_key": key, "postedFrom": _mdy(since), "postedTo": _mdy(today), "limit": LIMIT,
                  "offset": page * LIMIT, "ptype": PTYPES}
        data = base.request(c, "GET", URL, params=params, retries=2).json()
        items = data.get("opportunitiesData") or []
        for item in items:
            o = parse(item)
            if o:
                out.setdefault(o.source_id, o)
        if len(items) < LIMIT:
            break
    return list(out.values())
